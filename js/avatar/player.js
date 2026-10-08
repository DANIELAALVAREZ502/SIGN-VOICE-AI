// =========================================================================
// js/avatar/player.js
// -------------------------------------------------------------------------
// REPRODUCTOR DEL AVATAR — cola de señas + interpolación + subtítulos
// =========================================================================
//
// PROPÓSITO
//   Convierte texto en una secuencia animada sobre el rig SVG:
//     texto → tokens (palabra o letra) → cola de pasos → interpolación
//     entre poses normalizadas con easing cubic-bezier → subtítulo sincronizado.
//
// PIPELINE DE REPRODUCCIÓN
//   1. play(text) tokeniza: palabras con pose propia se emiten como un paso;
//      el resto se deletrea letra por letra (mejora progresiva).
//   2. Cada paso resuelve su pose (poses.getLetterPose/getWordPose). Un paso
//      sin pose (letra fuera del diccionario) se salta PERO actualiza el
//      subtítulo: el usuario siempre ve qué se está "firmando".
//   3. animateTo() interpola la pose actual → destino por rAF durante
//      clamp(POSE_DURATION_MS / speed, MIN, MAX) ms con easing.
//   4. Si existe clip MP4 y PREFER_CLIPS, clipAdapter reemplaza al rig para
//      ese paso (fallback silencioso a SVG si el clip falla).
//   5. Cola cancelable: stop() incrementa un token de generación; cualquier
//      bucle o timeout antiguo detecta el cambio y se autodestruye.
//
// ACCESIBILIDAD (crítico en este producto)
//   - #avatar-caption (aria-live=polite) anuncia cada letra/palabra.
//   - #avatar-status refleja la máquina de estados (IDLE/REPRODUCIENDO/…).
//   - prefers-reduced-motion (o ajuste manual) → sin interpolación: la pose
//     aparece de golpe y el subtítulo avanza. Cero movimiento, misma信息.
//
// EVENTOS DEL BUS
//   emite: 'avatar:start' {text} · 'avatar:step' {index,token} ·
//          'avatar:done' {steps} · 'avatar:stop'
//   escucha: 'chat:play' {text} → play(text) (flujo chat → avatar)
// =========================================================================

import { CONFIG } from '../core/config.js';
import { bus } from '../core/bus.js';
import { dom } from '../core/dom.js';
import { store } from '../core/store.js';
import { i18n } from '../core/i18n.js';
import { renderRig, applyPose } from './rig.js';
import {
  loadDict,
  getLetterPose,
  getWordPose,
  lerpPose,
  restPose,
} from './poses.js';
import * as clipAdapter from './clipAdapter.js';

// --- Referencias DOM (null-safe: el módulo no rompe si el panel cambia) ---
const stage = dom.qs('#avatar-stage');
const svgRoot = dom.qs('#avatar-root');
const statusEl = dom.qs('#avatar-status');
const captionEl = dom.qs('#avatar-caption');
const btnPlay = dom.qs('#btn-avatar-play');
const btnStop = dom.qs('#btn-avatar-stop');
const cbClips = dom.qs('#cb-use-clips');
const chatInput = dom.qs('#chat-input');

// --- Estado interno del reproductor --------------------------------------
let rigReady = false;         // ¿el rig SVG ya fue construido?
let currentPose = null;       // pose actual en pantalla (base de la interpolación)
let gen = 0;                  // token de generación: cancela bucles antiguos
let playing = false;          // bandera de "en reproducción"
let queue = [];               // cola de pasos pendientes
let index = 0;                // índice del paso en curso

// --- Preferencias (leídas del store, con defaults de CONFIG) -------------
let speed = () => store.get('avatar.speed', 1.0);        // 0.5–2.0
let preferClips = () => store.get('avatar.preferClips', CONFIG.AVATAR.PREFER_CLIPS);

/**
 * ¿Debemos omitir la interpolación (accesibilidad)?
 * Prioridad: ajuste manual del usuario > prefers-reduced-motion del sistema.
 * @returns {boolean}
 */
