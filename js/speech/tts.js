// =========================================================================
// js/speech/tts.js
// -------------------------------------------------------------------------
// TEXT-TO-SPEECH (speechSynthesis) — lectura en voz alta
// =========================================================================
//
// PROPÓSITO
//   Envuelve window.speechSynthesis con utilidades útiles:
//     - soporte/estado (isSupported, isSpeaking)
//     - selección de voz por idioma (prefiere voces locales para offline)
//     - speak() cancelable (cancela la locución anterior por defecto)
//     - eventos por bus ('tts:start' / 'tts:end' / 'tts:error')
//
// PRINCIPIO
//   Es una mejora progresiva: si no existe speechSynthesis, isSupported()
//   devuelve false y la UI lo refleja; nunca rompe.
//
// EVENTOS DEL BUS
//   emite: 'tts:start' {text,lang} · 'tts:end' {} · 'tts:error' {error}
// =========================================================================

import { CONFIG } from '../core/config.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';

const synth = (typeof window !== 'undefined') ? window.speechSynthesis : null;

/** Voces cargadas (Chrome las rellena de forma asíncrona). */
let voices = [];

/**
 * ¿Hay soporte de síntesis de voz?
 * @returns {boolean}
 */
export function isSupported() {
  return !!synth && typeof window.SpeechSynthesisUtterance === 'function';
}

/**
 * Refresca la lista de voces del sistema.
 * @returns {SpeechSynthesisVoice[]}
 */
export function refreshVoices() {
  if (!synth) return [];
  try {
    voices = synth.getVoices() || [];
  } catch (_) {
    voices = [];
  }
  return voices;
}

/**
 * Elige la mejor voz para un idioma BCP-47 (p. ej. 'es-ES').
 * Prioriza voces locales (funcionan sin red).
 * @param {string} lang
 * @returns {SpeechSynthesisVoice|null}
 */
export function pickVoice(lang) {
  if (!voices.length) refreshVoices();
  const base = String(lang || '').slice(0, 2).toLowerCase();
  const matches = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith(base));
  if (!matches.length) return null;
  // Preferencia: local > default > primera coincidencia
  return matches.find((v) => v.localService) || matches.find((v) => v.default) || matches[0];
}

/**
 * Resuelve idioma BCP-47 a partir de 'rec.lang'.
 * @returns {string}
 */
function resolveLang() {
  const l = store.get('rec.lang', 'LSE');
  return l === 'ASL' ? CONFIG.SPEECH.STT_LANG_EN : CONFIG.SPEECH.TTS_LANG;
}

/**
 * Pronuncia un texto. Cancela la locución anterior por defecto.
 * @param {string} text
 * @param {{lang?:string, rate?:number, pitch?:number, cancel?:boolean}} [opts]
 * @returns {boolean} true si se encoló la locución
 */
export function speak(text, opts = {}) {
  const clean = String(text || '').trim();
  if (!clean || !isSupported()) {
    if (!isSupported()) bus.emit('tts:error', { error: 'unsupported' });
    return false;
  }
  if (opts.cancel !== false) cancel();

  const lang = opts.lang || resolveLang();
  const u = new window.SpeechSynthesisUtterance(clean);
  u.lang = lang;
  u.rate = Number.isFinite(opts.rate) ? opts.rate : CONFIG.SPEECH.TTS_RATE;
  u.pitch = Number.isFinite(opts.pitch) ? opts.pitch : CONFIG.SPEECH.TTS_PITCH;
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;

  u.onstart = () => bus.emit('tts:start', { text: clean, lang, ts: Date.now() });
  u.onend = () => bus.emit('tts:end', { ts: Date.now() });
  u.onerror = (e) => {
    // 'interrupted'/'canceled' son normales al cancelar; no alarmar
    const err = e?.error || 'error';
    if (err !== 'interrupted' && err !== 'canceled') {
      bus.emit('tts:error', { error: err, ts: Date.now() });
    }
  };

  try {
    synth.speak(u);
    return true;
  } catch (e) {
    bus.emit('tts:error', { error: String(e?.message || e), ts: Date.now() });
    return false;
  }
}

/** Cancela cualquier locución en curso o en cola. */
export function cancel() {
  if (!synth) return;
  try { synth.cancel(); } catch (_) {}
}

/** ¿Hay una locución en curso? */
export function isSpeaking() {
  return !!synth && synth.speaking;
}

/**
 * Inicializa: calienta la lista de voces y escucha cambios de idioma.
 */
export function init() {
  if (!isSupported()) return;
  refreshVoices();
  // Chrome carga las voces de forma diferida
  if (typeof synth.onvoiceschanged !== 'undefined') {
    synth.onvoiceschanged = () => refreshVoices();
  }
  bus.on('signs:lang:change', () => {
    // El idioma de locución se resuelve en cada speak(); nada persistente
    refreshVoices();
  });
}

export const tts = Object.freeze({
  init, isSupported, speak, cancel, isSpeaking,
  refreshVoices, pickVoice,
});

if (typeof window !== 'undefined' && !window.__svaiTts) {
  window.__svaiTts = tts;
}
