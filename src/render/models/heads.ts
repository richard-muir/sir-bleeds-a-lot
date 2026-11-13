import * as THREE from 'three';
import { ball, box, gauss, loft, merge, noise3, paint, rng, sculpt, smooth, tube, xf, type Col } from './geo';

// Heads after Bruegel: heavy jaws, bulbous noses, small suspicious eyes, bad teeth.
// A head is sculpted from a displaced sphere, then given features, hair and something to wear.
// Head space: origin at the base of the neck, skull centre at CY, +Z is the face.

const R = 0.112, CY = 0.137, CZ = 0.012;

export interface HeadParams {
  skin: number; jaw: number; chin: number; brow: number; cheek: number; gaunt: number;
  nose: 'bulb' | 'hook' | 'long' | 'pug'; noseSize: number; ears: number;
  browTilt: number; hairCol: number;
  mouth: 'grim' | 'gap' | 'frown' | 'sneer'; teeth: number;
  stubble: number; ruddy: number; wart: boolean; eyepatch: boolean;
  hair: 'none' | 'mop' | 'fringe' | 'crop';
  beard: 'none' | 'full' | 'chin' | 'tash';
  hat: 'none' | 'straw' | 'hood' | 'coif' | 'wimple' | 'cap' | 'kettle' | 'mailcoif';
  hatCol: number;
  female: boolean;
}
export interface HeadGeo { matte: THREE.BufferGeometry; metal?: THREE.BufferGeometry; mail?: THREE.BufferGeometry; mantle?: number }

const SKINS = [0xc9a184, 0xb98d6f, 0xd4b196, 0xa9805f, 0xc49a86];
const HAIRS = [0x2a2018, 0x4a3a28, 0x6b4a2a, 0x77705f, 0x8a8478, 0x3a2a20, 0x7a3a1c];
const CLOTHS = [0x5d5038, 0x4b4a3a, 0x6a5a45, 0x44503e, 0x5a4a50, 0x3f4a52, 0x6b3a2e, 0x7a6a48];
const LINEN = 0xb8ad94;

export function randomHead(seed: number, look: string): HeadParams {
  const r = rng(seed * 7919 + 13), pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const female = look === 'mob' && r() < 0.3;
  const p: HeadParams = {
    skin: pick(SKINS), jaw: 0.66 + r() * 0.34, chin: r() * 1.1, brow: 0.5 + r() * 0.9, cheek: 0.2 + r() * 0.9, gaunt: r() < 0.35 ? 0.5 + r() * 0.5 : 0,
    nose: pick(['bulb', 'bulb', 'hook', 'long', 'pug'] as const), noseSize: 0.85 + r() * 0.75, ears: 0.8 + r() * 0.7,
    browTilt: (r() - 0.35) * 0.014, hairCol: pick(HAIRS),
    mouth: pick(['grim', 'gap', 'frown', 'sneer', 'gap'] as const), teeth: 1 + Math.floor(r() * 3),
    stubble: female ? 0 : r() * 0.8, ruddy: 0.3 + r() * 0.7, wart: r() < 0.25, eyepatch: !female && r() < 0.07,
    hair: female ? 'none' : pick(['mop', 'fringe', 'crop', 'mop', 'none'] as const),
    beard: female ? 'none' : pick(['none', 'none', 'full', 'chin', 'tash'] as const),
    hat: female ? pick(['wimple', 'wimple', 'coif'] as const) : pick(['none', 'none', 'straw', 'hood', 'coif', 'cap'] as const),
    hatCol: pick(CLOTHS), female,
  };
  if (female) { p.jaw = Math.min(p.jaw, 0.8); p.brow *= 0.5; p.chin *= 0.6; }
  if (look === 'farmhand') { p.hat = r() < 0.75 ? 'straw' : 'coif'; p.ruddy = 0.8 + r() * 0.2; }
  if (look === 'woodcutter') { p.hat = r() < 0.7 ? 'hood' : 'cap'; p.beard = r() < 0.8 ? 'full' : 'chin'; p.jaw = 0.9 + r() * 0.1; p.brow = 1.1 + r() * 0.4; p.browTilt = -0.008; p.hatCol = pick([0x2e2a22, 0x3a3226, 0x33382c, 0x4a2a22]); }
  if (look === 'foreman') { p.hat = 'kettle'; p.beard = 'full'; p.jaw = 1; p.brow = 1.5; p.browTilt = -0.011; p.nose = 'hook'; p.noseSize = 1.4; p.hairCol = 0x2a2018; p.mouth = 'grim'; p.eyepatch = true; p.hair = 'crop'; }
  if (p.hat === 'straw' || p.hat === 'cap') p.hair = p.hair === 'none' ? 'fringe' : p.hair;
  return p;
}
/** Sir Bleedsalot's own face, for when the helm comes off: lean, moustached, unimpressed. */
export const KNIGHT_FACE: HeadParams = {
  skin: 0xc49a86, jaw: 0.86, chin: 0.7, brow: 1.0, cheek: 0.7, gaunt: 0.5, nose: 'long', noseSize: 1.05, ears: 0.9, browTilt: -0.006, hairCol: 0x4a3a28,
  mouth: 'grim', teeth: 0, stubble: 0.5, ruddy: 0.35, wart: false, eyepatch: false, hair: 'none', beard: 'tash', hat: 'mailcoif', hatCol: 0, female: false,
};

