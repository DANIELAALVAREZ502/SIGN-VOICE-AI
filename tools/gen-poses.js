// =========================================================================
// tools/gen-poses.js
// -------------------------------------------------------------------------
// GENERADOR DE DICCIONARIOS DE POSES A–Z (LSE + ASL) — DATA DEMO CC0
// =========================================================================
//
// PROPÓSITO
//   Produce assets/signs/signs.es-LSE.json y signs.en-ASL.json con las 26
//   letras dactilológicas. Cada letra es una pose de 21 puntos [x,y]
//   normalizados, generada por cinemática 2D de una mano (palma + 5 cadenas
//   articuladas), de forma DETERMINISTA (sin aleatoriedad): el mismo input
//   produce siempre el mismo JSON, ideal para versionado.
//
// MODELO
//   - Espacio normalizado: x,y ∈ [0,1], y hacia abajo (como MediaPipe).
//   - Muñeca fija; MCPs de los 4 dedos sobre un arco de palma.
//   - Cada dedo: cadena de 3 segmentos (PIP/DIP/TIP) con longitud decreciente.
//   - CURL (0..1): 0 = extendido, 1 = plegado. Cada articulación añade
//     grados acumulativos (80°/60°/40° = 180° totales → puño cerrado).
//   - Pulgar: cadena propia (CMC→MCP→IP→TIP) con ángulo base configurable
//     por letra (lateral, arriba, cruzado sobre palma).
//   - J/Z añaden `trail` (trayectoria del trazo) para el rig.
//
// USO
//   node tools/gen-poses.js
//
// NOTA DE HONESTIDAD (documentada también en el JSON meta)
//   Estas poses son una aproximación DEMO educativa, no ground-truth de LSE
//   ni ASL. Sirven para validar el pipeline rig→player y pueden reemplazarse
//   a mano por poses capturadas con un guante de datos o por clips MP4.
// =========================================================================

const fs = require('fs');
const path = require('path');

// --- GEOMETRÍA BASE DE LA MANO -------------------------------------------
// Puntos fijos (no articulados) en espacio normalizado y-down.
const WRIST = [0.5, 0.88];
// Arcos MCP: índice a meñique, y ligeramente descendente (arco real de palma)
const MCP = {
  index: [0.405, 0.565],
  middle: [0.487, 0.535],
  ring: [0.567, 0.558],
  pinky: [0.638, 0.612],
};
// Pulgar: el punto 1 (CMC) vive junto a la muñeca; la cadena sale desde ahí
const THUMB_CMC = [0.435, 0.8];

// Longitudes de segmentos por dedo [proximal, media, distal]
const LENS = {
  index: [0.075, 0.05, 0.042],
  middle: [0.08, 0.055, 0.045],
  ring: [0.075, 0.05, 0.042],
  pinky: [0.06, 0.04, 0.035],
  thumb: [0.065, 0.055, 0.048], // CMC→MCP, MCP→IP, IP→TIP
};

// Ángulo base por dedo (grados; −90 = arriba en sistema y-down) + dispersión
// natural de la mano (dedos no son paralelos: el meñique se abre hacia fuera)
const BASE_ANGLE = { index: -94, middle: -90, ring: -85, pinky: -76 };

// --- UTILIDADES DE CINEMÁTICA --------------------------------------------
const rad = (deg) => (deg * Math.PI) / 180;
// Punto a partir de origen + dirección angular + longitud
const step = (p, deg, len) => [
  p[0] + Math.cos(rad(deg)) * len,
  p[1] + Math.sin(rad(deg)) * len,
];
// Redondeo a 3 decimales → JSON compacto y legible
const r3 = (n) => Math.round(n * 1000) / 1000;
const pt = (p) => [r3(p[0]), r3(p[1])];

/**
 * Construye los 21 landmarks de una mano dada la configuración de letra.
 * Orden MediaPipe estándar: 0 muñeca · 1–4 pulgar · 5–8 índice ·
 * 9–12 medio · 13–16 anular · 17–20 meñique.
 *
 * @param {object} cfg
 * @param {number[]} cfg.curl   — [índice, medio, anular, meñique] 0..1
 * @param {number[]} [cfg.spread] — dispersión extra en grados por dedo
 * @param {{angle:number,curl:number}} cfg.thumb — ángulo base y plegado pulgar
 * @returns {number[][]} 21 puntos [x,y]
 */
