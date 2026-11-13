import * as THREE from 'three';
import { around, ball, box, cyl, gauss, loft, merge, mirrorX, noise3, paint, rivets, smooth, tube, xf, type Ring } from './geo';
import { buildHead, KNIGHT_FACE } from './heads';
import { decalMaterial, drawHeart, type Kind } from './materials';
import { fist, foot, LEN, SHAPES, shoulder, skirtHalf, type Part, type Seg } from './peasants';

// Sir Bleedsalot, in two harnesses.
//   mail  (c. 1280): great helm with torse and plume, mail hauberk and chausses, long crimson
//                    surcoat with the bleeding heart, poleyns and couters, sword belt.
//   plate (c. 1420): houndskull bascinet with aventail, globose breastplate and plackart, fauld
//                    and tassets, full arm and leg harness, crimson arming skirt and panache.
// Every armour part carries the id of its gear piece, so a broken piece falls away to show the
// quilted gambeson (or his face) underneath.

const STEEL = 0x8e949c, DARKSTEEL = 0x5c6168, MAILC = 0x5e636b, BRASS = 0x9a7a32, CRIMSON = 0x520a0e, LEATHER = 0x2a1c14, GAMBESON = 0x9a8c6e, SILVER = 0xc9ccd2, BLACK = 0x050505;
const CY = 0.137, CZ = 0.012;
const grow = (rings: Ring[], d: number): Ring[] => rings.map((r) => ({ ...r, rx: r.rx + d, rz: (r.rz ?? r.rx) + d }));
const steelPaint = (rust = 0.5) => ({ jitter: 0.1, freq: 26, fn: (p: THREE.Vector3, c: THREE.Color) => { const n = noise3(p.x * 55 + 9, p.y * 55, p.z * 55); if (n > 0.74) c.lerp(new THREE.Color(0x5a3a26), (n - 0.74) * 2.6 * rust); } });
const mailPaint = { jitter: 0.16, freq: 30 };
const cloth = (grad?: [number, number, number, number]) => ({ jitter: 0.1, freq: 26, grad });
const quilt = { jitter: 0.08, freq: 30, fn: (p: THREE.Vector3, c: THREE.Color) => { if (Math.abs(Math.sin(Math.atan2(p.x, p.z) * 9)) < 0.16) c.multiplyScalar(0.72); } };
const innerShade = (p: THREE.Vector3, c: THREE.Color, n: THREE.Vector3) => { if (n.x * p.x + n.z * p.z < 0) c.multiplyScalar(0.4); };

const RIBS: Ring[] = [
  { y: 0.045, rx: 0.078, rz: 0.064 }, { y: 0.012, rx: 0.166, rz: 0.09 }, { y: -0.04, rx: 0.209, rz: 0.11, front: 1.03 },
  { y: -0.13, rx: 0.205, rz: 0.12, front: 1.1 }, { y: -0.24, rx: 0.183, rz: 0.112 }, { y: -0.36, rx: 0.179, rz: 0.114 },
];
const BELLY: Ring[] = [{ y: 0.24, rx: 0.177, rz: 0.113 }, { y: 0.14, rx: 0.183, rz: 0.12 }, { y: 0.04, rx: 0.192, rz: 0.125 }, { y: -0.04, rx: 0.196, rz: 0.13 }];
/** One master skirt profile, cut off at `len`, so inner layers never poke through outer ones. */
const SKIRT = (len: number, flare = 1): Ring[] => {
  const master: [number, number, number][] = [[0, 0.194, 0.132], [-0.1, 0.214, 0.16], [-0.32, 0.226 * flare, 0.184 * flare], [-0.56, 0.248 * flare, 0.208 * flare]];
  const at = (y: number): Ring => { for (let i = 1; i < master.length; i++) if (y >= master[i][0] || i === master.length - 1) { const a = master[i - 1], b = master[i], t = Math.min(1.3, (y - a[0]) / (b[0] - a[0])); return { y, rx: a[1] + (b[1] - a[1]) * t, rz: a[2] + (b[2] - a[2]) * t }; } return { y, rx: 0.2 }; };
  const ys = [0, -0.1, -0.32, -0.56].filter((y) => y > -len + 0.03);
  return [...ys.map(at), at(-len)];
};

let heartDecal: THREE.Material | null = null;

function plume(x: number, y: number, z: number, n: number, len: number): THREE.BufferGeometry[] {
  // Ostrich feathers: fat, drooping back over the crown.
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i / Math.max(1, n - 1) - 0.5) * 2, l = len * (0.75 + ((i * 7) % 3) * 0.16), lift = 1 - Math.abs(s) * 0.35;
    const g = tube([[x + s * 0.01, y, z], [x + s * 0.04, y + l * 0.6 * lift, z - l * 0.08], [x + s * 0.085, y + l * 0.95 * lift, z - l * 0.45], [x + s * 0.12, y + l * 0.8 * lift, z - l * 0.9], [x + s * 0.135, y + l * 0.45 * lift, z - l * 1.2]], (t) => 0.05 * Math.sin(Math.min(1, t * 1.15 + 0.1) * Math.PI) + 0.006, 8, 0.5);
    const a = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < a.count; k++) { const nz = noise3(a.getX(k) * 90, a.getY(k) * 90, a.getZ(k) * 90) - 0.5; a.setXYZ(k, a.getX(k) + nz * 0.012, a.getY(k) + nz * 0.012, a.getZ(k)); }
    g.computeVertexNormals();
    out.push(paint(g, i % 3 === 1 ? SILVER : CRIMSON, { jitter: 0.3, freq: 140 }));
  }
  return out;
}

