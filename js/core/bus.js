// =========================================================================
// js/core/bus.js
// -------------------------------------------------------------------------
// BUS DE EVENTOS (PUB/SUB) SIN DEPENDENCIAS
// =========================================================================
//
// PROPÓSITO
//   Comunicación desacoplada entre módulos. El orquestador (app.js) y los
//   paneles (UI) no se importan entre sí directamente: se suscriben a eventos
//   semánticos ('ui:tab:change', 'net:online', 'ai:letter:commit', etc.)
//
// DISEÑO
//   - Mapa de listeners por tipo de evento.
//   - nextTick opcional para evitar reentradas profundas.
//   - on/off una sola vez (once) también soportado.
//   - Tipado implícito pero con nombres autoexplicativos.
//   - Todos los handlers son wrappers para que errores no rompan el bus.
// =========================================================================

const listeners = new Map();

/**
 * Suscribe `fn` al evento `type`. Devuelve función para desuscribirse.
 * @param {string} type
 * @param {(payload:any, meta?:any)=>void} fn
 * @returns {()=>void}
 */
export function on(type, fn) {
  if (typeof type !== 'string' || !type) throw new TypeError('bus.on: type inválido');
  if (typeof fn !== 'function') throw new TypeError('bus.on: fn debe ser función');

  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.get(type) ? /* no-op */ null : listeners.set(type, set);
  }
  set.add(fn);
  return () => off(type, fn);
}

/**
 * Desuscribe `fn` de `type`. Si no existe, no falla.
 * @param {string} type
 * @param {(payload:any, meta?:any)=>void} fn
 */
export function off(type, fn) {
  const set = listeners.get(type);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) {
    // Limpieza mínima: liberar memoria si no quedan listeners
    listeners.delete(type);
  }
}

/**
 * Emite `type` con `payload` y `meta` opcional. Los handlers se invocan
 * en el orden de suscripción. Para evitar efectos colaterales raros,
 * cada handler se envuelve en try/catch con logging silencioso a consola.
 * @param {string} type
 * @param {any} [payload]
 * @param {any} [meta]
 */
export function emit(type, payload = undefined, meta = undefined) {
  if (typeof type !== 'string' || !type) return;
  const set = listeners.get(type);
  if (!set || set.size === 0) return;

  // Clonamos el Set para evitar mutaciones durante la emisión
  // (desuscripciones dentro de un handler)
  const handlers = Array.from(set);
  const tick = typeof queueMicrotask === 'function' ? queueMicrotask : (cb) => setTimeout(cb, 0);

  handlers.forEach((fn) => {
    tick(() => {
      try {
        fn(payload, { type, ts: Date.now(), ...meta });
      } catch (err) {
        // NO romper el bus: registrar error sin interrumpir el resto
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[bus.emit] handler error', type, err);
        }
      }
    });
  });
}

/**
 * Suscribe UNA SOLA VEZ. Se desuscribe automáticamente tras la primera emisión.
 * @param {string} type
 * @param {(payload:any, meta?:any)=>void} fn
 * @returns {()=>void}
 */
export function once(type, fn) {
  if (typeof fn !== 'function') throw new TypeError('bus.once: fn debe ser función');
  const offFn = on(type, (payload, meta) => {
    offFn();
    fn(payload, meta);
  });
  return offFn;
}

/**
 * Devuelve el número de listeners activos para depuración/test.
 * @param {string} [type]
 * @returns {number}
 */
export function size(type) {
  if (type) {
    const set = listeners.get(type);
    return set ? set.size : 0;
  }
  let total = 0;
  for (const set of listeners.values()) total += set.size;
  return total;
}

/**
 * Elimina TODOS los listeners. Útil SOLO en tests/hot-reload.
 */
export function clear() {
  listeners.clear();
}

// API mínima y estable para consumo interno
export const bus = Object.freeze({ on, off, emit, once, size, clear });

// Exposición opcional para depuración (NO usada en producción, pero no intrusiva)
if (typeof window !== 'undefined') {
  // Evita sobreescribir si ya existe
  if (!window.__svaiBus) {
    window.__svaiBus = bus;
  }
}
