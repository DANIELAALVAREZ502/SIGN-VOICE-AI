// =========================================================================
// js/avatar/poses.js
// -------------------------------------------------------------------------
// CARGA DE DICCIONARIOS DE POSES (LSE/ASL) + UTILIDADES DE INTERPOLACIÓN
// =========================================================================
//
// PROPÓSITO
//   Puente entre los assets JSON (assets/signs/signs.*.json) y el reproductor
//   del avatar (player.js). Expone:
//     - loadDict(lang)      → carga (y cachea) el diccionario LSE o ASL
//     - getLetterPose(ch)   → pose de una letra dactilológica (A–Z)
//     - getWordPose(word)   → pose de una palabra completa (si existe)
//     - lerpPose(a, b, t)   → interpolación lineal entre dos poses (0..1)
//     - restPose()          → pose neutra de reposo para el rig
//
// DISEÑO
//   - Caché en memoria por idioma (Map): el JSON solo se fetcha una vez.
//   - Tolerancia a fallos: si el fetch falla (offline sin caché SW), devuelve
//     un diccionario vacío en lugar de romper la reproducción (el player
//     simplemente omitirá las poses y mostrará subtítulos).
//   - Las poses son arrays de 21 puntos [x,y] normalizados en el espacio del
//     rig (mismo sistema que rig.applyPose): centro (0.5,0.5), y hacia abajo.
//
// FORMATO DEL JSON
//   { meta:{...}, letters:{ "A": {desc, pose:[[x,y]x21], trail?} },
//     words:{ "hola": {desc, pose?, clip?} } }
// =========================================================================

import { CONFIG } from '../core/config.js';

/** Caché de diccionarios ya cargados: 'LSE' | 'ASL' → dict */
const cache = new Map();

/** Diccionario activo (el que usa getLetterPose/getWordPose) */
let dict = null;

/** Idioma activo del diccionario: 'LSE' | 'ASL' */
let lang = 'LSE';

/**
 * Carga el diccionario del idioma indicado y lo deja como activo.
 * Idempotente: si ya está en caché no vuelve a fetchar.
 * @param {'LSE'|'ASL'} l — idioma de señas
 * @returns {Promise<object>} diccionario (nunca null; vacío si falla)
 */
export async function loadDict(l = 'LSE') {
  // Normalizar a las dos variantes soportadas (cualquier otro valor → LSE)
  lang = l === 'ASL' ? 'ASL' : 'LSE';

  // 1) ¿Ya en caché? Devolver sin red (clave estable por idioma)
  if (cache.has(lang)) {
    dict = cache.get(lang);
    return dict;
  }

  // 2) Resolver URL desde CONFIG (un solo punto de verdad de rutas)
  const url = lang === 'ASL' ? CONFIG.PATHS.SIGNS_EN : CONFIG.PATHS.SIGNS_ES;

  try {
    // 3) Fetch con force-cache: si el SW ya lo sirve, ni se va a la red
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('fetch ' + res.status);
    dict = await res.json();

    // 4) Validación mínima de forma (evita crash en player con JSON raro)
    if (!dict || typeof dict !== 'object' || !dict.letters) {
      dict = { letters: {}, words: {} };
    }
    cache.set(lang, dict);
    return dict;
  } catch (e) {
    // 5) Fallo tolerado: cacheamos un dict vacío para no reintentar en bucle
    console.warn('[poses] loadDict error:', e);
    dict = { letters: {}, words: {} };
    cache.set(lang, dict);
    return dict;
  }
}

/**
 * Cambia el idioma ACTIVO sin recargar (el diccionario ya debe estar en caché;
 * si no lo está, mantiene el actual hasta que loadDict lo resuelva).
 * @param {'LSE'|'ASL'} l
 */
export function setLang(l) {
  lang = l === 'ASL' ? 'ASL' : 'LSE';
  if (cache.has(lang)) dict = cache.get(lang);
}

/** @returns {'LSE'|'ASL'} idioma activo */
export function getLang() {
  return lang;
}

/** @returns {boolean} ¿hay diccionario cargado con letras? */
export function hasDict() {
  return !!(dict && dict.letters && Object.keys(dict.letters).length);
}

/**
 * Pose de una letra A–Z (case-insensitive).
 * @param {string} letter
 * @returns {{desc?:string, pose?:number[][], trail?:number[][]}|null}
 */
export function getLetterPose(letter = 'A') {
  if (!dict) return null;
  const L = String(letter).toUpperCase().trim();
  return dict.letters?.[L] || null;
}

/**
 * Pose de una palabra completa ("hola", "gracias"…). Si no existe,
 * el player cae a deletreo letra por letra (mejora progresiva).
 * @param {string} word
 * @returns {object|null}
 */
export function getWordPose(word = '') {
  if (!dict) return null;
  // Normalización: minúsculas + NFD sin acentos ("señal" → "senal")
  const w = String(word)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return dict.words?.[w] || dict.words?.[String(word).toLowerCase()] || null;
}

/** Lista de letras disponibles (para UI/debug) */
export function listLetters() {
  return dict && dict.letters ? Object.keys(dict.letters) : [];
}

/** Meta del diccionario activo (nombre, versión, licencia…) */
export function getMeta() {
  return dict?.meta || null;
}

/**
 * Pose neutra de reposo: usa la "B" (mano abierta) si existe; si no, la
 * primera disponible; si el dict está vacío, null (rig usa su estado inicial).
 * @returns {object|null}
 */
export function restPose() {
  return getLetterPose('B') || getLetterPose('A') || null;
}

/**
 * Interpola linealmente entre dos poses (21 puntos).
 * El player la llama en cada frame de animación con t ∈ [0,1] ya eased.
 *
 * @param {object|number[][]} poseA — pose origen (acepta {points}|{pose}|array)
 * @param {object|number[][]} poseB — pose destino
 * @param {number} t — factor 0..1 (se clampa para tolerar overshoot)
 * @returns {{points:number[][]}} pose interpolada (formato rig.applyPose)
 */
export function lerpPose(poseA, poseB, t) {
  // Extraer arrays de puntos de las tres formas posibles de entrada
  const a = poseA?.points || poseA?.pose || poseA || [];
  const b = poseB?.points || poseB?.pose || poseB || [];

  // Clamp defensivo del progreso (el easing puede oscilar ligeramente)
  const tt = Math.max(0, Math.min(1, t));

  // Pre-asignar 21 puntos [0,0] (evita push en bucle y garantiza longitud)
  const out = Array.from({ length: 21 }, () => [0, 0]);

  for (let i = 0; i < 21; i++) {
    // Si falta un punto en origen/destino, usar el otro extremo (no NaN)
    const pa = a[i] || b[i] || [0, 0];
    const pb = b[i] || a[i] || [0, 0];
    // Lerp clásico: p = a + (b − a)·t
    out[i][0] = pa[0] + (pb[0] - pa[0]) * tt;
    out[i][1] = pa[1] + (pb[1] - pa[1]) * tt;
  }
  return { points: out };
}

/**
 * ¿La pose tiene trayectoria (J/Z)? Las letras con movimiento traen `trail`
 * (array de puntos que rig dibuja como polilínea discontinua magenta).
 * @param {object|null} pose
 * @returns {boolean}
 */
export function hasTrail(pose) {
  return !!(pose && Array.isArray(pose.trail) && pose.trail.length > 1);
}