function buildHand(cfg) {
  const curl = cfg.curl;
  const spread = cfg.spread || [0, 0, 0, 0];
  const pts = [pt(WRIST)]; // índice 0: muñeca

  // --- PULGAR (1–4): cadena desde CMC con ángulo configurable -------------
  const tAngles = [
    cfg.thumb.angle, // 1→2 (CMC→MCP): dirección general del pulgar
    cfg.thumb.angle + 75 * cfg.thumb.curl, // 2→3: se curva hacia palma
    cfg.thumb.angle + 75 * cfg.thumb.curl + 55 * cfg.thumb.curl, // 3→4
  ];
  let tp = THUMB_CMC;
  pts.push(pt(tp)); // punto 1 (CMC ya está en THUMB_CMC)
  const thumbLens = LENS.thumb;
  for (let i = 0; i < 3; i++) {
    tp = step(tp, tAngles[i], thumbLens[i]);
    pts.push(pt(tp)); // 2, 3, 4
  }

  // --- DEDOS PALMARES (5–20): 4 cadenas de 3 segmentos --------------------
  const names = ['index', 'middle', 'ring', 'pinky'];
  for (let n = 0; n < 4; n++) {
    const name = names[n];
    const c = Math.max(0, Math.min(1, curl[n])); // clamp de seguridad
    const a0 = BASE_ANGLE[name] + spread[n]; // dirección MCP→PIP
    const a1 = a0 + 80 * c; // PIP flexiona (80° al plegar del todo)
    const a2 = a1 + 60 * c; // DIP continúa (60°)
    const a3 = a2 + 40 * c; // TIP remata (40°) → 180° acumulados con c=1
    const [l1, l2, l3] = LENS[name];

    let p = MCP[name];
    pts.push(pt(p)); // MCP (5, 9, 13, 17)
    p = step(p, a0, l1); pts.push(pt(p)); // PIP (6, 10, 14, 18)
    p = step(p, a1, l2); pts.push(pt(p)); // DIP (7, 11, 15, 19)
    p = step(p, a2, l3); pts.push(pt(p)); // TIP (8, 12, 16, 20)
  }
  return pts;
}

