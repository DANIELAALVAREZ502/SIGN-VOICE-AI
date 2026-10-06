// =========================================================================
// js/core/dom.js
// -------------------------------------------------------------------------
// UTILIDADES DOM SEGUROS (sin jQuery) — ARIA + accesibilidad
// =========================================================================
//
// PROPÓSITO
//   Thin wrapper para queries, toggles, ARIA, foco, throttling/debouncing
//   y creación de toasts/modales ligeros. Usa event delegation cuando convenga.
//
// REGLAS
//   - Siempre verificar existencia (no asumir elementos).
//   - Usar dataset en lugar de clases semánticas para estado JS.
//   - No mutar global styles a menos que sea absolutamente necesario.
// =========================================================================

import { CONFIG } from './config.js';

/**
 * Query selector con fallback
 * @template {Element} T
 * @param {string} sel
 * @param {Document|Element} [root]
 * @returns {T|null}
 */
export function qs(sel, root = document) {
  try {
    return root.querySelector(sel);
  } catch (_) {
    return null;
  }
}

/**
 * Query selector all → array
 * @param {string} sel
 * @param {Document|Element} [root]
 */
export function qsa(sel, root = document) {
  try {
    return Array.from(root.querySelectorAll(sel));
  } catch (_) {
    return [];
  }
}

/**
 * toggle aria-hidden + hidden (cuando exista atributo hidden)
 */
export function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) {
    el.setAttribute('aria-hidden', 'true');
    if ('hidden' in el) el.hidden = true;
  } else {
    el.removeAttribute('aria-hidden');
    if ('hidden' in el) el.hidden = false;
  }
}

/** aria-selected boolean */
export function setAriaSelected(el, sel) {
  if (!el) return;
  el.setAttribute('aria-selected', sel ? 'true' : 'false');
}

/** aria-expanded boolean */
export function setAriaExpanded(el, exp) {
  if (!el) return;
  el.setAttribute('aria-expanded', exp ? 'true' : 'false');
}

/** aria-pressed boolean */
export function setAriaPressed(el, p) {
  if (!el) return;
  el.setAttribute('aria-pressed', p ? 'true' : 'false');
}

/** focus seguro */
export function focus(el, { preventScroll = false } = {}) {
  if (!el || typeof el.focus !== 'function') return;
  try {
    el.focus({ preventScroll });
  } catch (_) {
    el.focus();
  }
}

/** throttle */
export function throttle(fn, ms = CONFIG.UI.THROTTLE_MS) {
  let last = 0;
  let timer = null;
  return function (...args) {
    const now = Date.now();
    const remain = ms - (now - last);
    if (remain <= 0) {
      last = now;
      fn.apply(this, args);
    } else if (timer === null) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remain);
    }
  };
}

/** debounce */
export function debounce(fn, ms = CONFIG.UI.DEBOUNCE_MS) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/** crear toast minimalista en #toast-host */
let toastHost = null;
function ensureToastHost() {
  if (toastHost) return toastHost;
  toastHost = qs('#toast-host');
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.id = 'toast-host';
    toastHost.className = 'toast-host';
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

/**
 * Mostrar toast
 * @param {{text:string,type?:'ok'|'warn'|'error'|'info',ttl?:number,action?:{label:string,onClick:()=>void}}} opts
 */
export function toast(opts = {}) {
  const host = ensureToastHost();
  const { text = '', type = 'info', ttl = CONFIG.UI.TOAST_MS, action } = opts;

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  const body = document.createElement('div');
  body.textContent = text;

  const close = document.createElement('button');
  close.className = 'icon-btn toast__close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar notificación');
  close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';
  close.onclick = () => dismiss();

  el.appendChild(body);
  if (action) {
    const act = document.createElement('button');
    act.className = 'btn btn--ghost btn--sm';
    act.type = 'button';
    act.textContent = action.label;
    act.onclick = () => {
      try { action.onClick(); } finally { dismiss(); }
    };
    el.appendChild(act);
  }
  el.appendChild(close);
  host.appendChild(el);

  const timer = setTimeout(dismiss, ttl);
  function dismiss() {
    clearTimeout(timer);
    el.style.transition = 'opacity 160ms ease, transform 160ms ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 160);
  }
  // limitar toasts
  while (host.children.length > CONFIG.UI.TOAST_MAX) {
    host.removeChild(host.firstElementChild);
  }
  return { dismiss };
}

/** helper para focus trap mínimo (no modal completo aún) */
export function trapFocus(container, onEscape) {
  if (!container) return () => {};
  const focusables = qsa('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])', container)
    .filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-disabled'));

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  function onKey(e) {
    if (e.key === 'Escape' && onEscape) onEscape();
    if (e.key !== 'Tab') return;
    if (focusables.length === 0) return;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  container.addEventListener('keydown', onKey);
  if (first) focus(first);
  return () => container.removeEventListener('keydown', onKey);
}

export const dom = Object.freeze({ qs, qsa, setHidden, setAriaSelected, setAriaExpanded, setAriaPressed, focus, throttle, debounce, toast, trapFocus });

if (typeof window !== 'undefined' && !window.__svaiDom) {
  window.__svaiDom = dom;
}