function swordBelt(): { matte: THREE.BufferGeometry[]; metal: THREE.BufferGeometry[] } {
  const y = 0.085;
  const belt = paint(loft([{ y: y + 0.026, rx: 0.202, rz: 0.136 }, { y: y - 0.026, rx: 0.206, rz: 0.14 }], { seg: 18, n: 2.5 }), LEATHER, { jitter: 0.14 });
  const tail = paint(tube([[0.03, y, 0.14], [0.045, y - 0.07, 0.15], [0.04, y - 0.2, 0.16]], 0.016, 5, 0.25), LEATHER, { jitter: 0.14 });
  // scabbard on the left hip, raked back
  const sc = xf(loft([{ y: 0.06, rx: 0.036, rz: 0.014 }, { y: 0, rx: 0.033, rz: 0.012 }, { y: -0.72, rx: 0.02, rz: 0.008 }, { y: -0.8, rx: 0.004, rz: 0.003 }], { seg: 8, cap: 'both' }), { r: [0.62, 0, 0.12], t: [0.222, y - 0.02, -0.01] });
  const chape = xf(loft([{ y: -0.66, rx: 0.024, rz: 0.011 }, { y: -0.8, rx: 0.007, rz: 0.005 }, { y: -0.815, rx: 0.002, rz: 0.002 }], { seg: 8, cap: 'end' }), { r: [0.62, 0, 0.12], t: [0.222, y - 0.02, -0.01] });
  const locket = xf(loft([{ y: 0.065, rx: 0.039, rz: 0.017 }, { y: 0.01, rx: 0.036, rz: 0.015 }], { seg: 8 }), { r: [0.62, 0, 0.12], t: [0.222, y - 0.02, -0.01] });
  const buckle = xf(box(0.05, 0.058, 0.012), { t: [0, y, 0.142] });
  const studs = around(9, 0.206, 0.142, y, 0.56, 0.98).map(([px, py, pz]) => xf(ball(0.008, 1, 1, 1, 6), { t: [px, py, pz] }));
  // rondel dagger on the right
  const dag = xf(loft([{ y: 0.1, rx: 0.02, rz: 0.02 }, { y: 0.09, rx: 0.008, rz: 0.008 }, { y: 0.02, rx: 0.009, rz: 0.009 }, { y: 0.01, rx: 0.022, rz: 0.022 }, { y: 0, rx: 0.018, rz: 0.008 }, { y: -0.26, rx: 0.005, rz: 0.004 }], { seg: 8, cap: 'both' }), { r: [0.25, 0, -0.1], t: [-0.216, y - 0.04, 0.03] });
  return {
    matte: [belt, tail, paint(sc, 0x3a1a16, { jitter: 0.14 }), paint(dag, 0x2a1c14, { jitter: 0.14 })],
    metal: [paint(chape, BRASS, { jitter: 0.1 }), paint(locket, BRASS, { jitter: 0.1 }), paint(buckle, BRASS, { jitter: 0.1 }), ...studs.map((s) => paint(s, BRASS))],
  };
}

function spur(): THREE.BufferGeometry[] {
  const y = -LEN.shin + 0.06;
  return [paint(tube([[-0.045, y, 0.02], [-0.04, y, -0.05], [0, y, -0.075], [0.04, y, -0.05], [0.045, y, 0.02]], 0.006, 5), BRASS), paint(tube([[0, y, -0.075], [0, y + 0.01, -0.12], [0, y + 0.012, -0.15]], (t) => 0.007 * (1 - t * 0.8), 5), BRASS)];
}

/** The face under the helm, in its mail coif. Shown only once the helm has been knocked off. */
function bareHead(piece: string): Part[] {
  const h = buildHead(KNIGHT_FACE, 'knight');
  const out: Part[] = [{ seg: 'head', kind: 'matte', geo: h.matte, showWhenBroken: piece }];
  if (h.mail) out.push({ seg: 'head', kind: 'mail', geo: h.mail, showWhenBroken: piece });
  return out;
}

// ------------------------------------------------------------------ mail harness

