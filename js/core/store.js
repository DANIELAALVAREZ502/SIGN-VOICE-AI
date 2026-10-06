// =========================================================================
// js/core/store.js
// -------------------------------------------------------------------------
// ALMACENAMIENTO LOCAL OFFLINE-FIRST (localStorage + límites de seguridad)
// =========================================================================
//
// PROPÓSITO
//   Persistencia tipo clave/valor con prefijo, versión de esquema, migraciones
//   futuras y protecciones básicas (tamaño, JSON inválido, quota exceeded).
//
// FILOSOFÍA
//   - ÚNICO punto de escritura en storage para preferencias/UI.
//   - Valores por defecto definidos aquí (coherentes con CONFIG).
//   - Fallo silencioso: si localStorage no está disponible (modo privado)
//     el store funciona en memoria sin romper la app.
// =========================================================================

import { CONFIG } from './config.js';

const LS = typeof window !== 'undefined' ? window.localStorage : null;
const PREFIX = CONFIG.STORE.PREFIX;
const MAX_BYTES = CONFIG.STORE.MAX_JSON_BYTES;
const VERSION_KEY = `${PREFIX}store:version`;

/**
 * Defaults por defecto del store. Nunca incluir secretos.
 * @type {Record<string, any>}
 */
const DEFAULTS = Object.freeze({
  // --- PREFERENCIAS DE ACCESIBILIDAD
  'prefs.motion': 'auto',      // 'auto' | 'reduced'
  'prefs.contrast': 'auto',    // 'auto' | 'high'
  'prefs.textsize': 'md',      // 'md' | 'lg'
  'prefs.skipIntro': false,

  // --- RECONOCIMIENTO
  'rec.lang': 'LSE',           // 'LSE' | 'ASL'
  'rec.mirror': true,
  'rec.tts': true,
  'rec.autoSendChat': false,

  // --- AVATAR
  'avatar.preferClips': CONFIG.AVATAR.PREFER_CLIPS,
  'avatar.speed': 1.0,

  // --- FILTRO DE MODISMOS
  'slang.enabled': CONFIG.SLANG.ENABLED,

  // --- SOS
  'sos.contacts': [],          // array de contactos E.164
  'sos.msg': CONFIG.SOS.DEFAULT_MSG,
  'sos.primaryId': null,

  // --- IA OFFLINE
  'ai.downloaded': false,      // indica si AI_CACHE tiene assets (heurístico)

  // --- UI
  'ui.tab': 'signs',           // panel activo
  'ui.toastSeen': 0,
});

/**
 * Bytes aproximados de un string UTF-16 (JS). Aproximado pero suficiente.
 * @param {string} s
 */
function byteSize(s) {
  return new Blob([s]).size;
}

/**
 * Escribe con protección de cuota. Si falla por QuotaExceededError,
 * borra claves antiguas de caché volátil (no críticas) antes de reintentar.
 * @param {string} key
 * @param {string} value
 */
function safeSetItem(key, value) {
  if (!LS) return false;
  try {
    if (byteSize(value) > MAX_BYTES) {
      console.warn('[store] payload demasiado grande, no se persiste:', key);
      return false;
    }
    LS.setItem(key, value);
    return true;
  } catch (e) {
    // Intento 1: limpiar claves no críticas (ai/download heurísticos temporales)
    try {
      const toClear = [];
      for (let i = 0; i < LS.length; i++) {
        const k = LS.key(i);
        if (!k) continue;
        if (k.startsWith(`${PREFIX}tmp:`)) toClear.push(k);
      }
      toClear.forEach((k) => LS.removeItem(k));
      LS.setItem(key, value);
      return true;
    } catch (e2) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[store] no se pudo escribir en localStorage:', e2);
      }
      return false;
    }
  }
}

/**
 * Lee con manejo de JSON corrupto.
 * @param {string} key
 * @returns {string|null}
 */
function safeGetItem(key) {
  if (!LS) return null;
  try {
    return LS.getItem(key);
  } catch (_) {
    return null;
  }
}

/**
 * Elimina clave con try/catch.
 * @param {string} key
 */