const P3 = (x: number, y: number, z: number): [number, number, number] => [x, CY + y, CZ + z];

function skull(p: HeadParams): THREE.BufferGeometry {
  const g = sculpt(R, (d, v) => {
    let x = d.x * 0.84, y = d.y, z = d.z * (d.z < 0 ? 0.98 : 0.93);
    const front = smooth(0.15, 0.8, d.z);
    const jawT = smooth(0.05, -0.8, d.y);
    x *= 1 - jawT * (1 - p.jaw) * (0.55 + 0.45 * front);
    // the back of the skull tucks into the neck
    const tuck = smooth(-0.1, -0.85, d.y) * smooth(0.25, -0.5, d.z);
    x *= 1 - 0.3 * tuck; z *= 1 - 0.35 * tuck; y *= 1 - 0.1 * tuck;
    z += gauss(d.x, d.y, 0, -0.8, 0.3) * front * (0.05 + p.chin * 0.14);
    y -= gauss(d.x, d.y, 0, -0.95, 0.4) * front * p.chin * 0.08;
    z += gauss(d.x, d.y, 0, -0.4, 0.32) * front * 0.07; // muzzle
    z += Math.exp(-(((d.y - 0.21) / 0.085) ** 2)) * smooth(0.6, 0.15, Math.abs(d.x)) * front * p.brow * 0.075;
    z -= (gauss(d.x, d.y, 0.33, 0.07, 0.15) + gauss(d.x, d.y, -0.33, 0.07, 0.15)) * front * 0.1;
    const ck = gauss(d.x, d.y, 0.5, -0.16, 0.2) + gauss(d.x, d.y, -0.5, -0.16, 0.2);
    x += Math.sign(d.x) * ck * p.cheek * 0.06; z += ck * p.cheek * 0.05 * front;
    const hollow = gauss(d.x, d.y, 0.48, -0.46, 0.2) + gauss(d.x, d.y, -0.48, -0.46, 0.2);
    x -= Math.sign(d.x) * hollow * p.gaunt * 0.07; z -= hollow * p.gaunt * 0.04;
    v.set(x * R, y * R, z * R);
  }, 30, 22);
  g.translate(0, CY, CZ);
  const skin = new THREE.Color(p.skin), red = new THREE.Color(0xa8483c), shade = new THREE.Color(0x4a4038);
  return paint(g, p.skin, { jitter: 0.05, freq: 40, fn: (v, c) => {
    const lx = v.x, ly = v.y - CY, lz = v.z - CZ;
    if (lz > 0) {
      c.lerp(red, (gauss(lx, ly, 0.05, -0.02, 0.028) + gauss(lx, ly, -0.05, -0.02, 0.028)) * 0.42 * p.ruddy);
      c.multiplyScalar(1 - (gauss(lx, ly, 0.035, 0.01, 0.02) + gauss(lx, ly, -0.035, 0.01, 0.02)) * 0.4); // sockets
      c.lerp(shade, smooth(-0.015, -0.06, ly) * smooth(0, 0.05, lz) * p.stubble * 0.5);
    }
    c.multiplyScalar(0.72 + 0.28 * smooth(-0.11, -0.04, ly)); // under the jaw
    void skin;
  } });
}

