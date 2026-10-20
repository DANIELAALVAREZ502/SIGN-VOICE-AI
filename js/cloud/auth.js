// =========================================================================
// js/cloud/auth.js
// -------------------------------------------------------------------------
// AUTENTICACIÓN OPCIONAL (SESIÓN ANÓNIMA / PERSISTENTE)
// =========================================================================
//
// PROPÓSITO
//   Gestiona la sesión con Supabase sin imponer login:
//     - Si ya hay una sesión persistida (localStorage del cliente), se usa.
//     - Si no, se intenta inicio de sesión ANÓNIMO (si el proyecto lo tiene
//       habilitado). Si no lo está, se degrada a "sin usuario" en silencio.
//
// SEGURIDAD/PRIVACIDAD
//   No se piden datos personales. El modo anónimo basta para sincronizar
//   contactos SOS y modismos propios de forma aislada por usuario (RLS).
//
// EVENTOS DEL BUS
//   emite: 'cloud:auth' {userId|null, anonymous:boolean}
// =========================================================================

import { bus } from '../core/bus.js';
import { supabase } from './supabase.js';

/** Caché en memoria de la sesión actual. */
let session = null;

/**
 * Obtiene la sesión actual del cliente (sin crear).
 * @returns {Promise<object|null>}
 */
export async function getSession() {
  const c = await supabase.getClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    session = data?.session || null;
    return session;
  } catch (_) {
    return null;
  }
}

/**
 * Garantiza una sesión: reutiliza la existente o intenta login anónimo.
 * @returns {Promise<{userId:string|null, anonymous:boolean}>}
 */
export async function ensureSession() {
  const c = await supabase.getClient();
  if (!c) return { userId: null, anonymous: false };

  // 1) Sesión ya persistida
  const existing = await getSession();
  if (existing?.user?.id) {
    const res = { userId: existing.user.id, anonymous: !existing.user.email };
    bus.emit('cloud:auth', res);
    return res;
  }

  // 2) Intento de login anónimo (puede no estar habilitado en el proyecto)
  try {
    const { data, error } = await c.auth.signInAnonymously();
    if (error) throw error;
    session = data?.session || null;
    const res = { userId: session?.user?.id || null, anonymous: true };
    bus.emit('cloud:auth', res);
    return res;
  } catch (_) {
    // Degradación silenciosa: la app funciona igual sin usuario
    const res = { userId: null, anonymous: false };
    bus.emit('cloud:auth', res);
    return res;
  }
}

/** @returns {string|null} id del usuario actual (si lo hay) */
export function getUserId() {
  return session?.user?.id || null;
}

/** Cierra la sesión (no borra datos locales). */
export async function signOut() {
  const c = await supabase.getClient();
  session = null;
  if (!c) return;
  try { await c.auth.signOut(); } catch (_) {}
  bus.emit('cloud:auth', { userId: null, anonymous: false });
}

export const auth = Object.freeze({ getSession, ensureSession, getUserId, signOut });

if (typeof window !== 'undefined' && !window.__svaiAuth) {
  window.__svaiAuth = auth;
}
