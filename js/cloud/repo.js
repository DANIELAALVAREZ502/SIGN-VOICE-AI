// =========================================================================
// js/cloud/repo.js
// -------------------------------------------------------------------------
// REPOSITORIO REMOTO (TABLAS OPCIONALES EN SUPABASE) — CON FALLBACK LOCAL
// =========================================================================
//
// ESQUEMA ESPERADO (SQL de referencia, con RLS por auth.uid())
//   create table sos_contacts (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid not null default auth.uid(),
//     name text not null,
//     relation text,
//     dial_code text,
//     phone text,
//     msg text,
//     updated_at timestamptz not null default now()
//   );
//   create table slang_terms (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid not null default auth.uid(),
//     term text not null,
//     neutral text not null,
//     region text,
//     updated_at timestamptz not null default now()
//   );
//
// PRINCIPIO
//   Cada operación devuelve {ok:boolean, data?, error?}. Si no hay cliente
//   (nube no configurada o sin red), devuelve {ok:false} sin lanzar: el
//   llamador decide si encolar en el outbox (sync.js) o seguir local.
// =========================================================================

import { supabase } from './supabase.js';

const T_CONTACTS = 'sos_contacts';
const T_SLANG = 'slang_terms';

/** Convierte una fila remota al formato local de contacto. */
function rowToContact(r) {
  return {
    id: r.id,
    name: r.name || '',
    relation: r.relation || '',
    dialCode: r.dial_code || '',
    phone: r.phone || '',
    msg: r.msg || '',
    remote: true,
    updatedAt: r.updated_at || null,
  };
}

/** Convierte un contacto local a fila remota (snake_case). */
function contactToRow(c) {
  return {
    name: c.name || '',
    relation: c.relation || '',
    dial_code: c.dialCode || '',
    phone: c.phone || '',
    msg: c.msg || '',
  };
}

/**
 * Sube (upsert) un contacto SOS.
 * @param {object} contact
 * @returns {Promise<{ok:boolean,data?:object,error?:any}>}
 */
export async function pushContact(contact) {
  const c = await supabase.getClient();
  if (!c || !contact) return { ok: false, error: 'no-client' };
  try {
    const payload = contactToRow(contact);
    if (contact.id && contact.remote) payload.id = contact.id;
    const { data, error } = await c.from(T_CONTACTS).upsert(payload).select().single();
    if (error) return { ok: false, error };
    return { ok: true, data: rowToContact(data) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Elimina un contacto remoto por id.
 * @param {string} id
 * @returns {Promise<{ok:boolean,error?:any}>}
 */
export async function deleteContact(id) {
  const c = await supabase.getClient();
  if (!c || !id) return { ok: false, error: 'no-client' };
  try {
    const { error } = await c.from(T_CONTACTS).delete().eq('id', id);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Descarga contactos (todos los del usuario; RLS filtra).
 * @returns {Promise<{ok:boolean,data?:object[],error?:any}>}
 */
export async function fetchContacts() {
  const c = await supabase.getClient();
  if (!c) return { ok: false, error: 'no-client' };
  try {
    const { data, error } = await c.from(T_CONTACTS).select('*').order('updated_at', { ascending: true });
    if (error) return { ok: false, error };
    return { ok: true, data: (data || []).map(rowToContact) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Sube un modismo personal (term → neutral).
 * @param {{term:string,neutral:string,region?:string}} entry
 * @returns {Promise<{ok:boolean,data?:object,error?:any}>}
 */
export async function pushSlang(entry) {
  const c = await supabase.getClient();
  if (!c || !entry?.term || !entry?.neutral) return { ok: false, error: 'no-client' };
  try {
    const { data, error } = await c
      .from(T_SLANG)
      .upsert({ term: entry.term, neutral: entry.neutral, region: entry.region || null })
      .select()
      .single();
    if (error) return { ok: false, error };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Descarga modismos personales.
 * @returns {Promise<{ok:boolean,data?:object[],error?:any}>}
 */
export async function fetchSlang() {
  const c = await supabase.getClient();
  if (!c) return { ok: false, error: 'no-client' };
  try {
    const { data, error } = await c.from(T_SLANG).select('*');
    if (error) return { ok: false, error };
    return { ok: true, data: data || [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export const repo = Object.freeze({
  pushContact, deleteContact, fetchContacts, pushSlang, fetchSlang,
});

if (typeof window !== 'undefined' && !window.__svaiRepo) {
  window.__svaiRepo = repo;
}
