import * as THREE from 'three';
import { ball, box, cyl, loft, merge, noise3, paint, tube, xf } from './geo';
import { drawHeart, material } from './materials';

// Weapons and the shield. Weapon space: the grip is at the origin and the business end points
// along +Z. Each weapon is at most two meshes: wood/leather (matte) and iron/steel (plate).

const WOOD = 0x5a4028, DARKWOOD = 0x3a2a1c, IRON = 0x4a4d52, STEEL = 0xb9bfc7, BRASS = 0xa8873a, LEATHER = 0x3a2418;
const Z = (g: THREE.BufferGeometry, z = 0) => xf(g, { r: [Math.PI / 2, 0, 0], t: [0, 0, z] });
const grain = { jitter: 0.16, freq: 50 };

interface WeaponGeo { matte: THREE.BufferGeometry[]; metal: THREE.BufferGeometry[] }

function sword(): WeaponGeo {
  // Arming sword: diamond-section blade with a slight taper, straight guard, wheel pommel.
  const blade = Z(loft([{ y: 0.095, rx: 0.027, rz: 0.0065 }, { y: 0.5, rx: 0.022, rz: 0.005 }, { y: 0.85, rx: 0.015, rz: 0.0035 }, { y: 0.97, rx: 0.008, rz: 0.002 }, { y: 1.02, rx: 0.0008, rz: 0.0008 }], { seg: 4, n: 1, cap: 'both' }));
  // seg 4 with n=1 gives a true rhombus; flat-shade it so the bevels catch the light separately
  const flat = blade.toNonIndexed(); flat.computeVertexNormals();
  paint(flat, STEEL, { jitter: 0.05, fn: (p, c) => { if (Math.abs(p.x) < 0.007) c.multiplyScalar(0.72); if (noise3(p.z * 40, 3, 1) > 0.78) c.multiplyScalar(0.8); } });
  const guard = paint(tube([[-0.105, 0, 0.097], [-0.05, 0, 0.088], [0, 0, 0.086], [0.05, 0, 0.088], [0.105, 0, 0.097]], (t) => 0.0085 + Math.abs(t - 0.5) * 0.008, 6), 0x8a8f96, { jitter: 0.08 });
  const grip = paint(Z(loft([{ y: -0.022, rx: 0.014 }, { y: 0.03, rx: 0.0165 }, { y: 0.085, rx: 0.0135 }], { seg: 8, ripple: (_t, v) => Math.sin(v * 44) * 0.07 })), LEATHER, { jitter: 0.1 });
  const pommel = paint(xf(cyl(0.028, 0.028, 0.016, 12), { r: [0, 0, Math.PI / 2], t: [0, 0, -0.046] }), 0x8a8f96, { jitter: 0.08 });
  const boss = [-1, 1].map((s) => paint(xf(ball(0.01, 1, 1, 1, 6), { t: [s * 0.009, 0, -0.046] }), BRASS));
  return { matte: [grip], metal: [flat, guard, pommel, ...boss] };
}

function club(): WeaponGeo {
  const body = Z(loft([{ y: -0.08, rx: 0.02 }, { y: 0.1, rx: 0.022 }, { y: 0.4, rx: 0.04 }, { y: 0.62, rx: 0.058 }, { y: 0.7, rx: 0.05 }, { y: 0.73, rx: 0.02 }], { seg: 9, cap: 'both', ripple: (t, v) => (noise3(t * 6, v * 7, 4) - 0.5) * 0.3 * v }));
  const knots = [[0.03, 0.02, 0.5], [-0.035, -0.01, 0.62], [0.01, -0.04, 0.42]].map(([x, y, z]) => paint(xf(ball(0.022, 1, 1, 1, 6), { t: [x, y, z] }), DARKWOOD, grain));
  const nails = [[0.05, 0.015, 0.6, 0.3], [-0.03, 0.045, 0.66, 2.2], [0.0, -0.055, 0.56, 4.4], [-0.05, -0.02, 0.5, 3.4]].map(([x, y, z, a]) => paint(xf(new THREE.ConeGeometry(0.007, 0.05, 5), { r: [0, 0, a - Math.PI / 2], t: [x, y, z] }), IRON));
  return { matte: [paint(body, WOOD, { ...grain, grad: [-0.1, 0.1, 1, 1] }), ...knots], metal: nails };
}

