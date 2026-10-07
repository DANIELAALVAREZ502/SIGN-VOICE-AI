// =========================================================================
// js/ai/features.js
// -------------------------------------------------------------------------
// EXTRACCIÓN DE FEATURES DE LANDMARKS (21 puntos MediaPipe HandLandmarker)
// =========================================================================
//
// PROPÓSITO
//   Normaliza los 21 landmarks (wrist=0, dedo pulgar→meñique, tips/fingers MCP/PIP/DIP)
//   para obtener invarianza a escala, posición y rotación suave. Genera un
//   vector numérico compacto (63 features aprox.) usado por fingerspell.js.
//
// NORMALIZACIÓN
//   - Origen: muñeca (landmark[0])
//   - Escala: distancia muñeca(0) → MCP medio(9) (longitud de palma base)
//     Evita que manos cerca/lejos distorsionen.
//   - Invariancia a rotación: alinea el eje muñeca(0)→MCP índice(5) vs eje base
//     con proyección 2D (vista frontal). No elimina perspectiva 3D completa,
//     pero es suficiente para dactilología frontal.
//   - Coordenadas normalizadas [x,y] en [-1,1] relativo a palma.
// =========================================================================

import { CONFIG } from '../core/config.js';

/**
 * Indices MediaPipe HandLandmarker (21)
 * 0 WRIST
 * 1 THUMB_CMC 2 THUMB_MCP 3 THUMB_IP 4 THUMB_TIP
 * 5 INDEX_FINGER_MCP 6 INDEX_FINGER_PIP 7 INDEX_FINGER_DIP 8 INDEX_FINGER_TIP
 * 9 MIDDLE_FINGER_MCP 10 MIDDLE_FINGER_PIP 11 MIDDLE_FINGER_DIP 12 MIDDLE_FINGER_TIP
 * 13 RING_FINGER_MCP 14 RING_FINGER_PIP 15 RING_FINGER_DIP 16 RING_FINGER_TIP
 * 17 PINKY_MCP 18 PINKY_PIP 19 PINKY_DIP 20 PINKY_TIP
 */

/** Devuelve vector de features (Float32Array o Array) */
export function extractFeatures(landmarks = []) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) {
    return { ok: false, vector: new Float32Array(0), meta: {} };
  }

  // Copia 2D [x,y,z] (z puede variar)
  const pts = Array.from({ length: 21 }, (_, i) => {
    const p = landmarks[i] || { x: 0, y: 0, z: 0 };
    return { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 };
  });

  const W = pts[0]; // wrist
  // MCPs
  const I0 = pts[5], M0 = pts[9], R0 = pts[13], P0 = pts[17];

  // Escala: muñeca → MCP medio (9)
  const scaleBase = dist(W, M0);
  const s = scaleBase <= 1e-4 ? 1.0 : 1.0 / scaleBase;

  // Trasladar origen a muñeca
  function rel(p) {
    return { x: (p.x - W.x) * s, y: (p.y - W.y) * s, z: (p.z - W.z) * s };
  }

  const r = Array.from({ length: 21 }, (_, i) => rel(pts[i]));

  // Ejes para alinear palma (2D): vector W->M0 aproximado como eje Y suave
  const vM = { x: r[9].x, y: r[9].y }; // ya relativo
  const lenM = Math.hypot(vM.x, vM.y) || 1.0;
  const ax = { x: vM.x / lenM, y: vM.y / lenM }; // eje hacia MCP medio
  const ay = { x: -ax.y, y: ax.x };              // perpendicular (izq)

  // Rotar 2D para alinear palma (reduce rotación en plano)
  function rot(p) {
    return {
      x: p.x * ax.x + p.y * ax.y,
      y: -p.x * ay.x - p.y * ay.y, // invertir Y para espacio de imagen (opcional)
      z: p.z, // mantener z relativo
    };
  }
  const n = Array.from({ length: 21 }, (_, i) => rot(r[i]));

  // Distancias y ángulos
  const feats = [];
  // 1) Distancias absolutas normalizadas entre puntos clave (dedos)
  // Pulgar
  feats.push(dist2(n[0], n[2]), dist2(n[2], n[3]), dist2(n[3], n[4]));
  // Índice
  feats.push(dist2(n[5], n[6]), dist2(n[6], n[7]), dist2(n[7], n[8]));
  // Medio
  feats.push(dist2(n[9], n[10]), dist2(n[10], n[11]), dist2(n[11], n[12]));
  // Anular
  feats.push(dist2(n[13], n[14]), dist2(n[14], n[15]), dist2(n[15], n[16]));
  // Meñique
  feats.push(dist2(n[17], n[18]), dist2(n[18], n[19]), dist2(n[19], n[20]));
  // 2) Distancias entre tips y MCP base (apertura)
  feats.push(dist2(n[4], n[2]), dist2(n[8], n[5]), dist2(n[12], n[9]), dist2(n[16], n[13]), dist2(n[20], n[17]));
  // 3) Ángulos de falanges (grados aprox normalizados 0–1)
  feats.push(angle01(n[2], n[3], n[4])); // pulgar IP
  feats.push(angle01(n[5], n[6], n[7]));
  feats.push(angle01(n[9], n[10], n[11]));
  feats.push(angle01(n[13], n[14], n[15]));
  feats.push(angle01(n[17], n[18], n[19]));
  // 4) Separación entre dedos (abducción relativa)
  feats.push(dist2(n[8], n[12])); // I–M
  feats.push(dist2(n[12], n[16])); // M–R
  feats.push(dist2(n[16], n[20])); // R–P
  feats.push(dist2(n[4], n[8]));  // T–I
  // 5) Posición relativa de tips respecto a muñeca (X,Y normalizados)
  for (let i of [4,8,12,16,20]) { feats.push(clamp01(n[i].x), clamp01(n[i].y + 0.2)); }
  // 6) Orientación palma (ángulo muñeca-MCP medio)
  feats.push(angNorm(ax));

  // Normalizar suavemente a media 0, var 1 (z-score ligero) no necesario;
  // heurístico usa umbrales relativos. Devolvemos vector crudo + ok.
  const vec = new Float32Array(feats.length);
  for (let i=0;i<feats.length;i++) vec[i] = Number.isFinite(feats[i]) ? feats[i] : 0;

  return {
    ok: true,
    vector: vec,
    count: vec.length,
    meta: { scale: scaleBase },
  };
}

function dist(a,b){ const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z; return Math.hypot(dx,dy,dz); }
function dist2(a,b){ const dx=a.x-b.x,dy=a.y-b.y; return Math.hypot(dx,dy); } // 2D para plano palma
function clamp01(v){ if(v<0)return 0; if(v>1)return 1; return v; }
function angNorm(v){ let a=Math.atan2(v.y,v.x)/(Math.PI*2)+0.5; return ((a%1)+1)%1; }
/** ángulo en B entre A,B,C → 0–1 (0 recto/abierto, 1 cerrado aprox) */
function angle01(A,B,C){
  const v1x=A.x-B.x,v1y=A.y-B.y,v2x=C.x-B.x,v2y=C.y-B.y;
  const d1=Math.hypot(v1x,v1y)||1,d2=Math.hypot(v2x,v2y)||1;
  let dot=(v1x*v2x+v1y*v2y)/(d1*d2); if(dot<-1)dot=-1;if(dot>1)dot=1;
  const ang=Math.acos(dot); // 0–PI
  return ang/Math.PI;
}