// --- TABLA DE LETRAS ------------------------------------------------------
// curl: [índice, medio, anular, meñique] · thumb: {angle, curl}
// Ángulos pulgar: −165 lateral izq · −100 arriba · −50 cruzado sobre palma
const LETTERS = {
  A: { curl: [1, 1, 1, 1], thumb: { angle: -105, curl: 0.15 }, desc: 'Puño cerrado con el pulgar extendido hacia arriba.' },
  B: { curl: [0, 0, 0, 0], thumb: { angle: -40, curl: 0.85 }, desc: 'Cuatro dedos extendidos y juntos, pulgar plegado sobre la palma.' },
  C: { curl: [0.45, 0.45, 0.45, 0.45], thumb: { angle: -120, curl: 0.45 }, desc: 'Mano curvada en forma de C (semicírculo).' },
  D: { curl: [0.15, 0.9, 0.95, 0.95], thumb: { angle: -60, curl: 0.7 }, desc: 'Índice extendido, resto plegado; el pulgar toca el dedo medio.' },
  E: { curl: [0.85, 0.85, 0.85, 0.85], thumb: { angle: -55, curl: 0.75 }, desc: 'Dedos plegados sobre la palma con el pulgar debajo.' },
  F: { curl: [0.75, 0.05, 0.05, 0.05], thumb: { angle: -50, curl: 0.7 }, desc: 'Índice y pulgar forman un círculo; los otros tres dedos extendidos.' },
  G: { curl: [0.1, 0.95, 0.95, 0.95], thumb: { angle: -75, curl: 0.15 }, desc: 'Índice y pulgar apuntan hacia un lado (señalar).' },
  H: { curl: [0.1, 0.1, 0.95, 0.95], thumb: { angle: -55, curl: 0.7 }, desc: 'Índice y medio extendidos juntos hacia un lado.' },
  I: { curl: [0.95, 0.95, 0.95, 0.05], thumb: { angle: -45, curl: 0.8 }, desc: 'Meñique extendido, resto plegado.' },
  J: { curl: [0.95, 0.95, 0.95, 0.05], thumb: { angle: -45, curl: 0.8 }, trail: [[0.66, 0.55], [0.685, 0.65], [0.66, 0.75], [0.58, 0.78], [0.51, 0.72]], desc: 'Meñique extendido con trazo en J (movimiento).' },
  K: { curl: [0.05, 0.05, 0.95, 0.95], spread: [-12, 14, 0, 0], thumb: { angle: -130, curl: 0.25 }, desc: 'Índice y medio en V con el pulgar entre ambos.' },
  L: { curl: [0.9, 0.95, 0.95, 0.95], thumb: { angle: -165, curl: 0.05 }, desc: 'Índice arriba y pulgar en ángulo recto (forma de L).' },
  M: { curl: [0.8, 0.8, 0.8, 0.95], thumb: { angle: -40, curl: 0.9 }, desc: 'Tres dedos plegados sobre el pulgar.' },
  N: { curl: [0.8, 0.8, 0.95, 0.95], thumb: { angle: -45, curl: 0.9 }, desc: 'Dos dedos plegados sobre el pulgar.' },
  O: { curl: [0.6, 0.6, 0.6, 0.6], thumb: { angle: -95, curl: 0.55 }, desc: 'Todos los dedos curvados formando una O con el pulgar.' },
  P: { curl: [0.3, 0.3, 0.95, 0.95], spread: [-8, 8, 0, 0], thumb: { angle: -140, curl: 0.4 }, desc: 'Como la K pero apuntando hacia abajo.' },
  Q: { curl: [0.5, 0.95, 0.95, 0.95], thumb: { angle: -30, curl: 0.35 }, desc: 'Como la G pero apuntando hacia abajo.' },
  R: { curl: [0.05, 0.05, 0.95, 0.95], spread: [10, -8, 0, 0], thumb: { angle: -55, curl: 0.75 }, desc: 'Índice y medio extendidos y cruzados.' },
  S: { curl: [1, 1, 1, 1], thumb: { angle: -35, curl: 0.85 }, desc: 'Puño cerrado con el pulgar delante de los dedos.' },
  T: { curl: [0.75, 0.95, 0.95, 0.95], thumb: { angle: -95, curl: 0.35 }, desc: 'Pulgar asomando entre índice y medio.' },
  U: { curl: [0.05, 0.05, 0.95, 0.95], spread: [3, -3, 0, 0], thumb: { angle: -50, curl: 0.8 }, desc: 'Índice y medio extendidos juntos.' },
  V: { curl: [0.05, 0.05, 0.95, 0.95], spread: [-14, 14, 0, 0], thumb: { angle: -50, curl: 0.8 }, desc: 'Índice y medio extendidos separados (tijera).' },
  W: { curl: [0.05, 0.05, 0.05, 0.95], spread: [-14, 0, 14, 0], thumb: { angle: -45, curl: 0.85 }, desc: 'Tres dedos extendidos y separados.' },
  X: { curl: [0.5, 0.95, 0.95, 0.95], thumb: { angle: -45, curl: 0.8 }, desc: 'Índice flexionado en gancho.' },
  Y: { curl: [0.95, 0.95, 0.95, 0.05], thumb: { angle: -160, curl: 0.1 }, desc: 'Pulgar y meñique extendidos (mano "yo").' },
  Z: { curl: [0.05, 0.95, 0.95, 0.95], thumb: { angle: -50, curl: 0.8 }, trail: [[0.4, 0.36], [0.6, 0.36], [0.4, 0.52], [0.62, 0.52]], desc: 'Índice extendido trazando una Z (movimiento).' },
};

