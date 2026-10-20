// =========================================================================
// js/ui/cloudPanel.js
// -------------------------------------------------------------------------
// PANEL DE NUBE (AJUSTES) — configurar/probar/borrar Supabase
// =========================================================================
//
// PROPÓSITO
//   Conecta los inputs de Ajustes con js/core/supabaseConfig.js y el cliente
//   perezoso js/cloud/supabase.js. Actualiza el badge #cloud-state y el texto
//   #cloud-info. Nunca expone la clave completa (solo máscara informativa).
//
// EVENTOS BUS
//   escucha: 'cloud:state' (ready/syncing/synced/error/offline/disabled)
// =========================================================================

import { bus } from '../core/bus.js';
import { dom } from '../core/dom.js';
import { i18n } from '../core/i18n.js';
import { store } from '../core/store.js';
import {
  resolveSupabaseConfig,
  isCloudConfigured,
  saveSupabaseConfig,
  clearSupabaseConfig,
  maskSecret,
} from '../core/supabaseConfig.js';
import { supabase } from '../cloud/supabase.js';
import { auth } from '../cloud/auth.js';
import { sync } from '../cloud/sync.js';

// --- Referencias DOM -----------------------------------------------------
const inUrl = dom.qs('#supabase-url');
const inKey = dom.qs('#supabase-key');
const btnTest = dom.qs('#btn-cloud-test');
const btnClear = dom.qs('#btn-cloud-clear');
const infoEl = dom.qs('#cloud-info');
const stateEl = dom.qs('#cloud-state');

/** Mapea estado del bus a etiqueta i18n. */
const STATE_LABEL = {
  disabled: 'cloud.disabled',
  offline: 'cloud.offline',
  syncing: 'cloud.syncing',
  synced: 'cloud.synced',
  error: 'cloud.error',
  ready: 'cloud.syncing',
};

/** Actualiza el badge de estado. */
function setBadge(state) {
  if (!stateEl) return;
  const key = STATE_LABEL[state] || 'cloud.disabled';
  stateEl.dataset.state = state in STATE_LABEL ? state : 'disabled';
  stateEl.textContent = i18n.t(key);
}

/** Refresca el texto informativo con máscara de clave. */
function refreshInfo() {
  if (!infoEl) return;
  const configured = isCloudConfigured();
  if (!configured) {
    infoEl.textContent = i18n.t('cloud.optin');
    return;
  }
  const cfg = resolveSupabaseConfig();
  infoEl.textContent = `${cfg.source === 'env' ? 'ENV' : 'LS'} · ${cfg.url} · ${maskSecret(cfg.anonKey)}`;
}

export function init() {
  // 1) Prefill: URL visible; clave NUNCA rellenada (solo máscara en info)
  const cfg = resolveSupabaseConfig();
  if (inUrl && cfg.url) inUrl.value = cfg.url;
  if (inKey) {
    inKey.value = '';
    inKey.placeholder = cfg.anonKey ? maskSecret(cfg.anonKey) : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
  }
  setBadge(isCloudConfigured() ? 'synced' : 'disabled');
  refreshInfo();

  // 2) Guardar y probar conexión
  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      const url = inUrl ? inUrl.value.trim() : '';
      const key = inKey ? inKey.value.trim() : '';

      // Si hay valores nuevos, persistirlos; si están vacíos, probar los guardados
      if (url || key) {
        if (!saveSupabaseConfig({ url, anonKey: key })) {
          dom.toast({ text: i18n.t('cloud.test.fail'), type: 'error', ttl: 3200 });
          return;
        }
        supabase.reset();      // forzar recreación con las nuevas credenciales
      }

      if (!isCloudConfigured()) {
        dom.toast({ text: i18n.t('cloud.test.fail'), type: 'warn', ttl: 3200 });
        setBadge('disabled');
        refreshInfo();
        return;
      }

      dom.toast({ text: i18n.t('cloud.saved'), type: 'info', ttl: 2200 });
      setBadge('syncing');
      const res = await supabase.testConnection();
      if (res.ok) {
        dom.toast({ text: i18n.t('cloud.test.ok'), type: 'ok', ttl: 2600 });
        setBadge('synced');
        await auth.ensureSession();
        sync.start();
        sync.flush();
        sync.pull();
      } else {
        dom.toast({ text: i18n.t('cloud.test.fail'), type: 'error', ttl: 3400 });
        setBadge(res.reason === 'offline' ? 'offline' : 'error');
      }
      refreshInfo();
    }, { passive: true });
  }

  // 3) Borrar credenciales (restaura modo 100% local)
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      clearSupabaseConfig();
      supabase.reset();
      sync.stop();
      if (inUrl) inUrl.value = '';
      if (inKey) { inKey.value = ''; inKey.placeholder = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; }
      setBadge('disabled');
      refreshInfo();
      dom.toast({ text: i18n.t('cloud.cleared'), type: 'info', ttl: 2000 });
    }, { passive: true });
  }

  // 4) Estado global de la nube → badge
  bus.on('cloud:state', (p) => setBadge(p?.state || 'disabled'));
  bus.on('cloud:synced', () => { setBadge('synced'); refreshInfo(); });

  // 5) Contador de cola pendiente en el texto informativo (opcional)
  bus.on('cloud:queued', (p) => {
    if (!infoEl || !p) return;
    void store; // la cola vive en sync.js; aquí solo informamos si hace falta
  });
}

export const cloudPanel = Object.freeze({ init });
