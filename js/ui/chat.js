// =========================================================================
// js/ui/chat.js
// -------------------------------------------------------------------------
// PANEL DE CHAT + AVATAR — envío, filtrado de modismos, historial
// =========================================================================
//
// PROPÓSITO
//   Gestiona el chat del panel #panel-chat (IDs: #chat-list, #chat-input,
//   #btn-send, #btn-send-voice, #btn-avatar-play en el mismo panel).
//   Integra:
//     - filtro de modismos neutralize() (carga perezosa: import dinámico de
//       js/safety/slangFilter.js). Si no existe, usa identidad (fallback).
//     - historial persistente en store (clave 'chat.history', límite 40).
//     - burbujas accesibles (aria-live en lista), diferencias visibles
//       (.bubble__changes) cuando el texto cambia al neutralizar.
//     - flujo unidireccional: chat:send → render + persist + chat:play
//       (avatar reproduce el texto neutralizado por defecto).
//   NOTA SOS: el texto marcado "sos" NO debe pasar por filtro (regla de
//   seguridad en safety/sos.js). Aquí no imponemos esa regla (no conocemos
//   el contexto sos), pero respetamos el parámetro `skipFilter` si llega.
//
// EVENTOS BUS
//   escucha: 'chat:send' {text, from, skipFilter?, ts?}
//   emite:   'chat:play' {text, meta}
// =========================================================================

import { bus } from '../core/bus.js';
import { dom } from '../core/dom.js';
import { store } from '../core/store.js';
import { i18n } from '../core/i18n.js';

// --- Referencias DOM -----------------------------------------------------
const listEl = dom.qs('#chat-list');
const inputEl = dom.qs('#chat-input');
const btnSend = dom.qs('#btn-send');
const btnSendVoice = dom.qs('#btn-send-voice');

// --- Estado persistente --------------------------------------------------
const STORE_KEY = 'chat.history';
const MAX_MSG = 40;
let history = store.get(STORE_KEY, []);
// Limpieza de ítems inválidos (respaldo ante corrupción de localStorage)
history = Array.isArray(history)
  ? history.filter((m) => m && typeof m.text === 'string')
  : [];

// --- Lazy loader del filtro de modismos ----------------------------------
let slangMod = null; // { neutralize: fn, init?: fn, isEnabled?: fn }
let slangLoaded = false;

/**
 * Carga perezosa del módulo de seguridad `slangFilter`.
 * Nunca bloquea la UI: si falla (404 en file:// o módulo aún no escrito),
 * devuelve un passthrough seguro ({neutralize: (x)=>x}).
 * @returns {Promise<{analyze?:(s:string,p?:any)=>{out:string,changes:any[]},neutralize:(s:string,p?:any)=>string}|null>}
 */
async function loadSlang() {
  if (slangLoaded) return slangMod;
  slangLoaded = true;
  try {
    // Import dinámico ESM: solo cuando se necesita neutralizar
    const mod = await import('../safety/slangFilter.js');
    slangMod = mod && (mod.analyze || mod.neutralize)
      ? mod
      : { neutralize: (x) => x };
    // init opcional (idempotente) si el módulo lo exporta
    if (slangMod.init && typeof slangMod.init === 'function') {
      try { await slangMod.init(); } catch (_) { /* ignora */ }
    }
    return slangMod;
  } catch (err) {
    // Fallback silencioso: sin filtro disponible
    slangMod = { neutralize: (s) => String(s || '') };
    return slangMod;
  }
}

/**
 * Neutraliza texto aplicando filtro de modismos si está habilitado.
 * Respeta skipFilter (SOS). Usa analyze() cuando existe para obtener la
 * lista de cambios (original → neutral) que la UI muestra y permite revertir.
 *
 * @param {string} text
 * @param {{skipFilter?:boolean}} opts
 * @returns {Promise<{out:string,diff?:{before:string,after:string,changes:any[]}}>}
 */
async function applyFilter(text, opts = {}) {
  const raw = String(text || '');
  if (!raw) return { out: '' };

  if (opts.skipFilter) return { out: raw };

  const enabled = store.get('slang.enabled', true);
  if (!enabled) return { out: raw };

  const mod = await loadSlang();

  // Preferir analyze() (devuelve cambios detallados); si no, neutralize().
  let out = raw;
  let changes = [];
  if (typeof mod?.analyze === 'function') {
    const res = mod.analyze(raw, {});
    out = res?.out ?? raw;
    changes = Array.isArray(res?.changes) ? res.changes : [];
  } else if (typeof mod?.neutralize === 'function') {
    out = mod.neutralize(raw, {});
    if (out !== raw) changes = [{ before: raw, after: out, severity: 'low' }];
  }

  if (out === raw) return { out: raw };
  return { out, diff: { before: raw, after: out, changes } };
}

// --- Renderizado de mensajes ---------------------------------------------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Añade un mensaje al historial, lo persiste y vuelve a renderizar.
 * @param {{role:'me'|'bot', text:string, ts:number, diff?:any}} msg
 */
