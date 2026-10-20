// =========================================================================
// js/safety/slangFilter.js
// -------------------------------------------------------------------------
// FILTRO DE MODISMOS (NEUTRALIZACIÓN CULTURAL) — Pilar 5
// =========================================================================
//
// PROPÓSITO
//   Neutraliza regionalismos/vocativos latinoamericanos (y algunos términos
//   peyorativos) ANTES de que el texto llegue al avatar o a una persona sorda,
//   evitando malentendidos por diferencias dialectales.
//   Ej.: "¿Qué onda, güey?" → "¿Hola, cómo estás?"
//
// DISEÑO
//   1. NORMALIZACIÓN: unifica comillas tipográficas (“ ” ‘ ’), guiones
//      largos (– —), espacios no separables y colapsa espacios. La
//      comparación es insensible a mayúsculas (bandera `i`) y tolera
//      variantes de acento/diéresis declaradas en cada regla.
//   2. REGIÓN: deduce el país del usuario con `Intl` (zona horaria y luego
//      idioma `navigator.language`). Las reglas declaran las regiones donde
//      aplican; 'LA' actúa como comodín latinoamericano. El usuario puede
//      forzar una región desde Ajustes (store 'slang.region').
//   3. REGLAS: {term, neutral, regions[], severity, kind, allowSuffix}.
//      - kind: 'word' | 'phrase' (frases se compilan con `\s+` entre palabras).
//      - allowSuffix: admite plurales/diminutivos comunes (s, es, ito, ita…).
//      - severity: 'low' | 'medium' | 'high'. Las de severidad alta
//        (peyorativos) se neutralizan SIEMPRE y la UI las resalta.
//   4. SALIDA ANALIZABLE: `analyze()` devuelve el texto neutralizado MÁS la
//      lista de cambios (original → neutral) para que la UI muestre
//      "cambios detectados" con opción de revertir. NUNCA se altera el
//      mensaje de otra persona a oscuras: siempre hay deshacer.
//
// SEGURIDAD
//   El mensaje de SOS JAMÁS pasa por este filtro (regla del pilar 4). Aquí se
//   respeta el flag `opts.skip` y, además, chat.js propaga `skipFilter`.
//
// INTEGRACIÓN
//   chat.js importa este módulo de forma perezosa y llama a analyze()/neutralize().
//   addRule() permite ampliar el diccionario (persistido y sincronizable).
// =========================================================================

import { CONFIG } from '../core/config.js';
import { store } from '../core/store.js';

// -------------------------------------------------------------------------
// 1) DETECCIÓN DE REGIÓN (Intl)
// -------------------------------------------------------------------------

/**
 * Mapa zona-horaria → código ISO de país. Cubre Latinoamérica hispana y
 * España. Es intencionalmente pequeño y explícito (auditable, 0 dependencias).
 * @type {Record<string,string>}
 */
const TZ_TO_REGION = Object.freeze({
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX',
  'America/Cancun': 'MX', 'America/Mazatlan': 'MX', 'America/Chihuahua': 'MX',
  'America/Guatemala': 'GT',
  'America/Tegucigalpa': 'HN',
  'America/El_Salvador': 'SV',
  'America/Managua': 'NI',
  'America/Costa_Rica': 'CR',
  'America/Panama': 'PA',
  'America/Bogota': 'CO',
  'America/Caracas': 'VE',
  'America/Havana': 'CU',
  'America/Santo_Domingo': 'DO',
  'America/Puerto_Rico': 'PR',
  'America/Lima': 'PE',
  'America/Santiago': 'CL',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/La_Paz': 'BO',
  'America/Asuncion': 'PY',
  'America/Montevideo': 'UY',
  'America/Guayaquil': 'EC',
  'Atlantic/Canary': 'ES',
  'Europe/Madrid': 'ES',
});

/**
 * Deduce el código de región del usuario. Prioriza zona horaria (más fiable
 * que el idioma, que depende del SO) y cae a `navigator.language` (p. ej.
 * 'es-SV' → 'SV'). Devuelve 'LA' (comodín latinoamericano) si no hay pista.
 * @returns {string}
 */