function pin(): WeaponGeo {
  const c = 0x9a7c50;
  const body = Z(loft([{ y: 0.06, rx: 0.012 }, { y: 0.07, rx: 0.042 }, { y: 0.4, rx: 0.042 }, { y: 0.41, rx: 0.012 }], { seg: 12, cap: 'both' }));
  const handles = Z(loft([{ y: -0.06, rx: 0.014 }, { y: -0.04, rx: 0.017 }, { y: 0.06, rx: 0.012 }, { y: 0.41, rx: 0.012 }, { y: 0.5, rx: 0.017 }, { y: 0.53, rx: 0.012 }], { seg: 8, cap: 'both' }));
  return { matte: [paint(body, c, { jitter: 0.1, freq: 40 }), paint(handles, 0x7a5e3a, grain)], metal: [] };
}

function pan(): WeaponGeo {
  const handle = paint(Z(loft([{ y: -0.06, rx: 0.012, rz: 0.008 }, { y: 0.32, rx: 0.011, rz: 0.006 }], { seg: 6, cap: 'both', n: 3 })), IRON, { jitter: 0.15 });
  const bowl = loft([{ y: 0.045, rx: 0.165 }, { y: 0.04, rx: 0.17 }, { y: 0, rx: 0.14 }, { y: -0.005, rx: 0.02 }, { y: 0.004, rx: 0.02 }, { y: 0.008, rx: 0.132 }, { y: 0.04, rx: 0.158 }, { y: 0.045, rx: 0.165 }], { seg: 16, ripple: (t) => (noise3(t * 8, 2, 2) - 0.5) * 0.05 });
  return { matte: [], metal: [handle, paint(xf(bowl, { t: [0, -0.02, 0.47] }), 0x2e3033, { jitter: 0.2, freq: 30 })] };
}

function rake(): WeaponGeo {
  const shaft = paint(Z(loft([{ y: -0.3, rx: 0.017 }, { y: 1.2, rx: 0.015 }], { seg: 6, cap: 'both', ripple: (t, v) => (noise3(t * 4, v * 20, 1) - 0.5) * 0.12 })), WOOD, grain);
  const head = paint(xf(box(0.42, 0.035, 0.035), { t: [0, 0, 1.2] }), DARKWOOD, grain);
  const tines = Array.from({ length: 7 }, (_, i) => paint(xf(new THREE.ConeGeometry(0.009, 0.11, 5), { r: [Math.PI, 0, 0], t: [-0.18 + i * 0.06, -0.07, 1.2] }), WOOD, grain));
  return { matte: [shaft, head, ...tines], metal: [] };
}

function pitchfork(): WeaponGeo {
  const shaft = paint(Z(loft([{ y: -0.42, rx: 0.02 }, { y: 1.2, rx: 0.017 }], { seg: 7, cap: 'both', ripple: (t, v) => (noise3(t * 4, v * 20, 1) - 0.5) * 0.1 })), WOOD, grain);
  const socket = paint(Z(loft([{ y: 1.12, rx: 0.022 }, { y: 1.3, rx: 0.017 }], { seg: 7 })), IRON, { jitter: 0.12 });
  const tines = [-1, 0, 1].map((s) => paint(tube([[0, 0, 1.28], [s * 0.06, 0, 1.33], [s * 0.095, 0.01, 1.42], [s * 0.1, 0.03, 1.58], [s * 0.097, 0.04, 1.72]], (t) => 0.011 * (1 - t * 0.85), 5), 0x5c6068, { jitter: 0.12 }));
  return { matte: [shaft], metal: [socket, ...tines] };
}

function axe(): WeaponGeo {
  const haft = paint(tube([[0, 0, -0.22], [0, 0.008, 0.1], [0, -0.004, 0.45], [0, 0.01, 0.74], [0, 0.012, 0.84]], (t) => 0.021 + Math.sin(t * 3.14) * -0.003 + (t < 0.08 ? 0.006 : 0), 7, 0.78), WOOD, grain);
  // Felling axe head: a long wedge with a flared, curved bit.
  const s = new THREE.Shape();
  s.moveTo(-0.03, -0.035); s.lineTo(0.06, -0.045); s.quadraticCurveTo(0.13, -0.07, 0.185, -0.105); s.quadraticCurveTo(0.215, 0, 0.185, 0.105); s.quadraticCurveTo(0.13, 0.06, 0.06, 0.04); s.lineTo(-0.03, 0.035); s.closePath();
  const head = new THREE.ExtrudeGeometry(s, { depth: 0.036, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.016, bevelSegments: 2, curveSegments: 8 });
  head.translate(0, 0, -0.018);
  // shape X runs from poll to edge; put that along -Y (the cutting side) and the blade's length along Z
  xf(head, { r: [0, Math.PI / 2, 0] }); xf(head, { r: [0, 0, -Math.PI / 2] }); xf(head, { t: [0, -0.005, 0.75] });
  paint(head, IRON, { jitter: 0.16, freq: 40, fn: (p, c) => { const e = -p.y; if (e > 0.15) c.lerp(new THREE.Color(0xc8ced6), Math.min(1, (e - 0.15) * 22)); } });
  return { matte: [haft], metal: [head] };
}

