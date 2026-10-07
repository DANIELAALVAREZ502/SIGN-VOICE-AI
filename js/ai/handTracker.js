// =========================================================================
// js/ai/handTracker.js
// -------------------------------------------------------------------------
// WRAPPER DE MEDIAPIPE TASKS VISION — HAND LANDMARKER (lazy + offline-aware)
// =========================================================================
//
// PROPÓSITO
//   Carga diferida de @mediapipe/tasks-vision. Soporta dos fuentes:
//     - LOCAL: ./vendor/vision_bundle.mjs + ./vendor/hand_landmarker.task + wasm/
//     - CDN:   https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1
//
// DECISIÓN ARQUITECTÓNICA
//   NO se precarga en boot. Solo se carga al pulsar "Iniciar cámara" en el
//   reconocedor. Esto mantiene el shell ligero (~200 KB) y respeta el
//   principio "motor IA bajo demanda" (19 MB).
//
// NOTA DE OFFLINE
//   Si el usuario descargó los assets a svai-ai-v1 (SW message 'svai.cache-ai'),
//   el Service Worker responderá cache-first. Si NO los descargó y estamos
//   offline, la importación/fetch fallará → UI mostrará aviso claro.
// =========================================================================

import { CONFIG } from '../core/config.js';
import { net } from '../core/net.js';

let Vision = null;
let HandLandmarker = null;
let loadingPromise = null;
let instance = null;

/**
 * Carga dinámica del módulo Tasks Vision (local primero si existe, sino CDN)
 */
async function loadVision() {
  if (Vision && HandLandmarker) return { Vision, HandLandmarker };
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // Intento 1: LOCAL (vendor/)
      const localBundle = CONFIG.MEDIAPIPE.LOCAL_BUNDLE;
      const mod = await import(/* @vite-ignore */ localBundle).catch(() => null);
      if (mod && mod.Vision && mod.HandLandmarker) {
        Vision = mod.Vision;
        HandLandmarker = mod.HandLandmarker;
        return { Vision, HandLandmarker };
      }
    } catch (e) {
      // ignorar y probar CDN
    }

    // Intento 2: CDN (solo si online)
    if (!net.isOnline()) {
      throw new Error('IA no disponible offline: motor no descargado. Usa el botón "Descargar motor de IA (19 MB)" desde Ajustes/Reconocedor.');
    }
    const cdn = `${CONFIG.MEDIAPIPE.CDN_BASE}/vision_bundle.mjs`;
    const mod = await import(/* @vite-ignore */ cdn);
    if (!mod || !mod.Vision || !mod.HandLandmarker) {
      throw new Error('Tasks Vision import inválido desde CDN');
    }
    Vision = mod.Vision;
    HandLandmarker = mod.HandLandmarker;
    return { Vision, HandLandmarker };
  })();

  return loadingPromise;
}

/**
 * Crea una instancia de HandLandmarker con opciones seguras
 * @param {{useLocalWasm?:boolean, onError?:(e:any)=>void}} opts
 */
export async function createLandmarker(opts = {}) {
  const { Vision, HandLandmarker } = await loadVision();

  const useLocal = opts.useLocalWasm !== false;
  const baseOptions = {
    baseOptions: {
      modelAssetPath: useLocal ? CONFIG.MEDIAPIPE.LOCAL_TASK : `${CONFIG.MEDIAPIPE.CDN_BASE}/hand_landmarker.task`,
      delegate: 'GPU',
    },
    runningMode: CONFIG.MEDIAPIPE.RUNNING_MODE,
    numHands: CONFIG.MEDIAPIPE.NUM_HANDS,
    minHandDetectionConfidence: CONFIG.MEDIAPIPE.MIN_HAND_DETECTION_CONFIDENCE,
    minHandPresenceConfidence: CONFIG.MEDIAPIPE.MIN_HAND_PRESENCE_CONFIDENCE,
    minTrackingConfidence: CONFIG.MEDIAPIPE.MIN_TRACKING_CONFIDENCE,
  };

  try {
    instance = await HandLandmarker.createFromOptions(Vision, baseOptions);
    return instance;
  } catch (err) {
    console.error('[handTracker] createFromOptions falló:', err);
    if (opts.onError) opts.onError(err);
    throw err;
  }
}

/** Devuelve instancia activa o null */
export function getLandmarker() {
  return instance;
}

/** Destruye instancia (liberar WASM/GPU) */
export function dispose() {
  if (instance && typeof instance.close === 'function') {
    try {
      instance.close();
    } catch (_) {}
  }
  instance = null;
}

/** Estado de carga */
export function isLoaded() {
  return instance !== null;
}
