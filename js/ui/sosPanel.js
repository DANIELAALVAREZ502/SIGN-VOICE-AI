// =========================================================================
// js/ui/sosPanel.js
// -------------------------------------------------------------------------
// PANEL SOS — contactos de emergencia + botón de cuenta atrás
// =========================================================================
//
// PROPÓSITO
//   Conecta el DOM del panel #panel-sos con js/safety/sos.js: alta/baja de
//   contactos, botón SOS (cuenta atrás cancelable) y oferta de envío del
//   mensaje de auxilio al volver de la llamada.
//
// EVENTOS BUS (escucha)
//   'sos:countdown' · 'sos:activated' · 'sos:cancelled' ·
//   'sos:call:back' · 'sos:nocontact' · 'sos:contacts'
// =========================================================================

import { bus } from '../core/bus.js';
import { dom } from '../core/dom.js';
import { i18n } from '../core/i18n.js';
import { sos } from '../safety/sos.js';

// --- Referencias DOM -----------------------------------------------------
const btnSos = dom.qs('#btn-sos');
const btnCancel = dom.qs('#btn-sos-cancel');
const countEl = dom.qs('#sos-count');
const contactsEl = dom.qs('#sos-contacts');
const emptyEl = dom.qs('#sos-empty');
const form = dom.qs('#sos-form');
const inName = dom.qs('#sos-name');
const inRel = dom.qs('#sos-rel');
const inDial = dom.qs('#sos-dial');
const inPhone = dom.qs('#sos-phone');
const inMsg = dom.qs('#sos-msg');
const btnClearAll = dom.qs('#sos-clear');

/** Muestra/oculta el contador y el botón cancelar del botón SOS. */
function setCounting(on, n) {
  if (countEl) {
    countEl.textContent = String(n ?? '');
    dom.setHidden(countEl, !on);
  }
  if (btnCancel) dom.setHidden(btnCancel, !on);
  if (btnSos) btnSos.setAttribute('aria-busy', on ? 'true' : 'false');
}

/** Pinta la lista de contactos (o el estado vacío). */
function renderContacts() {
  if (!contactsEl) return;
  const list = sos.getContacts();
  contactsEl.innerHTML = '';

  if (!list.length) {
    if (emptyEl) dom.setHidden(emptyEl, false);
    return;
  }
  if (emptyEl) dom.setHidden(emptyEl, true);

  const primary = sos.getPrimary();
  const frag = document.createDocumentFragment();

  for (const c of list) {
    const card = document.createElement('div');
    card.className = 'contact-card';

    const avatar = document.createElement('div');
    avatar.className = 'contact-card__avatar';
    avatar.textContent = (c.name || '?').trim().charAt(0).toUpperCase();
    avatar.setAttribute('aria-hidden', 'true');
    card.appendChild(avatar);

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'contact-card__name';
    name.textContent = c.name + (primary && primary.id === c.id ? ' ★' : '');
    const phone = document.createElement('div');
    phone.className = 'contact-card__phone';
    phone.textContent = `${c.dialCode || ''} ${c.phone || ''}`.trim();
    info.appendChild(name);
    info.appendChild(phone);
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'contact-card__actions';

    const call = document.createElement('button');
    call.className = 'btn btn--ghost btn--sm';
    call.type = 'button';
    call.textContent = 'Llamar';
    call.addEventListener('click', () => sos.openCall(c), { passive: true });
    actions.appendChild(call);

    const del = document.createElement('button');
    del.className = 'btn btn--ghost btn--sm';
    del.type = 'button';
    del.textContent = 'Borrar';
    del.addEventListener('click', () => {
      sos.removeContact(c.id);
      dom.toast({ text: i18n.t('sos.contact.removed'), type: 'info', ttl: 1800 });
    }, { passive: true });
    actions.appendChild(del);

    card.appendChild(actions);
    frag.appendChild(card);
  }

  contactsEl.appendChild(frag);
}

/** Prepara el mensaje por defecto en el textarea. */
function prefillMessage() {
  if (inMsg && !inMsg.value.trim()) {
    inMsg.value = sos.getMessage();
  }
}

export function init() {
  renderContacts();
  prefillMessage();

  // Botón SOS: iniciar cuenta atrás
  if (btnSos) {
    btnSos.addEventListener('click', (e) => {
      // El botón cancelar puede quedar como hermano por corrección de HTML:
      // ignoramos el click si proviene de él.
      if (e.target && e.target.closest && e.target.closest('#btn-sos-cancel')) return;
      sos.trigger();
    }, { passive: true });
  }

  // Cancelar cuenta atrás
  if (btnCancel) {
    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      sos.cancel();
    }, { passive: true });
  }

  // Alta de contacto
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = inName ? inName.value.trim() : '';
      const phone = inPhone ? inPhone.value.trim() : '';
      if (!name || !phone) {
        dom.toast({ text: i18n.t('sos.form.required'), type: 'warn', ttl: 2600 });
        return;
      }
      const msg = inMsg ? inMsg.value.trim() : '';
      if (msg) sos.setMessage(msg);
      sos.saveContact({
        name,
        relation: inRel ? inRel.value.trim() : '',
        dialCode: inDial ? inDial.value : '+503',
        phone,
        msg,
      });
      if (inName) inName.value = '';
      if (inRel) inRel.value = '';
      if (inPhone) inPhone.value = '';
      dom.toast({ text: i18n.t('sos.contact.saved'), type: 'ok', ttl: 2200 });
      renderContacts();
    });
  }

  // Borrar todos
  if (btnClearAll) {
    btnClearAll.addEventListener('click', () => {
      sos.clearContacts();
      dom.toast({ text: i18n.t('sos.contacts.cleared'), type: 'info', ttl: 2000 });
      renderContacts();
    }, { passive: true });
  }

  // --- Eventos del bus ---
  bus.on('sos:countdown', (p) => setCounting(true, p?.n));
  bus.on('sos:cancelled', () => {
    setCounting(false);
    dom.toast({ text: i18n.t('sos.cancel'), type: 'info', ttl: 1400 });
  });
  bus.on('sos:activated', (p) => {
    setCounting(false);
    dom.toast({
      text: i18n.t('sos.activated'),
      type: 'warn',
      ttl: 3600,
      action: p?.contact ? { label: 'WhatsApp', onClick: () => sos.openMessage(p.contact, 'whatsapp') } : undefined,
    });
  });
  bus.on('sos:nocontact', () => {
    setCounting(false);
    dom.toast({ text: i18n.t('sos.nocontact'), type: 'warn', ttl: 3400 });
  });
  bus.on('sos:call:back', (p) => {
    if (!p?.contact) return;
    dom.toast({
      text: i18n.t('sos.call.back'),
      type: 'info',
      ttl: 6000,
      action: { label: i18n.t('sos.send.msg'), onClick: () => sos.openMessage(p.contact, 'whatsapp') },
    });
  });
  bus.on('sos:contacts', () => renderContacts());
}

export const sosPanel = Object.freeze({ init });