export function guessRegion() {
  try {
    // (a) Zona horaria
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (TZ_TO_REGION[tz]) return TZ_TO_REGION[tz];
    }
    // (b) Idioma del navegador: 'es-SV' | 'es-419' | 'es'
    if (typeof navigator !== 'undefined' && navigator.language) {
      const parts = String(navigator.language).split('-');
      if (parts[0] === 'es') {
        const sub = (parts[1] || '').toUpperCase();
        if (sub && sub !== '419' && sub !== 'ES') return sub;
        if (sub === 'ES') return 'ES';
      }
    }
  } catch (_) {
    /* Intl/navigator no disponible: usar comodín */
  }
  return 'LA';
}

/** Región activa (override del usuario → detección automática). */
export function getRegion() {
  const forced = store.get('slang.region', '');
  return forced ? String(forced).toUpperCase() : guessRegion();
}

/** Fuerza la región activa ('' = automática). */
export function setRegion(region) {
  store.set('slang.region', region ? String(region).toUpperCase() : '');
  compiled = null; // la selección de reglas depende de la región
}

/**
 * ¿Aplica una regla para la región activa?
 *   - Sin regiones declaradas → aplica siempre (global).
 *   - 'LA' en cualquiera de los dos lados → comodín latinoamericano.
 *   - Coincidencia exacta de código → aplica.
 * @param {string[]|undefined} ruleRegions
 * @param {string} active
 * @returns {boolean}
 */
function regionApplies(ruleRegions, active) {
  if (!ruleRegions || ruleRegions.length === 0) return true;
  const a = String(active || 'LA').toUpperCase();
  if (ruleRegions.includes(a)) return true;
  if (a === 'LA' || ruleRegions.includes('LA')) return true;
  return false;
}

// -------------------------------------------------------------------------
// 2) TABLA CURADA DE MODISMOS
// -------------------------------------------------------------------------
// Regiones: MX, GT, HN, SV, NI, CR, PA, CO, VE, CU, DO, PR, PE, CL, AR, BO,
//           PY, UY, EC, ES y 'LA' (Latinoamérica genérica).
/**
 * @typedef {Object} SlangRule
 * @property {string} term            Término tal como se escribe (sin variantes de acento extra).
 * @property {string} neutral         Español neutro equivalente.
 * @property {string[]} [regions]     Regiones donde aplica ([] = global).
 * @property {'low'|'medium'|'high'} [severity] Severidad (informativa/aviso UI).
 * @property {'word'|'phrase'} [kind] Tipo (las frases se compilan con \s+).
 * @property {boolean} [allowSuffix]  Admite plurales/diminutivos.
 */