function mailKit(): Part[] {
  const P: Part[] = [];
  const add = (seg: Seg, kind: Kind, geos: (THREE.BufferGeometry | false | null | undefined)[], piece?: string) => { const g = merge(geos); if (g.attributes.position) P.push({ seg, kind, geo: g, piece }); };
  const HELM = 'greatHelm';

  // ----- great helm
  const helmRings: Ring[] = [
    { y: 0.022, rx: 0.124, rz: 0.134, z: CZ }, { y: 0.04, rx: 0.119, rz: 0.13, z: CZ }, { y: 0.155, rx: 0.122, rz: 0.134, z: CZ, front: 1.05 },
    { y: 0.25, rx: 0.117, rz: 0.128, z: CZ }, { y: 0.275, rx: 0.104, rz: 0.114, z: CZ }, { y: 0.29, rx: 0.07, rz: 0.078, z: CZ }, { y: 0.296, rx: 0.012, rz: 0.012, z: CZ },
  ];
  const helm = paint(loft(helmRings, { seg: 22, n: 2.35, cap: 'end' }), STEEL, { ...steelPaint(0.6), grad: [0.02, 0.12, 0.72, 1] });
  const fz = CZ + 0.134 * 1.05;
  const band = (y0: number, y1: number, d: number, arc?: [number, number]) => loft([{ y: y0, rx: 0.122 + d, rz: 0.134 + d, z: CZ, front: 1.05 }, { y: y1, rx: 0.122 + d, rz: 0.134 + d, z: CZ, front: 1.05 }], { seg: 22, n: 2.35, arc });
  const metal: THREE.BufferGeometry[] = [
    helm,
    paint(band(0.02, 0.042, 0.004), DARKSTEEL, steelPaint()),
    paint(loft([{ y: 0.243, rx: 0.121, rz: 0.132, z: CZ }, { y: 0.258, rx: 0.119, rz: 0.13, z: CZ }], { seg: 22, n: 2.35 }), DARKSTEEL, steelPaint()),
    // the cross: brass reinforcing bars over the face
    paint(xf(loft([{ y: 0.04, rx: 0.015, rz: 0.007 }, { y: 0.06, rx: 0.011, rz: 0.006 }, { y: 0.24, rx: 0.011, rz: 0.006 }, { y: 0.262, rx: 0.017, rz: 0.007 }], { seg: 6, n: 3, cap: 'both' }), { t: [0, 0, fz + 0.002] }), BRASS, { jitter: 0.12 }),
    paint(band(0.14, 0.176, 0.005, [0.3, 0.7]), BRASS, { jitter: 0.12 }),
    ...rivets(around(16, 0.122, 0.133, 0.25).map(([x, y, z]) => [x, y, z + CZ] as [number, number, number]), 0.0055).map((g) => paint(g, 0xc4c9d0)),
    ...rivets(around(6, 0.129, 0.146, 0.158, 0.31, 0.47).map(([x, y, z]) => [x, y, z + CZ] as [number, number, number]), 0.0045).map((g) => paint(g, 0xd0b060)),
    ...rivets(around(6, 0.129, 0.146, 0.158, 0.53, 0.69).map(([x, y, z]) => [x, y, z + CZ] as [number, number, number]), 0.0045).map((g) => paint(g, 0xd0b060)),
    paint(xf(ball(0.016, 1, 1, 1, 8), { t: [0, 0.3, CZ] }), BRASS),
  ];
  add('head', 'plate', metal, HELM);
  const trim: THREE.BufferGeometry[] = [
    // sights: two dark slits either side of the upright
    paint(band(0.153, 0.164, 0.0075, [0.335, 0.482]), BLACK, { jitter: 0 }),
    paint(band(0.153, 0.164, 0.0075, [0.518, 0.665]), BLACK, { jitter: 0 }),
    // breaths, on the right cheek only: the left is the side that gets hit
    ...[0.06, 0.082, 0.104].flatMap((y, row) => around(4, 0.1235, 0.1375, y, 0.33 + row * 0.006, 0.45).map(([x, yy, z]) => paint(xf(ball(0.0058, 1, 1, 0.4, 6), { t: [x, yy, z + CZ], r: [0, Math.atan2(x, z), 0] }), BLACK, { jitter: 0 }))),
    // torse: a twisted roll of crimson and silver
    paint(xf(new THREE.TorusGeometry(0.086, 0.017, 7, 24), { r: [Math.PI / 2, 0, 0], s: [1, 1, 1.08], t: [0, 0.281, CZ] }), CRIMSON, { jitter: 0.12, fn: (p, c) => { if (Math.sin(Math.atan2(p.x, p.z - CZ) * 8 + p.y * 120) > 0) c.set(SILVER).multiplyScalar(0.8); } }),
    ...plume(0, 0.295, CZ - 0.01, 7, 0.26),
  ];
  add('head', 'matte', trim, HELM);
  P.push(...bareHead(HELM));

  // ----- chest: gambeson, hauberk, surcoat, mail over the shoulders
  add('chest', 'matte', [paint(loft(RIBS, { seg: 18, n: 2.5 }), GAMBESON, quilt)]);
  add('chest', 'mail', [paint(loft(grow(RIBS.slice(1), 0.012), { seg: 18, n: 2.5 }), MAILC, mailPaint)], 'hauberk');
  const surRings = grow(RIBS.slice(1), 0.024);
  const sur = paint(loft(surRings, { seg: 20, n: 2.5, ripple: (t, v) => Math.sin(t * 6.283 * 9) * 0.012 * v }), CRIMSON, { ...cloth([-0.4, -0.05, 0.82, 1]), fn: (p, c) => { c.multiplyScalar(0.88 + 0.24 * noise3(p.x * 9, p.y * 5, p.z * 9)); } });
  // guige: the shield strap across the chest
  const guige = paint(tube([[-0.16, 0.035, -0.06], [-0.12, 0.02, 0.095], [0.0, -0.13, 0.158], [0.13, -0.27, 0.13], [0.185, -0.34, 0.03]], 0.014, 5, 0.28), LEATHER, { jitter: 0.12 });
  P.push({ seg: 'chest', kind: 'matte', geo: merge([sur, guige]), hideWith: 'hauberk' });
  heartDecal ??= decalMaterial((x, s) => drawHeart(x, s));
  P.push({ seg: 'chest', kind: 'matte', geo: loft(grow(RIBS.slice(2, 5), 0.0275).map((r) => ({ ...r })), { seg: 10, n: 2.5, arc: [0.37, 0.63] }), decal: heartDecal, hideWith: 'hauberk' });
  add('chest', 'mail', [paint(loft([{ y: 0.085, rx: 0.088, rz: 0.094 }, { y: 0.04, rx: 0.12, rz: 0.108 }, { y: -0.005, rx: 0.225, rz: 0.13 }, { y: -0.055, rx: 0.262, rz: 0.15 }, { y: -0.08, rx: 0.268, rz: 0.154 }], { seg: 20, n: 2.4, drop: (t, v) => (v > 0.9 ? Math.abs(Math.sin(t * 6.283 * 11)) * -0.012 : 0) }), MAILC, mailPaint)]);

  // ----- hips
  add('hips', 'matte', [paint(loft(BELLY, { seg: 18, n: 2.5 }), GAMBESON, quilt), paint(xf(ball(0.13, 1.15, 0.8, 0.9, 10), { t: [0, -0.04, 0] }), 0x1e1a16)]);
  add('hips', 'mail', [paint(loft(grow(BELLY, 0.012), { seg: 18, n: 2.5 }), MAILC, mailPaint)], 'hauberk');
  const belt = swordBelt();
  add('hips', 'matte', [paint(loft(grow(BELLY, 0.024), { seg: 20, n: 2.5, ripple: (t) => Math.sin(t * 6.283 * 9) * 0.012 }), CRIMSON, cloth()), ...belt.matte]);
  add('hips', 'plate', belt.metal);
  for (const side of [1, -1] as const) {
    const seg: Seg = side > 0 ? 'skirtL' : 'skirtR';
    add(seg, 'matte', [paint(skirtHalf(SKIRT(0.14), side, { folds: 0, ragged: 0.005 }), GAMBESON, { ...quilt, fn: (p, c, n) => { quilt.fn(p, c); innerShade(p, c, n); } })]);
    add(seg, 'mail', [paint(skirtHalf(grow(SKIRT(0.4, 1.1), 0.012), side, { folds: 6, foldAmp: 0.015, ragged: 0.012 }), MAILC, { ...mailPaint, fn: innerShade })], 'hauberk');
    add(seg, 'matte', [paint(skirtHalf(grow(SKIRT(0.56, 1.1), 0.024), side, { folds: 9, foldAmp: 0.05, ragged: 0.09, seg: 14 }), CRIMSON, { ...cloth([-0.56, -0.25, 0.45, 1]), fn: (p, c, n) => { c.multiplyScalar(0.86 + 0.28 * noise3(p.x * 9, p.y * 5, p.z * 9)); innerShade(p, c, n); } })]);
  }

  // ----- arms (right, then mirrored)
  const upG = merge([paint(loft(SHAPES.upper(1), { seg: 10, cap: 'both' }), GAMBESON, quilt), shoulder(GAMBESON, 0.068)]);
  const upM = merge([paint(loft(SHAPES.upper(1.26), { seg: 10, cap: 'both' }), MAILC, mailPaint), paint(xf(ball(0.096, 1.05, 0.95, 1.08, 12), { t: [-0.008, -0.012, 0] }), MAILC, mailPaint)]);
  const foG = merge([paint(loft(SHAPES.fore(1), { seg: 10, cap: 'both' }), GAMBESON, quilt)]);
  const foM = merge([paint(loft(SHAPES.fore(1.28), { seg: 10, cap: 'both' }), MAILC, mailPaint)]);
  // couter: a dished steel cop at the elbow, strapped on
  const couter = merge([
    paint(xf(ball(0.07, 0.95, 0.85, 1, 12), { t: [-0.014, 0, -0.014] }), STEEL, steelPaint()),
    paint(xf(cyl(0.036, 0.04, 0.012, 12), { r: [0, 0, Math.PI / 2], t: [-0.066, 0, -0.012] }), DARKSTEEL, steelPaint()),
    paint(xf(ball(0.011, 1, 1, 1, 6), { t: [-0.075, 0, -0.012] }), BRASS),
  ]);
  const hand = merge([...fist(MAILC, 1.25).map((g) => paint(g, MAILC, mailPaint))]);
  const cuff = merge([paint(loft([{ y: 0.06, rx: 0.06 }, { y: 0.0, rx: 0.05 }, { y: -0.012, rx: 0.052 }], { seg: 10 }), LEATHER, { jitter: 0.14 })]);
  for (const [seg, geo, kind, piece] of [['upper', upG, 'matte', undefined], ['upper', upM, 'mail', 'mailSleeves'], ['fore', foG, 'matte', undefined], ['fore', foM, 'mail', 'mailSleeves'], ['fore', couter, 'plate', 'mailSleeves'], ['hand', hand, 'mail', undefined], ['hand', cuff, 'matte', undefined]] as const) {
    P.push({ seg: `${seg}R` as Seg, kind, geo, piece }, { seg: `${seg}L` as Seg, kind, geo: mirrorX(geo), piece });
  }

  // ----- legs
  const HOSEC = 0x2e2a24, LEGS = 'chausses';
  const thG = merge([paint(loft(SHAPES.thigh(1), { seg: 10, cap: 'both' }), HOSEC, cloth())]);
  const thM = merge([paint(loft(SHAPES.thigh(1.22), { seg: 10, cap: 'both' }), MAILC, mailPaint)]);
  const shG = merge([paint(loft(SHAPES.shin(1), { seg: 10, cap: 'both' }), HOSEC, cloth()), paint(ball(0.06), HOSEC)]);
  const shM = merge([paint(loft(SHAPES.shin(1.24), { seg: 10, cap: 'both' }), MAILC, { ...mailPaint, grad: [-0.48, -0.2, 0.6, 1] }), paint(ball(0.075), MAILC, mailPaint)]);
  const ftG = merge([foot(LEATHER, 0.01, 1.05)]);
  const ftM = merge([paint(xf(foot(MAILC, 0.012, 1.26), { t: [0, 0.004, 0] }), MAILC, { ...mailPaint, grad: [-0.48, -0.38, 0.45, 1] }), ...spur()]);
  // poleyn: knee cop with a small side wing
  const poleyn = merge([
    paint(xf(sculptCop(0.084), { t: [0, 0.0, 0.016] }), STEEL, steelPaint()),
    paint(xf(cyl(0.034, 0.038, 0.012, 10), { r: [0, 0, Math.PI / 2], t: [-0.07, 0, 0.0] }), DARKSTEEL, steelPaint()),
    paint(tube([[-0.06, -0.035, 0.02], [-0.03, -0.04, -0.07], [0.03, -0.04, -0.07], [0.06, -0.035, 0.02]], 0.01, 5, 0.3), LEATHER),
  ]);
  for (const [seg, geo, kind, piece] of [['thigh', thG, 'matte', undefined], ['thigh', thM, 'mail', LEGS], ['shin', shG, 'matte', undefined], ['shin', shM, 'mail', LEGS], ['shin', poleyn, 'plate', LEGS], ['foot', ftG, 'matte', undefined], ['foot', ftM, 'mail', LEGS]] as const) {
    P.push({ seg: `${seg}R` as Seg, kind, geo, piece }, { seg: `${seg}L` as Seg, kind, geo: mirrorX(geo), piece });
  }
  return P;
}

