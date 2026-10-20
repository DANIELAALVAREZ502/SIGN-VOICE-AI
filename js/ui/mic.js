// =========================================================================
// js/ui/mic.js
// -------------------------------------------------------------------------
// PANEL "VOZ AL AVATAR" — dictado por micrófono (STT) → chat/avatar
// =========================================================================
//
// PROPÓSITO
//   Controla el panel #panel-voice: botón de micrófono, transcripción en vivo
//   (final + provisional), botones enviar/limpiar y soporte detectado.
//   Toda la lógica de reconocimiento vive en js/speech/stt.js; aquí solo UI.
//
// FALLBACK
//   Si la Web Speech API no está disponible (offline o navegador sin soporte),
//   el panel lo informa y el usuario puede escribir en el chat (degradación).
//
// EVENTOS BUS
//   escucha: 'stt:state' · 'stt:result' · 'stt:error' · 'stt:end'
//   emite:   (indirecto) 'chat:send' al enviar la transcripción
// =========================================================================

import { bus } from '../core/bus.js';
import { dom } from '../core/dom.js';
import { i18n } from '../core/i18n.js';
import { stt } from '../speech/stt.js';

// --- Referencias DOM (null-safe) -----------------------------------------
const panel = dom.qs('#mic-panel');
const btnMic = dom.qs('#btn-mic');
const labelEl = dom.qs('#mic-label');
const finalEl = dom.qs('#stt-final');
const interimEl = dom.qs('#stt-interim');
const btnSend = dom.qs('#btn-stt-send');
const btnClear = dom.qs('#btn-stt-clear');
const supportEl = dom.qs('#stt-support');

/** ¿Escuchando? (para el toggle del botón) */
let active = false;

/** Actualiza el estado visual del panel (anillo/wave vía data-listening). */
function setListening(on) {
  active = !!on;
  if (panel) panel.dataset.listening = active ? 'true' : 'false';
  if (labelEl) labelEl.textContent = i18n.t(active ? 'voice.listening' : 'voice.tap.start');
  if (btnMic) btnMic.setAttribute('aria-pressed', active ? 'true' : 'false');
}

/** Pinta la transcripción (final + provisional). */
function renderTranscript(finalText, interimText) {
  if (finalEl) finalEl.textContent = finalText || '';
  if (interimEl) interimEl.textContent = interimText || '';
}

export function init() {
  // 1) Detección de soporte + mensaje inicial
  const supported = stt.isSupported();
  if (supportEl) supportEl.textContent = i18n.t(supported ? 'voice.support.yes' : 'voice.support.no');
  if (labelEl && !supported) labelEl.textContent = i18n.t('voice.fallback');
  setListening(false);

  // 2) Botón de micrófono: alternar reconocimiento
  if (btnMic) {
    btnMic.addEventListener('click', () => {
      if (!stt.isSupported()) {
        dom.toast({ text: i18n.t('voice.support.no'), type: 'warn', ttl: 3000 });
        return;
      }
      stt.toggle();
    }, { passive: true });
  }

  // 3) Enviar transcripción al chat + avatar
  if (btnSend) {
    btnSend.addEventListener('click', () => {
      const txt = stt.getFinal().trim();
      if (!txt) {
        dom.toast({ text: i18n.t('voice.tap.start'), type: 'warn', ttl: 2400 });
        return;
      }
      stt.stop();
      bus.emit('chat:send', { text: txt, from: 'voice', ts: Date.now() });
      dom.toast({ text: i18n.t('signs.send.chat'), type: 'ok', ttl: 1600 });
      stt.reset();
      renderTranscript('', '');
    }, { passive: true });
  }

  // 4) Limpiar buffers y transcripción
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      stt.reset();
      renderTranscript('', '');
    }, { passive: true });
  }

  // 5) Suscripciones al bus (STT → UI)
  bus.on('stt:state', (p) => setListening(!!p?.listening));

  bus.on('stt:result', (p) => {
    renderTranscript(p?.final || '', p?.interim || '');
  });

  bus.on('stt:end', () => {
    // El motor se detuvo; reflejar estado (onend ya emitió stt:state)
    setListening(false);
  });

  bus.on('stt:error', (p) => {
    const code = p?.error || '';
    let msg = i18n.t('voice.support.no');
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      msg = i18n.t('signs.perm.denied');
    } else if (code === 'network') {
      msg = i18n.t('voice.fallback');
    }
    dom.toast({ text: msg, type: 'warn', ttl: 3200 });
    setListening(false);
  });
}

export const mic = Object.freeze({ init });
