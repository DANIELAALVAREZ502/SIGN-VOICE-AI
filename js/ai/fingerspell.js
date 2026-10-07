// =========================================================================
// js/ai/fingerspell.js
// -------------------------------------------------------------------------
// CLASIFICADOR HEURÍSTICO PARA DACTILOGRAFÍA (A–Z) — 100% cliente, auditable
// =========================================================================
//
// PROPÓSITO
//   Mapa reglas geométricas sobre features extraídos. Sin modelo entrenado
//   (0 MB). Prioriza PRECISIÓN SOBRE VELOCIDAD: solo commitea con margen
//   claro entre top1/top2 y coherencia temporal (sequencer.js).
//
// ALFABETO CUBIERTO (demo base)
//   A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z
//   NOTA: J,Z se benefician de trayectoria (sequencer detecta movimiento).
//   Pares ambigüos tratados con desempate explícito: E/U/S, M/N, G/H, K/P, R.
//
// ENFOQUE
//   Basado en apertura de dedos, extensión (tips vs MCP), abducción (I–M etc),
//   y posición del pulgar. Cada regla devuelve score 0–1.
// =========================================================================

import { CONFIG } from '../core/config.js';

/** Extraer valores clave del vector features (mismo orden que features.js) */
function get(fv, i){ return (fv && i<fv.length) ? fv[i] : 0; }

