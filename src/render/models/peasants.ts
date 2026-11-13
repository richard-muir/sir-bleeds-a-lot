import * as THREE from 'three';
import { ball, box, cyl, loft, merge, mirrorX, noise3, paint, rng, smooth, tube, xf, type Ring } from './geo';
import { buildHead, randomHead } from './heads';
import type { Kind } from './materials';

// Peasant bodies: sculpted segments on the shared skeleton, dressed in tunics, hose, aprons
// and whatever else was to hand. Each segment is one merged, painted mesh.
//
// Segment spaces (all hang down -Y from their joint):
//   chest  origin at the shoulder line; the ribcage runs down to about -0.34
//   hips   origin at the hip joints; belly above, skirt below
//   upper / fore / hand, thigh / shin: origin at the joint above

export type Seg = 'hips' | 'chest' | 'head' | 'upperL' | 'upperR' | 'foreL' | 'foreR' | 'handL' | 'handR' | 'thighL' | 'thighR' | 'shinL' | 'shinR' | 'footL' | 'footR' | 'skirtL' | 'skirtR';
export interface Part {
  seg: Seg; kind: Kind; geo: THREE.BufferGeometry;
  /** Armour piece id: the mesh is removed when that piece breaks. */
  piece?: string;
  /** Hidden along with another piece (the surcoat goes when the hauberk does). */
  hideWith?: string;
  /** Hidden until that piece breaks (the face under the helm). */
  showWhenBroken?: string;
  decal?: THREE.Material;
}
export const LEN = { upper: 0.3, fore: 0.28, thigh: 0.45, shin: 0.48 };

const mud = (lo: number, hi: number): [number, number, number, number] => [lo, hi, 0.55, 1];

// ------------------------------------------------------------------ shared anatomy

/** A closed fist, gripping along Z. Used bare for peasants and under mail for the knight. */
export function fist(col: THREE.ColorRepresentation, scale = 1): THREE.BufferGeometry[] {
  const c = new THREE.Color(col);
  const palm = paint(xf(loft([{ y: 0.012, rx: 0.03, rz: 0.03 }, { y: -0.02, rx: 0.04, rz: 0.043 }, { y: -0.06, rx: 0.04, rz: 0.045 }, { y: -0.083, rx: 0.028, rz: 0.035 }], { seg: 10, n: 3, cap: 'both' }), { s: scale }), c, { jitter: 0.06 });
  const knuckles = [-0.03, -0.01, 0.01, 0.03].map((z, i) => paint(xf(ball(0.0125, 1, 1.25, 1, 6), { t: [-0.034 * scale, (-0.05 - (i === 3 ? 0.004 : 0)) * scale, z * scale], s: scale }), c.clone().multiplyScalar(0.92), { jitter: 0.05 }));
  const thumb = paint(xf(tube([[0.01, -0.02, 0.042], [-0.01, -0.035, 0.052], [-0.03, -0.045, 0.042]], 0.012, 6), { s: scale }), c, { jitter: 0.05 });
  const wrist = paint(xf(ball(0.034, 1, 1, 1, 8), { s: scale }), c.clone().multiplyScalar(0.95), { jitter: 0.05 });
  return [palm, ...knuckles, thumb, wrist];
}

/** A turnshoe or boot foot, built along Z and set on the ground at the bottom of the shin. */
export function foot(col: THREE.ColorRepresentation, pointed = 0, bulk = 1): THREE.BufferGeometry {
  const g = loft([{ y: -0.078, rx: 0.012, rz: 0.014 }, { y: -0.07, rx: 0.034, rz: 0.036 }, { y: -0.02, rx: 0.044, rz: 0.046 }, { y: 0.06, rx: 0.05, rz: 0.04 }, { y: 0.13, rx: 0.046, rz: 0.03 }, { y: 0.17 + pointed, rx: 0.026, rz: 0.02 }, { y: 0.19 + pointed * 1.6, rx: 0.004, rz: 0.004 }], { seg: 10, cap: 'both' });
  // +Y of the loft becomes +Z; its front half becomes the sole, so flatten that.
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) * 0.45);
  xf(g, { r: [Math.PI / 2, 0, 0] }); g.computeVertexNormals();
  xf(g, { s: [bulk, bulk, 1], t: [0, -LEN.shin + 0.024 * bulk, 0.012] });
  return paint(g, col, { jitter: 0.12, grad: [-LEN.shin, -LEN.shin + 0.07, 0.5, 1] });
}

