// =========================================================================
// js/core/i18n.js
// -------------------------------------------------------------------------
// INTERNACIONALIZACIÓN MÍNIMA (ES/EN) — sin build, diccionarios inline
// =========================================================================
//
// PROPÓSITO
//   Strings estáticos de la UI (etiquetas, toasts, errores). No traduce
//   el texto libre del usuario (ese es el input). Soporta fallback a 'es'.
//
// USO
//   import { t } from './i18n.js'; t('net.online')
// =========================================================================

const DICT = Object.freeze({
  es: {
    // HUD/Red
    'net.checking': 'Comprobando conexión…',
    'net.online': 'En línea',
    'net.offline': 'Sin conexión',
    'net.check': 'Comprobando conectividad…',
    'pwa.install': 'Instalar app',
    'pwa.installed': 'App instalada correctamente',
    'pwa.available': 'Instalación disponible',

    // Tabs
    'tab.signs': 'Reconocer señas',
    'tab.chat': 'Chat + Avatar',
    'tab.voice': 'Voz al avatar',
    'tab.sos': 'SOS',
    'tab.settings': 'Ajustes',

    // Reconocedor
    'signs.camera.start': 'Iniciar cámara',
    'signs.camera.stop': 'Cerrar cámara',
    'signs.mirror.on': 'Espejo activado',
    'signs.mirror.off': 'Espejo desactivado',
    'signs.perm.denied': 'Permiso de cámara denegado. Revísalo en Ajustes del navegador.',
    'signs.notfound': 'No se encontró ninguna cámara. Conecta una cámara y vuelve a intentarlo.',
    'signs.secure': 'La cámara requiere contexto seguro (HTTPS o localhost).',
    'signs.fileurl': 'file:// no permite getUserMedia. Sirve la app con un servidor HTTP.',
    'signs.ai.notloaded': 'Motor IA no descargado. Puedes descargarlo en Ajustes o usar modo online.',
    'signs.ai.downloaded': 'Motor IA offline disponible',
    'signs.ai.downloading': 'Descargando motor IA…',
    'signs.ai.cleared': 'Caché de IA liberada',
    'signs.buffer.hint': 'Sin detecciones aún. Enfoca la mano frente a la cámara.',
    'signs.send.chat': 'Enviado al chat + avatar',

    // Avatar/Chat
    'chat.placeholder': 'Escribe el mensaje para el avatar…',
    'avatar.idle': 'IDLE',
    'avatar.playing': 'REPRODUCIENDO',
    'avatar.paused': 'EN PAUSA',
    'avatar.stopped': 'DETENIDO',
    'avatar.clips.on': 'Usando clips locales si existen',
    'avatar.clips.off': 'Usando poses SVG',

    // Voz
    'voice.support.yes': 'Web Speech API disponible',
    'voice.support.no': 'Web Speech no soportado. Usando fallback manual.',
    'voice.listening': 'Escuchando…',
    'voice.tap.start': 'Toca para empezar a dictar',
    'voice.fallback': 'Escribe manualmente (sin conexión o sin soporte)',

    // SOS
    'sos.countdown': 'Activando en {n}s…',
    'sos.cancel': 'Cancelar',
    'sos.activated': 'SOS activado. Abriendo llamada…',
    'sos.call.back': 'Has vuelto de la llamada. ¿Enviar mensaje de auxilio?',
    'sos.msg.sent': 'Mensaje de auxilio abierto',
    'sos.nocontact': 'Añade un contacto de emergencia en SOS',

    // Ajustes/Nube
    'cloud.disabled': 'DESHABILITADO',
    'cloud.offline': 'SIN CONEXIÓN',
    'cloud.syncing': 'SINCRONIZANDO',
    'cloud.synced': 'SINCRONIZADO',
    'cloud.error': 'ERROR',
    'cloud.saved': 'Credenciales guardadas. Probando conexión…',
    'cloud.test.ok': 'Conexión con Supabase correcta',
    'cloud.test.fail': 'No se pudo conectar a Supabase. Revisa URL y ANON KEY.',
    'cloud.cleared': 'Credenciales eliminadas',
    'cloud.optin': 'Nube opcional: desactivada por defecto',

    // Errores/genéricos
    'err.generic': 'Ha ocurrido un error. Inténtalo de nuevo.',
    'toast.ok': 'Hecho',
    'toast.warn': 'Atención',
    'toast.error': 'Error',
    'toast.info': 'Información',
  },
  en: {
    // HUD/Red
    'net.checking': 'Checking connection…',
    'net.online': 'Online',
    'net.offline': 'Offline',
    'net.check': 'Checking connectivity…',
    'pwa.install': 'Install app',
    'pwa.installed': 'App installed successfully',
    'pwa.available': 'Install available',

    // Tabs
    'tab.signs': 'Sign recognition',
    'tab.chat': 'Chat + Avatar',
    'tab.voice': 'Voice to avatar',
    'tab.sos': 'SOS',
    'tab.settings': 'Settings',

    // Reconocedor
    'signs.camera.start': 'Start camera',
    'signs.camera.stop': 'Stop camera',
    'signs.mirror.on': 'Mirror ON',
    'signs.mirror.off': 'Mirror OFF',
    'signs.perm.denied': 'Camera permission denied. Check browser settings.',
    'signs.notfound': 'No camera found. Connect one and retry.',
    'signs.secure': 'Camera requires secure context (HTTPS or localhost).',
    'signs.fileurl': 'file:// blocks getUserMedia. Serve over HTTP(S).',
    'signs.ai.notloaded': 'AI engine not downloaded. Download offline or use online.',
    'signs.ai.downloaded': 'AI engine ready offline',
    'signs.ai.downloading': 'Downloading AI engine…',
    'signs.ai.cleared': 'AI cache cleared',
    'signs.buffer.hint': 'No detections yet. Point hand to camera.',
    'signs.send.chat': 'Sent to chat + avatar',

    // Avatar/Chat
    'chat.placeholder': 'Type a message for the avatar…',
    'avatar.idle': 'IDLE',
    'avatar.playing': 'PLAYING',
    'avatar.paused': 'PAUSED',
    'avatar.stopped': 'STOPPED',
    'avatar.clips.on': 'Using local clips if available',
    'avatar.clips.off': 'Using SVG poses',

    // Voz
    'voice.support.yes': 'Web Speech API supported',
    'voice.support.no': 'Web Speech unsupported. Manual fallback.',
    'voice.listening': 'Listening…',
    'voice.tap.start': 'Tap to start dictation',
    'voice.fallback': 'Type manually (offline or unsupported)',

    // SOS
    'sos.countdown': 'Activating in {n}s…',
    'sos.cancel': 'Cancel',
    'sos.activated': 'SOS activated. Opening call…',
    'sos.call.back': 'Returned from call. Send help message?',
    'sos.msg.sent': 'Help message opened',
    'sos.nocontact': 'Add emergency contact in SOS',

    // Ajustes
    'cloud.disabled': 'DISABLED',
    'cloud.offline': 'OFFLINE',
    'cloud.syncing': 'SYNCING',
    'cloud.synced': 'SYNCED',
    'cloud.error': 'ERROR',
    'cloud.saved': 'Credentials saved. Testing…',
    'cloud.test.ok': 'Supabase connection OK',
    'cloud.test.fail': 'Supabase connection failed. Check URL/ANON KEY.',
    'cloud.cleared': 'Credentials cleared',
    'cloud.optin': 'Cloud optional: disabled by default',

    // Errores
    'err.generic': 'Something went wrong. Try again.',
    'toast.ok': 'Done',
    'toast.warn': 'Warning',
    'toast.error': 'Error',
    'toast.info': 'Info',
  },
});

let lang = 'es';

/** Establece idioma 'es'|'en' */
export function setLang(l) {
  if (l === 'en' || l === 'es') lang = l;
}

/** Obtiene idioma actual */
export function getLang() {
  return lang;
}

/** Traduce clave con interpolación {k} */
export function t(key, vars = {}) {
  const d = DICT[lang] || DICT.es;
  let s = d[key] || DICT.es[key] || key;
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/** Lista de idiomas disponibles */
export function available() {
  return Object.keys(DICT);
}

export const i18n = Object.freeze({ setLang, getLang, t, available });

if (typeof window !== 'undefined' && !window.__svaiI18n) {
  window.__svaiI18n = i18n;
}