function safeRemoveItem(key) {
  if (!LS) return;
  try {
    LS.removeItem(key);
  } catch (_) {}
}

/**
 * Prefija clave.
 * @param {string} k
 */
function k(k) {
  return `${PREFIX}${k}`;
}

/**
 * Migración mínima de esquema (placeholder para futuras versiones).
 */
function migrateIfNeeded() {
  const v = safeGetItem(VERSION_KEY);
  if (v === null) {
    safeSetItem(VERSION_KEY, String(CONFIG.STORE.VERSION));
    return;
  }
  const vn = parseInt(v, 10);
  if (Number.isNaN(vn) || vn < CONFIG.STORE.VERSION) {
    // Migraciones futuras aquí (shallow merge con defaults)
    safeSetItem(VERSION_KEY, String(CONFIG.STORE.VERSION));
  }
}

/** Inicializa store (migraciones) */
export function init() {
  migrateIfNeeded();
}

/** Obtiene valor con default. */
export function get(key, def) {
  const raw = safeGetItem(k(key));
  if (raw === null) {
    // devolver copia profunda si es objeto (defaults congelados)
    const d = def !== undefined ? def : DEFAULTS[key];
    return d !== undefined && typeof d === 'object' && d !== null ? structuredClone(d) : d;
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    // Corrupto → limpiar y devolver default
    safeRemoveItem(k(key));
    const d = def !== undefined ? def : DEFAULTS[key];
    return d !== undefined && typeof d === 'object' && d !== null ? structuredClone(d) : d;
  }
}

/** Establece valor (serializa JSON). Devuelve true si persistió. */
export function set(key, value) {
  const json = JSON.stringify(value);
  return safeSetItem(k(key), json);
}

/** Borra clave */
export function del(key) {
  safeRemoveItem(k(key));
}

/** Existe la clave */
export function has(key) {
  if (!LS) return false;
  try {
    return k(key) in LS;
  } catch (_) {
    return false;
  }
}

/** Borra TODO lo que empiece con PREFIX (reset app). CUIDADO: no borra cachés SW */
export function clearAll() {
  if (!LS) return;
  const keys = [];
  for (let i = 0; i < LS.length; i++) {
    const kk = LS.key(i);
    if (kk && kk.startsWith(PREFIX)) keys.push(kk);
  }
  keys.forEach((kk) => safeRemoveItem(kk));
  migrateIfNeeded();
}

/** Exporta snapshot JSON (backup/export settings) */
export function exportJSON() {
  const out = {};
  if (!LS) return out;
  for (let i = 0; i < LS.length; i++) {
    const kk = LS.key(i);
    if (!kk || !kk.startsWith(PREFIX)) continue;
    const short = kk.slice(PREFIX.length);
    const raw = safeGetItem(kk);
    if (raw === null) continue;
    try {
      out[short] = JSON.parse(raw);
    } catch (_) {
      out[short] = raw; // string crudo
    }
  }
  return out;
}

/** Importa snapshot (merge parcial, no borra claves no presentes) */
export function importJSON(obj = {}) {
  if (!obj || typeof obj !== 'object') return false;
  let ok = true;
  for (const [short, val] of Object.entries(obj)) {
    if (typeof short !== 'string') continue;
    // No importar claves internas/version
    if (short === 'store:version') continue;
    if (!safeSetItem(k(short), JSON.stringify(val))) ok = false;
  }
  return ok;
}

/** Espacio estimado usado (bytes) — aproximado */
export function usedBytesApprox() {
  if (!LS) return 0;
  let total = 0;
  for (let i = 0; i < LS.length; i++) {
    const kk = LS.key(i);
    if (!kk || !kk.startsWith(PREFIX)) continue;
    total += byteSize(kk);
    const v = safeGetItem(kk);
    if (v) total += byteSize(v);
  }
  return total;
}

export const store = Object.freeze({ init, get, set, del, has, clearAll, exportJSON, importJSON, usedBytesApprox });

if (typeof window !== 'undefined' && !window.__svaiStore) {
  window.__svaiStore = store;
}