function prefersReducedMotion() {
  const manual = store.get('prefs.motion', 'auto'); // 'auto' | 'reduced'
  if (manual === 'reduced') return true;
  if (manual === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

// --- MÁQUINA DE ESTADOS (texto i18n para #avatar-status) ------------------
/**
 * Actualiza el badge de estado y la bandera data-playing del stage
 * (esta última también la usa el CSS para atenuar huesos en reposo).
 * @param {'idle'|'playing'|'paused'|'stopped'} s
 */
function setState(s) {
  if (statusEl) statusEl.textContent = i18n.t(`avatar.${s}`);
  if (stage) stage.dataset.playing = s === 'playing' ? 'true' : 'false';
}

/**
 * Escribe el subtítulo sincronizado (el equivalente accesible del signing).
 * @param {string} text — letra o palabra mostrada ahora
 */
function setCaption(text) {
  if (captionEl) captionEl.textContent = text || '';
}

// --- EASING (cubic-bezier de CONFIG.AVATAR.EASE) --------------------------
/**
 * Genera una función de easing a partir de una curva cubic-bezier CSS.
 * Resuelve B(t) por bisección (12 iteraciones ≈ error < 1e-4, suficiente a
 * 60 fps) y devuelve y para un tiempo x. Si la curva es inválida, usa
 * ease-out cúbico (suave y seguro).
 *
 * @param {string} curve — p. ej. 'cubic-bezier(0.2,0.7,0.2,1)'
 * @returns {(t:number)=>number} t normalizado 0..1 → progreso 0..1
 */
function makeEasing(curve) {
  const m = /cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/.exec(curve || '');
  if (!m) return (t) => 1 - Math.pow(1 - t, 3); // fallback ease-out cúbico
  const [x1, y1, x2, y2] = m.slice(1).map(Number);

  // Bézier cúbica con componente de tiempo resuelta por bisección
  const bez = (a, b, t) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 12; i++) {
      const cx = bez(x1, x2, t);
      if (Math.abs(cx - x) < 1e-4) break;
      if (cx < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return bez(y1, y2, t);
  };
}
const ease = makeEasing(CONFIG.AVATAR.EASE);

/**
 * Duración efectiva de un paso en ms (respeta límites MIN/MAX y velocidad).
 * @returns {number}
 */
function stepDuration() {
  const base = CONFIG.AVATAR.POSE_DURATION_MS / Math.max(0.25, speed());
  return Math.round(
    Math.min(CONFIG.AVATAR.POSE_MAX_MS, Math.max(CONFIG.AVATAR.POSE_MIN_MS, base))
  );
}

// --- TOKENIZADOR ----------------------------------------------------------
/**
 * Convierte texto libre en una cola de pasos.
 * Reglas:
 *   - Palabra con pose propia (dict.words) → 1 paso "word" (clip o pose).
 *   - Palabra sin pose → pasos "letter" por cada A–Z; los caracteres no
 *     alfabéticos (números, signos) generan un paso "gap" con el carácter
 *     en el subtítulo (pausa breve, sin pose).
 *   - Espacios → paso "gap" (seña de pausa visual, limpia el subtítulo).
 *
 * @param {string} text
 * @returns {Array<{type:'word'|'letter'|'gap', token:string, pose:object|null}>}
 */
function tokenize(text) {
  const steps = [];
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);

  for (const raw of words) {
    // Intento 1: palabra completa en el diccionario (p. ej. "hola")
    const wordPose = getWordPose(raw);
    if (wordPose && wordPose.pose) {
      steps.push({ type: 'word', token: raw, pose: wordPose });
      continue;
    }
    // Intento 2: deletreo letra a letra (A–Z); no-alfabéticos → gap
    for (const ch of raw.normalize('NFC').toUpperCase()) {
      if (ch >= 'A' && ch <= 'Z') {
        steps.push({ type: 'letter', token: ch, pose: getLetterPose(ch) });
      } else if (/[\d¿?¡!.,;:()]/.test(ch)) {
        steps.push({ type: 'gap', token: ch, pose: null });
      }
      // resto (acentos sueltos, etc.) se ignora sin romper la cola
    }
    // Separación entre palabras: limpiar subtítulo un instante
    steps.push({ type: 'gap', token: '', pose: null });
  }
  // Quitar el gap final sobrante
  while (steps.length && steps[steps.length - 1].type === 'gap') steps.pop();
  return steps;
}

// --- ANIMACIÓN ------------------------------------------------------------
/**
 * Interpola el rig desde currentPose hasta `to` durante `dur` ms.
 * Con reduced-motion aplica la pose de forma instantánea (accesibilidad).
 *
 * @param {object} to — pose destino (formato {pose} o {points})
 * @param {number} dur — duración en ms
 * @param {number} myGen — token de generación (cancelación)
 * @returns {Promise<boolean>} false si se canceló por stop()
 */
function animateTo(to, dur, myGen) {
  return new Promise((resolve) => {
    if (!to || !svgRoot) return resolve(true);

    // Reduced-motion: sin interpolación, salto inmediato
    if (prefersReducedMotion() || dur <= 0) {
      currentPose = to;
      applyPose(svgRoot, to);
      return resolve(myGen === gen);
    }

    const from = currentPose || restPose() || to;
    const t0 = performance.now();

    const frame = (now) => {
      // Cancelado por stop() o por una nueva reproducción
      if (myGen !== gen) return resolve(false);
      const x = Math.min(1, (now - t0) / dur);       // progreso lineal 0..1
      const y = ease(x);                             // progreso eased
      applyPose(svgRoot, lerpPose(from, to, y));     // pinta frame intermedio
      if (x < 1) {
        requestAnimationFrame(frame);                // siguiente frame
      } else {
        currentPose = to;                            // asentar pose final
        resolve(true);
      }
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Pausa cancelable: resuelve false si la generación cambió durante la espera.
 * @param {number} ms
 * @param {number} myGen
 * @returns {Promise<boolean>} true si NO se canceló
 */
function sleep(ms, myGen) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(myGen === gen), ms);
    // Si llega stop() antes, el timeout seguiría… por eso verificamos gen
    // también al despertar (el caller aborta la cola en ese caso).
    void timer;
  });
}

// --- BUCLE PRINCIPAL DE LA COLA -------------------------------------------
/**
 * Recorre la cola ejecutando cada paso (clip → animación → subtítulo).
 * Se detiene solo si `myGen !== gen` (stop() o replay).
 * @param {number} myGen
 */
async function runQueue(myGen) {
  for (index = 0; index < queue.length; index++) {
    // ¿Cancelado? (stop() o play() nuevo incrementó gen)
    if (myGen !== gen) return;

    const step = queue[index];
    const dur = stepDuration();

    // Subtítulo SIEMPRE (incluso sin pose: el texto es la fuente de verdad)
    setCaption(step.token || '·');
    bus.emit('avatar:step', { index, token: step.token, type: step.type });

    // 1) Intentar clip de vídeo (solo palabras/letras con clip disponible)
    if (step.type !== 'gap' && preferClips() && stage) {
      const played = await clipAdapter.play(step.token, stage);
      if (myGen !== gen) return;            // cancelado mientras el clip iba
      if (played) {
        if (step.pose) currentPose = step.pose; // sincronizar pose tras clip
        await sleep(60, myGen);
        continue;
      }
      // clip no disponible → seguimos con rig SVG (fallback natural)
    }

    // 2) Pose: animar si existe; si no, mantener la anterior (solo caption)
    if (step.pose) {
      const ok = await animateTo(step.pose, dur, myGen);
      if (!ok) return;                       // cancelado durante la animación
    } else {
      // Sin pose: breve sostén para que el subtítulo se lea
      const ok = await sleep(Math.round(dur * 0.45), myGen);
      if (!ok) return;
    }
  }

  // Cola completada sin cancelación
  if (myGen === gen) {
    playing = false;
    setState('idle');
    setCaption('');
    bus.emit('avatar:done', { steps: queue.length });
  }
}

// --- API PÚBLICA ----------------------------------------------------------
/**
 * Inicializa el rig y vincula los controles del panel del avatar.
 * Idempotente: llamar varias veces no duplica listeners.
 */
export function init() {
  // Rig SVG (una sola vez por sesión de página)
  if (!rigReady && svgRoot) {
    renderRig(svgRoot);
    rigReady = true;
    // Pose de reposo inmediata (la pantalla nunca muestra un esqueleto roto)
    const rest = restPose();
    if (rest) {
      currentPose = rest;
      applyPose(svgRoot, rest);
    }
  }

  setState('idle');

  // Checkbox de clips: refleja y persiste la preferencia
  if (cbClips) {
    cbClips.checked = preferClips();
    cbClips.addEventListener('change', () => {
      store.set('avatar.preferClips', cbClips.checked);
      dom.toast({
        text: cbClips.checked ? i18n.t('avatar.clips.on') : i18n.t('avatar.clips.off'),
        type: 'info',
        ttl: 1800,
      });
    }, { passive: true });
  }

  // Botón "Reproducir texto": lee el textarea del chat (o su contenido)
  if (btnPlay) {
    btnPlay.addEventListener('click', () => {
      const text = (chatInput && chatInput.value.trim()) || '';
      if (!text) {
        dom.toast({ text: i18n.t('chat.placeholder'), type: 'warn', ttl: 2600 });
        if (chatInput) chatInput.focus();
        return;
      }
      play(text);
    }, { passive: true });
  }

  // Botón "Detener": cancela la cola y el clip en curso
  if (btnStop) {
    btnStop.addEventListener('click', () => stop(), { passive: true });
  }

  // Flujo chat → avatar: chat.js emite 'chat:play' tras enviar/neutralizar
  bus.on('chat:play', (p) => {
    if (p && typeof p.text === 'string') play(p.text);
  });

  // Cambio de idioma de señas (desde Ajustes): recargar diccionario y repo
  bus.on('signs:lang:change', async (p) => {
    const lang = p?.lang === 'ASL' ? 'ASL' : 'LSE';
    stop();                          // nada de animar con el diccionario viejo
    await loadDict(lang);            // precachear el nuevo diccionario
    const rest = restPose();
    if (rest && svgRoot) {
      currentPose = rest;
      applyPose(svgRoot, rest);
    }
  });
}

/**
 * Reproduce un texto en el avatar (cancela cualquier reproducción previa).
 * @param {string} text
 */
export async function play(text) {
  const clean = String(text || '').trim();
  if (!clean) return;

  // Cargar diccionario del idioma actual (cached: resuelve en microtask
  // si ya se cargó antes; la primera vez puede esperar un fetch local)
  const lang = store.get('rec.lang', 'LSE');
  await loadDict(lang);

  // Cancelar cola anterior y crear nueva generación
  gen += 1;
  const myGen = gen;
  clipAdapter.stop();
  playing = true;
  setState('playing');

  // Construir cola + emitir evento de inicio
  queue = tokenize(clean);
  index = 0;
  bus.emit('avatar:start', { text: clean, steps: queue.length });

  if (queue.length === 0) {
    // Texto sin letras reproducibles (p. ej. solo emoji): estado limpio
    playing = false;
    setState('idle');
    return;
  }
  await runQueue(myGen);
}

/**
 * Detiene la reproducción actual de forma inmediata y limpia el subtítulo.
 * Seguro de llamar en cualquier estado (incluso sin reproducción activa).
 */
export function stop() {
  gen += 1;                 // invalida bucles/animations en vuelo
  playing = false;
  clipAdapter.stop();       // corta vídeo si estaba reproduciendo
  setState('stopped');
  setCaption('');
  bus.emit('avatar:stop', { ts: Date.now() });
  // Volver a reposo (la siguiente reproducción parte de una pose estable)
  const rest = restPose();
  if (rest && svgRoot) {
    currentPose = rest;
    applyPose(svgRoot, rest);
  }
  // 'stopped' → a los 1.2 s volver a 'idle' (feedback claro en la UI)
  setTimeout(() => {
    if (!playing) setState('idle');
  }, 1200);
}

/** ¿Está reproduciendo ahora mismo? (para guards de UI/tests) */
export function isPlaying() {
  return playing;
}

export const player = Object.freeze({ init, play, stop, isPlaying });
