// =========================================================================
// app.js
// -------------------------------------------------------------------------
// ORQUESTADOR PRINCIPAL — arranque modular, offline-first
// =========================================================================
//
// PROPÓSITO
//   Punto de entrada único. Inicializa core (store, net, bus), UI (hud) y
//   deja preparado el terreno para los paneles (se inicializan por módulo
//   cuando corresponda). No contiene lógica de IA pesada (esa vive en /js/ai)
//
// CARGA
//   index.html importa este archivo como type=module (ESM). El orden de
//   los <script type="module"> ya garantiza que core/UI existen.
// =========================================================================

import { CONFIG, IS_SECURE_CONTEXT, APP_VERSION, HAS_ES_MODULES } from './js/core/config.js';
import { store } from './js/core/store.js';
import { bus } from './js/core/bus.js';
import { net } from './js/core/net.js';
import { dom } from './js/core/dom.js';
import { i18n } from './js/core/i18n.js';
import { hud } from './js/ui/hud.js';

function logBoot(msg, extra = {}) {
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[SVAI v${APP_VERSION}] ${msg}`, extra);
  }
}

export async function boot() {
  logBoot('boot:start', {
    secure: IS_SECURE_CONTEXT,
    esModules: HAS_ES_MODULES,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
  });

  // 1) Persistencia + migraciones
  try {
    store.init();
  } catch (e) {
    console.warn('[app] store.init falló, continuando:', e);
  }

  // 2) Red + PWA
  try {
    net.init();
  } catch (e) {
    console.warn('[app] net.init falló, continuando:', e);
  }

  // 3) HUD superior
  try {
    hud.init();
  } catch (e) {
    console.warn('[app] hud.init falló, continuando:', e);
  }

  // 4) Sincronización de pestañas (tabs) mínima
  syncTabs();

  // 5) Registrar SW si existe
  registerSW();

  logBoot('boot:done');
  bus.emit('app:ready', { ts: Date.now(), version: APP_VERSION });
}

/**
 * Sincroniza navegación por pestañas. Escucha clicks y atajos 1–5/S/M/E.
 * Usa aria-selected + hidden en paneles.
 */
function syncTabs() {
  const tabs = dom.qsa('.tab');
  const panels = dom.qsa('.panel');
  const tabMap = new Map(tabs.map((t) => [t.dataset.panel, t]));

  function activate(panelKey) {
    if (!panelKey) return;
    tabs.forEach((t) => dom.setAriaSelected(t, t.dataset.panel === panelKey));
    panels.forEach((p) => {
      const show = p.id === `panel-${panelKey}`;
      dom.setHidden(p, !show);
    });
    bus.emit('ui:tab:change', { panel: panelKey, ts: Date.now() });
    // focus main sutilmente (no mueve foco si ya dentro)
    const main = dom.qs('#main');
    if (main) main.setAttribute('tabindex', '-1');
  }

  tabs.forEach((t) => {
    t.addEventListener('click', () => activate(t.dataset.panel), { passive: true });
  });

  // Atajos
  window.addEventListener('keydown', (e) => {
    // Evitar interferir con inputs/textarea/contenteditable
    const tag = document.activeElement?.tagName?.toLowerCase();
    const isInput = tag === 'input' || tag === 'textarea';
    if (isInput && e.key !== 'Escape') return;

    if (e.key === '1') { e.preventDefault(); activate('signs'); return; }
    if (e.key === '2') { e.preventDefault(); activate('chat'); return; }
    if (e.key === '3') { e.preventDefault(); activate('voice'); return; }
    if (e.key === '4') { e.preventDefault(); activate('sos'); return; }
    if (e.key === '5') { e.preventDefault(); activate('settings'); return; }
    // S = SOS (atajo rápido)
    if (e.key.toLowerCase() === 's' && !isInput) {
      e.preventDefault();
      activate('sos');
      return;
    }
    // M = Mic/voz
    if (e.key.toLowerCase() === 'm' && !isInput) {
      e.preventDefault();
      activate('voice');
      return;
    }
    // E = Escape: volver a reconocedor o limpiar foco
    if (e.key === 'Escape') {
      // si hay modal/toast activo el toast ya gestiona; por ahora ir a signs
      e.preventDefault();
      activate('signs');
      return;
    }
  }, { passive: false });

  // Restaurar última pestaña
  const last = store.get('ui.tab', 'signs');
  activate(last);
  // guardar al cambiar
  bus.on('ui:tab:change', (p) => {
    store.set('ui.tab', p.panel);
  });
}

/** Registro del Service Worker (modo opt-in, sin skipWaiting automático) */
function registerSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' })
    .then((reg) => {
      logBoot('sw:registered', { scope: reg.scope });
      // Escuchar actualizaciones
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            // Hay nueva versión disponible: avisar al usuario (no forzar)
            dom.toast({
              text: 'Actualización disponible. Recarga cuando quieras para aplicar.',
              type: 'info',
              ttl: 6000,
              action: {
                label: 'Recargar ahora',
                onClick: () => {
                  try {
                    reg.waiting?.postMessage({ type: 'svai.skipWaiting' });
                  } catch (_) {}
                  window.location.reload();
                },
              },
            });
          }
        });
      });
    })
    .catch((err) => {
      console.warn('[app] sw registration failed:', err);
    });
}

// Arranque automático
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
