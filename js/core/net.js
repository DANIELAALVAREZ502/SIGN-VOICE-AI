// =========================================================================
// js/core/net.js
// -------------------------------------------------------------------------
// GESTIÓN DE CONEXIÓN (online/offline) + PWA INSTALL PROMPT
// =========================================================================
//
// PROPÓSITO
//   Centraliza la detección de red, emite eventos por el bus y gestiona
//   el evento beforeinstallprompt (instalación PWA). También provee utilidades
//   seguras para comprobar conectividad.
//
// NOTA
//   El estado de red NO determina si la IA funciona offline: ese control
//   vive en el panel "Reconocer señas" (svai-ai-v1). net.js solo informa.
// =========================================================================

import { bus } from './bus.js';
import { CONFIG, IS_SECURE_CONTEXT } from './config.js';

let online = true;
let installPrompt = null;

/**
 * Refresca el estado "online" usando navigator.onLine (rápido) y
 * opcionalmente una cabecera HEAD si se fuerza (no por defecto).
 */
export function isOnline() {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine;
}

/**
 * Emitir cambio de estado
 * @param {boolean} next
 * @param {string} [reason]
 */
function emitChange(next, reason = '') {
  if (online === next) return;
  online = next;
  bus.emit('net:change', { online, reason, ts: Date.now() });
  if (online) {
    bus.emit('net:online', { ts: Date.now() });
  } else {
    bus.emit('net:offline', { ts: Date.now() });
  }
}

/** Inicializa listeners globales */
export function init() {
  if (typeof window === 'undefined') return;

  online = isOnline();

  window.addEventListener('online', () => {
    emitChange(true, 'navigator.online=true');
  }, { passive: true });

  window.addEventListener('offline', () => {
    emitChange(false, 'navigator.offline=true');
  }, { passive: true });

  // beforeinstallprompt: guardar para mostrar botón "Instalar app"
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevenir el prompt automático para mostrarlo desde el HUD
    e.preventDefault();
    installPrompt = e;
    bus.emit('pwa:install:available', { ts: Date.now() });
  }, { passive: false });

  // appinstalled: limpiar prompt
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    bus.emit('pwa:installed', { ts: Date.now() });
  }, { passive: true });
}

/** ¿Hay prompt de instalación disponible? */
export function canInstall() {
  return installPrompt !== null;
}

/** Mostrar diálogo de instalación si existe. Devuelve Promise<void>|false */
export async function triggerInstall() {
  if (!installPrompt) return false;
  try {
    // Solicitar al usuario instalar
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      bus.emit('pwa:install:accepted', { ts: Date.now() });
    } else {
      bus.emit('pwa:install:denied', { ts: Date.now() });
    }
    installPrompt = null;
    return true;
  } catch (err) {
    console.warn('[net] triggerInstall error:', err);
    return false;
  }
}

/** Devuelve estado actual */
export function state() {
  return { online: isOnline() };
}

/**
 * Comprobar conectividad "real" con un HEAD ligero (solo si online).
 * Útil para distinguir "WiFi pero sin salida" (raro). No se usa en bucle.
 * @param {string} [url]
 */
export async function checkConnectivity(url = 'https://www.gstatic.com/generate_204') {
  if (!isOnline()) return { ok: false, reason: 'offline' };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
    clearTimeout(t);
    return { ok: true, via: 'head' };
  } catch (_) {
    clearTimeout(t);
    return { ok: true, via: 'navigator.onLine' }; // fallback conservador
  }
}

export const net = Object.freeze({ init, isOnline, canInstall, triggerInstall, state, checkConnectivity });

if (typeof window !== 'undefined' && !window.__svaiNet) {
  window.__svaiNet = net;
}
