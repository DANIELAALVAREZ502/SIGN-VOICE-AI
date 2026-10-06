// =========================================================================
// js/core/config.js
// -------------------------------------------------------------------------
// CENTRAL DE CONFIGURACIÓN — SIGN-VOICE AI (Offline-first, 100% en cliente)
// =========================================================================
//
// PROPÓSITO
//   Punto único de verdad para flags, rutas, límites y constantes. Esto evita
//   duplicados entre módulos (AI, avatar, voz, nube, SW) y simplifica el
//   tuning sin buscar strings por todo el código.
//
// PRINCIPIO
//   Valores predeterminados seguros (local-first). Cualquier cambio dinámico
//   pasa por store.js (persistido en localStorage) o por parámetros de UI.
//   No incluye SECRETS (esas viven en supabaseConfig.js o en env.js opcional).
//
// NOTA SOBRE INTEGRIDAD
//   Cada constante lleva JSDoc explicando qué es, por qué existe y rango
//   recomendado. Esto facilita el mantenimiento y el cumplimiento de accesibilidad.
// =========================================================================

export const CONFIG = Object.freeze({
  // --- RUTAS BÁSICAS (relativas a ./index.html) ---------------------------
  PATHS: Object.freeze({
    /** Manifest de PWA */
    MANIFEST: './manifest.json',
    /** Service Worker */
    SW: './sw.js',
    /** Offline fallback (navegaciones) */
    OFFLINE_HTML: './offline.html',
    /** Iconos SVG base */
    ICON_SVG: './assets/icons/icon.svg',
    /** Diccionarios de señas */
    SIGNS_ES: './assets/signs/signs.es-LSE.json',
    SIGNS_EN: './assets/signs/signs.en-ASL.json',
    /** Clips opcionales por palabra/letra (MP4/WebM) */
    SIGNS_CLIPS_DIR: './assets/signs/clips/',
    /** Recursos MediaPipe (locales en /vendor o CDN) */
    VENDOR_DIR: './vendor/',
    VENDOR_WASM_DIR: './vendor/wasm/',
  }),

  // --- PWA / SERVICE WORKER ----------------------------------------------
  SW: Object.freeze({
    /** Nombre de la caché del shell (obligatorio para estrategias) */
    SHELL_CACHE: 'svai-shell-v1',
    /** Nombre de la caché de IA bajo demanda (19 MB aprox.) */
    AI_CACHE: 'svai-ai-v1',
    /** Timeout para navegación network-first (ms). 3000ms = equilibrio
     * entre primer render y fallback a caché en conexiones lentas. */
    NAV_TIMEOUT_MS: 3000,
  }),

  // --- MEDIA PIPE (HandLandmarker) ---------------------------------------
  MEDIAPIPE: Object.freeze({
    /** Paquete CDN (jsDelivr). Se usa ESM directo (vision_bundle.mjs). */
    CDN_BASE: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1',
    /** Rutas locales (cuando ya están en /vendor/) */
    LOCAL_BUNDLE: './vendor/vision_bundle.mjs',
    LOCAL_TASK: './vendor/hand_landmarker.task',
    /** WASM interno (SIMD recomendado en escritorio moderno) */
    LOCAL_WASM: './vendor/wasm/vision_wasm_internal.wasm',
    LOCAL_WASM_NOSIMD: './vendor/wasm/vision_wasm_nosimd_internal.wasm',
    /** Archivos exactos para precachear bajo demanda (AI_CACHE) */
    AI_ASSETS: Object.freeze([
      './vendor/vision_bundle.mjs',
      './vendor/hand_landmarker.task',
      './vendor/wasm/vision_wasm_internal.wasm',
      './vendor/wasm/vision_wasm_nosimd_internal.wasm',
    ]),
    /** Modo de ejecución: VIDEO (tiempo real). LIVE_STREAM usaría resultados
     * por timestamp; VIDEO es suficiente para dactilología estable. */
    RUNNING_MODE: 'VIDEO',
    /** Número máximo de manos a detectar. 2 permite leer ambas manos
     * sin incrementar notablemente el coste (MediaPipe sigue ligero). */
    NUM_HANDS: 2,
    /** Confianza mínima para aceptar una detección de mano (0–1).
     * 0.40 = evita falsos positivos con fondo complejo; ajustable en Ajustes. */
    MIN_HAND_DETECTION_CONFIDENCE: 0.40,
    /** Confianza mínima de presencia de landmarks. */
    MIN_HAND_PRESENCE_CONFIDENCE: 0.40,
    /** Confianza mínima de seguimiento (tracking). 0.35 deja margen de
     * estabilidad entre frames sin perder velocidad. */
    MIN_TRACKING_CONFIDENCE: 0.35,
  }),

  // --- RECONOCIMIENTO DE SEÑAS (Dactilología) -----------------------------
  FINGERSPELL: Object.freeze({
    /** Umbral mínimo de confianza (0–1) para COMETER una letra al buffer
     * definitivo. Un valor bajo genera más ruido; uno alto retrasa la salida.
     * 0.78 es un equilibrio razonable entre velocidad y precisión. */
    MIN_COMMIT_CONF: 0.78,
    /** Ventana de estabilidad (frames consecutivos con el mismo ganador)
     * antes de emitir la letra. 3–4 frames suavizan el parpadeo. */
    STABILITY_FRAMES: 4,
    /** Margen mínimo entre top1 y top2 (delta de confianza) para desempatar
     * con seguridad. Si < GAP, no se commitea hasta ganar por margen. */
    CONF_GAP: 0.12,
    /** Máximo de letras en el buffer provisional antes de forzar un flush
     * (evita crecer indefinidamente sin comprometer). */
    BUFFER_MAX_CHARS: 20,
    /** Tiempo de gracia (ms) para mantener el último frame válido si hay
     * una caída puntual de detección (oclusiones breves). */
    GRACE_MS: 160,
    /** Longitud mínima de trayectoria (px equivalentes normalizados) para
     * detectar movimiento trazado (J, Z). */
    TRAJ_MIN_LEN: 0.22,
  }),

  // --- AVATAR REPRODUCTOR -------------------------------------------------
  AVATAR: Object.freeze({
    /** Duración base de cada pose/clip entre letras (ms). 220ms = ritmo
     * natural de dactilología sin resultar lento. Interpolado por player.js */
    POSE_DURATION_MS: 220,
    /** Duración mínima entre poses (evita flash). */
    POSE_MIN_MS: 180,
    /** Duración máxima (para letras con transición más marcada). */
    POSE_MAX_MS: 320,
    /** Ease por defecto (cubic-bezier) para la interpolación del rig SVG. */
    EASE: 'cubic-bezier(0.2,0.7,0.2,1)',
    /** Si existe MP4 en clips/, usar vídeo en lugar de SVG (mejora progresiva) */
    PREFER_CLIPS: true,
    /** Fade-in/out del vídeo de clip (ms) para evitar cortes abruptos */
    CLIP_FADE_MS: 80,
  }),

  // --- VOZ / SPEECH (STT/TTS) ---------------------------------------------
  SPEECH: Object.freeze({
    /** Idioma por defecto para Web Speech API (reconocimiento). */
    STT_LANG_ES: 'es-ES',
    STT_LANG_EN: 'en-US',
    /** Retraso para reinicio automático de SpeechRecognition en onend (ms).
     * 180ms evita reinicios en bucle cuando hay ruido transitorio. */
    STT_RESTART_DELAY_MS: 180,
    /** Máximo de resultados intermedios a conservar (buffer de UI). */
    STT_MAX_INTERIM: 16,
    /** Idioma por defecto para speechSynthesis. */
    TTS_LANG: 'es-ES',
    /** Rate/pitch conservadores (1.0 por defecto, WCAG no impone pero
     * conviene permitir ajuste en futuro). */
    TTS_RATE: 1.0,
    TTS_PITCH: 1.0,
  }),

  // --- FILTRO DE MODISMOS -------------------------------------------------
  SLANG: Object.freeze({
    /** Activo por defecto (Pilar 5: neutralización cultural). */
    ENABLED: true,
    /** Regiones preferidas para inferir modismos (ES-LA por defecto). */
    DEFAULT_REGIONS: ['ES-LA'],
    /** Umbral de severidad a avisar en UI ('low'|'medium'|'high').
     * 'medium' avisa pero no bloquea; el usuario ve original→neutral. */
    WARN_SEVERITY: 'medium',
    /** Nunca neutralizar el mensaje de SOS (seguridad/comunicación crítica) */
    SKIP_FOR_SOS: true,
  }),

  // --- SOS (EMERGENCIA DE DOBLE FUNCIÓN) ----------------------------------
  SOS: Object.freeze({
    /** Cuenta atrás obligatoria para evitar activación accidental (ms).
     * 3000 ms = tiempo suficiente para cancelar con un pulso grande. */
    COUNTDOWN_MS: 3000,
    /** Intervalo de actualización del contador (ms) */
    COUNTDOWN_TICK_MS: 1000,
    /** Template por defecto de SMS/WhatsApp (sin pasar por filtro de modismos) */
    DEFAULT_MSG:
      'Necesito ayuda urgente. Me encuentro en una situación de emergencia. ' +
      'Este mensaje fue enviado desde SIGN-VOICE AI.',
    /** Prefijo E.164 por defecto si el usuario olvida + */
    DEFAULT_DIAL: '+503',
    /** Pausa antes de lanzar tel: (ms). Permite que el toast/contador
     * desaparezca sin interferir con el cambio de aplicación. */
    TEL_DELAY_MS: 240,
    /** Esperar visibilitychange tras volver de llamada para proponer
     * el envío del mensaje de auxilio (ms de ventana de escucha). */
    VISIBILITY_WAIT_MS: 800,
  }),

  // --- NUBE OPCIONAL (SUPABASE) -------------------------------------------
  CLOUD: Object.freeze({
    /** Clave de almacenamiento en localStorage para credenciales (URL+anon key) */
    LS_KEY_CREDS: 'svai.cloud.supabase',
    /** Clave para último timestamp de sincronización (ms) */
    LS_KEY_LAST_SYNC: 'svai.cloud.lastSync',
    /** Clave para estado de outbox (array serializado) */
    LS_KEY_OUTBOX: 'svai.cloud.outbox',
    /** Intervalo de pull automático al estar online (ms). 30s es razonable
     * y no genera tráfico innecesario (usa updated_at > last_pulled_at). */
    PULL_INTERVAL_MS: 30_000,
    /** Backoff exponencial máximo para reintentos de flush (ms) */
    MAX_RETRY_MS: 60_000,
    /** Throttle para visibilitychange (ms) */
    VIS_THROTTLE_MS: 1_500,
  }),

  // --- UI / RENDIMIENTO ---------------------------------------------------
  UI: Object.freeze({
    /** Throttle para eventos de red/resize ligeros (ms) */
    THROTTLE_MS: 250,
    /** Debounce para búsquedas/inputs (ms) */
    DEBOUNCE_MS: 180,
    /** Duración de toasts (ms). 3600ms permite leer sin apresurar */
    TOAST_MS: 3600,
    /** Máximo de toasts simultáneos en el host */
    TOAST_MAX: 4,
    /** Mostrar spinner de carga en paneles > X ms */
    SPINNER_THRESHOLD_MS: 220,
  }),

  // --- ALMACENAMIENTO LOCAL ----------------------------------------------
  STORE: Object.freeze({
    /** Prefijo de claves en localStorage (aislamiento de app) */
    PREFIX: 'svai:',
    /** Versión del esquema de store (para migraciones futuras) */
    VERSION: 1,
    /** Límites para evitar crecimiento descontrolado (bytes aproximados) */
    MAX_JSON_BYTES: 2_000_000, // 2 MB por blob
  }),

  // --- SEGURIDAD / ENTORNOS -----------------------------------------------
  SECURITY: Object.freeze({
    /** Dominios permitidos en CSP connect-src (se añaden dinámicamente
     * con el proyecto de Supabase: https://*.supabase.co) */
    SUPABASE_WILDCARD: '*.supabase.co',
  }),
});

