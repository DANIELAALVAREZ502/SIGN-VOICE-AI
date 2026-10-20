// =========================================================================
// js/safety/sos.js
// -------------------------------------------------------------------------
// EMERGENCIA SOS DE DOBLE FUNCIÓN — cuenta atrás + llamada + mensaje
// =========================================================================
//
// FLUJO
//   1. trigger(): cuenta atrás cancelable (CONFIG.SOS.COUNTDOWN_MS).
//   2. Al llegar a 0: abre el marcador telefónico hacia el contacto primario
//      (tel:). Emite 'sos:activated'.
//   3. Al volver a la app tras la llamada (visibilitychange visible), ofrece
//      enviar el mensaje de auxilio preconfigurado por WhatsApp o SMS.
//   4. El mensaje NUNCA pasa por el filtro de modismos (seguridad/criticidad).
//
// PERSISTENCIA (store)
//   'sos.contacts'  → array de {id,name,relation,dialCode,phone,msg,remote?}
//   'sos.msg'       → mensaje por defecto
//   'sos.primaryId' → id del contacto primario
//
// EVENTOS DEL BUS
//   emite: 'sos:countdown' {n} · 'sos:activated' {contact} · 'sos:cancelled'
//          'sos:call:back' {contact} · 'sos:nocontact' · 'sos:contacts'
// =========================================================================

import { CONFIG } from '../core/config.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';

const KEY_CONTACTS = 'sos.contacts';
const KEY_MSG = 'sos.msg';
const KEY_PRIMARY = 'sos.primaryId';

let counting = false;
let countTimer = null;
let remaining = 0;
let visibilityBound = false;
let hiddenDuringCall = false;

/** Genera un id local razonable. */
function newId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normaliza un teléfono a solo dígitos. */
function digitsOnly(s) {
  return String(s || '').replace(/\D+/g, '');
}

/** Construye el número E.164 sin '+' (dígitos). */
function e164Digits(contact) {
  const dial = digitsOnly(contact?.dialCode || CONFIG.SOS.DEFAULT_DIAL);
  const phone = digitsOnly(contact?.phone || '');
  return `${dial}${phone}`;
}

/** Lista validada de contactos. */
export function getContacts() {
  const arr = store.get(KEY_CONTACTS, []);
  return Array.isArray(arr) ? arr.filter((c) => c && (c.phone || c.name)) : [];
}

/** Contacto primario (o el primero disponible). */
export function getPrimary() {
  const list = getContacts();
  if (!list.length) return null;
  const id = store.get(KEY_PRIMARY, null);
  return list.find((c) => c.id === id) || list[0];
}

/**
 * Guarda un contacto (crea o actualiza por id).
 * @param {object} contact
 * @param {{sync?:boolean}} [opts]
 * @returns {object|null} contacto guardado
 */
