// =========================================================================
// js/ui/hud.js
// -------------------------------------------------------------------------
// HUD SUPERIOR: estado de red, PWA install, toasts de bienvenida
// =========================================================================
//
// PROPÓSITO
//   Controla el banner superior (logo, estado net, botón instalar).
//   Sin lógica de negocio: solo escucha eventos (bus) y actualiza DOM.
// =========================================================================

import { bus } from '../core/bus.js';
import { net } from '../core/net.js';
import { dom } from '../core/dom.js';
import { i18n } from '../core/i18n.js';
import { store } from '../core/store.js';
import { CONFIG, IS_SECURE_CONTEXT } from '../core/config.js';

const elNet = dom.qs('#net-state');
const elNetLabel = dom.qs('.net__label', elNet);
const btnInstall = dom.qs('#btn-pwa-install');
const btnHelp = dom.qs('#btn-help');

function setNetState(online) {
  if (!elNet) return;
  elNet.dataset.state = online ? 'online' : 'offline';
  if (elNetLabel) {
    elNetLabel.textContent = i18n.t(online ? 'net.online' : 'net.offline');
  }
  elNet.setAttribute('aria-label', i18n.t(online ? 'net.online' : 'net.offline'));
}

export function init() {
  // Estado inicial
  setNetState(net.isOnline());

  // Eventos de red
  bus.on('net:online', () => setNetState(true));
  bus.on('net:offline', () => setNetState(false));
  bus.on('net:change', (p) => setNetState(p.online));

  // PWA install
  if (btnInstall) {
    btnInstall.hidden = !net.canInstall();
    btnInstall.addEventListener('click', async () => {
      const ok = await net.triggerInstall();
      if (ok === false && net.canInstall() === false) {
        btnInstall.hidden = true;
      }
    });
  }
  bus.on('pwa:install:available', () => {
    if (btnInstall) btnInstall.hidden = false;
    dom.toast({ text: i18n.t('pwa.available'), type: 'info', ttl: 3200 });
  });
  bus.on('pwa:installed', () => {
    if (btnInstall) btnInstall.hidden = true;
    dom.toast({ text: i18n.t('pwa.installed'), type: 'ok', ttl: 3600 });
  });

  // Ayuda/atajos
  if (btnHelp) {
    btnHelp.addEventListener('click', () => {
      dom.toast({
        text: 'Atajos: 1–5 pestañas · S SOS · M Mic · E Esc/Cancelar · Tab foco',
        type: 'info',
        ttl: 5000,
      });
    });
  }

  // Aviso de contexto seguro (cámara)
  if (!IS_SECURE_CONTEXT) {
    setTimeout(() => {
      dom.toast({ text: i18n.t('signs.secure'), type: 'warn', ttl: 5600 });
    }, 900);
  }

  // Bienvenida (una sola vez)
  const seen = store.get('ui.toastSeen', 0);
  if (seen < 1) {
    setTimeout(() => {
      dom.toast({
        text: 'SIGN-VOICE AI · Offline-first · Accesibilidad primero',
        type: 'ok',
        ttl: 4200,
      });
      store.set('ui.toastSeen', 1);
    }, 1200);
  }
}

export const hud = Object.freeze({ init });