const limb = (rings: Ring[], seg = 10) => loft(rings, { seg, cap: 'both' });
export const SHAPES = {
  upper: (k = 1): Ring[] => [{ y: 0.02, rx: 0.05 * k }, { y: -0.03, rx: 0.064 * k, rz: 0.068 * k }, { y: -0.13, rx: 0.058 * k, rz: 0.064 * k, front: 1.1 }, { y: -0.24, rx: 0.05 * k }, { y: -0.31, rx: 0.046 * k }],
  fore: (k = 1): Ring[] => [{ y: 0.03, rx: 0.044 * k }, { y: -0.03, rx: 0.052 * k, rz: 0.05 * k }, { y: -0.1, rx: 0.05 * k, rz: 0.046 * k }, { y: -0.22, rx: 0.036 * k, rz: 0.032 * k }, { y: -0.285, rx: 0.031 * k, rz: 0.027 * k }],
  thigh: (k = 1): Ring[] => [{ y: 0.05, rx: 0.07 * k }, { y: -0.03, rx: 0.092 * k, rz: 0.098 * k }, { y: -0.2, rx: 0.082 * k, rz: 0.088 * k, front: 1.08 }, { y: -0.38, rx: 0.062 * k }, { y: -0.47, rx: 0.056 * k }],
  shin: (k = 1): Ring[] => [{ y: 0.04, rx: 0.05 * k }, { y: -0.02, rx: 0.06 * k }, { y: -0.14, rx: 0.058 * k, rz: 0.062 * k, back: 1.28 }, { y: -0.3, rx: 0.042 * k, back: 1.1 }, { y: -0.41, rx: 0.036 * k }, { y: -0.45, rx: 0.04 * k }],
};
export function shoulder(col: THREE.ColorRepresentation, r = 0.072): THREE.BufferGeometry { return paint(xf(ball(r, 1.05, 0.95, 1.05, 10), { t: [0, -0.012, 0] }), col); }

/** Raw meat and a nub of bone: what is left at the joint when a limb goes. */
export function stump(r: number): THREE.BufferGeometry {
  return merge([
    paint(xf(ball(r, 1, 0.45, 1, 10), {}), 0x6a1010, { jitter: 0.25, freq: 90 }),
    paint(xf(ball(r * 0.72, 1, 0.5, 1, 8), { t: [0, -r * 0.12, 0] }), 0x8c1a16, { jitter: 0.3, freq: 120 }),
    paint(xf(cyl(r * 0.3, r * 0.34, r * 0.7, 7), { t: [0, -r * 0.3, 0] }), 0xd8cfb8, { jitter: 0.08 }),
  ]);
}

/** Hollow shell half (one side of a split skirt), with an inner face so it reads as cloth, not paper. */
export function skirtHalf(rings: Ring[], side: 1 | -1, o: { folds?: number; foldAmp?: number; ragged?: number; seg?: number } = {}): THREE.BufferGeometry {
  const arc: [number, number] = side > 0 ? [0.5, 1] : [0, 0.5];
  const opts = (shrink: number) => ({
    seg: o.seg ?? 10, arc,
    ripple: (t: number, v: number) => Math.sin(t * Math.PI * 2 * (o.folds ?? 8) + side) * (o.foldAmp ?? 0.05) * v * v - shrink,
    drop: (t: number, v: number) => (v > 0.95 ? (noise3(t * 30 + side * 9, 1, 7) - 0.5) * (o.ragged ?? 0.03) : 0),
  });
  const outer = loft(rings, opts(0));
  const inner = loft(rings, opts(0.04));
  inner.index!.array.reverse(); inner.computeVertexNormals();
  // merge needs colours; these are placeholders, the caller paints the merged shell
  return merge([paint(outer, 0xffffff), paint(inner, 0xffffff)]);
}

// ------------------------------------------------------------------ peasants

