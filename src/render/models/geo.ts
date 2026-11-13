import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// A small modelling toolkit. Characters are sculpted in code from lofted cross-sections,
// swept tubes and displaced spheres, then painted with vertex colour (with painterly mottling
// and grime gradients) and merged so each body segment is one draw call.
//
// Conventions: +Z forward, +Y up, +X the character's left. Angles run from the BACK (theta = 0
// at -Z) so texture seams sit behind the figure and u = 0.5 is dead centre front.

export type Col = THREE.ColorRepresentation;
const TAU = Math.PI * 2;

export interface Ring {
  y: number;
  rx: number;
  rz?: number;
  x?: number;
  z?: number;
  /** Superellipse exponent: 2 is an ellipse, higher is boxier. */
  n?: number;
  /** Scale applied to the front (z > 0) or back half of the section. */
  front?: number;
  back?: number;
}
export interface LoftOpts {
  seg?: number;
  /** Partial sweep [from, to] in turns (0 = back, 0.5 = front). Omit for a closed section. */
  arc?: [number, number];
  cap?: 'start' | 'end' | 'both';
  /** Radius multiplier offset by angle (turns) and position along the loft (0..1). */
  ripple?: (turn: number, v: number) => number;
  /** Vertical offset by angle and v: ragged hems, drooping brims. */
  drop?: (turn: number, v: number) => number;
  n?: number;
}

/** Skin a surface through a stack of cross-sections. The workhorse for torsos, limbs, helms, skirts. */
export function loft(rings: Ring[], o: LoftOpts = {}): THREE.BufferGeometry {
  const seg = o.seg ?? 16;
  const closed = !o.arc;
  const [a0, a1] = o.arc ?? [0, 1];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const cols = seg + 1;
  let len = 0;
  const lens = rings.map((r, i) => (i === 0 ? 0 : (len += Math.hypot(r.y - rings[i - 1].y, r.rx - rings[i - 1].rx) + 1e-6)));
  rings.forEach((r, i) => {
    const v = len > 0 ? lens[i] / len : 0;
    for (let j = 0; j <= seg; j++) {
      const turn = a0 + ((a1 - a0) * j) / seg;
      const th = turn * TAU;
      const s = -Math.sin(th), c = -Math.cos(th); // turn 0 is the back (-Z), 0.25 the right (-X), 0.5 the front
      const e = 2 / (r.n ?? o.n ?? 2);
      const px = Math.sign(s) * Math.pow(Math.abs(s), e), pz = Math.sign(c) * Math.pow(Math.abs(c), e);
      const rip = 1 + (o.ripple?.(turn, v) ?? 0);
      pos.push((r.x ?? 0) + r.rx * px * rip, r.y + (o.drop?.(turn, v) ?? 0), (r.z ?? 0) + (r.rz ?? r.rx) * pz * rip * (pz >= 0 ? r.front ?? 1 : r.back ?? 1));
      uv.push(j / seg, 1 - v);
    }
  });
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => (flip ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c));
  // Winding: decide once from the widest ring pair so normals face outward whichever way the rings run.
  let wide = 0;
  for (let i = 1; i < rings.length - 1; i++) if (rings[i].rx > rings[wide].rx) wide = i;
  wide = Math.min(wide, rings.length - 2);
  const P = (i: number, j: number) => new THREE.Vector3(pos[(i * cols + j) * 3], pos[(i * cols + j) * 3 + 1], pos[(i * cols + j) * 3 + 2]);
  const jm = Math.floor(seg / 2);
  const a = P(wide, jm), b = P(wide, jm + 1), c2 = P(wide + 1, jm);
  const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c2, a));
  const out = new THREE.Vector3(a.x - (rings[wide].x ?? 0), 0, a.z - (rings[wide].z ?? 0));
  const flip = nrm.dot(out) < 0;
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) quad(i * cols + j, i * cols + j + 1, (i + 1) * cols + j, (i + 1) * cols + j + 1, flip);
  const capAt = (i: number, towardNext: boolean) => {
    const r = rings[i], centre = pos.length / 3;
    pos.push(r.x ?? 0, r.y, r.z ?? 0); uv.push(0.5, towardNext ? 1 : 0);
    for (let j = 0; j < seg; j++) { const p = i * cols + j, q = p + 1; if (towardNext !== flip) idx.push(centre, q, p); else idx.push(centre, p, q); }
  };
  if (o.cap === 'start' || o.cap === 'both') capAt(0, true);
  if (o.cap === 'end' || o.cap === 'both') capAt(rings.length - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closed) { // weld the seam's normals so the join behind the figure doesn't show
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < rings.length; i++) {
      const p = i * cols, q = p + seg;
      const x = n.getX(p) + n.getX(q), y = n.getY(p) + n.getY(q), z = n.getZ(p) + n.getZ(q), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(p, x / l, y / l, z / l); n.setXYZ(q, x / l, y / l, z / l);
    }
  }
  return g;
}