function nose(p: HeadParams): THREE.BufferGeometry[] {
  const s = p.noseSize, col = new THREE.Color(p.skin).lerp(new THREE.Color(0xa8483c), 0.25 + p.ruddy * 0.3);
  const tipY = p.nose === 'pug' ? -0.022 : p.nose === 'long' ? -0.042 : p.nose === 'hook' ? -0.04 : -0.032;
  const tipZ = 0.1 + (p.nose === 'pug' ? 0.012 : p.nose === 'long' ? 0.03 : 0.022) * s;
  const midZ = p.nose === 'hook' ? tipZ + 0.006 : 0.098 + (tipZ - 0.1) * 0.55;
  const bridge = tube([P3(0, 0.022, 0.09), P3(0, 0.003, 0.097), P3(0, tipY * 0.5, midZ), P3(0, tipY, tipZ)], (t) => 0.008 + t * 0.006 * s, 7, 1.15);
  const bulbR = (p.nose === 'bulb' ? 0.02 : p.nose === 'pug' ? 0.017 : 0.014) * s;
  const out = [paint(bridge, col, { jitter: 0.05 }), paint(xf(ball(bulbR, 1.05, 0.9, 1), { t: P3(0, tipY - 0.002, tipZ) }), col, { jitter: 0.06 })];
  for (const sx of [-1, 1]) out.push(paint(xf(ball(bulbR * 0.62), { t: P3(sx * bulbR * 0.85, tipY - 0.004, tipZ - bulbR * 0.55) }), col, { jitter: 0.05 }));
  return out;
}

function features(p: HeadParams): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [...nose(p)];
  const skin = new THREE.Color(p.skin), dark = 0x1a0d0b, lid = skin.clone().multiplyScalar(0.8);
  for (const sx of [-1, 1]) {
    const patched = p.eyepatch && sx === 1;
    if (patched) {
      out.push(paint(xf(ball(0.022, 1, 1.05, 0.35), { t: P3(0.036, 0.01, 0.088), r: [0, 0.35, 0] }), 0x15110d, { jitter: 0.04 }));
    } else {
      out.push(paint(xf(ball(0.0125), { t: P3(sx * 0.036, 0.008, 0.079) }), 0xd9d2c2, { jitter: 0.02 }));
      out.push(paint(xf(ball(0.0062), { t: P3(sx * 0.0355, 0.0075, 0.0885) }), 0x120b08, { jitter: 0 }));
      // heavy upper lid and a bag underneath: nobody here has slept well
      out.push(paint(xf(ball(0.0145, 1.1, 0.5, 0.9), { t: P3(sx * 0.036, 0.0155, 0.08), r: [0.35, 0, sx * -0.12] }), lid, { jitter: 0.03 }));
      out.push(paint(xf(ball(0.013, 1.1, 0.4, 0.8), { t: P3(sx * 0.037, -0.004, 0.081) }), lid.clone().multiplyScalar(0.94), { jitter: 0.03 }));
    }
    // brows
    out.push(paint(tube([P3(sx * 0.011, 0.026 + p.browTilt, 0.099), P3(sx * 0.034, 0.031, 0.097), P3(sx * 0.058, 0.026 - p.browTilt, 0.082)], (t) => 0.0052 * (0.7 + p.brow * 0.35) * (1 - t * 0.35), 6, 0.8), p.hairCol, { jitter: 0.12, freq: 90 }));
    // ears
    out.push(paint(xf(ball(0.024 * p.ears, 0.42, 1, 0.72), { t: P3(sx * 0.091, 0.0, -0.004), r: [0, sx * -0.5, sx * -0.12] }), skin.clone().lerp(new THREE.Color(0xa8483c), 0.18), { jitter: 0.05 }));
  }
  if (p.eyepatch) out.push(paint(tube([P3(0.09, 0.03, 0.0), P3(0.07, 0.035, 0.07), P3(0.036, 0.025, 0.099), P3(-0.02, 0.05, 0.1), P3(-0.07, 0.07, 0.06), P3(-0.085, 0.07, 0)], 0.003, 5), 0x15110d));
  // mouth
  const my = -0.056, mz = 0.091;
  if (p.mouth === 'gap') {
    out.push(paint(xf(ball(0.021, 1.15, 0.6, 0.5), { t: P3(0, my, mz) }), dark, { jitter: 0 }));
    for (let i = 0; i < p.teeth; i++) { const tx = [-0.008, 0.007, 0.0][i] + (i === 2 ? -0.016 : 0); out.push(paint(xf(box(0.0075, 0.011, 0.005), { t: P3(tx, my + (i === 1 ? -0.006 : 0.006), mz + 0.0085), r: [0, 0, (i - 1) * 0.15] }), 0xcfc29a, { jitter: 0.06 })); }
    out.push(paint(xf(ball(0.02, 1.2, 0.38, 0.6), { t: P3(0, my - 0.015, mz + 0.002) }), skin.clone().lerp(new THREE.Color(0x8a4038), 0.35), { jitter: 0.04 }));
  } else {
    const dy = p.mouth === 'frown' ? -0.008 : p.mouth === 'sneer' ? 0.002 : -0.003;
    const pts: [number, number, number][] = [P3(-0.03, my + dy, mz - 0.006), P3(-0.012, my, mz + 0.006), P3(0.012, my + (p.mouth === 'sneer' ? 0.004 : 0), mz + 0.006), P3(0.03, my + (p.mouth === 'sneer' ? 0.012 : dy), mz - 0.006)];
    out.push(paint(tube(pts, 0.0032, 5), 0x2a1412, { jitter: 0 }));
    out.push(paint(xf(ball(0.019, 1.2, 0.36, 0.6), { t: P3(0, my - 0.011, mz + 0.002) }), skin.clone().lerp(new THREE.Color(0x8a4038), 0.3), { jitter: 0.04 }));
  }
  if (p.wart) out.push(paint(xf(ball(0.006), { t: P3(0.045, -0.035, 0.082) }), skin.clone().multiplyScalar(0.75)));
  return out;
}

