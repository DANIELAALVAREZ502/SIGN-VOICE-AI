// =========================================================================
// js/cloud/supabase.js
// -------------------------------------------------------------------------
// CLIENTE SUPABASE OPCIONAL (CARGA PEREZOSA DESDE CDN)
// =========================================================================
//
// PRINCIPIO FUNDAMENTAL
//   La nube es ESTRICTAMENTE OPCIONAL. Este módulo NUNCA se importa si el
//   usuario no configura credenciales. Aun importado, getClient() devuelve
//   null si faltan credenciales o si no hay red: la app sigue 100% local.
//
// ESTRATEGIA DE CARGA
//   1. resolveSupabaseConfig() valida credenciales (URL + anon key).
//   2. Solo entonces se hace import() dinámico de @supabase/supabase-js
//      desde CDN ESM (jsDelivr). Sin dependencias npm ni build.
//   3. El cliente se memoiza; reset() lo descarta (cambio de credenciales).
//
// SEGURIDAD
//   Se usa SIEMPRE la ANON_KEY (pública). Nunca SERVICE_ROLE_KEY.
// =========================================================================

import { bus } from '../core/bus.js';
import { net } from '../core/net.js';
import {
  resolveSupabaseConfig,
  isCloudConfigured,
  assertNoServiceRole,
} from '../core/supabaseConfig.js';

/** URL del bundle ESM de supabase-js (jsDelivr sirve un build ESM listo). */
const CDN_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/** Cliente memoizado y promesa de carga en curso (evita dobles imports). */
let client = null;
let loading = null;

/** Emite estado de la nube de forma homogénea. */
function emitState(state, extra = {}) {
  bus.emit('cloud:state', { state, ts: Date.now(), ...extra });
}

/**
 * Crea (una vez) el cliente Supabase. Devuelve null si no está configurado
 * o si no hay conexión. Nunca lanza hacia el llamador.
 * @returns {Promise<object|null>}
 */
export async function getClient() {
  // 1) Credenciales válidas
  if (!isCloudConfigured()) {
    emitState('disabled');
    return null;
  }
  // 2) Con cliente ya creado
  if (client) return client;
  // 3) Carga en curso (compartir promesa)
  if (loading) return loading;

  loading = (async () => {
    const cfg = resolveSupabaseConfig();
    // Verificación de seguridad (nunca permitir service_role en cliente)
    try { assertNoServiceRole(cfg.anonKey); } catch (e) {
      emitState('error', { reason: 'service_role' });
      console.error('[cloud]', e);
      return null;
    }

    // Sin red no podemos importar el bundle desde CDN la 1ª vez.
    if (!net.isOnline()) {
      emitState('offline');
      return null;
    }

    try {
      const mod = await import(/* @vite-ignore */ CDN_JS);
      const createClient = mod.createClient;
      if (typeof createClient !== 'function') throw new Error('createClient ausente');
      client = createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      emitState('ready', { source: cfg.source });
      return client;
    } catch (err) {
      console.warn('[cloud] no se pudo cargar supabase-js:', err);
      emitState('error', { reason: 'load' });
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** ¿Hay cliente listo en memoria? */
export function isReady() {
  return client !== null;
}

/** Descarta el cliente (tras cambiar/borrar credenciales). */
export function reset() {
  client = null;
  loading = null;
}

/**
 * Prueba la conexión: intenta crear el cliente y hacer una consulta trivial.
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function testConnection() {
  const c = await getClient();
  if (!c) {
    // Distinguir "sin configurar" de "sin red"
    if (!isCloudConfigured()) return { ok: false, reason: 'not-configured' };
    if (!net.isOnline()) return { ok: false, reason: 'offline' };
    return { ok: false, reason: 'load' };
  }
  try {
    // Consulta liviana contra un endpoint público de GoTrue (health)
    const { error } = await c.auth.getSession();
    if (error) return { ok: false, reason: error.message };
    emitState('synced');
    return { ok: true };
  } catch (e) {
    emitState('error', { reason: 'test' });
    return { ok: false, reason: String(e?.message || e) };
  }
}

export const supabase = Object.freeze({ getClient, isReady, reset, testConnection });

if (typeof window !== 'undefined' && !window.__svaiSupabase) {
  window.__svaiSupabase = supabase;
}