/** Clasifica vector features → {letter, score, candidates[]} */
export function classify(featuresVec = []) {
  const fv = featuresVec;
  // mapeo implícito por índices (ver features.js):
  // 0-2 pulgar, 3-5 índice, 6-8 medio, 9-11 anular, 12-14 meñique
  // 15-19 aperturas tips-MCP
  // 20-24 ángulos
  // 25-28 separaciones
  // 29-38 tips rel
  // 39 angNorm

  const thumbExt = get(fv,15); // THUMB_TIP vs THUMB_MCP aprox
  const idxExt   = get(fv,16);
  const midExt   = get(fv,17);
  const ringExt  = get(fv,18);
  const pinkExt  = get(fv,19);

  const angIdx   = get(fv,21); // ángulo PIP-DIP aproximado normalizado
  const angMid   = get(fv,22);
  const angRing  = get(fv,23);
  const angPink  = get(fv,24);

  const sepIM    = get(fv,25); // I–M
  const sepMR    = get(fv,26); // M–R
  const sepRP    = get(fv,27); // R–P
  const sepTI    = get(fv,28); // T–I

  // puntajes por letra
  const scores = new Map();

  // A: pulgar extendido, resto cerrado (ángulos altos = flexionados)
  scores.set('A', score([
    [thumbExt>0.25,0.9],
    [idxExt<0.18 && angIdx>0.6,0.9],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepTI>0.18,0.6],
  ]));

  // B: dedos extendidos, pulgar pegado
  scores.set('B', score([
    [thumbExt<0.22,0.9],
    [idxExt>0.32,0.9],
    [midExt>0.32,0.9],
    [ringExt>0.32,0.9],
    [pinkExt>0.32,0.9],
    [angIdx<0.35 && angMid<0.35,0.8],
    [sepIM<0.12 && sepMR<0.12 && sepRP<0.12,0.8],
  ]));

  // C: curva cóncava (ángulos medios)
  scores.set('C', score([
    [thumbExt>0.14 && thumbExt<0.38,0.9],
    [idxExt>0.12 && idxExt<0.32,0.9],
    [midExt>0.12 && midExt<0.32,0.9],
    [ringExt>0.12 && ringExt<0.32,0.9],
    [pinkExt>0.12 && pinkExt<0.32,0.9],
    [angIdx>0.25 && angIdx<0.6,0.8],
  ]));

  // D: índice extendido, medio/anular/meñique cerrados, pulgar lateral
  scores.set('D', score([
    [idxExt>0.32,0.95],
    [midExt<0.22 && angMid>0.55,0.9],
    [ringExt<0.22<0?false:ringExt<0.22 && angRing>0.55,0.9],
    [pinkExt<0.22 && angPink>0.55,0.9],
    [sepIM>0.16,0.7],
  ]));

  // E: dedos muy flexionados, pulgar cruzado/apoyado
  scores.set('E', score([
    [idxExt<0.16 && angIdx>0.7,0.95],
    [midExt<0.16 && angMid>0.7,0.95],
    [ringExt<0.16 && angRing>0.7,0.95],
    [pinkExt<0.16 && angPink>0.7,0.95],
    [thumbExt<0.26,0.8],
  ]));

  // F: índice+pulgar en círculo/abiertos, resto extendido
  scores.set('F', score([
    [idxExt<0.22 && angIdx>0.5,0.9], // flexionado
    [thumbExt>0.18,0.8],
    [midExt>0.32,0.9],
    [ringExt>0.32,0.9],
    [pinkExt>0.32,0.9],
    [sepIM>0.14,0.7],
  ]));

  // G: índice extendido lateral, pulgar lateral, resto cerrado
  scores.set('G', score([
    [idxExt>0.28,0.95],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM>0.18,0.8],
    [sepTI>0.16,0.7],
  ]));

  // H: índice+medio extendidos laterales, resto cerrado
  scores.set('H', score([
    [idxExt>0.28,0.95],
    [midExt>0.28,0.95],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM<0.16,0.8],
  ]));

  // I: meñique extendido, resto cerrado
  scores.set('I', score([
    [pinkExt>0.28,0.95],
    [idxExt<0.18 && angIdx>0.6,0.9],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
    [thumbExt<0.28,0.7],
  ]));

  // J: meñique extendido + movimiento trazado (se refuerza en sequencer)
  scores.set('J', score([
    [pinkExt>0.26,0.95],
    [idxExt<0.18 && angIdx>0.6,0.9],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
  ]));

  // K: índice+medio extendidos en V, pulgar entre/adelante
  scores.set('K', score([
    [idxExt>0.28,0.95],
    [midExt>0.28,0.95],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM>0.16,0.8],
    [thumbExt>0.16,0.7],
  ]));

  // L: índice extendido, pulgar perpendicular
  scores.set('L', score([
    [idxExt>0.32,0.95],
    [thumbExt>0.26,0.9],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepTI>0.22,0.8],
  ]));

  // M: pulgar bajo dedos flexionados (todos muy flexionados)
  scores.set('M', score([
    [idxExt<0.14 && angIdx>0.72,0.95],
    [midExt<0.14 && angMid>0.72,0.95],
    [ringExt<0.14 && angRing>0.72,0.95],
    [pinkExt<0.14 && angPink>0.72,0.95],
    [thumbExt>0.12 && thumbExt<0.32,0.8],
  ]));

  // N: similar a M pero dedos algo menos "ocultos"
  scores.set('N', score([
    [idxExt<0.16 && angIdx>0.68,0.95],
    [midExt<0.16 && angMid>0.68,0.95],
    [ringExt<0.16 && angRing>0.68,0.95],
    [pinkExt<0.16 && angPink>0.68,0.95],
    [thumbExt>0.12 && thumbExt<0.3,0.8],
  ]));

  // O: mano en forma de O (curva)
  scores.set('O', score([
    [idxExt<0.26 && angIdx>0.4 && angIdx<0.7,0.95],
    [midExt<0.26 && angMid>0.4 && angMid<0.7,0.95],
    [ringExt<0.26 && angRing>0.4 && angRing<0.7,0.95],
    [pinkExt<0.26 && angPink>0.4 && angPink<0.7,0.95],
    [thumbExt>0.12 && thumbExt<0.32,0.9],
  ]));

  // P: índice+medio apuntando, pulgar hacia abajo/lateral
  scores.set('P', score([
    [idxExt>0.28,0.95],
    [midExt>0.28,0.95],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM<0.14,0.8],
    [thumbExt>0.14,0.7],
  ]));

  // Q: índice hacia abajo/lateral, pulgar paralelo
  scores.set('Q', score([
    [idxExt>0.24,0.95],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM>0.16,0.8],
  ]));

  // R: índice+medio cruzados/solapados sutilmente
  scores.set('R', score([
    [idxExt>0.26,0.95],
    [midExt>0.26,0.95],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM<0.12,0.9], // muy juntos
  ]));

  // S: puño cerrado (ángulos muy altos)
  scores.set('S', score([
    [idxExt<0.14 && angIdx>0.78,0.95],
    [midExt<0.14 && angMid>0.78,0.95],
    [ringExt<0.14 && angRing>0.78,0.95],
    [pinkExt<0.14 && angPink>0.78,0.95],
    [thumbExt<0.24,0.9],
  ]));

  // T: pulgar entre índice y medio (flexionados)
  scores.set('T', score([
    [idxExt<0.16 && angIdx>0.7,0.95],
    [midExt<0.16 && angMid>0.7,0.95],
    [ringExt<0.16 && angRing>0.7,0.95],
    [pinkExt<0.16 && angPink>0.7,0.95],
    [thumbExt>0.14 && thumbExt<0.32,0.85],
    [sepTI<0.22,0.8],
  ]));

  // U: índice+medio juntos extendidos, resto cerrado
  scores.set('U', score([
    [idxExt>0.32,0.95],
    [midExt>0.32,0.95],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM<0.12,0.95],
  ]));

  // V: índice+medio en V, juntos pero separados lateral
  scores.set('V', score([
    [idxExt>0.32,0.95],
    [midExt>0.32,0.95],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM>0.14 && sepIM<0.28,0.95],
  ]));

  // W: I,M,R extendidos
  scores.set('W', score([
    [idxExt>0.3,0.95],
    [midExt>0.3,0.95],
    [ringExt>0.3,0.95],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [sepIM<0.16,0.9],
    [sepMR<0.16,0.9],
  ]));

  // X: índice flexionado en gancho, resto cerrado
  scores.set('X', score([
    [idxExt>0.16 && idxExt<0.3,0.95],
    [angIdx>0.38 && angIdx<0.68,0.95],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [thumbExt>0.14,0.7],
  ]));

  // Y: meñique+pulgar extendidos, resto cerrado
  scores.set('Y', score([
    [pinkExt>0.32,0.95],
    [thumbExt>0.28,0.95],
    [idxExt<0.18 && angIdx>0.6,0.9],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
    [sepTI>0.16,0.8],
  ]));

  // Z: índice extendido + movimiento trazado
  scores.set('Z', score([
    [idxExt>0.3,0.95],
    [midExt<0.18 && angMid>0.6,0.9],
    [ringExt<0.18 && angRing>0.6,0.9],
    [pinkExt<0.18 && angPink>0.6,0.9],
    [thumbExt<0.28,0.7],
  ]));

  // Desempate explícito para pares conflictivos
  const cands = Array.from(scores.entries())
    .filter(([,s])=>s>=0.42) // umbral de viabilidad
    .sort((a,b)=>b[1]-a[1]);

  if(cands.length===0){
    return { letter:null, score:0, candidates:[] };
  }

  let [best, bestS] = cands[0];
  if(cands.length>=2){
    const [sc1,sc2]=[cands[0][1], cands[1][1]];
    // si muy parecidos, aplicar desempate por reglas duras
    if(Math.abs(sc1-sc2)<0.12){
      const w = tieBreak(best,cands[1][0], fv);
      if(w!==best) { best=w; bestS = Math.max(sc1,sc2); }
    }
  }

  return { letter:best, score:Math.min(1,bestS), candidates:cands.slice(0,5) };
}