const hairPaint = (c: Col) => ({ jitter: 0.16, freq: 70 });
function hair(p: HeadParams): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const rag = (g: THREE.BufferGeometry, amt = 0.012) => { const a = g.attributes.position as THREE.BufferAttribute; for (let i = 0; i < a.count; i++) { const n = noise3(a.getX(i) * 60, a.getY(i) * 60, a.getZ(i) * 60) - 0.5; a.setXYZ(i, a.getX(i) * (1 + n * 0.1), a.getY(i) + n * amt, a.getZ(i) * (1 + n * 0.1)); } g.computeVertexNormals(); return g; };
  if (p.hair === 'mop' || p.hair === 'crop') {
    const big = p.hair === 'mop' ? 1.1 : 1.045;
    const g = new THREE.SphereGeometry(R * big, 20, 12, 0, Math.PI * 2, 0, Math.PI * (p.hair === 'mop' ? 0.56 : 0.46));
    g.scale(0.88, 1.04, 0.99); g.rotateX(-0.42); g.translate(0, CY + 0.004, CZ - 0.004);
    out.push(paint(rag(g, p.hair === 'mop' ? 0.02 : 0.006), p.hairCol, hairPaint(p.hairCol)));
  } else if (p.hair === 'fringe') {
    const g = new THREE.SphereGeometry(R * 1.07, 18, 8, Math.PI * 0.82, Math.PI * 1.36, Math.PI * 0.3, Math.PI * 0.36);
    g.scale(0.9, 1, 0.98); g.translate(0, CY, CZ - 0.004);
    out.push(paint(rag(g, 0.014), p.hairCol, hairPaint(p.hairCol)));
  }
  if (p.beard === 'full' || p.beard === 'chin') {
    const full = p.beard === 'full';
    const g = sculpt(0.058, (d, v) => {
      const n = noise3(d.x * 5 + 3, d.y * 5, d.z * 5) - 0.5;
      v.set(d.x * (full ? 1.2 : 0.62), d.y * (d.y < 0 ? (full ? 1.45 : 1.25) : 0.75), d.z * 0.8).multiplyScalar(0.058 * (1 + n * 0.35));
      if (d.y < -0.3) v.z += 0.008;
    }, 16, 12);
    g.translate(0, CY - 0.088, CZ + 0.05);
    out.push(paint(g, p.hairCol, { jitter: 0.2, freq: 60, grad: [CY - 0.17, CY - 0.07, 0.75, 1.05] }));
  }
  if (p.beard === 'tash' || p.beard === 'full') {
    for (const sx of [-1, 1]) out.push(paint(tube([P3(sx * 0.003, -0.043, 0.103), P3(sx * 0.022, -0.047, 0.097), P3(sx * 0.04, -0.064, 0.082)], (t) => 0.0075 * (1 - t * 0.6), 6), p.hairCol, { jitter: 0.16, freq: 70 }));
  }
  return out;
}

