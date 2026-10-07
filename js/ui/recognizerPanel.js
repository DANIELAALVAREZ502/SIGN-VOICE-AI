// =========================================================================
// js/ui/recognizerPanel.js
// -------------------------------------------------------------------------
// PANEL "RECONOCER SEÑAS": cámara, overlay landmarks, extracción features,
// clasificador + sequencer, UI de confianza/buffer
// =========================================================================
//
// PROPÓSITO
//   Orquesta el pipeline por frame: getUserMedia → HandLandmarker.detectForVideo
//   → features.extractFeatures → fingerspell.classify → sequencer.push
//   → pintar overlay + buffer + commit al textarea.
//
// NOTAS
//   - Usa requestAnimationFrame (no setInterval)
//   - Overlay se escala al tamaño real del vídeo (canvas)
//   - Solo commitea con alta confianza (CONFIG.FINGERSPELL.MIN_COMMIT_CONF)
//   - Soporta espejo ON/OFF (canvas+video)
// =========================================================================

import { CONFIG, IS_SECURE_CONTEXT } from '../core/config.js';
import { bus } from '../core/bus.js';
import { dom } from '../core/dom.js';
import { i18n } from '../core/i18n.js';
import { store } from '../core/store.js';
import { createLandmarker, getLandmarker, dispose } from '../ai/handTracker.js';
import { extractFeatures } from '../ai/features.js';
import { classify } from '../ai/fingerspell.js';
import { createSequencer } from '../ai/sequencer.js';

const video = dom.qs('#sign-video');
const canvas = dom.qs('#sign-canvas');
const stage = dom.qs('#sign-stage');
const btnCam = dom.qs('#btn-camera');
const btnFlip = dom.qs('#btn-flip');
const stageNote = dom.qs('#stage-note');
const buf = dom.qs('#letter-buffer');
const recText = dom.qs('#recogn-text');
const btnSendChat = dom.qs('#btn-send-chat');
const btnSpeak = dom.qs('#btn-speak-rec');
const btnClear = dom.qs('#btn-clear-rec');
const recStatus = dom.qs('#rec-status');
const confFill = dom.qs('#conf-fill');
const confVal = dom.qs('#conf-value');
const aiChip = dom.qs('#ai-offline-chip');
const btnAiDown = dom.qs('#btn-ai-download');
const btnAiClear = dom.qs('#btn-ai-clear');
const aiProg = dom.qs('#ai-progress-fill');
const aiStat = dom.qs('#ai-download-status');

let ctx = null;
let stream = null;
let landmarker = null;
let seq = createSequencer();
let running = false;
let rafId = 0;
let lastFrameTs = 0;
let committed = '';
let mirror = store.get('rec.mirror', true);

function showNote(msg) {
  if (!stageNote) return;
  stageNote.textContent = msg || '';
  dom.setHidden(stageNote, !msg);
}

function setStatus(msg) {
  if (recStatus) recStatus.textContent = msg || '';
}

function resizeCanvas() {
  if (!video || !canvas) return;
  const rect = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  if (ctx) ctx.scale(dpr, dpr);
}