/** Sweep a round (or flattened) section along a path. Plumes, liripipes, tines, straps, branches. */
export function tube(pts: [number, number, number][], radius: number | ((t: number) => number), seg = 7, flat = 1): THREE.BufferGeometry {
  const P = pts.map((p) => new THREE.Vector3(...p));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let normal = new THREE.Vector3(1, 0, 0);
  const tan = new THREE.Vector3(), bin = new THREE.Vector3();
  const cols = seg + 1;
  P.forEach((p, i) => {
    tan.subVectors(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)]).normalize();
    normal.addScaledVector(tan, -normal.dot(tan));
    if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1).addScaledVector(tan, -tan.z);
    normal.normalize();
    bin.crossVectors(tan, normal);
    const t = i / (P.length - 1), r = typeof radius === 'number' ? radius : radius(t);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU, cx = Math.cos(a) * r, cy = Math.sin(a) * r * flat;
      pos.push(p.x + normal.x * cx + bin.x * cy, p.y + normal.y * cx + bin.y * cy, p.z + normal.z * cx + bin.z * cy);
      uv.push(j / seg, t);
    }
  });
  for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, b, c, b, d, c); }
  for (const [i, end] of [[0, false], [P.length - 1, true]] as const) { // end caps
    const c = pos.length / 3; pos.push(P[i].x, P[i].y, P[i].z); uv.push(0.5, end ? 1 : 0);
    for (let j = 0; j < seg; j++) { const a = i * cols + j; if (end) idx.push(c, a, a + 1); else idx.push(c, a + 1, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A sphere pushed around by a function of direction: heads, bellies, turnips. */
export function sculpt(radius: number, fn: (d: THREE.Vector3, p: THREE.Vector3) => void, w = 26, h = 18): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.rotateY(-Math.PI / 2); // put the UV seam at the back
  const p = g.attributes.position as THREE.BufferAttribute;
  const d = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    v.copy(d).multiplyScalar(radius);
    fn(d, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // weld normals along the seam and at the poles
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let r = 0; r <= h; r++) {
    const a = r * (w + 1), b = a + w;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  for (let j = 0; j <= w; j++) { n.setXYZ(j, 0, 1, 0); n.setXYZ(h * (w + 1) + j, 0, -1, 0); }
  return g;
}
export const gauss = (x: number, y: number, cx: number, cy: number, s: number) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (s * s));
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ primitives

export const ball = (r: number, sx = 1, sy = 1, sz = 1, seg = 10) => { const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))); g.scale(sx, sy, sz); return g; };
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (r0: number, r1: number, h: number, seg = 10, open = false) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, open);
/** A box with rounded corners, standing on the XZ plane centred at the origin. */
export const rbox = (w: number, h: number, d: number, n = 5, seg = 12) => loft([{ y: -h / 2, rx: w / 2, rz: d / 2 }, { y: h / 2, rx: w / 2, rz: d / 2 }], { n, seg, cap: 'both' });