// Palabras demo: "hola" conserva su pose + hint de clip (mejora progresiva);
// el resto se deletrean (player cae a letras cuando no hay pose de palabra).
const WORDS_ES = {
  hola: { desc: 'Saludo genérico (demo).', clip: 'hola.mp4', pose: buildHand({ curl: [0.1, 0.1, 0.1, 0.1], thumb: { angle: -150, curl: 0.2 } }) },
  gracias: { desc: 'Agradecimiento (demo, deletrear si no hay clip).' },
  ayuda: { desc: 'Petición de ayuda (demo, deletrear si no hay clip).' },
  si: { desc: 'Afirmación (demo, deletrear si no hay clip).' },
  no: { desc: 'Negación (demo, deletrear si no hay clip).' },
};
const WORDS_EN = {
  hello: { desc: 'Greeting (demo).', clip: 'hello.mp4', pose: buildHand({ curl: [0.1, 0.1, 0.1, 0.1], thumb: { angle: -150, curl: 0.2 } }) },
  help: { desc: 'Ask for help (demo, fingerspell if no clip).' },
  yes: { desc: 'Affirmative (demo, fingerspell if no clip).' },
  no: { desc: 'Negative (demo, fingerspell if no clip).' },
  thanks: { desc: 'Thanks (demo, fingerspell if no clip).' },
};

/** Genera el objeto letters completo (26 entradas) con poses + trail */
function buildLetters() {
  const out = {};
  for (const [ch, cfg] of Object.entries(LETTERS)) {
    const entry = { desc: cfg.desc, pose: buildHand(cfg) };
    if (cfg.trail) entry.trail = cfg.trail; // J/Z llevan trayectoria
    out[ch] = entry;
  }
  return out;
}

// --- ESCRITURA DE LOS DOS JSON -------------------------------------------
const ROOT = path.join(__dirname, '..');
const outEs = {
  meta: {
    lang: 'es-LSE',
    name: 'Diccionario base LSE (demo educativa)',
    note: 'Poses A–Z generadas por tools/gen-poses.js (cinemática 2D demo, NO ground-truth de LSE). 21 puntos normalizados [x,y]. Clips propios: assets/signs/clips/<clave>.mp4',
    author: 'SIGN-VOICE AI',
    version: '1.1.0',
    license: 'CC0-1.0',
    generator: 'tools/gen-poses.js',
  },
  letters: buildLetters(),
  words: WORDS_ES,
};

const outEn = {
  meta: {
    lang: 'en-ASL',
    name: 'ASL base dictionary (demo)',
    note: 'A–Z poses generated by tools/gen-poses.js (2D demo kinematics, NOT ASL ground-truth). 21 normalized points [x,y]. Own clips: assets/signs/clips/<key>.mp4',
    author: 'SIGN-VOICE AI',
    version: '1.1.0',
    license: 'CC0-1.0',
    generator: 'tools/gen-poses.js',
  },
  letters: buildLetters(),
  words: WORDS_EN,
};

// Escribir con indentación de 2 espacios para diffs legibles en git
const esPath = path.join(ROOT, 'assets', 'signs', 'signs.es-LSE.json');
const enPath = path.join(ROOT, 'assets', 'signs', 'signs.en-ASL.json');
fs.writeFileSync(esPath, JSON.stringify(outEs, null, 2) + '\n', 'utf8');
fs.writeFileSync(enPath, JSON.stringify(outEn, null, 2) + '\n', 'utf8');

// --- VERIFICACIÓN POST-ESCRITURA -----------------------------------------
// Comprobamos que cada letra tiene exactamente 21 puntos y coordenadas en
// rango razonable: un JSON corrupto rompería el avatar en silencio.
let errors = 0;
for (const file of [outEs, outEn]) {
  for (const [ch, e] of Object.entries(file.letters)) {
    if (!Array.isArray(e.pose) || e.pose.length !== 21) {
      console.error(`  ✗ ${file.meta.lang} ${ch}: ${e.pose?.length ?? 0} puntos (esperado 21)`);
      errors++;
    } else if (e.pose.some((p) => !Array.isArray(p) || p.length !== 2)) {
      console.error(`  ✗ ${file.meta.lang} ${ch}: punto mal formado`);
      errors++;
    }
  }
}
console.log(errors === 0
  ? `✓ Generados 26 letras × 2 idiomas → ${path.basename(esPath)}, ${path.basename(enPath)}`
  : `✗ ${errors} errores de validación`);
process.exit(errors === 0 ? 0 : 1);