function drawLandmarks(landmarks) {
  if (!ctx || !landmarks || landmarks.length < 21) return;
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.save();
  // espejo visual coherente con video
  if (mirror) {
    ctx.translate(rect.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = 'rgba(0,240,255,0.9)';
  ctx.strokeStyle = 'rgba(0,240,255,0.6)';
  ctx.lineWidth = 2;
  // puntos
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    const x = p.x * rect.width;
    const y = p.y * rect.height;
    ctx.beginPath();
    ctx.arc(x, y, i === 0 ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function updateBuffer(text) {
  if (!buf) return;
  if (!text) {
    buf.innerHTML = `<span class="buffer__hint">${i18n.t('signs.buffer.hint')}</span>`;
    return;
  }
  buf.innerHTML = '';
  for (const ch of text) {
    const span = document.createElement('span');
    span.className = 'buffer__letter';
    span.textContent = ch.toUpperCase();
    buf.appendChild(span);
  }
}

async function startCam() {
  if (!IS_SECURE_CONTEXT) {
    showNote(i18n.t('signs.secure'));
    return false;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showNote(i18n.t('signs.fileurl'));
    return false;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    if (video) {
      video.srcObject = stream;
      await video.play();
    }
    if (stage) stage.dataset.scanning = 'on';
    showNote('');
    setStatus('Cámara activa. Cargando motor IA…');
    landmarker = await createLandmarker({ useLocalWasm: true });
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { passive: true });
    running = true;
    seq.reset();
    committed = recText ? recText.value : '';
    lastFrameTs = performance.now();
    loop();
    setStatus('Detectando…');
    return true;
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('NotAllowedError')) showNote(i18n.t('signs.perm.denied'));
    else if (msg.includes('NotFoundError')) showNote(i18n.t('signs.notfound'));
    else showNote(msg);
    console.error('[recognizer] startCam error:', err);
    return false;
  }
}

function stopCam() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (video) video.srcObject = null;
  if (stage) stage.dataset.scanning = 'off';
  dispose();
  landmarker = null;
  ctx = null;
  showNote('');
  setStatus('Cámara detenida');
}

function loop() {
  if (!running || !video || !landmarker) return;
  const now = performance.now();
  if (video.readyState >= 2) {
    const res = landmarker.detectForVideo(video, now);
    if (res && res.landmarks && res.landmarks.length > 0) {
      const lm = res.landmarks[0];
      drawLandmarks(lm);
      const f = extractFeatures(lm);
      if (f.ok) {
        const cls = classify(f.vector);
        const ev = seq.push(cls, lm, now);
        if (ev.commit && ev.letter) {
          const ch = ev.letter.toUpperCase();
          committed += ch;
          if (recText) {
            recText.value = committed;
            recText.scrollTop = recText.scrollHeight;
          }
          updateBuffer(committed);
          bus.emit('ai:letter:commit', { letter: ch, text: committed, ts: now });
        }
        // actualizar confianza visual (top score)
        const top = cls.candidates && cls.candidates[0];
        if (top) {
          const v = Math.round(top[1] * 100);
          if (confFill) confFill.style.width = v + '%';
          if (confVal) confVal.textContent = String(v);
        }
      }
    } else {
      ctx?.clearRect(0, 0, canvas.width / (window.devicePixelRatio||1), canvas.height/(window.devicePixelRatio||1));
    }
  }
  rafId = requestAnimationFrame(loop);
}

export function init() {
  mirror = store.get('rec.mirror', true);
  if (btnCam) {
    btnCam.addEventListener('click', async () => {
      if (running) stopCam();
      else await startCam();
    }, { passive: true });
  }
  if (btnFlip) {
    btnFlip.addEventListener('click', () => {
      mirror = !mirror;
      store.set('rec.mirror', mirror);
      dom.toast({ text: mirror ? i18n.t('signs.mirror.on') : i18n.t('signs.mirror.off'), type: 'info', ttl: 1600 });
    }, { passive: true });
  }
  if (btnSendChat) {
    btnSendChat.addEventListener('click', () => {
      const txt = recText ? recText.value.trim() : '';
      if (!txt) return;
      bus.emit('chat:send', { text: txt, from: 'recognizer', ts: Date.now() });
      dom.toast({ text: i18n.t('signs.send.chat'), type: 'ok', ttl: 1600 });
    }, { passive: true });
  }
  if (btnSpeak) {
    btnSpeak.addEventListener('click', () => {
      const txt = recText ? recText.value.trim() : '';
      if (!txt || !window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = CONFIG.SPEECH.TTS_LANG;
      u.rate = CONFIG.SPEECH.TTS_RATE;
      u.pitch = CONFIG.SPEECH.TTS_PITCH;
      window.speechSynthesis.speak(u);
    }, { passive: true });
  }
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      committed = '';
      if (recText) recText.value = '';
      updateBuffer('');
      seq.reset();
      if (confFill) confFill.style.width = '0%';
      if (confVal) confVal.textContent = '0';
    }, { passive: true });
  }
  updateBuffer('');
}

export const recognizerPanel = Object.freeze({ init, startCam, stopCam });