/** @type {SlangRule[]} */
const BASE_RULES = Object.freeze([
  // --- SALUDOS / VOCATIVOS (frases) --------------------------------------
  { term: 'qué onda', neutral: '¿cómo estás?', regions: ['MX', 'GT'], severity: 'low', kind: 'phrase' },
  { term: 'que onda', neutral: '¿cómo estás?', regions: ['MX', 'GT'], severity: 'low', kind: 'phrase' },
  { term: 'qué xopa', neutral: '¿cómo estás?', regions: ['PA'], severity: 'low', kind: 'phrase' },
  { term: 'qué bolá', neutral: '¿cómo estás?', regions: ['CU'], severity: 'low', kind: 'phrase' },
  { term: 'que bola', neutral: '¿cómo estás?', regions: ['CU'], severity: 'low', kind: 'phrase' },
  { term: 'qué lo qué', neutral: '¿cómo estás?', regions: ['DO', 'PR'], severity: 'low', kind: 'phrase' },
  { term: 'quiubo', neutral: '¿cómo estás?', regions: ['MX', 'CO'], severity: 'low', kind: 'phrase' },
  { term: 'qué hubo', neutral: '¿cómo estás?', regions: ['MX', 'CO'], severity: 'low', kind: 'phrase' },
  { term: 'qué tal', neutral: '¿cómo estás?', regions: ['LA'], severity: 'low', kind: 'phrase' },

  // --- VOCATIVOS "amigo" --------------------------------------------------
  { term: 'güey', neutral: 'amigo', regions: ['MX'], severity: 'low', kind: 'word', allowSuffix: true },
  { term: 'guey', neutral: 'amigo', regions: ['MX'], severity: 'low', kind: 'word', allowSuffix: true },
  { term: 'wey', neutral: 'amigo', regions: ['MX'], severity: 'low', kind: 'word', allowSuffix: true },
  { term: 'maje', neutral: 'amigo', regions: ['HN', 'GT', 'SV'], severity: 'low', kind: 'word', allowSuffix: true },
  { term: 'amigazo', neutral: 'amigo', regions: ['LA'], severity: 'low', kind: 'word' },
  { term: 'parce', neutral: 'amigo', regions: ['CO'], severity: 'low', kind: 'word' },
  { term: 'parcero', neutral: 'amigo', regions: ['CO'], severity: 'low', kind: 'word' },
  { term: 'broder', neutral: 'amigo', regions: ['VE'], severity: 'low', kind: 'word' },
  { term: 'pana', neutral: 'amigo', regions: ['VE'], severity: 'low', kind: 'word' },
  { term: 'panita', neutral: 'amigo', regions: ['VE'], severity: 'low', kind: 'word' },
  { term: 'llave', neutral: 'amigo', regions: ['CO', 'VE'], severity: 'low', kind: 'word' },
  { term: 'marica', neutral: 'amigo', regions: ['CO'], severity: 'medium', kind: 'word' },
  { term: 'mae', neutral: 'amigo', regions: ['CR'], severity: 'low', kind: 'word' },
  { term: 'cuate', neutral: 'amigo', regions: ['MX'], severity: 'low', kind: 'word' },
  { term: 'carnal', neutral: 'amigo', regions: ['MX'], severity: 'low', kind: 'word' },
  { term: 'viejo', neutral: 'amigo', regions: ['AR', 'CL', 'LA'], severity: 'low', kind: 'word' },
  { term: 'choche', neutral: 'amigo', regions: ['SV'], severity: 'low', kind: 'word' },

  // --- "chamaco"/joven ----------------------------------------------------
  { term: 'chamaco', neutral: 'muchacho', regions: ['MX'], severity: 'low', kind: 'word', allowSuffix: true },
  { term: 'chavo', neutral: 'muchacho', regions: ['MX'], severity: 'low', kind: 'word', allowSuffix: true },
  { term: 'chavalo', neutral: 'muchacho', regions: ['NI', 'HN'], severity: 'low', kind: 'word', allowSuffix: true },
  { term: 'cipote', neutral: 'muchacho', regions: ['SV', 'HN'], severity: 'low', kind: 'word', allowSuffix: true },

  // --- VALORATIVOS --------------------------------------------------------
  { term: 'bacán', neutral: 'excelente', regions: ['CO', 'CL'], severity: 'low', kind: 'word' },
  { term: 'bacano', neutral: 'excelente', regions: ['CO'], severity: 'low', kind: 'word' },
  { term: 'chévere', neutral: 'excelente', regions: ['VE', 'CO'], severity: 'low', kind: 'word' },
  { term: 'chevere', neutral: 'excelente', regions: ['VE', 'CO'], severity: 'low', kind: 'word' },
  { term: 'chido', neutral: 'excelente', regions: ['MX'], severity: 'low', kind: 'word' },
  { term: 'tuanis', neutral: 'excelente', regions: ['CR'], severity: 'low', kind: 'word' },
  { term: 'pura vida', neutral: 'todo bien', regions: ['CR'], severity: 'low', kind: 'phrase' },
  { term: 'qué padre', neutral: 'qué bien', regions: ['MX'], severity: 'low', kind: 'phrase' },

  // --- COSAS / ACCIONES ---------------------------------------------------
  { term: 'vaina', neutral: 'cosa', regions: ['VE', 'DO'], severity: 'low', kind: 'word' },
  { term: 'chunche', neutral: 'aparato', regions: ['CR', 'HN'], severity: 'low', kind: 'word' },
  { term: 'chela', neutral: 'cerveza', regions: ['MX', 'PE'], severity: 'low', kind: 'word' },
  { term: 'plata', neutral: 'dinero', regions: ['LA'], severity: 'low', kind: 'word' },
  { term: 'lana', neutral: 'dinero', regions: ['MX'], severity: 'low', kind: 'word' },
  { term: 'billete', neutral: 'dinero', regions: ['LA'], severity: 'low', kind: 'word' },
  { term: 'pisto', neutral: 'dinero', regions: ['GT', 'SV'], severity: 'low', kind: 'word' },
  { term: 'platicar', neutral: 'conversar', regions: ['MX', 'GT'], severity: 'low', kind: 'word' },
  { term: 'platicamos', neutral: 'conversamos', regions: ['MX', 'GT'], severity: 'low', kind: 'word' },
  { term: 'brete', neutral: 'trabajo', regions: ['CR'], severity: 'low', kind: 'word' },
  { term: 'bretear', neutral: 'trabajar', regions: ['CR'], severity: 'low', kind: 'word' },
  { term: 'chamba', neutral: 'trabajo', regions: ['MX', 'PE'], severity: 'low', kind: 'word' },
  { term: 'camello', neutral: 'trabajo', regions: ['CO'], severity: 'low', kind: 'word' },
  { term: 'guagua', neutral: 'autobús', regions: ['CU', 'PR'], severity: 'low', kind: 'word' },
  { term: 'micro', neutral: 'autobús', regions: ['CL', 'AR'], severity: 'low', kind: 'word' },
  { term: 'colectivo', neutral: 'autobús', regions: ['AR'], severity: 'low', kind: 'word' },

  // --- EXPRESIONES --------------------------------------------------------
  { term: 'a la gran', neutral: 'vaya', regions: ['LA'], severity: 'low', kind: 'phrase' },
  { term: 'híjole', neutral: 'vaya', regions: ['MX'], severity: 'low', kind: 'word' },
  { term: 'hijole', neutral: 'vaya', regions: ['MX'], severity: 'low', kind: 'word' },
  { term: 'no manches', neutral: 'no puede ser', regions: ['MX'], severity: 'low', kind: 'phrase' },
  { term: 'ni modo', neutral: 'no hay problema', regions: ['MX', 'LA'], severity: 'low', kind: 'phrase' },
  { term: 'a huevo', neutral: 'por supuesto', regions: ['MX'], severity: 'medium', kind: 'phrase' },
  { term: 'ahorita', neutral: 'ahora', regions: ['LA'], severity: 'low', kind: 'word' },
  { term: 'ahoritita', neutral: 'ahora', regions: ['MX'], severity: 'low', kind: 'word' },
  { term: 'orale', neutral: 'vamos', regions: ['MX'], severity: 'low', kind: 'word' },
  { term: 'órale', neutral: 'vamos', regions: ['MX'], severity: 'low', kind: 'word' },

  // --- TÉRMINOS PEYORATIVOS (severidad alta → siempre neutralizar + aviso) --
  { term: 'pendejo', neutral: 'tonto', regions: ['MX', 'LA'], severity: 'high', kind: 'word', allowSuffix: true },
  { term: 'culero', neutral: 'desagradable', regions: ['MX'], severity: 'high', kind: 'word' },
  { term: 'bicho', neutral: 'insecto', regions: ['CR', 'PA'], severity: 'medium', kind: 'word' },
  { term: 'webo', neutral: 'tonto', regions: ['MX', 'GT'], severity: 'high', kind: 'word' },
  { term: 'huevón', neutral: 'perezoso', regions: ['LA'], severity: 'medium', kind: 'word' },
  { term: 'huevon', neutral: 'perezoso', regions: ['LA'], severity: 'medium', kind: 'word' },
  { term: 'cabrón', neutral: 'desgraciado', regions: ['MX', 'LA'], severity: 'high', kind: 'word' },
  { term: 'cabron', neutral: 'desgraciado', regions: ['MX', 'LA'], severity: 'high', kind: 'word' },
  { term: 'idiota', neutral: 'insensato', regions: [], severity: 'high', kind: 'word' },
  { term: 'estúpido', neutral: 'insensato', regions: [], severity: 'high', kind: 'word' },
  { term: 'estupido', neutral: 'insensato', regions: [], severity: 'high', kind: 'word' },
]);

