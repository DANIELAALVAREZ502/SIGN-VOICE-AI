// =========================================================================
// js/speech/stt.js
// -------------------------------------------------------------------------
// SPEECH-TO-TEXT (Web Speech API) — reconocimiento de voz continuo
// =========================================================================
//
// PROPÓSITO
//   Envuelve SpeechRecognition / webkitSpeechRecognition con:
//     - detección de soporte (feature detection, sin lanzar)
//     - reinicio automático controlado (onend → restart si el usuario sigue)
//     - idioma derivado del store ('rec.lang' → es-ES / en-US)
//     - eventos por bus (desacopla la UI: mic.js solo escucha)
//
// PRINCIPIO OFFLINE-FIRST
//   La Web Speech API suele depender de la nube del navegador. Si no hay
//   soporte o falla, la app DEBE seguir funcionando con el fallback de
//   escritura manual (el panel de voz ya lo indica). Nunca lanzamos excepción
//   fuera del módulo: emitimos 'stt:error' y dejamos el estado consistente.
//
// EVENTOS DEL BUS
//   emite: 'stt:start' {lang} · 'stt:result' {final,interim,isFinal} ·
//          'stt:end' {manual} · 'stt:error' {error} · 'stt:state' {listening}
// =========================================================================

import { CONFIG } from '../core/config.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';

/** Constructor nativo (con prefijo para Safari/WebKit) */
const Recognition = (typeof window !== 'undefined')
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

let rec = null;            // instancia de reconocimiento (reutilizada)
let listening = false;     // estado real (onstart/onend)
let wantListen = false;    // intención del usuario (sobrevive a reinicios)
let restartTimer = null;   // temporizador de reinicio (onend)
let finalBuffer = '';      // texto final acumulado de la sesión
let interimBuffer = '';    // texto provisional (solo display)

/**
 * ¿El navegador soporta reconocimiento de voz?
 * @returns {boolean}
 */
export function isSupported() {
  return !!Recognition;
}

/**
 * Resuelve el idioma BCP-47 para el reconocimiento a partir de 'rec.lang'.
 * @returns {string}
 */
function resolveLang() {
  const l = store.get('rec.lang', 'LSE');
  return l === 'ASL' ? CONFIG.SPEECH.STT_LANG_EN : CONFIG.SPEECH.STT_LANG_ES;
}

/**
 * Crea (una vez) la instancia de reconocimiento y enlaza sus callbacks.
 * Idempotente: reutiliza la misma instancia entre sesiones.
 * @returns {SpeechRecognition|null}
 */
function ensureInstance() {
  if (!Recognition) return null;
  if (rec) return rec;

  rec = new Recognition();
  rec.continuous = true;        // dictado largo sin cortar en cada pausa
  rec.interimResults = true;    // mostrar texto provisional en vivo
  rec.maxAlternatives = 1;
  rec.lang = resolveLang();

  rec.onstart = () => {
    listening = true;
    bus.emit('stt:state', { listening: true, lang: rec.lang });
    bus.emit('stt:start', { lang: rec.lang, ts: Date.now() });
  };

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const txt = res[0] ? res[0].transcript : '';
      if (res.isFinal) {
        finalBuffer += txt;
      } else {
        interim += txt;
      }
    }
    // Limitar el buffer provisional (evita crecer sin límite con ruido)
    interimBuffer = interim.slice(-1024);
    bus.emit('stt:result', {
      final: finalBuffer,
      interim: interimBuffer,
      isFinal: interimBuffer.length === 0,
      ts: Date.now(),
    });
  };

  rec.onerror = (event) => {
    // 'no-speech' y 'aborted' son ruido normal: no deben alarmar
    const code = event?.error || 'unknown';
    const benign = code === 'no-speech' || code === 'aborted';
    if (!benign) {
      bus.emit('stt:error', { error: code, message: event?.message || '', ts: Date.now() });
    }
    // En errores 'not-allowed'/'service-not-allowed' dejamos de insistir
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      wantListen = false;
    }
  };

  rec.onend = () => {
    listening = false;
    bus.emit('stt:state', { listening: false, ts: Date.now() });
    bus.emit('stt:end', { manual: !wantListen, ts: Date.now() });
    // Reinicio automático si el usuario no ha parado explícitamente
    if (wantListen) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (wantListen) safeStart();
      }, CONFIG.SPEECH.STT_RESTART_DELAY_MS);
    }
  };

  return rec;
}

/** Arranca sin lanzar (envuelto en try/catch) */
function safeStart() {
  if (!wantListen || listening) return;
  try {
    // Refrescar idioma por si cambió en Ajustes
    if (rec && rec.lang !== resolveLang()) rec.lang = resolveLang();
    rec.start();
  } catch (_) {
    // start() lanza si ya estaba iniciado; reintentar tras un tick
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (wantListen) safeStart();
    }, CONFIG.SPEECH.STT_RESTART_DELAY_MS);
  }
}

/**
 * Activa el reconocimiento continuo.
 * @returns {boolean} false si no hay soporte (fallback manual)
 */
export function start() {
  if (!isSupported()) {
    bus.emit('stt:error', { error: 'unsupported', ts: Date.now() });
    return false;
  }
  ensureInstance();
  wantListen = true;
  safeStart();
  return true;
}

/**
 * Detiene el reconocimiento y desactiva el reinicio automático.
 */
export function stop() {
  wantListen = false;
  clearTimeout(restartTimer);
  restartTimer = null;
  if (rec && listening) {
    try { rec.stop(); } catch (_) { /* ya estaba parado */ }
  }
  listening = false;
  bus.emit('stt:state', { listening: false, ts: Date.now() });
}

/** Alterna el reconocimiento. @returns {boolean} nuevo estado deseado */
export function toggle() {
  if (wantListen) {
    stop();
    return false;
  }
  return start();
}

/**
 * Devuelve el texto final acumulado y (opcionalmente) limpia el buffer.
 * @param {{clear?:boolean}} [opts]
 * @returns {string}
 */
export function takeFinal(opts = {}) {
  const out = finalBuffer;
  if (opts.clear !== false) {
    finalBuffer = '';
    interimBuffer = '';
  }
  return out;
}

/** Texto final acumulado (sin limpiar) */
export function getFinal() {
  return finalBuffer;
}

/** ¿Está escuchando ahora mismo? */
export function isListening() {
  return listening;
}

/** Reinicia los buffers de texto (no toca el motor). */
export function reset() {
  finalBuffer = '';
  interimBuffer = '';
  bus.emit('stt:result', { final: '', interim: '', isFinal: true, ts: Date.now() });
}

/**
 * Inicializa: escucha cambios de idioma de señas para reconfigurar el motor.
 */
export function init() {
  bus.on('signs:lang:change', (p) => {
    const l = p?.lang === 'ASL' ? 'ASL' : 'LSE';
    if (rec) rec.lang = l === 'ASL' ? CONFIG.SPEECH.STT_LANG_EN : CONFIG.SPEECH.STT_LANG_ES;
  });
}

export const stt = Object.freeze({
  init, isSupported, start, stop, toggle,
  takeFinal, getFinal, isListening, reset,
});

if (typeof window !== 'undefined' && !window.__svaiStt) {
  window.__svaiStt = stt;
}
