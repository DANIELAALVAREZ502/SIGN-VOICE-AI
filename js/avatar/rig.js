// =========================================================================
// js/avatar/rig.js
// -------------------------------------------------------------------------
// RIG SVG PROCEDURAL (21 articulaciones) — estética Cyber-HUD
// =========================================================================
//
// Basado en landmarks 21 (igual MediaPipe): dibuja huesos, joints, palma y
// trail opcional para J/Z. Se renderiza dentro de #avatar-svg #avatar-root.
// El jugador (player.js) interpola entre poses normalizadas [x,y].
// =========================================================================

const JOINTS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
const BONES = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

export function renderRig(root, pose = null) {
  if (!root) return;
  root.innerHTML = '';

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', 'rig-main');

  // huesos
  const bone = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  bone.setAttribute('class', 'rig-bone-layer');
  for (const [a,b] of BONES) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'rig-bone');
    line.setAttribute('data-a', String(a));
    line.setAttribute('data-b', String(b));
    line.setAttribute('x1', '280');
    line.setAttribute('y1', '210');
    line.setAttribute('x2', '300');
    line.setAttribute('y2', '210');
    bone.appendChild(line);
  }
  g.appendChild(bone);

  // palma (polígono entre 0,5,9,13,17)
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('class', 'rig-palm');
  poly.setAttribute('points', '280,210 300,200 320,210 310,230 290,230');
  g.appendChild(poly);

  // joints
  const jg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  jg.setAttribute('class', 'rig-joint-layer');
  for (let i=0;i<21;i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'rig-joint');
    c.setAttribute('data-i', String(i));
    c.setAttribute('cx', '280');
    c.setAttribute('cy', '210');
    c.setAttribute('r', i===0?'9':'6');
    jg.appendChild(c);
  }
  g.appendChild(jg);

  // trail
  const trail = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  trail.setAttribute('class', 'rig-trail');
  trail.setAttribute('points', '');
  trail.setAttribute('opacity', '0');
  g.appendChild(trail);

  root.appendChild(g);
}

/** Aplica pose {points: [[x,y],...21]} a root ya renderizado */
export function applyPose(root, pose, opts={}) {
  if (!root) return;
  const pts = pose?.points || pose?.pose || [];
  const joints = root.querySelectorAll('.rig-joint');
  const lines = root.querySelectorAll('.rig-bone');
  const poly = root.querySelector('.rig-palm');
  const trail = root.querySelector('.rig-trail');
  const vw=560,vh=420;
  const ox=vw/2, oy=vh/2, s=160;

  // joints + bones
  for (let i=0;i<joints.length;i++) {
    const cx = ox + (pts[i]?.[0]||0)*s;
    const cy = oy + (pts[i]?.[1]||0)*s;
    joints[i].setAttribute('cx', String(cx));
    joints[i].setAttribute('cy', String(cy));
  }
  for (const l of lines) {
    const a=+l.getAttribute('data-a'), b=+l.getAttribute('data-b');
    l.setAttribute('x1', joints[a].getAttribute('cx'));
    l.setAttribute('y1', joints[a].getAttribute('cy'));
    l.setAttribute('x2', joints[b].getAttribute('cx'));
    l.setAttribute('y2', joints[b].getAttribute('cy'));
  }
  if (poly) {
    poly.setAttribute('points', [
      [0,5,9,13,17].map(i=>`${joints[i].getAttribute('cx')},${joints[i].getAttribute('cy')}`).join(' ')
    ]);
  }
  if (trail) {
    const t = pose?.trail || [];
    if (t.length>1) {
      trail.setAttribute('opacity','0.9');
      trail.setAttribute('points', t.map(p=>`${ox+p[0]*s},${oy+p[1]*s}`).join(' '));
    } else {
      trail.setAttribute('opacity','0');
      trail.setAttribute('points','');
    }
  }
}