// -------------------------------------------------------------------------
// 3) COMPILACIÓN
// -------------------------------------------------------------------------

/** Reglas combinadas (base + personales) vigentes. */
let rules = [];
/** Reglas compiladas con RegExp y metadatos. */
let compiled = null;

/** Escapa una cadena para usarla como literal RegExp. */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Preserva la capitalización del texto original al reemplazar. */
function matchCase(source, target) {
  if (!source) return target;
  if (source === source.toUpperCase() && source.replace(/[^A-Za-zÁÉÍÓÚÜÑ]/g, '').length > 1) {
    return target.toUpperCase();
  }
  if (source[0] === source[0].toUpperCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target;
}

/**
 * Recompila la lista de reglas (base + personales) en expresiones regulares
 * ordenadas por longitud descendente (frases antes que palabras sueltas).
 */
function compile() {
  const seen = new Set();
  const list = [];
  // Personales primero: tienen prioridad y sobreescriben a la base.
  const personal = store.get('slang.personal', []);
  const merged = [
    ...(Array.isArray(personal) ? personal : []),
    ...BASE_RULES,
  ];
  for (const r of merged) {
    if (!r || !r.term || !r.neutral) continue;
    const term = String(r.term).trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    list.push({
      term,
      neutral: String(r.neutral),
      regions: Array.isArray(r.regions) ? r.regions.map((x) => String(x).toUpperCase()) : [],
      severity: r.severity || 'low',
      kind: r.kind === 'phrase' ? 'phrase' : 'word',
      allowSuffix: !!r.allowSuffix,
    });
  }
  // Frases más largas primero (evita que una palabra suelta rompa una frase)
  list.sort((a, b) => b.term.length - a.term.length);
  rules = list;

  compiled = list.map((r) => {
    // Las frases toleran cualquier run de espacios entre palabras.
    const body = r.term.split(/\s+/).map(escapeRe).join('\\s+');
    const suffix = r.allowSuffix ? '(?:s|es|ito|ita|itos|itas)?' : '';
    return {
      ...r,
      re: new RegExp(`\\b${body}${suffix}\\b`, 'gi'),
    };
  });
}

/** Garantiza que las reglas estén compiladas (perezoso). */
function ensureCompiled() {
  if (!compiled) compile();
}

// -------------------------------------------------------------------------
// 4) API PÚBLICA
// -------------------------------------------------------------------------

/** ¿Está habilitado el filtro? (default true según CONFIG.SLANG). */
export function isEnabled() {
  return store.get('slang.enabled', CONFIG.SLANG.ENABLED) !== false;
}

/** Activa/desactiva el filtro (persistente). */
export function setEnabled(on) {
  store.set('slang.enabled', !!on);
}

/**
 * @typedef {Object} SlangChange
 * @property {string} before    Texto original detectado (con su capitalización).
 * @property {string} after     Reemplazo neutro aplicado.
 * @property {string} term      Término de la regla.
 * @property {string} neutral   Equivalente neutro declarado.
 * @property {string} region    Región principal de la regla (o 'LA').
 * @property {'low'|'medium'|'high'} severity
 * @property {'word'|'phrase'} kind
 */

/**
 * Analiza un texto y devuelve la versión neutralizada junto con la lista de
 * cambios (para la UI de "cambios detectados" + revertir).
 *
 * Los reemplazos se hacen con centinelas (`\u0000`) y se restauran al final,
 * de modo que una neutralización nunca se vuelve a procesar por otra regla.
 *
 * @param {string} text
 * @param {{skip?:boolean, region?:string}} [opts]
 * @returns {{out:string, changes:SlangChange[], region:string}}
 */
export function analyze(text, opts = {}) {
  const raw = String(text || '');
  const region = (opts.region || getRegion()).toUpperCase();
  if (!raw) return { out: raw, changes: [], region };
  if (opts.skip || !isEnabled()) return { out: raw, changes: [], region };

  ensureCompiled();

  let work = raw;
  /** @type {SlangChange[]} */
  const changes = [];

  for (const rule of compiled) {
    // Filtro regional: las reglas de otra región no se aplican.
    if (!regionApplies(rule.regions, region)) continue;

    work = work.replace(rule.re, (match) => {
      const after = matchCase(match, rule.neutral);
      const id = changes.length;
      changes.push({
        before: match,
        after,
        term: rule.term,
        neutral: rule.neutral,
        region: rule.regions[0] || 'LA',
        severity: rule.severity,
        kind: rule.kind,
      });
      // Centinela no imprimible: se restaura en la fase final.
      return `\u0000${id}\u0000`;
    });
  }

  // Restaurar centinelas → texto neutral
  const out = work.replace(/\u0000(\d+)\u0000/g, (_, i) => changes[Number(i)].after);
  return { out, changes, region };
}

/**
 * Neutraliza un texto aplicando las reglas activas (atajo de analyze().out).
 * @param {string} text
 * @param {{skip?:boolean, region?:string}} [opts]
 * @returns {string} texto neutralizado (idéntico si no hay cambios)
 */
export function neutralize(text, opts = {}) {
  return analyze(text, opts).out;
}

/** ¿Hubo algún cambio de severidad alta? (para avisos más visibles). */
export function hasHighSeverity(changes) {
  return Array.isArray(changes) && changes.some((c) => c.severity === 'high');
}

/**
 * Añade/actualiza una regla personal (se persiste y opcionalmente se sube).
 * @param {SlangRule} rule
 * @param {{sync?:boolean}} [opts]
 * @returns {boolean}
 */
export function addRule(rule, opts = {}) {
  if (!rule || !rule.term || !rule.neutral) return false;
  const personal = store.get('slang.personal', []);
  const list = Array.isArray(personal) ? personal.slice() : [];
  const term = String(rule.term).trim().toLowerCase();
  const idx = list.findIndex((r) => String(r.term || '').toLowerCase() === term);
  const entry = {
    term,
    neutral: String(rule.neutral),
    regions: Array.isArray(rule.regions) ? rule.regions : [],
    severity: rule.severity || 'low',
    kind: rule.kind === 'phrase' ? 'phrase' : 'word',
    allowSuffix: !!rule.allowSuffix,
  };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  store.set('slang.personal', list);
  compiled = null; // forzar recompilación perezosa
  if (opts.sync) {
    // Subida opcional a la nube (carga perezosa para no acoplar)
    import('../cloud/sync.js')
      .then((m) => m.sync?.queue?.({ type: 'slang-upsert', payload: entry }))
      .catch(() => {});
  }
  return true;
}

/**
 * Elimina una regla personal por término.
 * @param {string} term
 * @param {{sync?:boolean}} [opts]
 * @returns {boolean}
 */
export function removeRule(term, opts = {}) {
  const t = String(term || '').trim().toLowerCase();
  if (!t) return false;
  const personal = store.get('slang.personal', []);
  const list = (Array.isArray(personal) ? personal : []).filter(
    (r) => String(r?.term || '').toLowerCase() !== t
  );
  store.set('slang.personal', list);
  compiled = null;
  if (opts.sync) {
    import('../cloud/sync.js')
      .then((m) => m.sync?.queue?.({ type: 'slang-delete', payload: { term: t } }))
      .catch(() => {});
  }
  return true;
}

/** Devuelve las reglas activas (base + personales) para inspección/UI. */
export function getRules() {
  ensureCompiled();
  return rules.slice();
}

/**
 * Inicializa: recompila desde el store y se refresca cuando la nube trae
 * modismos personales ('cloud:synced').
 */
export function init() {
  compile();
  import('../core/bus.js')
    .then(({ bus }) => {
      bus.on('cloud:synced', () => {
        compiled = null; // los personales llegaron: recompilar al próximo uso
      });
    })
    .catch(() => {});
}

export const slangFilter = Object.freeze({
  init,
  analyze,
  neutralize,
  isEnabled,
  setEnabled,
  addRule,
  removeRule,
  getRules,
  guessRegion,
  getRegion,
  setRegion,
  hasHighSeverity,
});

// Exposición opcional de depuración (consistente con el resto de módulos).
if (typeof window !== 'undefined' && !window.__svaiSlang) {
  window.__svaiSlang = slangFilter;
}