interface Body {
  fat: number; bulk: number; female: boolean;
  tunic: number; hose: number; shoes: number | null; belt: number;
  sleeves: 'long' | 'rolled' | 'none'; skirt: number; apron: number | null; wraps: boolean;
  jerkin: number | null; mailShirt: boolean; skin: number; mantle?: number; tallBoots: boolean; patch: number;
}
const TUNICS = [0x6a5a3c, 0x55523e, 0x7a6748, 0x4c5a44, 0x66505a, 0x47545c, 0x7a4a36, 0x8a7a52, 0x5c4a38, 0x6e6a58];
const HOSE = [0x3c352c, 0x4a4234, 0x33332f, 0x5a4a3a, 0x3a4038, 0x54382e];

function randomBody(seed: number, look: string, female: boolean, skin: number): Body {
  const r = rng(seed * 104729 + 71), pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const b: Body = {
    fat: 0.85 + r() * r() * 0.9, bulk: 0.92 + r() * 0.16, female, tunic: pick(TUNICS), hose: pick(HOSE), shoes: r() < 0.82 ? pick([0x2a2018, 0x3a2a1c, 0x1e1a16]) : null, belt: pick([0x2a1c14, 0x3a2a1c, 0x6a5a3c]),
    sleeves: pick(['long', 'long', 'rolled'] as const), skirt: female ? 0.72 + r() * 0.1 : 0.3 + r() * 0.14, apron: female ? (r() < 0.75 ? pick([0xa89c82, 0x8a8068, 0x9a8a6a]) : null) : r() < 0.15 ? 0x5a4a38 : null,
    wraps: !female && r() < 0.45, jerkin: null, mailShirt: false, skin, tallBoots: false, patch: pick(TUNICS),
  };
  if (look === 'farmhand') { b.tunic = pick([0x9a8c6a, 0x8a7c5c, 0xa39672, 0x7c7458]); b.sleeves = r() < 0.5 ? 'none' : 'rolled'; b.bulk = 1.02 + r() * 0.1; b.wraps = r() < 0.5; b.fat = 0.85 + r() * 0.3; b.belt = 0x7a6a48; }
  if (look === 'woodcutter') { b.bulk = 1.16; b.fat = 1.05 + r() * 0.35; b.tunic = pick([0x5a4632, 0x4a4a38, 0x5c3a2c]); b.jerkin = pick([0x3a2a1c, 0x2e241a, 0x44301e]); b.sleeves = 'rolled'; b.tallBoots = true; b.shoes = 0x241a12; b.skirt = 0.36; }
  if (look === 'foreman') { b.bulk = 1.2; b.fat = 1.45; b.tunic = 0x4a2a22; b.jerkin = 0x2e241a; b.mailShirt = true; b.sleeves = 'rolled'; b.tallBoots = true; b.shoes = 0x1e1610; b.skirt = 0.42; }
  return b;
}