export function saveContact(contact, opts = {}) {
  if (!contact) return null;
  const list = getContacts().slice();
  const entry = {
    id: contact.id || newId(),
    name: String(contact.name || '').trim(),
    relation: String(contact.relation || '').trim(),
    dialCode: String(contact.dialCode || CONFIG.SOS.DEFAULT_DIAL).trim(),
    phone: String(contact.phone || '').trim(),
    msg: String(contact.msg || '').trim(),
    remote: !!contact.remote,
  };
  if (!entry.name || !entry.phone) return null;
  const idx = list.findIndex((c) => c.id === entry.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
  store.set(KEY_CONTACTS, list);
  if (!store.get(KEY_PRIMARY, null)) store.set(KEY_PRIMARY, entry.id);

  // Subida opcional a la nube (perezosa, nunca bloquea)
  if (opts.sync !== false) {
    import('../cloud/sync.js')
      .then((m) => m.sync?.queue?.({ type: 'contact-upsert', payload: entry }))
      .catch(() => {});
  }
  bus.emit('sos:contacts', { contacts: list });
  return entry;
}

/** Elimina un contacto por id. */
export function removeContact(id, opts = {}) {
  const list = getContacts().filter((c) => c.id !== id);
  store.set(KEY_CONTACTS, list);
  if (store.get(KEY_PRIMARY, null) === id) {
    store.set(KEY_PRIMARY, list[0]?.id || null);
  }
  if (opts.sync !== false) {
    import('../cloud/sync.js')
      .then((m) => m.sync?.queue?.({ type: 'contact-delete', payload: { id } }))
      .catch(() => {});
  }
  bus.emit('sos:contacts', { contacts: list });
}

/** Borra todos los contactos locales. */
export function clearContacts() {
  store.set(KEY_CONTACTS, []);
  store.set(KEY_PRIMARY, null);
  bus.emit('sos:contacts', { contacts: [] });
}

/** Marca un contacto como primario. */
export function setPrimary(id) {
  store.set(KEY_PRIMARY, id || null);
}

/** Mensaje de auxilio (contacto > store > default). */
export function getMessage(contact) {
  return String(
    contact?.msg || store.get(KEY_MSG, CONFIG.SOS.DEFAULT_MSG) || CONFIG.SOS.DEFAULT_MSG
  );
}

/** Establece el mensaje por defecto. */
export function setMessage(msg) {
  store.set(KEY_MSG, String(msg || '').trim() || CONFIG.SOS.DEFAULT_MSG);
}

/** Abre el marcador con el número del contacto (tel:). */
export function openCall(contact) {
  const digits = e164Digits(contact);
  const url = digits ? `tel:+${digits}` : 'tel:';
  try {
    // Pequeña pausa para que el toast/contador desaparezca antes del salto
    setTimeout(() => { window.location.href = url; }, CONFIG.SOS.TEL_DELAY_MS);
  } catch (_) {
    window.open(url, '_self');
  }
}

/**
 * Abre el mensaje de auxilio por WhatsApp o SMS.
 * @param {object} contact
 * @param {'whatsapp'|'sms'} [channel]
 */
export function openMessage(contact, channel = 'whatsapp') {
  const digits = e164Digits(contact);
  const text = encodeURIComponent(getMessage(contact));
  let url;
  if (channel === 'sms') {
    url = `sms:+${digits}?body=${text}`;
  } else {
    url = `https://wa.me/${digits}?text=${text}`;
  }
  try {
    window.open(url, channel === 'sms' ? '_self' : '_blank', 'noopener');
  } catch (_) {
    window.location.href = url;
  }
  bus.emit('sos:msg:opened', { channel, ts: Date.now() });
}

/** Vincula la escucha de "vuelta de llamada" (una sola vez). */
function bindVisibility() {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenDuringCall = true;
      return;
    }
    // Volvió a estar visible tras haber estado oculta (posible llamada)
    if (hiddenDuringCall) {
      hiddenDuringCall = false;
      setTimeout(() => {
        const contact = getPrimary();
        bus.emit('sos:call:back', { contact, ts: Date.now() });
      }, CONFIG.SOS.VISIBILITY_WAIT_MS);
    }
  }, { passive: true });
}

/** Cancela una cuenta atrás en curso. */
export function cancel() {
  if (!counting) return;
  counting = false;
  clearInterval(countTimer);
  countTimer = null;
  bus.emit('sos:cancelled', { ts: Date.now() });
}

/** ¿Hay una cuenta atrás activa? */
export function isCounting() {
  return counting;
}

/**
 * Inicia el flujo SOS: cuenta atrás cancelable → llamada → (al volver) mensaje.
 * @returns {boolean} true si arrancó la cuenta atrás
 */
export function trigger() {
  if (counting) return false;
  counting = true;
  remaining = CONFIG.SOS.COUNTDOWN_MS;
  bindVisibility();

  const tick = () => {
    remaining -= CONFIG.SOS.COUNTDOWN_TICK_MS;
    if (remaining > 0) {
      bus.emit('sos:countdown', { n: Math.ceil(remaining / 1000), ts: Date.now() });
      return;
    }
    // Fin de cuenta atrás → activar
    clearInterval(countTimer);
    countTimer = null;
    counting = false;
    const contact = getPrimary();
    if (!contact) {
      bus.emit('sos:nocontact', { ts: Date.now() });
      return;
    }
    bus.emit('sos:activated', { contact, ts: Date.now() });
    openCall(contact);
  };

  bus.emit('sos:countdown', { n: Math.ceil(remaining / 1000), ts: Date.now() });
  countTimer = setInterval(tick, CONFIG.SOS.COUNTDOWN_TICK_MS);
  return true;
}

/** Inicializa: adopta un mensaje por defecto si aún no existe. */
export function init() {
  if (!store.get(KEY_MSG, null)) store.set(KEY_MSG, CONFIG.SOS.DEFAULT_MSG);
}

export const sos = Object.freeze({
  init, trigger, cancel, isCounting,
  getContacts, getPrimary, saveContact, removeContact, clearContacts, setPrimary,
  getMessage, setMessage, openCall, openMessage,
});

if (typeof window !== 'undefined' && !window.__svaiSos) {
  window.__svaiSos = sos;
}
