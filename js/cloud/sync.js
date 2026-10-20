// =========================================================================
// js/cloud/sync.js
// -------------------------------------------------------------------------
// SINCRONIZACIÓN OPCIONAL (OUTBOX + PULL PERIÓDICO) — OFFLINE-FIRST
// =========================================================================
//
// MODELO
//   - OUTBOX: toda escritura remota (contacto/modismo) se encola localmente
//     en el store ('cloud.outbox') y se intenta aplicar. Si falla (offline,
//     nube sin configurar), permanece en cola y se reintenta al recuperar red.
//   - PULL: cada PULL_INTERVAL_MS (solo online y con cliente listo) se
//     descargan contactos/modismos y se fusionan con los locales.
//
// GARANTÍAS
//   La sincronización NUNCA bloquea la UI ni destruye datos locales: ante
//   cualquier error, se mantiene lo local y se reintenta después.
//
// EVENTOS DEL BUS
//   emite: 'cloud:state' · 'cloud:queued' · 'cloud:synced' {counts}
// =========================================================================

import { CONFIG } from '../core/config.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { net } from '../core/net.js';
import { supabase } from './supabase.js';
import { repo } from './repo.js';

const OUTBOX_KEY = 'cloud.outbox';
const LAST_SYNC_KEY = 'cloud.lastSync';
const CONTACTS_KEY = 'sos.contacts';

let timer = null;
let flushing = false;
let started = false;

/** Lee el outbox persistido (valida forma). */
function readOutbox() {
  const arr = store.get(OUTBOX_KEY, []);
  return Array.isArray(arr) ? arr.filter((o) => o && o.type) : [];
}

/** Persiste el outbox. */
function writeOutbox(arr) {
  store.set(OUTBOX_KEY, Array.isArray(arr) ? arr : []);
}

/** Encola una operación y dispara un flush (best-effort). */
export function queue(op) {
  if (!op || !op.type) return;
  const entry = { id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: Date.now(), ...op };
  const arr = readOutbox();
  arr.push(entry);
  writeOutbox(arr);
  bus.emit('cloud:queued', { id: entry.id, type: entry.type, pending: arr.length });
  // Intento inmediato (no bloquea: no se await aquí)
  flush();
}

/** Aplica una operación concreta contra el repositorio remoto. */
async function applyOp(op) {
  switch (op.type) {
    case 'contact-upsert': return repo.pushContact(op.payload);
    case 'contact-delete': return repo.deleteContact(op.payload?.id);
    case 'slang-upsert': return repo.pushSlang(op.payload);
    default: return { ok: false, error: 'tipo-desconocido' };
  }
}

/** Vacía el outbox contra el backend. Silencioso ante fallos. */
export async function flush() {
  if (flushing) return;
  if (!net.isOnline() || !supabase.isReady()) return;
  const arr = readOutbox();
  if (!arr.length) return;

  flushing = true;
  bus.emit('cloud:state', { state: 'syncing', ts: Date.now() });
  const remaining = [];
  let sent = 0;

  for (const op of arr) {
    let res;
    try { res = await applyOp(op); } catch (e) { res = { ok: false, error: e }; }
    if (res && res.ok) {
      sent++;
    } else {
      // Si el cliente desapareció, dejamos el resto en cola
      remaining.push(op);
      if (res && res.error === 'no-client') { remaining.push(...arr.slice(arr.indexOf(op) + 1)); break; }
    }
  }

  writeOutbox(remaining);
  flushing = false;
  bus.emit('cloud:state', { state: remaining.length ? 'error' : 'synced', sent, pending: remaining.length, ts: Date.now() });
}

/** Fusiona contactos remotos con los locales (por id o dial+phone). */
function mergeContacts(local, remote) {
  const key = (c) => (c.id ? `id:${c.id}` : `ph:${(c.dialCode || '')}${c.phone || ''}`);
  const map = new Map();
  for (const c of local || []) if (c) map.set(key(c), c);
  for (const c of remote || []) if (c) map.set(key(c), { ...(map.get(key(c)) || {}), ...c });
  return Array.from(map.values());
}

/** Descarga remotos y fusiona con el estado local. */
export async function pull() {
  if (!net.isOnline() || !supabase.isReady()) return { ok: false };
  const [contactsRes, slangRes] = await Promise.all([repo.fetchContacts(), repo.fetchSlang()]);

  if (contactsRes.ok) {
    const local = store.get(CONTACTS_KEY, []);
    const merged = mergeContacts(Array.isArray(local) ? local : [], contactsRes.data || []);
    store.set(CONTACTS_KEY, merged);
  }
  if (slangRes.ok) {
    // Los modismos personales se guardan planos para slangFilter (fase 9)
    store.set('slang.personal', slangRes.data || []);
  }

  const ok = contactsRes.ok || slangRes.ok;
  if (ok) {
    store.set(LAST_SYNC_KEY, Date.now());
    bus.emit('cloud:synced', {
      contacts: contactsRes.ok ? (contactsRes.data || []).length : 0,
      slang: slangRes.ok ? (slangRes.data || []).length : 0,
      ts: Date.now(),
    });
    bus.emit('cloud:state', { state: 'synced', ts: Date.now() });
  }
  return { ok };
}

/** Arranca el bucle de sincronización (idempotente). */
export function start() {
  if (started) return;
  started = true;

  bus.on('net:online', () => { flush(); pull(); });
  bus.on('cloud:state', (p) => {
    // Cuando el cliente pasa a "ready", aprovechar para sincronizar
    if (p?.state === 'ready') { flush(); pull(); }
  });

  clearInterval(timer);
  timer = setInterval(() => { flush(); pull(); }, CONFIG.CLOUD.PULL_INTERVAL_MS);

  if (typeof document !== 'undefined') {
    let last = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last < CONFIG.CLOUD.VIS_THROTTLE_MS) return;
      last = now;
      flush(); pull();
    }, { passive: true });
  }
}

/** Detiene el bucle (útil al cerrar sesión o borrar credenciales). */
export function stop() {
  started = false;
  clearInterval(timer);
  timer = null;
}

/**
 * Inicializa: si hay nube configurada, arranca el bucle; si no, no hace nada.
 */
export function init() {
  start();
  if (supabase.isReady()) { flush(); pull(); }
}

export const sync = Object.freeze({ init, start, stop, queue, flush, pull });

if (typeof window !== 'undefined' && !window.__svaiSync) {
  window.__svaiSync = sync;
}