export interface Xf { t?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
/** Scale, then rotate, then translate (in place). Returns the geometry for chaining. */
export function xf<T extends THREE.BufferGeometry>(g: T, o: Xf): T {
  const s = typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s ?? [1, 1, 1];
  _m.compose(new THREE.Vector3(...(o.t ?? [0, 0, 0])), _q.setFromEuler(_e.set(...(o.r ?? [0, 0, 0]))), new THREE.Vector3(...(s as [number, number, number])));
  g.applyMatrix4(_m);
  return g;
}

// ------------------------------------------------------------------ painting

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in 3D, 0..1. Cheap, stable, and good enough for mottling. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  return L(L(L(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), L(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    L(L(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), L(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}

export interface PaintOpts {
  /** Strength of the mottling (0.08 is a good default for cloth). */
  jitter?: number;
  freq?: number;
  /** Vertical gradient: [yLow, yHigh, multiplierAtLow, multiplierAtHigh]. Mud on hems, shade under folds. */
  grad?: [number, number, number, number];
  /** Custom touch-ups per vertex (position and normal are in the geometry's local space). */
  fn?: (p: THREE.Vector3, c: THREE.Color, n: THREE.Vector3) => void;
}
const _c = new THREE.Color(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
/** Give a geometry its vertex colours: a base colour, broken up like brushwork. */
export function paint<T extends THREE.BufferGeometry>(g: T, color: Col, o: PaintOpts = {}): T {
  const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
  const base = new THREE.Color(color as THREE.ColorRepresentation);
  const out = new Float32Array(pos.count * 3);
  const j = o.jitter ?? 0.08, fq = o.freq ?? 22;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i); if (nor) _n.fromBufferAttribute(nor, i);
    _c.copy(base);
    let m = 1 + (noise3(_p.x * fq + 7.3, _p.y * fq + 1.7, _p.z * fq + 4.1) - 0.5) * 2 * j + (noise3(_p.x * fq * 3.1, _p.y * fq * 3.1, _p.z * fq * 3.1) - 0.5) * j;
    if (o.grad) m *= o.grad[2] + (o.grad[3] - o.grad[2]) * smooth(o.grad[0], o.grad[1], _p.y);
    _c.multiplyScalar(Math.max(0, m));
    o.fn?.(_p, _c, _n);
    out[i * 3] = _c.r; out[i * 3 + 1] = _c.g; out[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Merge painted parts into one geometry (one draw call). */
export function merge(parts: (THREE.BufferGeometry | null | undefined | false)[]): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (!p.attributes.color) paint(p, 0xff00ff);
    if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
    if (!p.attributes.normal) p.computeVertexNormals();
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    list.push(g);
  }
  if (!list.length) return new THREE.BufferGeometry();
  return mergeGeometries(list, false)!;
}

/** Mirror a merged (non-indexed) geometry across X, fixing winding and normals. Left limb from right. */
export function mirrorX(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = (src.index ? src.toNonIndexed() : src.clone());
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute, n = a.itemSize, arr = a.array as Float32Array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < n; k++) { const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k, tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp; }
      if (name === 'position' || name === 'normal') for (let v = 0; v < 3; v++) arr[(t + v) * n] *= -1;
    }
  }
  return g;
}

/** Small domed rivets at the given points, facing outward from the Y axis. */
export function rivets(points: [number, number, number][], r = 0.006): THREE.BufferGeometry[] {
  return points.map(([x, y, z]) => xf(ball(r, 1, 1, 1, 6), { t: [x, y, z] }));
}
/** Points spaced around an ellipse at height y (turn 0 = back). */
export function around(count: number, rx: number, rz: number, y: number, from = 0, to = 1): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) { const a = (from + ((to - from) * (i + (to - from >= 1 ? 0 : 0.5))) / count) * TAU; out.push([-Math.sin(a) * rx, y, -Math.cos(a) * rz]); }
  return out;
}

/** Deterministic random for model variants. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