/** A cloth shell around the head with the face left open: hoods, coifs, wimples, mail coifs. */
function wrap(scale: number, win: { y0: number; y1: number; w: number }, col: Col, lengthen = 1, jitter = 0.1): THREE.BufferGeometry {
  const g = sculpt(R * scale, (d, v) => {
    // push the face window inside the skull so the cloth appears to fold in around the face
    const w = smooth(win.w + 0.12, win.w - 0.05, Math.abs(d.x)) * smooth(win.y0 - 0.1, win.y0 + 0.05, d.y) * smooth(win.y1 + 0.1, win.y1 - 0.05, d.y) * smooth(0.25, 0.6, d.z);
    const k = 1 - w * 0.32;
    v.set(d.x * 0.88 * k, d.y * (d.y < 0 ? lengthen : 1.03), d.z * 0.99 * k).multiplyScalar(R * scale);
  }, 26, 18);
  g.translate(0, CY, CZ - 0.002);
  return paint(g, col, { jitter, freq: 30 });
}

function hat(p: HeadParams): { matte: THREE.BufferGeometry[]; metal: THREE.BufferGeometry[]; mail: THREE.BufferGeometry[]; mantle?: number } {
  const matte: THREE.BufferGeometry[] = [], metal: THREE.BufferGeometry[] = [], mail: THREE.BufferGeometry[] = [];
  let mantle: number | undefined;
  const c = p.hatCol;
  switch (p.hat) {
    case 'straw': {
      const straw = 0xa8904f;
      const wav = (t: number) => (noise3(t * 9, 1, 3) - 0.5) * 0.035 + Math.sin(t * 6.283 * 2) * 0.012;
      const brim = loft([{ y: 0.004, rx: 0.088, rz: 0.098 }, { y: -0.006, rx: 0.215, rz: 0.225 }, { y: -0.013, rx: 0.217, rz: 0.227 }, { y: -0.006, rx: 0.088, rz: 0.098 }], { seg: 22, drop: (t, v) => (v > 0.2 && v < 0.8 ? wav(t) : 0), ripple: (t) => (noise3(t * 14, 5, 2) - 0.5) * 0.12 });
      const crown = loft([{ y: 0, rx: 0.09, rz: 0.1 }, { y: 0.05, rx: 0.085, rz: 0.094 }, { y: 0.085, rx: 0.066, rz: 0.072 }, { y: 0.097, rx: 0.02, rz: 0.022 }], { seg: 16, cap: 'end' });
      const band = loft([{ y: 0.006, rx: 0.092, rz: 0.102 }, { y: 0.022, rx: 0.09, rz: 0.1 }], { seg: 16 });
      for (const [g, col] of [[brim, straw], [crown, straw], [band, c]] as const) matte.push(paint(xf(g, { t: [0, CY + 0.07, CZ - 0.004], r: [-0.14, 0, 0.05] }), col, { jitter: col === straw ? 0.2 : 0.08, freq: 80 }));
      break;
    }
    case 'hood': {
      matte.push(wrap(1.16, { y0: -0.62, y1: 0.36, w: 0.5 }, c, 1.12));
      matte.push(paint(tube([P3(0, 0.1, -0.1), P3(0, 0.12, -0.15), P3(0.01, 0.05, -0.185), P3(0.02, -0.08, -0.17), P3(0.03, -0.2, -0.15)], (t) => 0.03 * (1 - t * 0.75), 7, 0.8), c, { jitter: 0.1 }));
      matte.push(paint(loft([{ y: 0.05, rx: 0.1, rz: 0.1 }, { y: 0, rx: 0.13, rz: 0.115 }, { y: -0.03, rx: 0.15, rz: 0.12 }], { seg: 16 }), c, { jitter: 0.1 }));
      mantle = c;
      break;
    }
    case 'coif':
      matte.push(wrap(1.07, { y0: -0.55, y1: 0.3, w: 0.52 }, LINEN, 1.0, 0.06));
      matte.push(paint(tube([P3(-0.07, -0.07, 0.04), P3(-0.03, -0.115, 0.06), P3(0, -0.125, 0.065), P3(0.03, -0.115, 0.06), P3(0.07, -0.07, 0.04)], 0.004, 5), LINEN));
      break;
    case 'wimple': {
      matte.push(wrap(1.1, { y0: -0.5, y1: 0.28, w: 0.46 }, LINEN, 1.25, 0.06));
      const veil = loft([{ y: 0.26, rx: 0.06, rz: 0.07 }, { y: 0.2, rx: 0.115, rz: 0.125 }, { y: 0.1, rx: 0.13, rz: 0.135 }, { y: 0, rx: 0.15, rz: 0.13 }, { y: -0.09, rx: 0.19, rz: 0.14 }], { seg: 16, arc: [-0.3, 0.3], ripple: (t, v) => Math.sin(t * 6.283 * 9) * 0.03 * v, drop: (t, v) => (v > 0.9 ? (noise3(t * 20, 2, 2) - 0.5) * 0.03 : 0) });
      matte.push(paint(xf(veil, { t: [0, 0, -0.012] }), c === LINEN ? 0x8a8068 : c, { jitter: 0.08 }));
      matte.push(paint(loft([{ y: 0.06, rx: 0.075, rz: 0.08 }, { y: -0.02, rx: 0.12, rz: 0.1 }], { seg: 14 }), LINEN, { jitter: 0.06 }));
      break;
    }
    case 'cap': {
      const g = new THREE.SphereGeometry(R * 1.08, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
      g.scale(0.9, 1.25, 1); g.rotateX(-0.3); g.translate(0, CY + 0.012, CZ - 0.006);
      matte.push(paint(g, c, { jitter: 0.1 }));
      matte.push(paint(xf(new THREE.TorusGeometry(R * 0.93, 0.014, 6, 18), { r: [Math.PI / 2 - 0.3, 0, 0], s: [0.93, 1, 1], t: [0, CY + 0.052, CZ - 0.02] }), new THREE.Color(c).multiplyScalar(0.8), { jitter: 0.1 }));
      break;
    }
    case 'kettle': {
      const iron = 0x5c6068;
      metal.push(paint(loft([{ y: 0.035, rx: 0.2, rz: 0.21 }, { y: 0.05, rx: 0.118, rz: 0.128 }, { y: 0.1, rx: 0.112, rz: 0.122 }, { y: 0.145, rx: 0.08, rz: 0.088 }, { y: 0.16, rx: 0.02, rz: 0.022 }], { seg: 20, cap: 'end' }), iron, { jitter: 0.14, freq: 30 }));
      metal.push(paint(loft([{ y: 0.035, rx: 0.2, rz: 0.21 }, { y: 0.046, rx: 0.112, rz: 0.122 }], { seg: 20 }), 0x3a3c40, { jitter: 0.1 }));
      for (const a of [0, 0.25, 0.5, 0.75]) metal.push(paint(xf(box(0.012, 0.11, 0.004), { t: [-Math.sin(a * 6.283) * 0.105, 0.105, -Math.cos(a * 6.283) * 0.114], r: [0, -a * 6.283, 0] }), 0x45484e));
      for (const g of metal) g.translate(0, CY + 0.012, CZ - 0.004);
      matte.push(wrap(1.06, { y0: -0.55, y1: 0.3, w: 0.52 }, 0x4a4234, 1.0, 0.08)); // arming cap
      break;
    }
    case 'mailcoif': {
      const g = wrap(1.09, { y0: -0.58, y1: 0.3, w: 0.5 }, 0x7c818a, 1.1, 0.1);
      mail.push(g);
      mail.push(paint(loft([{ y: 0.05, rx: 0.095, rz: 0.1 }, { y: 0, rx: 0.12, rz: 0.11 }], { seg: 14 }), 0x7c818a, { jitter: 0.1 }));
      break;
    }
  }
  return { matte, metal, mail, mantle };
}

const headCache = new Map<string, HeadGeo>();
/** Build (or fetch) a complete head: skull, face, hair, headwear, neck. */
export function buildHead(p: HeadParams, key?: string): HeadGeo {
  const hit = key ? headCache.get(key) : undefined;
  if (hit) return hit;
  const h = hat(p);
  const covered = p.hat === 'hood' || p.hat === 'coif' || p.hat === 'wimple' || p.hat === 'kettle' || p.hat === 'mailcoif';
  const neck = paint(loft([{ y: 0.075, rx: 0.05, rz: 0.055, z: 0.004 }, { y: 0.03, rx: 0.047, rz: 0.05 }, { y: -0.02, rx: 0.052, rz: 0.054 }], { seg: 12, cap: 'end' }), p.skin, { jitter: 0.05, grad: [-0.02, 0.07, 1, 0.75] });
  const out: HeadGeo = {
    matte: merge([skull(p), ...features(p), ...(covered ? hair({ ...p, hair: 'none' }) : hair(p)), neck, ...h.matte]),
    metal: h.metal.length ? merge(h.metal) : undefined,
    mail: h.mail.length ? merge(h.mail) : undefined,
    mantle: h.mantle,
  };
  if (key) headCache.set(key, out);
  return out;
}