const BUILD: Record<string, () => WeaponGeo> = { sword, club, pin, pan, rake, pitchfork, axe };
const cache = new Map<string, { matte: THREE.BufferGeometry | null; metal: THREE.BufferGeometry | null }>();

export function buildWeapon(model: string): THREE.Group {
  let c = cache.get(model);
  if (!c) { const w = (BUILD[model] ?? club)(); c = { matte: w.matte.length ? merge(w.matte) : null, metal: w.metal.length ? merge(w.metal) : null }; cache.set(model, c); }
  const g = new THREE.Group();
  for (const [geo, kind] of [[c.matte, 'matte'], [c.metal, 'plate']] as const) {
    if (!geo) continue;
    const m = new THREE.Mesh(geo, material(kind, 0));
    m.castShadow = true; m.userData.kind = kind;
    if (kind === 'plate' && model === 'sword') m.name = 'blade';
    g.add(m);
  }
  return g;
}

// ------------------------------------------------------------------ shield

let shieldFace: THREE.MeshStandardMaterial | null = null;
let shieldGeo: { face: THREE.BufferGeometry; matte: THREE.BufferGeometry; metal: THREE.BufferGeometry } | null = null;

/** Heater shield: curved board faced in painted linen, steel rim, straps behind. */
export function buildShield(): THREE.Group {
  if (!shieldGeo) {
    const W = 0.27, top = 0.32, H = 0.74;
    const half = (v: number) => (v < 0.3 ? W : W * Math.pow(Math.max(0, 1 - ((v - 0.3) / 0.7) ** 1.9), 0.62));
    const at = (u: number, v: number, off: number): [number, number, number] => { const x = u * half(v); return [x, top - v * H, off - x * x * 1.5]; };
    const grid = (off: number, back: boolean) => {
      const nu = 12, nv = 16, pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const u = (i / nu) * 2 - 1, v = j / nv; pos.push(...at(u, v, off)); uv.push(0.5 + u * (half(v) / W) * 0.5, 1 - v); }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; if (back) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    // rim follows the outline
    const outline: [number, number, number][] = [];
    for (let i = 0; i <= 10; i++) outline.push(at(-1 + (i / 10) * 2, 0, 0));
    for (let j = 1; j <= 22; j++) outline.push(at(1, j / 22, 0));
    for (let j = 21; j >= 0; j--) outline.push(at(-1, j / 22, 0));
    const rim = paint(tube(outline, 0.011, 6), 0x8a8f96, { jitter: 0.12 });
    const studs = [0.12, 0.3, 0.5, 0.7].flatMap((v) => [-1, 1].map((s) => paint(xf(ball(0.008, 1, 1, 1, 6), { t: at(s * 0.86, v, 0.012) }), 0x9aa0a8)));
    const back = paint(grid(-0.02, true), 0x4a3524, { jitter: 0.18, freq: 30 });
    const straps = [0.08, -0.1].map((y) => paint(tube([[-0.11, y, -0.028], [-0.05, y, -0.075], [0.05, y, -0.075], [0.11, y, -0.028]], 0.012, 5, 0.3), LEATHER, { jitter: 0.1 }));
    shieldGeo = { face: grid(0.002, false), matte: merge([back, ...straps]), metal: merge([rim, ...studs]) };
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const x = cv.getContext('2d')!;
    drawHeart(x, 512, true);
    // a hard life: gouges through the paint to the wood
    for (let i = 0; i < 9; i++) { x.strokeStyle = `rgba(${150 + i * 6},${120 + i * 4},${80},0.75)`; x.lineWidth = 2 + (i % 3); const px = 60 + ((i * 97) % 400), py = 40 + ((i * 151) % 420), a = i * 1.3; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * (20 + i * 5), py + Math.sin(a) * (20 + i * 5)); x.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    shieldFace = new THREE.MeshStandardMaterial({ map: t, roughness: 0.72, metalness: 0.05 });
  }
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, kind?: string) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; if (kind) o.userData.kind = kind; o.position.set(0, -0.03, 0.085); g.add(o); };
  add(shieldGeo.face, shieldFace!);
  add(shieldGeo.matte, material('matte', 0), 'matte');
  add(shieldGeo.metal, material('plate', 0), 'plate');
  return g;
}