/** A dished cop: the front half of an egg, with a medial ridge. */
function sculptCop(r: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  g.rotateX(Math.PI / 2); // dome faces +Z
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * 0.95, y * 1.1, z * (1.05 + gauss(x, 0, 0, 0, r * 0.3) * 0.18)); }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ plate harness

function plateKit(): Part[] {
  const P: Part[] = [];
  const add = (seg: Seg, kind: Kind, geos: (THREE.BufferGeometry | false | null | undefined)[], piece?: string) => { const g = merge(geos); if (g.attributes.position) P.push({ seg, kind, geo: g, piece }); };
  const BRIGHT = 0x868c94, HELM = 'bascinet', sp = steelPaint(0.25);
  const edge = (y: number, w = 0.012) => (p: THREE.Vector3, c: THREE.Color) => { sp.fn(p, c); if (Math.abs(p.y - y) < w) c.set(BRASS).multiplyScalar(0.9); };

  // ----- houndskull bascinet
  const skull: Ring[] = [
    { y: 0.03, rx: 0.121, rz: 0.13, z: CZ }, { y: 0.1, rx: 0.125, rz: 0.137, z: CZ }, { y: 0.175, rx: 0.121, rz: 0.135, z: CZ - 0.002 },
    { y: 0.235, rx: 0.1, rz: 0.118, z: CZ - 0.008 }, { y: 0.285, rx: 0.064, rz: 0.08, z: CZ - 0.018 }, { y: 0.318, rx: 0.024, rz: 0.03, z: CZ - 0.03 }, { y: 0.33, rx: 0.003, rz: 0.003, z: CZ - 0.034 },
  ];
  const snout = xf(loft([{ y: 0, rx: 0.098, rz: 0.1 }, { y: 0.035, rx: 0.088, rz: 0.086 }, { y: 0.085, rx: 0.052, rz: 0.05 }, { y: 0.125, rx: 0.022, rz: 0.022 }, { y: 0.14, rx: 0.004, rz: 0.004 }], { seg: 16, n: 2.2, cap: 'end' }), { r: [Math.PI / 2 + 0.16, 0, 0], t: [0, 0.128, CZ + 0.092] });
  add('head', 'plate', [
    paint(loft(skull, { seg: 22, n: 2.2, cap: 'end' }), BRIGHT, { ...sp, fn: edge(0.036, 0.01) }),
    paint(snout, BRIGHT, sp),
    // brow of the visor
    paint(xf(loft([{ y: 0, rx: 0.103, rz: 0.03 }, { y: 0.03, rx: 0.1, rz: 0.02 }], { seg: 12, arc: [0.25, 0.75] }), { t: [0, 0.172, CZ + 0.098], r: [0.2, 0, 0] }), BRIGHT, sp),
    ...[-1, 1].flatMap((s) => [paint(xf(cyl(0.02, 0.02, 0.012, 10), { r: [0, 0, Math.PI / 2], t: [s * 0.125, 0.165, CZ + 0.03] }), BRASS), paint(xf(ball(0.009, 1, 1, 1, 6), { t: [s * 0.133, 0.165, CZ + 0.03] }), BRIGHT)]),
    ...rivets(around(18, 0.124, 0.134, 0.05).map(([x, y, z]) => [x, y, z + CZ] as [number, number, number]), 0.0045).map((g) => paint(g, 0xd0b060)),
  ], HELM);
  add('head', 'matte', [
    ...[-1, 1].map((s) => paint(xf(box(0.05, 0.008, 0.012), { t: [s * 0.045, 0.176, CZ + 0.168], r: [0.25, s * -0.5, s * 0.1] }), BLACK, { jitter: 0 })),
    ...[0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => paint(xf(ball(0.005, 1, 1, 0.5, 5), { t: [-0.03 - col * 0.014 - row * 0.004, 0.118 - row * 0.014, CZ + 0.188 - col * 0.018 + row * 0.004], r: [0, -0.8, 0] }), BLACK, { jitter: 0 }))),
    ...plume(0, 0.3, CZ - 0.06, 5, 0.2),
  ], HELM);
  add('head', 'mail', [paint(loft([{ y: 0.05, rx: 0.118, rz: 0.128, z: CZ }, { y: 0.01, rx: 0.115, rz: 0.118, z: CZ }, { y: -0.03, rx: 0.13, rz: 0.12 }], { seg: 18 }), MAILC, mailPaint)], HELM);
  P.push(...bareHead(HELM));

  // ----- cuirass
  const breast: Ring[] = [{ y: 0.03, rx: 0.105, rz: 0.075 }, { y: 0.005, rx: 0.155, rz: 0.092 }, { y: -0.05, rx: 0.195, rz: 0.114, front: 1.14 }, { y: -0.14, rx: 0.192, rz: 0.124, front: 1.3 }, { y: -0.215, rx: 0.172, rz: 0.114, front: 1.2 }, { y: -0.27, rx: 0.158, rz: 0.106, front: 1.02 }];
  const plack: Ring[] = [{ y: -0.19, rx: 0.176, rz: 0.118, front: 1.24 }, { y: -0.27, rx: 0.164, rz: 0.11, front: 1.08 }, { y: -0.37, rx: 0.17, rz: 0.118 }];
  add('chest', 'matte', [paint(loft(RIBS, { seg: 18, n: 2.5 }), GAMBESON, quilt)]);
  add('chest', 'plate', [
    paint(loft(breast, { seg: 22, n: 2.3 }), BRIGHT, sp),
    paint(tube([[0, -0.02, 0.13], [0, -0.13, 0.166], [0, -0.21, 0.142]], 0.007, 5), BRIGHT, sp), // medial ridge
    paint(loft(plack, { seg: 22, n: 2.3, drop: (t, v) => (v < 0.15 ? gauss(t, 0, 0.5, 0, 0.07) * 0.075 : 0) }), BRIGHT, { ...sp, fn: (p, c) => { sp.fn(p, c); if (p.y > -0.205 && p.z > 0) c.set(BRASS).multiplyScalar(0.9); } }),
    paint(loft([{ y: 0.085, rx: 0.08, rz: 0.084 }, { y: 0.05, rx: 0.092, rz: 0.09 }, { y: 0.01, rx: 0.14, rz: 0.1 }], { seg: 18 }), BRIGHT, { ...sp, fn: edge(0.082, 0.008) }),
    // besagews guard the armpits
    ...[-1, 1].flatMap((s) => [paint(xf(cyl(0.046, 0.05, 0.01, 14), { r: [Math.PI / 2 - 0.15, 0, s * -0.35], t: [s * 0.172, -0.07, 0.122] }), BRIGHT, sp), paint(xf(new THREE.ConeGeometry(0.012, 0.03, 6), { r: [Math.PI / 2, 0, 0], t: [s * 0.176, -0.07, 0.14] }), BRASS)]),
  ], 'cuirass');
  add('chest', 'mail', [paint(loft([{ y: 0.06, rx: 0.1, rz: 0.098 }, { y: 0.0, rx: 0.2, rz: 0.126 }, { y: -0.05, rx: 0.226, rz: 0.142 }], { seg: 20, n: 2.4, drop: (t, v) => (v > 0.9 ? Math.abs(Math.sin(t * 6.283 * 11)) * -0.012 : 0) }), MAILC, mailPaint)]);

  // ----- hips: fauld of three lames, belt, mail and arming skirt
  add('hips', 'matte', [paint(loft(BELLY, { seg: 18, n: 2.5 }), GAMBESON, quilt), paint(xf(ball(0.13, 1.15, 0.8, 0.9, 10), { t: [0, -0.04, 0] }), 0x1e1a16)]);
  const lame = (y0: number, y1: number, r0: number, r1: number) => paint(loft([{ y: y0, rx: 0.165 + r0, rz: 0.116 + r0 }, { y: y1, rx: 0.175 + r1, rz: 0.128 + r1 }], { seg: 22, n: 2.4 }), BRIGHT, { ...sp, fn: edge(y1, 0.007) });
  const belt = swordBelt();
  add('hips', 'plate', [lame(0.25, 0.15, 0.012, 0.022), lame(0.165, 0.06, 0.018, 0.03), lame(0.075, -0.035, 0.026, 0.04)], 'cuirass');
  add('hips', 'plate', belt.metal);
  add('hips', 'matte', belt.matte.map((g) => xf(g, { s: [1.13, 1, 1.18] })));
  for (const side of [1, -1] as const) {
    const seg: Seg = side > 0 ? 'skirtL' : 'skirtR';
    add(seg, 'matte', [paint(skirtHalf(grow(SKIRT(0.34, 1.05), 0.006), side, { folds: 10, foldAmp: 0.05, ragged: 0.05 }), CRIMSON, { ...cloth([-0.34, -0.1, 0.6, 1]), fn: innerShade })]);
    add(seg, 'mail', [paint(skirtHalf(grow(SKIRT(0.24), 0.016), side, { folds: 6, foldAmp: 0.02, ragged: 0.012 }), MAILC, { ...mailPaint, fn: innerShade })], 'cuirass');
    // tasset: a pointed plate hanging over the front of the thigh
    const a: [number, number] = side > 0 ? [0.52, 0.72] : [0.28, 0.48];
    add(seg, 'plate', [paint(loft([{ y: -0.02, rx: 0.2, rz: 0.165 }, { y: -0.14, rx: 0.214, rz: 0.184 }, { y: -0.27, rx: 0.222, rz: 0.194 }], { seg: 8, n: 2.3, arc: a, drop: (t, v) => (v > 0.9 ? -gauss(t, 0, (a[0] + a[1]) / 2, 0, 0.05) * 0.06 : 0) }), BRIGHT, { ...sp, fn: (p, c) => { sp.fn(p, c); if (p.y < -0.25) c.set(BRASS).multiplyScalar(0.9); } })], 'cuirass');
  }

  // ----- arms
  const ARMS = 'plateArms';
  const upG = merge([paint(loft(SHAPES.upper(1), { seg: 10, cap: 'both' }), GAMBESON, quilt), shoulder(GAMBESON, 0.068)]);
  const pauldron = merge([
    paint(xf(ball(0.1, 1.12, 0.72, 1.22, 14), { t: [-0.018, 0.012, 0] }), BRIGHT, { ...sp, fn: (p, c) => { sp.fn(p, c); if (p.y < -0.035) c.set(BRASS).multiplyScalar(0.9); } }),
    paint(loft([{ y: -0.02, rx: 0.086, rz: 0.098, x: -0.012 }, { y: -0.075, rx: 0.08, rz: 0.09, x: -0.012 }], { seg: 12 }), BRIGHT, { ...sp, fn: edge(-0.075, 0.007) }),
    paint(loft([{ y: -0.06, rx: 0.077, rz: 0.086, x: -0.01 }, { y: -0.115, rx: 0.07, rz: 0.078, x: -0.008 }], { seg: 12 }), BRIGHT, { ...sp, fn: edge(-0.115, 0.007) }),
    paint(loft([{ y: -0.1, rx: 0.066, rz: 0.072 }, { y: -0.2, rx: 0.058, rz: 0.062 }, { y: -0.29, rx: 0.056, rz: 0.058 }], { seg: 12 }), BRIGHT, sp), // rerebrace
    ...rivets([[-0.1, -0.05, 0.03], [-0.1, -0.05, -0.03], [-0.092, -0.095, 0.0]], 0.005).map((g) => paint(g, 0xd0b060)),
  ]);
  const foG = merge([paint(loft(SHAPES.fore(1), { seg: 10, cap: 'both' }), GAMBESON, quilt)]);
  const vambrace = merge([
    paint(xf(ball(0.064, 0.95, 0.9, 1, 12), { t: [-0.008, 0, -0.01] }), BRIGHT, sp),
    // the couter's wing, a fluted shell on the outside of the elbow
    paint(xf(ball(0.055, 0.22, 1, 0.95, 10), { t: [-0.066, 0, 0.0] }), BRIGHT, { ...sp, fn: (p, c) => { sp.fn(p, c); if (Math.abs(Math.sin(p.y * 90)) < 0.25) c.multiplyScalar(0.7); } }),
    paint(loft([{ y: -0.03, rx: 0.058, rz: 0.056 }, { y: -0.1, rx: 0.056, rz: 0.052 }, { y: -0.23, rx: 0.042, rz: 0.038 }, { y: -0.275, rx: 0.046, rz: 0.042 }], { seg: 12 }), BRIGHT, { ...sp, fn: edge(-0.27, 0.008) }),
  ]);
  const gauntlet = merge([
    paint(loft([{ y: 0.075, rx: 0.058, rz: 0.054 }, { y: 0.02, rx: 0.044, rz: 0.042 }, { y: -0.01, rx: 0.045, rz: 0.046 }], { seg: 12 }), BRIGHT, { ...sp, fn: edge(0.072, 0.008) }),
    ...fist(BRIGHT, 1.25).map((g) => paint(g, BRIGHT, sp)),
    // gadlings: the knuckle spikes some really had
    ...[-0.034, -0.011, 0.012, 0.035].map((z) => paint(xf(new THREE.ConeGeometry(0.008, 0.022, 5), { r: [0, 0, Math.PI / 2], t: [-0.058, -0.058, z] }), BRASS)),
  ]);
  for (const [seg, geo, kind, piece] of [['upper', upG, 'matte', undefined], ['upper', pauldron, 'plate', ARMS], ['fore', foG, 'matte', undefined], ['fore', vambrace, 'plate', ARMS], ['hand', gauntlet, 'plate', undefined]] as const) {
    P.push({ seg: `${seg}R` as Seg, kind, geo, piece }, { seg: `${seg}L` as Seg, kind, geo: mirrorX(geo), piece });
  }

  // ----- legs
  const LEGS = 'plateLegs', HOSEC = 0x2e2a24;
  const thG = merge([paint(loft(SHAPES.thigh(1), { seg: 10, cap: 'both' }), HOSEC, cloth())]);
  const cuisse = merge([
    paint(loft([{ y: 0.02, rx: 0.094, rz: 0.1 }, { y: -0.05, rx: 0.102, rz: 0.108 }, { y: -0.2, rx: 0.092, rz: 0.098, front: 1.1 }, { y: -0.37, rx: 0.074, rz: 0.076 }, { y: -0.4, rx: 0.076, rz: 0.078 }], { seg: 12 }), BRIGHT, { ...sp, fn: edge(-0.395, 0.007) }),
    paint(tube([[0, -0.04, 0.108], [0, -0.2, 0.108], [0, -0.38, 0.08]], 0.006, 5), BRIGHT, sp),
  ]);
  const shG = merge([paint(loft(SHAPES.shin(1), { seg: 10, cap: 'both' }), HOSEC, cloth()), paint(ball(0.06), HOSEC)]);
  const ftG = merge([foot(LEATHER, 0.01, 1.05)]);
  const sab = foot(BRIGHT, 0.028, 1.2);
  const greave = merge([
    paint(xf(sculptCop(0.08), { t: [0, 0, 0.014] }), BRIGHT, sp),
    paint(xf(ball(0.05, 0.22, 1.05, 0.95, 10), { t: [-0.072, 0, 0.0] }), BRIGHT, { ...sp, fn: (p, c) => { sp.fn(p, c); if (Math.abs(Math.sin(p.y * 90)) < 0.25) c.multiplyScalar(0.7); } }),
    paint(loft([{ y: -0.045, rx: 0.062, rz: 0.064 }, { y: -0.14, rx: 0.064, rz: 0.066, back: 1.3 }, { y: -0.3, rx: 0.048, rz: 0.05, back: 1.12 }, { y: -0.41, rx: 0.043, rz: 0.045 }, { y: -0.44, rx: 0.05, rz: 0.052 }], { seg: 12 }), BRIGHT, { ...sp, grad: [-0.48, -0.25, 0.7, 1] }),
    paint(tube([[0, -0.06, 0.066], [0, -0.25, 0.058], [0, -0.42, 0.048]], 0.005, 5), BRIGHT, sp),
  ]);
  const sabaton = merge([
    paint(sab, BRIGHT, { jitter: 0.1, grad: [-0.48, -0.4, 0.5, 1], fn: (p, c) => { sp.fn(p, c); if (Math.abs(Math.sin(p.z * 70)) < 0.2) c.multiplyScalar(0.62); } }),
    ...spur(),
  ]);
  for (const [seg, geo, kind, piece] of [['thigh', thG, 'matte', undefined], ['thigh', cuisse, 'plate', LEGS], ['shin', shG, 'matte', undefined], ['shin', greave, 'plate', LEGS], ['foot', ftG, 'matte', undefined], ['foot', sabaton, 'plate', LEGS]] as const) {
    P.push({ seg: `${seg}R` as Seg, kind, geo, piece }, { seg: `${seg}L` as Seg, kind, geo: mirrorX(geo), piece });
  }
  void smooth;
  return P;
}

const cache = new Map<string, Part[]>();
export function buildKnight(kit: string): Part[] {
  let p = cache.get(kit);
  if (!p) { p = kit === 'plate' ? plateKit() : mailKit(); cache.set(kit, p); }
  return p;
}