function pushMessage(msg) {
  const m = {
    role: msg.role === 'bot' ? 'bot' : 'me',
    text: String(msg.text || ''),
    ts: Number(msg.ts) || Date.now(),
    diff: msg.diff || null,
  };
  history.push(m);
  if (history.length > MAX_MSG) history = history.slice(history.length - MAX_MSG);
  store.set(STORE_KEY, history);
  render();
}

/** Limpia y vuelve a dibujar toda la lista (historial completo). */
function render() {
  if (!listEl) return;
  const frag = document.createDocumentFragment();

  for (const m of history) {
    const wrap = document.createElement('div');
    wrap.className = `bubble ${m.role === 'me' ? 'bubble--me' : 'bubble--bot'}`;
    wrap.dataset.ts = String(m.ts);

    const meta = document.createElement('div');
    meta.className = 'bubble__meta';
    const t = new Date(m.ts);
    meta.textContent = m.role === 'me' ? 'Yo' : 'Avatar';
    meta.title = t.toLocaleString();
    wrap.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'bubble__body';
    body.textContent = m.text; // texto plano (sin HTML inyectado)
    wrap.appendChild(body);

    // Mostrar cambios de neutralización (solo si existen)
    if (m.diff && m.diff.before && m.diff.after && m.diff.before !== m.diff.after) {
      const ch = document.createElement('div');
      ch.className = 'bubble__changes';
      ch.textContent = `Neutralizado: “${m.diff.before}” → “${m.diff.after}”`;
      wrap.appendChild(ch);
    }

    // Doble clic en cualquier burbuja → reproducir ese texto en avatar
    wrap.addEventListener('dblclick', () => {
      const txt = m.text || '';
      if (txt.trim()) bus.emit('chat:play', { text: txt });
    }, { passive: true });

    frag.appendChild(wrap);
  }

  listEl.innerHTML = '';
  listEl.appendChild(frag);
  // Auto-scroll al final (UX fluida)
  listEl.scrollTop = listEl.scrollHeight;
}

/** Vacía historial (persistente) */
export function clearHistory() {
  history = [];
  store.set(STORE_KEY, history);
  render();
}

/** Exporta historial (para copia de seguridad opcional) */
export function getHistory() {
  return history.slice();
}

/** Restaura historial (array validado) */
export function setHistory(arr) {
  if (!Array.isArray(arr)) return;
  history = arr
    .filter((m) => m && typeof m.text === 'string')
    .slice(-MAX_MSG);
  store.set(STORE_KEY, history);
  render();
}

/**
 * Envía un mensaje (me → bot/flujo avatar). Aplica filtro si corresponde.
 * @param {string} text
 * @param {{from?:string, skipFilter?:boolean}} opts
 */
export async function send(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw) return;

  const tsMe = Date.now();
  // 1) Añadir mensaje del usuario (sin modificar aún el diff del render)
  pushMessage({ role: 'me', text: raw, ts: tsMe });

  // 2) Aplicar filtro de modismos (perezoso)
  const f = await applyFilter(raw, { skipFilter: opts.skipFilter });
  const neutralized = f.out.trim() || raw;

  // 3) Si hubo neutralización, renderizar una nota en el último mensaje
  //    (añadimos diff al último ítem del historial y re-render)
  if (f.diff) {
    const last = history[history.length - 1];
    if (last && last.role === 'me' && last.text === raw) {
      last.diff = f.diff;
      store.set(STORE_KEY, history);
      render();
    }
  }

  // 4) Emitir al avatar: reproducir versión neutralizada (por defecto)
  //    El avatar/player escuchará 'chat:play'. También otros módulos pueden
  //    reaccionar a 'chat:send' (recognizerPanel ya lo emite).
  bus.emit('chat:play', { text: neutralized, meta: { from: opts.from || 'chat' } });

  // 5) Feedback "typing" opcional muy breve (avatar empieza a reproducir)
  //    No añadimos burbuja bot artificial aquí: el avatar gesticula y el
  //    subtítulo ya comunica lo que se reproduce (redundancia mínima).
}

// --- Event listeners ------------------------------------------------------
function onSendClick() {
  const v = inputEl ? inputEl.value : '';
  send(v);
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }
}

function onKeyDown(e) {
  // Enter = enviar, Shift+Enter = salto de línea
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSendClick();
  }
}

export function init() {
  render(); // carga historial persistente

  if (btnSend) btnSend.addEventListener('click', onSendClick, { passive: true });
  if (inputEl) inputEl.addEventListener('keydown', onKeyDown);

  // Botón "Enviar vía voz": reenvía al panel de voz (cambia pestaña)
  if (btnSendVoice) {
    btnSendVoice.addEventListener('click', () => {
      bus.emit('ui:tab:change', { panel: 'voice' });
      dom.toast({ text: i18n.t('voice.tap.start'), type: 'info', ttl: 1800 });
    }, { passive: true });
  }

  // Escucha eventos externos: otro módulo quiere enviar al chat
  bus.on('chat:send', (p) => {
    if (!p || typeof p.text !== 'string') return;
    send(p.text, {
      from: p.from || 'bus',
      skipFilter: !!p.skipFilter,
    });
  });

  // Placeholder traducido (por si cambia idioma tras init)
  if (inputEl) inputEl.placeholder = i18n.t('chat.placeholder');
}

export const chat = Object.freeze({ init, send, clearHistory, getHistory, setHistory });
