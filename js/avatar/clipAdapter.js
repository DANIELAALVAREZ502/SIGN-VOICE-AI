// =========================================================================
// js/avatar/clipAdapter.js
// -------------------------------------------------------------------------
// ADAPTADOR DE CLIPS DE VÍDEO (MEJORA PROGRESIVA DEL AVATAR SVG)
// =========================================================================
//
// PROPÓSITO
//   El avatar base es 100% procedural (SVG, offline, $0). Este módulo permite
//   que SIEMPRE que exista un clip real en assets/signs/clips/<clave>.mp4
//   (grabado por el usuario o descargado), el reproductor conmute al vídeo
//   real sin reescribir nada: rig → clip → rig.
//
// DISEÑO
//   - probeClip(clave): HEAD request con caché en memoria (Map). Si el
//     servidor devuelve 404 → cachea "no existe" y no vuelve a preguntar
//     (evita latencia por cada tecla). file:// y hosts sin HEAD → null.
//   - play(src, stage): crea UN <video> reutilizable dentro de #avatar-stage,
//     aplica fade (CONFIG.AVATAR.CLIP_FADE_MS) y resuelve al terminar.
//   - stop(): corta el vídeo actual (usado por player.stop()).
//   - Nunca lanza excepciones no controladas: si el clip falla, el player
//     simplemente sigue con la pose SVG (fallback silencioso documentado).
// =========================================================================

import { CONFIG } from '../core/config.js';

/** Cache clave → true (existe) | false (no existe). Evita HEAD repetidos. */
const probeCache = new Map();

/** Elemento <video> único (se crea bajo demanda y se reutiliza) */
let videoEl = null;

/** Referencia al stage actual (para montar/desmontar) */
let stageEl = null;

/**
 * Resuelve la URL de un clip por clave de letra/palabra.
 * Convención: <clave minúscula>.mp4 dentro de SIGNS_CLIPS_DIR.
 * @param {string} key — p. ej. "hola", "a"
 * @returns {string} URL relativa del clip
 */
export function clipUrl(key) {
  return `${CONFIG.PATHS.SIGNS_CLIPS_DIR}${String(key).toLowerCase()}.mp4`;
}

/**
 * Comprueba si existe un clip para la clave (HEAD + caché).
 * @param {string} key
 * @returns {Promise<boolean>} true si el servidor confirmó 2xx/3xx
 */
export async function probeClip(key) {
  const k = String(key).toLowerCase();
  // 1) ¿Ya sabemos la respuesta? Devolver sin red (positiva o negativa)
  if (probeCache.has(k)) return probeCache.get(k);

  // 2) HEAD con timeout corto: un 404 no debe frenar la reproducción
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(clipUrl(k), {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'force-cache',
    });
    clearTimeout(timer);
    const ok = res.ok;
    probeCache.set(k, ok); // recordar tanto sí como no
    return ok;
  } catch (_) {
    // Sin red / HEAD no soportado / file:// → asumimos "no clip" (SVG gana)
    probeCache.set(k, false);
    return false;
  }
}

/**
 * Crea (si no existe) el <video> dentro del stage y lo devuelve.
 * Seis atributos clave: playsinline (iOS), preload auto, sin controles
 * (es avatar, no reproductor), muted (autoplay permitido sin gesto),
 * aria-hidden (el equivalente accesible es el subtítulo).
 * @param {HTMLElement} stage
 * @returns {HTMLVideoElement|null}
 */
function ensureVideo(stage) {
  if (!stage) return null;
  if (videoEl && videoEl.parentNode === stage) return videoEl;

  // Limpiar cualquier vídeo huérfano de una iteración previa
  if (videoEl && videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);

  videoEl = document.createElement('video');
  videoEl.className = 'avatar__clip';
  videoEl.setAttribute('playsinline', '');   // iPhone: no salir a pantalla completa
  videoEl.setAttribute('webkit-playsinline', ''); // Safari viejo
  videoEl.muted = true;                       // autoplay seguro (sin audio forzado)
  videoEl.loop = false;                       // cada clip = una seña; no repetir
  videoEl.preload = 'auto';
  videoEl.setAttribute('aria-hidden', 'true'); // decorativo: subtítulo = a11y real
  stage.appendChild(videoEl);
  return videoEl;
}

/**
 * Reproduce un clip de vídeo y resuelve cuando termina (o al error).
 * Mientras el clip corre, el stage oculta el rig SVG (data-clip="on") y el
 * CSS funde la opacidad. Si algo falla, devuelve false y el player cae al
 * modo SVG para ese paso (fallback total, nunca aborta la frase).
 *
 * @param {string} key — clave del clip
 * @param {HTMLElement} stage — contenedor #avatar-stage
 * @returns {Promise<boolean>} true si el clip se reprodujo
 */
export async function play(key, stage) {
  if (!CONFIG.AVATAR.PREFER_CLIPS) return false;
  const exists = await probeClip(key);
  if (!exists) return false;

  const video = ensureVideo(stage || stageEl);
  if (!video) return false;
  stageEl = stage || stageEl;

  return new Promise((resolve) => {
    let settled = false;
    // Resolver una sola vez (ended y error pueden solaparse)
    const done = (ok) => {
      if (settled) return;
      settled = true;
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      // Fade-out + ocultar (el CSS transiciona con CLIP_FADE_MS)
      if (stageEl) stageEl.dataset.clip = 'off';
      setTimeout(() => resolve(ok), CONFIG.AVATAR.CLIP_FADE_MS);
    };
    const onEnded = () => done(true);
    const onError = () => done(false); // 404 entre probe y play, codec raro…

    video.addEventListener('ended', onEnded, { once: true });
    video.addEventListener('error', onError, { once: true });

    video.src = clipUrl(key);
    // Mostrar el clip: stage[data-clip=on] → SVG funde a 0, vídeo a 1
    if (stageEl) stageEl.dataset.clip = 'on';
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      // Autoplay bloqueado (política de navegador): fallback SVG inmediato
      p.catch(() => done(false));
    }
    // Red de seguridad: si el vídeo nunca dispara 'ended' (bug de codec),
    // cortamos a los 6 s para no bloquear la cola del player.
    setTimeout(() => done(true), 6000);
  });
}

/**
 * Detiene el clip en curso (estado "stopped" del player).
 * Silencioso: también sirve si nunca hubo clip.
 */
export function stop() {
  if (!videoEl) return;
  try {
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load(); // libera el buffer de decodificación
  } catch (_) { /* ignorado: el vídeo ya estaba liberado */ }
  if (stageEl) stageEl.dataset.clip = 'off';
}

/**
 * Reinicia la caché de probes (útil al cambiar de origen o en tests).
 */
export function clearProbeCache() {
  probeCache.clear();
}

export const clipAdapter = Object.freeze({
  clipUrl,
  probeClip,
  play,
  stop,
  clearProbeCache,
});