/**
 * Bandera de entorno: ¿se ejecuta en contexto seguro (HTTPS/localhost)?
 * Obligatorio para navigator.mediaDevices.getUserMedia (cámara/micrófono).
 * @type {boolean}
 */
export const IS_SECURE_CONTEXT = (() => {
  try {
    // window.isSecureContext existe en navegadores modernos
    if (typeof window !== 'undefined' && 'isSecureContext' in window) {
      return window.isSecureContext;
    }
    // Fallback: protocolo https o localhost/127.0.0.1
    const { protocol, hostname } = window.location || {};
    if (protocol === 'https:') return true;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
})();

/**
 * Detecta si el navegador soporta módulos ES nativos (obligatorio para la
 * arquitectura modular elegida). Si no, la app simplemente no carga los
 * <script type="module"> (fallback no previsto intencionalmente).
 * @type {boolean}
 */
export const HAS_ES_MODULES = 'noModule' in HTMLScriptElement.prototype === false;

/**
 * Versión semántica del bundle para logs/diagnóstico y para invalidar
 * cachés en futuras releases (no usado aún, pero documentado).
 * @type {string}
 */
export const APP_VERSION = '0.1.0-alpha';

/**
 * Notas de diseño (para desarrolladores): nunca exponer SERVICE_ROLE_KEY aquí.
 * La nube es opt-in y el failure-mode es silencioso (app sigue offline-first).
 */
export const __DESIGN_NOTES__ = Object.freeze({
  supabaseOptIn: true,
  failureSilent: true,
  noTelemetry: true,
  aiOptInOffline: true, // 19 MB bajo demanda
});
