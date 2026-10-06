// ==========================================================================
// SERVICE WORKER — SIGN-VOICE AI (Offline-first)
// Descripción general:
//   • Shell cache (svai-shell-v1): precachea recursos críticos de la app
//   • AI cache (svai-ai-v1): cache bajo demanda para MediaPipe (19 MB)
//   • Reglas: network-first para navegación, stale-while-revalidate para estáticos
//   • El motor de IA NO se precachea en install (porque es 19 MB) — se descarga
//     bajo demanda cuando el usuario pulsa "Descargar motor IA para uso offline"
//   • skipWaiting solo por mensaje del usuario (evita actualizaciones forzadas)
// =========================================================================

const SHELL_CACHE = 'svai-shell-v1';
const AI_CACHE    = 'svai-ai-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png'
];

// Listado base de módulos JS que componen el shell
const JS_SHELL = [
  './js/core/config.js',
  './js/core/bus.js',
  './js/core/store.js',
  './js/core/net.js',
  './js/core/dom.js',
  './js/core/i18n.js',
  './js/core/supabaseConfig.js',
  './js/ui/hud.js',
  './js/ui/recognizerPanel.js',
  './js/ui/chat.js',
  './js/ui/mic.js',
  './js/ui/sosPanel.js',
  './js/ui/settings.js',
  './js/ui/cloudPanel.js'
];

// Para mantener el shell lo más pequeño posible, los assets de IA NO van aquí.
// Se añaden dinámicamente a svai-ai-v1 mediante message 'svai.cache-ai'.
// ==========================================================================

// Instalación: precache del SHELL (CRÍTICO). No precacheamos los 19 MB.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Intentamos añadir todos los shell assets. Si alguno falla (404 raro),
      // seguimos para no bloquear la instalación.
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)));
      // No llamar a skipWaiting aquí: lo haremos solo cuando el usuario lo solicite.
      // Esto evita que la nueva versión "robe" el control sin aviso.
    })()
  );
});

// Activación: limpiar cachés antiguas, pero preservar AI_CACHE si existe
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== AI_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
      // Opcional: no forzamos clientes.claim() para dejar que el usuario decida.
      // En casos avanzados se puede, pero preferimos transparencia.
    })()
  );
});

// Navegación: network-first, timeout -> cache -> offline.html
async function networkFirst(req, timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(req, { signal: controller.signal, cache: 'no-cache' });
    clearTimeout(timer);
    if (res && res.ok) {
      // Guardamos la última versión navegable (HTML) en shell cache
      const shell = await caches.open(SHELL_CACHE);
      shell.put(req, res.clone());
      return res;
    }
  } catch (_) {
    // Ignorado -> caemos a cache
  }
  // Intentar en cache (shell primero, luego cualquier cache)
  const cached = await caches.match(req);
  if (cached) return cached;
  // Fallback offline.html (solo para navegaciones)
  if (req.mode === 'navigate') {
    const shell = await caches.open(SHELL_CACHE);
    return caches.match('./offline.html');
  }
  // Para otros casos, devolvemos respuesta genérica offline
  return new Response('Fuera de línea', {
    status: 503,
    statusText: 'Fuera de línea (Sin conexión)',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// Stale-while-revalidate: sirve desde cache inmediatamente, actualiza en 2º plano
async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) {
      cache.put(req, res.clone());
    }
    return res;
  }).catch(() => cached);
  return cached || network;
}

// Cache-first para el cache de IA (solo bajo demanda)
async function cacheFirstAI(req) {
  const cache = await caches.open(AI_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
    }
    return res;
  } catch (_) {
    // Si no está cacheado y no hay red, mejor devolver 503 claro
    return new Response('Recurso de IA no disponible offline. Descarga el motor desde Ajustes.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// Detección: ¿es un recurso de MediaPipe/IA?
function isAIAsset(req) {
  const url = req.url;
  return (
    url.includes('/mediapipe-models/hand_landmarker/') ||
    url.includes('tasks-vision@') ||
    url.includes('/wasm/vision_wasm') ||
    url.includes('hand_landmarker.task') ||
    url.includes('/vendor/') // mirror local
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignorar non-GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navegaciones HTML
  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Recursos de IA (cache-first, SOLO si existen en AI_CACHE)
  if (isAIAsset(req)) {
    event.respondWith(cacheFirstAI(req));
    return;
  }

  // CSS/JS/JSON/IMAGENES del shell: stale-while-revalidate
  const ext = url.pathname.split('.').pop().toLowerCase();
  if (['css','js','mjs','json','svg','png','jpg','jpeg','webp','ico'].includes(ext)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Por defecto, intentar cache y luego red
  event.respondWith(
    caches.match(req).then((c) => c || fetch(req).catch(() => new Response('Offline', { status: 503 })))
  );
});

// Mensajería: controlar skipWaiting y cachear assets de IA bajo demanda
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  // El usuario aceptó la actualización -> activar nuevo SW
  if (msg.type === 'svai.skipWaiting') {
    self.skipWaiting();
    return;
  }

  // Cachear recursos de IA (19 MB aprox) bajo demanda
  if (msg.type === 'svai.cache-ai') {
    const list = Array.isArray(msg.urls) ? msg.urls : [];
    event.waitUntil(
      (async () => {
        if (list.length === 0) return;
        const cache = await caches.open(AI_CACHE);
        // cache.addAll con allSettled para no fallar por un 404
        await Promise.allSettled(list.map((u) => cache.add(new Request(u, { cache: 'no-cache' }))));
      })()
    );
    return;
  }

  // Purgar cache de IA si el usuario quiere liberar espacio
  if (msg.type === 'svai.clear-ai') {
    event.waitUntil(caches.delete(AI_CACHE));
    return;
  }
});
