// =========================================================================
// js/core/supabaseConfig.js
// -------------------------------------------------------------------------
// CONFIGURACIÓN OPCIONAL DE SUPABASE (PLACEHOLDERS VACÍOS + RESOLUTOR)
// =========================================================================
//
// PRINCIPIO FUNDAMENTAL
//   "Supabase entra como capa de nube estrictamente opcional y aditiva, nunca
//   como dependencia". Si URL y ANON_KEY están vacías, js/cloud/* NUNCA se
//   importa dinámicamente y los 5 pilares funcionan 100% local.
//
// ORDEN DE PRIORIDAD (resolveSupabaseConfig):
//   1. localStorage['svai.cloud.supabase']  → escrito desde Ajustes (UI)
//   2. window.ENV (env.js opcional)        → CI/CD (Netlify/Vercel)
//   3. placeholders de ESTE archivo        → desarrollo manual
//
// SEGURIDAD
//   - NUNCA pegar aquí SUPABASE_SERVICE_ROLE_KEY (bypasea RLS, expone todo).
//   - Solo usar ANON_KEY (pública). El proyecto NO tiene servidor.
//   - RLS OBLIGATORIA en schema.sql.
// =========================================================================

export const SUPABASE_URL = '';        // ← PEGA AQUÍ tu URL (https://xxxx.supabase.co)
export const SUPABASE_ANON_KEY = '';   // ← PEGA AQUÍ tu anon key (clave pública)

/**
 * Lee credenciales desde localStorage (formato: {url, anonKey})
 * @returns {{url:string,anonKey:string}|null}
 */
function readFromLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem('svai.cloud.supabase');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const url = String(obj.url || '').trim();
    const anonKey = String(obj.anonKey || '').trim();
    if (!url || !anonKey) return null;
    return { url, anonKey };
  } catch (_) {
    return null;
  }
}

/**
 * Lee credenciales desde window.ENV (env.js opcional)
 * Formato esperado en env.js:
 *   window.ENV = { SUPABASE_URL: '...', SUPABASE_ANON_KEY: '...' }
 * @returns {{url:string,anonKey:string}|null}
 */
function readFromEnv() {
  if (typeof window === 'undefined') return null;
  const ENV = window.ENV;
  if (!ENV || typeof ENV !== 'object') return null;
  const url = String(ENV.SUPABASE_URL || ENV.supabaseUrl || '').trim();
  const anonKey = String(ENV.SUPABASE_ANON_KEY || ENV.supabaseAnonKey || '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Resuelve la configuración efectiva de Supabase (orden de prioridad).
 * @returns {{url:string,anonKey:string,source:'ls'|'env'|'defaults'}}
 */
export function resolveSupabaseConfig() {
  // 1) localStorage
  const ls = readFromLocalStorage();
  if (ls && ls.url && ls.anonKey) {
    return { url: ls.url, anonKey: ls.anonKey, source: 'ls' };
  }
  // 2) env.js
  const env = readFromEnv();
  if (env && env.url && env.anonKey) {
    return { url: env.url, anonKey: env.anonKey, source: 'env' };
  }
  // 3) placeholders
  const url = SUPABASE_URL.trim();
  const anonKey = SUPABASE_ANON_KEY.trim();
  return { url, anonKey, source: 'defaults' };
}

/**
 * ¿Está la nube configurada correctamente?
 * @returns {boolean}
 */
export function isCloudConfigured() {
  const c = resolveSupabaseConfig();
  if (!c.url || !c.anonKey) return false;
  // Validación mínima: debe empezar por https:// y contener .supabase.co
  if (!/^https:\/\//i.test(c.url)) return false;
  if (!/\.supabase\.co$/i.test(c.url.replace(/\/$/, ''))) return false;
  // ANON_KEY suele ser JWT (empieza por eyJ)
  if (!/^eyJ/i.test(c.anonKey)) return false;
  return true;
}

/**
 * Guarda credenciales en localStorage (escritas desde el panel de Ajustes)
 * @param {{url:string,anonKey:string}} cfg
 */
export function saveSupabaseConfig(cfg = {}) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  const url = String(cfg.url || '').trim();
  const anonKey = String(cfg.anonKey || '').trim();
  if (!url || !anonKey) return false;
  try {
    window.localStorage.setItem('svai.cloud.supabase', JSON.stringify({ url, anonKey }));
    return true;
  } catch (_) {
    return false;
  }
}

/** Elimina credenciales de localStorage */
export function clearSupabaseConfig() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem('svai.cloud.supabase');
  } catch (_) {}
}

/**
 * Enmascara una clave para mostrarla en UI (últimos 6 + prefijo corto)
 * @param {string} key
 */
export function maskSecret(key = '') {
  const s = String(key).trim();
  if (s.length <= 10) return '••••••••';
  return `${s.slice(0, 6)}••••••${s.slice(-6)}`;
}

/**
 * ADVERTENCIA DE SEGURIDAD: nunca usar SERVICE_ROLE_KEY en cliente.
 * Esta función es meramente documental (no se usa). Úsala solo en servidor.
 * @param {string} [k]
 */
export function assertNoServiceRole(k = '') {
  const s = String(k);
  if (/service[_-]?role/i.test(s) && s.length > 60) {
    console.error('[SECURITY] SERVICE_ROLE_KEY detectado en cliente. NO debe usarse aquí.');
    throw new Error('SERVICE_ROLE_KEY no permitido en cliente.');
  }
}

export const supabaseConfig = Object.freeze({
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  resolveSupabaseConfig,
  isCloudConfigured,
  saveSupabaseConfig,
  clearSupabaseConfig,
  maskSecret,
  assertNoServiceRole,
});

if (typeof window !== 'undefined' && !window.__svaiSupabaseCfg) {
  window.__svaiSupabaseCfg = supabaseConfig;
}