function buildBody(b: Body): Part[] {
  const parts: Part[] = [];
  const add = (seg: Seg, geos: (THREE.BufferGeometry | null | false | undefined)[], kind: Kind = 'matte') => { const g = merge(geos); if (g.attributes.position) parts.push({ seg, kind, geo: g }); };
  const f = b.fat, k = b.bulk, skin = new THREE.Color(b.skin), tunic = new THREE.Color(b.tunic);
  const cloth = (c: THREE.ColorRepresentation, grad?: [number, number, number, number]) => ({ jitter: 0.1, freq: 26, grad });
  const patchFn = (px: number, py: number) => (p: THREE.Vector3, c: THREE.Color) => { if (p.z > 0 && Math.abs(p.x - px) < 0.045 && Math.abs(p.y - py) < 0.04) c.lerp(new THREE.Color(b.patch), 0.85).multiplyScalar(0.9); };

  // ----- chest
  const ribs: Ring[] = [
    { y: 0.045, rx: 0.07, rz: 0.062 }, { y: 0.012, rx: 0.15 * k, rz: 0.088 }, { y: -0.04, rx: 0.19 * k, rz: 0.108, front: 1.02 },
    { y: -0.13, rx: 0.185 * k, rz: 0.118, front: b.female ? 1.2 : 1.08 }, { y: -0.24, rx: 0.168 * k, rz: 0.112 * f, front: 1 + (f - 1) * 0.5 }, { y: -0.36, rx: 0.165 * k, rz: 0.114 * f, front: 1 + (f - 1) * 0.8 },
  ];
  const chest: THREE.BufferGeometry[] = [paint(loft(ribs, { seg: 18, n: 2.5 }), tunic, { ...cloth(tunic), fn: patchFn(0.07, -0.2) })];
  // neckline: a darker undershirt and the collar's slit
  chest.push(paint(loft([{ y: 0.06, rx: 0.062, rz: 0.066 }, { y: 0.035, rx: 0.082, rz: 0.076 }], { seg: 14 }), tunic.clone().multiplyScalar(0.7), cloth(tunic)));
  chest.push(paint(xf(box(0.012, 0.09, 0.01), { t: [0, -0.02, 0.105] }), tunic.clone().multiplyScalar(0.45)));
  if (b.jerkin !== null) {
    const j = new THREE.Color(b.jerkin);
    chest.push(paint(loft(ribs.slice(1).map((r) => ({ ...r, rx: r.rx + 0.012, rz: (r.rz ?? r.rx) + 0.012 })), { seg: 18, n: 2.5, arc: [-0.44, 0.44] }), j, { jitter: 0.16, freq: 34 }));
    for (let i = 0; i < 4; i++) chest.push(paint(tube([[-0.035, -0.08 - i * 0.07, 0.132 + i * 0.004 * f], [0, -0.1 - i * 0.07, 0.14 + i * 0.006 * f], [0.035, -0.08 - i * 0.07, 0.132 + i * 0.004 * f]], 0.0045, 5), 0x1a120c));
    // fur at the collar
    chest.push(paint(xf(new THREE.TorusGeometry(0.105, 0.03, 6, 14), { r: [Math.PI / 2, 0, 0], s: [1.35, 1, 0.85], t: [0, 0.025, 0] }), 0x4a3a2a, { jitter: 0.4, freq: 120 }));
  }
  if (b.mantle !== undefined) chest.push(paint(loft([{ y: 0.055, rx: 0.085, rz: 0.08 }, { y: 0.02, rx: 0.19 * k, rz: 0.115 }, { y: -0.05, rx: 0.245 * k, rz: 0.15 }, { y: -0.1, rx: 0.255 * k, rz: 0.16 }], { seg: 18, n: 2.4, drop: (t, v) => (v > 0.9 ? (noise3(t * 26, 3, 3) - 0.5) * 0.05 : 0), ripple: (t, v) => Math.sin(t * 6.283 * 7) * 0.03 * v }), b.mantle, cloth(b.mantle)));
  add('chest', chest);
  if (b.mailShirt) add('chest', [paint(loft(ribs.slice(1).map((r) => ({ ...r, rx: r.rx + 0.02, rz: (r.rz ?? r.rx) + 0.02 })), { seg: 18, n: 2.5 }), 0x6c7078, { jitter: 0.2, freq: 30 })], 'mail');

  // ----- hips: belly, belt, and whatever hangs from it
  const belly: Ring[] = [{ y: 0.24, rx: 0.16 * k, rz: 0.112 * f, front: 1 + (f - 1) * 0.6 }, { y: 0.14, rx: 0.168 * k, rz: 0.122 * f, front: 1 + (f - 1) * 1.1 }, { y: 0.04, rx: 0.175 * k, rz: 0.125 * (0.6 + f * 0.4), front: 1 + (f - 1) * 0.6 }, { y: -0.04, rx: 0.18 * k, rz: 0.13 }];
  const hips: THREE.BufferGeometry[] = [paint(loft(belly, { seg: 18, n: 2.5 }), tunic, { ...cloth(tunic), fn: patchFn(-0.06, 0.1) })];
  hips.push(paint(xf(ball(0.13, 1.15, 0.8, 0.9, 10), { t: [0, -0.04, 0] }), 0x2a241c)); // braies, so the split never shows daylight
  const by = 0.075, bz = 0.125 * (0.6 + f * 0.4) * (1 + (f - 1) * 0.75);
  hips.push(paint(loft([{ y: by + 0.022, rx: 0.176 * k, rz: 0.129 * (0.62 + f * 0.4), front: 1 + (f - 1) * 0.85 }, { y: by - 0.022, rx: 0.18 * k, rz: 0.131 * (0.62 + f * 0.4), front: 1 + (f - 1) * 0.7 }], { seg: 18, n: 2.5 }), b.belt, { jitter: 0.12 }));
  hips.push(paint(xf(box(0.04, 0.05, 0.012), { t: [0.02, by, bz + 0.01] }), 0x6a6458));
  hips.push(paint(xf(loft([{ y: 0.02, rx: 0.03, rz: 0.018 }, { y: -0.02, rx: 0.042, rz: 0.03 }, { y: -0.07, rx: 0.036, rz: 0.028 }], { seg: 8, cap: 'both' }), { t: [-0.15 * k, by - 0.04, 0.07] }), 0x4a3524, { jitter: 0.14 })); // pouch
  if (b.mailShirt) parts.push({ seg: 'hips', kind: 'mail', geo: merge([paint(loft(belly.map((r) => ({ ...r, rx: r.rx + 0.02, rz: (r.rz ?? r.rx) + 0.02 })), { seg: 18, n: 2.5 }), 0x6c7078, { jitter: 0.2, freq: 30 })]) });
  add('hips', hips);

  // ----- skirt halves follow the thighs
  const L = b.skirt, flare = b.female ? 1.25 : 1;
  const skirtRings: Ring[] = [{ y: 0.0, rx: 0.176 * k, rz: 0.128 }, { y: -0.1, rx: 0.2 * k, rz: 0.155 }, { y: -L * 0.6, rx: 0.215 * k * flare, rz: 0.18 * flare }, { y: -L, rx: 0.235 * k * flare, rz: 0.2 * flare }];
  for (const side of [1, -1] as const) {
    const g = skirtHalf(skirtRings, side, { folds: b.female ? 11 : 8, foldAmp: 0.055, ragged: 0.045, seg: 12 });
    const apron = b.apron !== null ? new THREE.Color(b.apron) : null;
    paint(g, tunic, { ...cloth(tunic, mud(-L, -L + 0.2)), fn: (p, c, n) => {
      if (apron && p.z > 0.08 && Math.abs(p.x) < 0.13 && p.y > -L * 0.86) c.copy(apron).multiplyScalar(0.8 + noise3(p.x * 30, p.y * 30, 1) * 0.3);
      if (n.x * p.x + n.z * p.z < 0) c.multiplyScalar(0.4); // inside face
    } });
    parts.push({ seg: side > 0 ? 'skirtL' : 'skirtR', kind: 'matte', geo: g });
    if (b.mailShirt) parts.push({ seg: side > 0 ? 'skirtL' : 'skirtR', kind: 'mail', geo: paint(skirtHalf(skirtRings.slice(0, 3).map((r) => ({ ...r, rx: r.rx + 0.016, rz: (r.rz ?? r.rx) + 0.016, y: r.y * 0.8 })), side, { folds: 0, ragged: 0.02 }), 0x6c7078, { jitter: 0.2, freq: 30, fn: (p, c, n) => { if (n.x * p.x + n.z * p.z < 0) c.multiplyScalar(0.4); } }) });
  }

  // ----- arms (built for the right side, mirrored for the left)
  const sleeve = b.sleeves, ak = k * (b.jerkin !== null ? 1.08 : 1);
  const upperR = merge([
    sleeve === 'none' ? paint(limb(SHAPES.upper(ak * 0.94)), skin, { jitter: 0.06 }) : paint(limb(SHAPES.upper(ak * 1.06)), tunic, cloth(tunic)),
    shoulder(sleeve === 'none' ? skin : tunic, 0.07 * ak),
    sleeve === 'none' && paint(loft([{ y: 0.03, rx: 0.074 * ak }, { y: -0.03, rx: 0.08 * ak }, { y: -0.05, rx: 0.074 * ak }], { seg: 10 }), tunic, cloth(tunic)),
  ]);
  const foreR = merge([
    sleeve === 'long' ? paint(limb(SHAPES.fore(ak * 1.1)), tunic, cloth(tunic)) : paint(limb(SHAPES.fore(ak)), skin, { jitter: 0.07, grad: [-0.28, -0.1, 0.8, 1] }),
    sleeve === 'rolled' && paint(xf(new THREE.TorusGeometry(0.05 * ak, 0.016, 6, 10), { r: [Math.PI / 2, 0, 0], t: [0, -0.03, 0] }), tunic.clone().multiplyScalar(1.1), cloth(tunic)),
    sleeve === 'long' && paint(loft([{ y: -0.25, rx: 0.04 * ak }, { y: -0.285, rx: 0.043 * ak }], { seg: 8 }), tunic.clone().multiplyScalar(0.7)),
    b.jerkin !== null && paint(loft([{ y: -0.12, rx: 0.049 * ak, rz: 0.045 * ak }, { y: -0.26, rx: 0.039 * ak, rz: 0.035 * ak }], { seg: 10 }), 0x2e241a, { jitter: 0.16 }), // bracer
  ]);
  const handR = merge(fist(skin.clone().multiplyScalar(0.95), 0.98 * k));
  parts.push({ seg: 'upperR', kind: 'matte', geo: upperR }, { seg: 'upperL', kind: 'matte', geo: mirrorX(upperR) });
  parts.push({ seg: 'foreR', kind: 'matte', geo: foreR }, { seg: 'foreL', kind: 'matte', geo: mirrorX(foreR) });
  parts.push({ seg: 'handR', kind: 'matte', geo: handR }, { seg: 'handL', kind: 'matte', geo: mirrorX(handR) });

  // ----- legs
  const hose = new THREE.Color(b.hose);
  const thighR = merge([paint(limb(SHAPES.thigh(k)), hose, cloth(hose))]);
  const shin: THREE.BufferGeometry[] = [];
  const bare = b.shoes === null;
  if (b.tallBoots) {
    shin.push(paint(limb(SHAPES.shin(k * 1.12)), b.shoes!, { jitter: 0.16, grad: mud(-0.48, -0.2) }));
    shin.push(paint(loft([{ y: 0.0, rx: 0.075 * k }, { y: -0.035, rx: 0.07 * k }, { y: -0.05, rx: 0.066 * k }], { seg: 10 }), new THREE.Color(b.shoes!).multiplyScalar(1.3), { jitter: 0.14 }));
  } else {
    shin.push(paint(limb(SHAPES.shin(k)), b.female || bare ? skin : hose, { jitter: 0.1, grad: mud(-0.48, -0.25), fn: b.wraps ? (p, c) => { if (Math.sin((p.y + Math.atan2(p.x, p.z) * 0.012) * 95) > 0.1) c.copy(new THREE.Color(0x8a7f68)).multiplyScalar(0.7 + noise3(p.x * 60, p.y * 60, 2) * 0.4 * (0.5 + smooth(-0.48, -0.2, p.y) * 0.5)); } : undefined }));
  }
  shin.push(paint(xf(ball(0.062 * k, 1, 1, 1.05, 8), {}), b.tallBoots ? hose : b.female || bare ? skin : hose, { jitter: 0.08 }));
  const footR = foot(bare ? skin.clone().multiplyScalar(0.7) : b.shoes!, b.tallBoots ? 0 : 0.012, b.tallBoots ? 1.12 * k : k);
  parts.push({ seg: 'footR', kind: 'matte', geo: footR }, { seg: 'footL', kind: 'matte', geo: mirrorX(footR) });
  const shinR = merge(shin);
  parts.push({ seg: 'thighR', kind: 'matte', geo: thighR }, { seg: 'thighL', kind: 'matte', geo: mirrorX(thighR) });
  parts.push({ seg: 'shinR', kind: 'matte', geo: shinR }, { seg: 'shinL', kind: 'matte', geo: mirrorX(shinR) });
  return parts;
}

const VARIANTS: Record<string, number> = { mob: 10, farmhand: 5, woodcutter: 4, foreman: 1 };
const cache = new Map<string, Part[]>();

/** A complete peasant: body variant and head variant are picked independently from `seed`, so a mob rarely repeats. */
export function buildPeasant(look: string, seed: number): Part[] {
  const hv = seed % ((VARIANTS[look] ?? 4) + 3), bv = Math.floor(seed / 7) % (VARIANTS[look] ?? 4);
  const hp = randomHead(hv + (look.length * 31), look);
  const head = buildHead(hp, `${look}:${hv}`);
  const bkey = `${look}:${bv}:${hp.female ? 'f' : 'm'}:${hp.skin}:${head.mantle ?? ''}`;
  let body = cache.get(bkey);
  if (!body) { const b = randomBody(bv + look.length * 17, look, hp.female, hp.skin); b.mantle = head.mantle; body = buildBody(b); cache.set(bkey, body); }
  const parts: Part[] = [...body, { seg: 'head', kind: 'matte', geo: head.matte }];
  if (head.metal) parts.push({ seg: 'head', kind: 'plate', geo: head.metal });
  if (head.mail) parts.push({ seg: 'head', kind: 'mail', geo: head.mail });
  return parts;
}
