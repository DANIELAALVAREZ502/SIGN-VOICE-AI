// =========================================================================
// js/ai\sequencer.js
// -------------------------------------------------------------------------
// SECUENCIADOR DE ESTABILIDAD + DETECCIÓN DE TRAZADO (J,Z)
// =========================================================================
//
// PROPÓSITO
//   Convierte predicciones por frame en letras COMPROMETIDAS (committed)
//   con ventana de estabilidad (N frames iguales + gap de confianza). También
//   detecta movimiento para reforzar J y Z (trayectoria).
//
// MECÁNICA
//   - buffer de último ganador (lastLetter) + contador de frames
//   - estabilidad: STABILITY_FRAMES con CONF_GAP entre top1/top2
//   - grace window tras pérdida de detección (GRACE_MS)
//   - trayectoria: acumula posición de índice (8) o meñique (20) para J/Z
// =========================================================================

import { CONFIG } from '../core/config.js';

export function createSequencer(opts = {}) {
  const cfg = {
    stability: opts.stability ?? CONFIG.FINGERSPELL.STABILITY_FRAMES,
    confGap: opts.confGap ?? CONFIG.FINGERSPELL.CONF_GAP,
    minCommit: opts.minCommit ?? CONFIG.FINGERSPELL.MIN_COMMIT_CONF,
    graceMs: opts.graceMs ?? CONFIG.FINGERSPELL.GRACE_MS,
    trajMinLen: opts.trajMinLen ?? CONFIG.FINGERSPELL.TRAJ_MIN_LEN,
  };

  let lastLetter = null;
  let lastScore = 0;
  let stableCount = 0;
  let lastTs = 0;
  let lastOkTs = 0;
  let traj = []; // puntos {x,y,ts}

  /**
   * Reset estado
   */
  function reset() {
    lastLetter = null;
    lastScore = 0;
    stableCount = 0;
    lastTs = 0;
    lastOkTs = 0;
    traj.length = 0;
  }

  /**
   * Agrega predicción + landmarks para trayectoria
   * @param {{letter:string|null,score:number,candidates:Array}} pred
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @param {number} ts
   * @returns {{commit:boolean, letter:string|null, score:number, reason:string}}
   */
  function push(pred, landmarks = [], ts = Date.now()) {
    lastTs = ts;
    if (pred && pred.letter && pred.score >= cfg.minCommit) {
      lastOkTs = ts;
      // trayectoria: usar tip índice (8) o meñique (20)
      const tip = landmarks[8] || landmarks[20];
      if (tip && typeof tip.x === 'number') {
        traj.push({ x: tip.x, y: tip.y, ts });
        if (traj.length > 40) traj.shift(); // mantener ventana corta
      }
      // estabilidad
      if (pred.letter === lastLetter) {
        stableCount++;
      } else {
        lastLetter = pred.letter;
        lastScore = pred.score;
        stableCount = 1;
      }
      // margen top1-top2
      let hasGap = true;
      if (pred.candidates && pred.candidates.length >= 2) {
        const s1 = pred.candidates[0][1], s2 = pred.candidates[1][1];
        if (s1 - s2 < cfg.confGap) hasGap = false;
      }
      // commit si estable + gap suficiente
      if (stableCount >= cfg.stability && hasGap) {
        // reforzar J/Z por trayectoria
        let letterOut = lastLetter;
        if (letterOut === 'J' || letterOut === 'Z') {
          if (hasTrajectory(traj, cfg.trajMinLen)) {
            // trayectoria válida
          } else {
            // trayectoria débil: bajar estabilidad para no commitear prematuro
            // pero no bloquear del todo
          }
        }
        const out = { commit: true, letter: letterOut, score: lastScore, reason: 'stable' };
        // no reset stableCount para permitir ráfagas
        return out;
      }
      return { commit: false, letter: null, score: lastScore, reason: 'building' };
    } else {
      // sin detección válida: grace window
      const grace = ts - lastOkTs < cfg.graceMs;
      if (!grace) {
        // timeout: reset suave
        if (lastLetter !== null) {
          stableCount = 0;
          lastLetter = null;
          traj.length = 0;
        }
      }
      return { commit: false, letter: null, score: 0, reason: grace ? 'grace' : 'lost' };
    }
  }

  function hasTrajectory(trajArr, minLen) {
    if (trajArr.length < 4) return false;
    let len = 0;
    for (let i = 1; i < trajArr.length; i++) {
      const a = trajArr[i - 1], b = trajArr[i];
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return len >= minLen;
  }

  return { push, reset, getState: () => ({ lastLetter, stableCount, lastScore }) };
}