function score(rules){
  let s=0,w=0;
  for(const [ok,wt] of rules){
    w+=wt; if(ok)s+=wt;
  }
  return w<=0?0:s/w;
}

/** Desempate concreto para reducir falsos positivos conocidos */
function tieBreak(a,b,fv){
  const angIdx=get(fv,21), angMid=get(fv,22), angRing=get(fv,23), angPink=get(fv,24);
  const idxExt=get(fv,16), midExt=get(fv,17), ringExt=get(fv,18), pinkExt=get(fv,19);
  const sepIM=get(fv,25), sepMR=get(fv,26), sepRP=get(fv,27);

  // E vs U/S: E exige todos muy flexionados
  if((a==='E'||b==='E') && (a==='U'||b==='U'||a==='S'||b==='S')){
    const eOK = idxExt<0.16 && angIdx>0.72 && midExt<0.16 && angMid>0.72 && ringExt<0.16 && angRing>0.72 && pinkExt<0.16 && angPink>0.72;
    if(eOK)return 'E';
  }
  // M vs N: M suele tener todos MUY flexionados y pulgar más "cubierto"
  if((a==='M'||b==='M') && (a==='N'||b==='N')){
    const mOK = angIdx>0.74 && angMid>0.74 && angRing>0.74 && angPink>0.74 && idxExt<0.14;
    if(mOK)return 'M';
  }
  // G vs H: G tiene resto cerrado + separación mayor entre I–M lateral
  if((a==='G'||b==='G') && (a==='H'||b==='H')){
    const gOK = midExt<0.18 && angMid>0.6 && ringExt<0.18 && angRing>0.6 && pinkExt<0.18 && angPink>0.6 && sepIM>0.18;
    if(gOK)return 'G';
  }
  // K vs P: K tiende a tener pulgar más "levantado"
  if((a==='K'||b==='K') && (a==='P'||b==='P')){
    const kOK = idxExt>0.28 && midExt>0.28 && sepIM>0.16;
    if(kOK)return 'K';
  }
  // R vs U: R con sepIM muy pequeño (cruzados)
  if((a==='R'||b==='R') && (a==='U'||b==='U')){
    const rOK = idxExt>0.26 && midExt>0.26 && sepIM<0.12;
    if(rOK)return 'R';
  }
  return a;
}
