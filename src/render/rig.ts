import * as THREE from 'three';
import type { Fighter, Limb } from '../sim/types';

// Characters are built in code from primitives on one shared skeleton layout, and animated
// procedurally (two-bone arm IK driven by hand targets, FK legs). The joint names and the
// "pose" structure are the seam where glTF models and animation clips drop in later.
//
// Character space: +Z forward, +Y up, +X is the character's LEFT.

const DIM = { hip: 0.95, torso: 0.5, shoulder: 0.21, upper: 0.3, fore: 0.28, thigh: 0.45, shin: 0.48, legX: 0.1 };
export const LIMB_LEN: Record<Limb, number> = { head: 0.26, armL: 0.6, armR: 0.6, legL: 0.95, legR: 0.95 };

type V3 = [number, number, number];
export interface Pose {
  rh: V3; rdir: V3; lh: V3; ldir: V3;
  twist: number; lean: number; crouch: number; stance: number;
  pitch: number; lift: number; headPitch: number; roll: number;
}
type PartialPose = Partial<Pose>;
const P = (p: PartialPose): PartialPose => p;

// ------------------------------------------------------------------ pose library

const IDLE: Record<string, Pose> = {
  knight: { rh: [-0.28, -0.34, 0.22], rdir: [0.15, 0.8, 0.55], lh: [0.2, -0.3, 0.3], ldir: [0.35, 0, 1], twist: 0.25, lean: 0.06, crouch: 0.05, stance: 0.35, pitch: 0, lift: 0, headPitch: 0, roll: 0 },
  one: { rh: [-0.3, -0.3, 0.2], rdir: [0.1, 0.85, 0.5], lh: [0.26, -0.42, 0.08], ldir: [0, 0, 1], twist: 0.1, lean: 0.12, crouch: 0.04, stance: 0.2, pitch: 0, lift: 0, headPitch: 0.05, roll: 0 },
  fork: { rh: [-0.26, -0.36, -0.08], rdir: [0.1, 0.22, 1], lh: [0, 0, 0], ldir: [0, 0, 1], twist: -0.35, lean: 0.14, crouch: 0.06, stance: 0.4, pitch: 0, lift: 0, headPitch: 0, roll: 0 },
  axe: { rh: [-0.2, -0.32, 0.16], rdir: [0.55, 0.75, 0.3], lh: [0, 0, 0], ldir: [0, 0, 1], twist: -0.1, lean: 0.1, crouch: 0.04, stance: 0.3, pitch: 0, lift: 0, headPitch: 0, roll: 0 },
};

interface Anim { wind: PartialPose; keys: PartialPose[] }
const ANIMS: Record<string, Anim> = {
  slashR: {
    wind: P({ rh: [-0.5, 0.18, -0.12], rdir: [-0.7, 0.6, -0.4], twist: -0.7, stance: 0.5 }),
    keys: [P({ rh: [-0.56, 0.06, 0.3], rdir: [-0.9, 0.1, 0.4], twist: -0.2 }), P({ rh: [0, -0.05, 0.56], rdir: [0.1, 0, 1], twist: 0.35, lean: 0.2 }), P({ rh: [0.42, -0.16, 0.28], rdir: [0.95, -0.1, 0.25], twist: 0.8, lean: 0.2, stance: 0.7 })],
  },
  slashL: {
    wind: P({ rh: [0.36, 0.1, 0.16], rdir: [0.8, 0.5, -0.25], twist: 0.75, stance: 0.5 }),
    keys: [P({ rh: [0.3, 0, 0.42], rdir: [0.9, 0.1, 0.4], twist: 0.4 }), P({ rh: [-0.12, -0.05, 0.56], rdir: [-0.1, 0, 1], twist: -0.1, lean: 0.2 }), P({ rh: [-0.56, -0.12, 0.18], rdir: [-0.95, -0.05, 0.25], twist: -0.75, lean: 0.2, stance: 0.7 })],
  },
  overhead: {
    wind: P({ rh: [-0.24, 0.5, -0.16], rdir: [0, 0.55, -0.85], lean: -0.14, twist: -0.25, stance: 0.4 }),
    keys: [P({ rh: [-0.2, 0.52, 0.2], rdir: [0, 1, 0.2], lean: 0 }), P({ rh: [-0.15, 0.1, 0.56], rdir: [0, 0.3, 1], lean: 0.25 }), P({ rh: [-0.1, -0.36, 0.44], rdir: [0, -0.5, 0.85], lean: 0.42, crouch: 0.14, stance: 0.8, twist: 0.25 })],
  },
  thrust: {
    wind: P({ rh: [-0.32, -0.08, -0.2], rdir: [0, 0.05, 1], twist: -0.6, stance: 0.4, lean: 0.05 }),
    keys: [P({ rh: [-0.22, -0.05, 0.3], rdir: [0, 0, 1], twist: 0 }), P({ rh: [-0.1, -0.02, 0.6], rdir: [0, 0, 1], twist: 0.55, lean: 0.32, stance: 0.9, crouch: 0.1 })],
  },
  sweep: {
    wind: P({ rh: [-0.42, -0.1, -0.3], rdir: [-0.8, 0.1, -0.6], twist: -1.1, crouch: 0.16, stance: 0.5 }),
    keys: [P({ rh: [-0.58, -0.2, 0.1], rdir: [-1, -0.1, 0.2], twist: -0.5, crouch: 0.2 }), P({ rh: [0, -0.26, 0.56], rdir: [0, -0.15, 1], twist: 0.5, crouch: 0.2 }), P({ rh: [0.5, -0.2, 0.05], rdir: [1, -0.1, -0.2], twist: 1.4, crouch: 0.18, stance: 0.8 })],
  },
  bash: {
    wind: P({ lh: [0.24, -0.16, 0.08], ldir: [0, 0, 1], twist: 0.4, stance: 0.4 }),
    keys: [P({ lh: [0.08, -0.1, 0.5], ldir: [0, 0, 1], twist: -0.3, lean: 0.2 }), P({ lh: [0.02, -0.08, 0.58], ldir: [0, 0, 1], twist: -0.55, lean: 0.28, stance: 0.8 })],
  },
  charge: {
    wind: P({ lh: [0.05, -0.14, 0.4], ldir: [0, 0, 1], lean: 0.3, crouch: 0.16 }),
    keys: [P({ lh: [0.02, -0.12, 0.5], ldir: [0, 0, 1], lean: 0.5, crouch: 0.18, twist: -0.3, rh: [-0.34, -0.3, -0.2], rdir: [0, 0.3, -1] })],
  },
  club: {
    wind: P({ rh: [-0.3, 0.46, -0.14], rdir: [-0.2, 0.6, -0.8], lean: -0.1, twist: -0.4 }),
    keys: [P({ rh: [-0.24, 0.4, 0.25], rdir: [0, 1, 0.3] }), P({ rh: [-0.1, -0.2, 0.5], rdir: [0.2, -0.4, 0.9], lean: 0.35, twist: 0.4, stance: 0.6 })],
  },
  poke: {
    wind: P({ rh: [-0.3, -0.26, -0.3], rdir: [0, 0.08, 1], twist: -0.6, lean: 0, stance: 0.5 }),
    keys: [P({ rh: [-0.2, -0.2, 0.2], rdir: [0, 0, 1], twist: -0.1 }), P({ rh: [-0.12, -0.16, 0.5], rdir: [0, -0.03, 1], twist: 0.35, lean: 0.35, stance: 0.9 })],
  },
  chop: {
    wind: P({ rh: [-0.1, 0.5, -0.2], rdir: [0.1, 0.5, -0.85], lean: -0.22, stance: 0.4 }),
    keys: [P({ rh: [-0.1, 0.55, 0.15], rdir: [0, 1, 0.1], lean: 0 }), P({ rh: [-0.05, 0.1, 0.52], rdir: [0, 0.2, 1], lean: 0.3 }), P({ rh: [0, -0.4, 0.4], rdir: [0, -0.6, 0.8], lean: 0.5, crouch: 0.16, stance: 0.8 })],
  },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(a: Pose, b: PartialPose, t: number): Pose {
  const o = { ...a } as Pose;
  for (const k in b) {
    const key = k as keyof Pose, bv = b[key]!, av = a[key];
    (o as unknown as Record<string, unknown>)[key] = Array.isArray(bv)
      ? [lerp((av as V3)[0], bv[0], t), lerp((av as V3)[1], bv[1], t), lerp((av as V3)[2], bv[2], t)]
      : lerp(av as number, bv as number, t);
  }
  return o;
}
const ease = (t: number) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------ materials and geometry caches

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const BLOOD = new THREE.Color(0x4a0606);
export function mat(color: number, rough = 0.9, metal = 0, blood = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${blood}`;
  let m = matCache.get(key);
  if (!m) {
    const c = new THREE.Color(color).lerp(BLOOD, blood * 0.75);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: lerp(rough, 0.35, blood * 0.6), metalness: metal * (1 - blood * 0.4) });
    m.userData = { color, rough, metal };
    matCache.set(key, m);
  }
  return m;
}
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g as T;
}
/** A tapered limb segment hanging down from its origin. */
function seg(len: number, r0: number, r1: number, m: THREE.Material): THREE.Mesh {
  const g = geo(`seg${len}|${r0}|${r1}`, () => {
    const c = new THREE.CylinderGeometry(r0, r1, len, 10, 1);
    c.translate(0, -len / 2, 0);
    return c;
  });
  return mesh(g, m);
}
function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  return o;
}
const ball = (r: number, m: THREE.Material) => mesh(geo(`ball${r}`, () => new THREE.SphereGeometry(r, 14, 10)), m);
const box = (x: number, y: number, z: number, m: THREE.Material) => mesh(geo(`box${x}|${y}|${z}`, () => new THREE.BoxGeometry(x, y, z)), m);
const cyl = (r0: number, r1: number, h: number, m: THREE.Material, s = 12) => mesh(geo(`cyl${r0}|${r1}|${h}|${s}`, () => new THREE.CylinderGeometry(r0, r1, h, s)), m);

const STEEL = 0xa8aeb6, MAIL = 0x6a6f78, WOOD = 0x4a3524, IRON = 0x3a3c40, SKIN = [0xc9a184, 0xb98d6f, 0xd4b196, 0xa87f63];
const TUNICS = [0x5d5038, 0x4b4a3a, 0x6a5a45, 0x57493a, 0x44503e, 0x5a4a50, 0x6b6250, 0x3f4a52];
const HOSE = [0x3c352c, 0x4a4234, 0x2f2f2c, 0x51463a];
export const CRIMSON = 0x7d1016;

// ------------------------------------------------------------------ weapons

export function buildWeapon(model: string): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(WOOD, 0.85), iron = mat(IRON, 0.5, 0.8), steel = mat(STEEL, 0.28, 1);
  const along = (o: THREE.Object3D, z: number) => { o.rotation.x = Math.PI / 2; o.position.z = z; g.add(o); return o; };
  switch (model) {
    case 'sword': {
      along(cyl(0.017, 0.017, 0.16, mat(0x2a1c14, 0.7), 8), 0);
      along(ball(0.03, steel), -0.1);
      const guard = box(0.2, 0.025, 0.03, steel); guard.position.z = 0.09; g.add(guard);
      const blade = mesh(geo('blade', () => { const b = new THREE.BoxGeometry(0.045, 0.012, 0.86); b.translate(0, 0, 0.53); return b; }), steel);
      blade.name = 'blade'; g.add(blade);
      const tip = mesh(geo('tip', () => { const c = new THREE.ConeGeometry(0.0225, 0.1, 4); c.rotateX(Math.PI / 2); c.scale(1, 0.27, 1); c.translate(0, 0, 1.01); return c; }), steel);
      g.add(tip);
      break;
    }
    case 'club': along(cyl(0.05, 0.022, 0.75, wood, 8), 0.3); break;
    case 'pin': along(cyl(0.04, 0.04, 0.4, mat(0x8a6f4a, 0.8), 10), 0.22); along(cyl(0.015, 0.015, 0.62, mat(0x8a6f4a, 0.8), 6), 0.22); break;
    case 'pan': { along(cyl(0.014, 0.014, 0.4, iron, 6), 0.15); const p = cyl(0.15, 0.13, 0.04, iron, 14); p.position.z = 0.5; g.add(p); break; }
    case 'rake': {
      along(cyl(0.017, 0.017, 1.5, wood, 6), 0.45);
      const head = box(0.4, 0.03, 0.03, wood); head.position.z = 1.2; g.add(head);
      for (let i = 0; i < 6; i++) { const t = cyl(0.008, 0.004, 0.1, wood, 4); t.position.set(-0.17 + i * 0.068, -0.06, 1.2); g.add(t); }
      break;
    }
    case 'pitchfork': {
      along(cyl(0.018, 0.018, 1.75, wood, 6), 0.45);
      const bar = box(0.2, 0.02, 0.02, iron); bar.position.z = 1.33; g.add(bar);
      for (let i = -1; i <= 1; i++) { const t = along(cyl(0.004, 0.011, 0.34, iron, 5), 1.5); t.position.x = i * 0.09; }
      break;
    }
    case 'axe': {
      along(cyl(0.02, 0.024, 1.0, wood, 6), 0.32);
      const head = mesh(geo('axehead', () => { const s = new THREE.Shape(); s.moveTo(0, -0.04); s.lineTo(0.14, -0.1); s.lineTo(0.16, 0.1); s.lineTo(0, 0.04); const e = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false }); e.translate(0.01, 0, -0.0125); e.rotateX(Math.PI / 2); e.rotateZ(-Math.PI / 2); return e; }), mat(0x6c7078, 0.35, 0.9));
      head.position.z = 0.72; g.add(head);
      break;
    }
  }
  return g;
}

function heartTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#7d1016'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 300; i++) x.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 22, 1.5);
  x.fillStyle = '#c9ccd2';
  x.beginPath(); x.moveTo(128, 196); x.bezierCurveTo(40, 130, 62, 62, 128, 104); x.bezierCurveTo(194, 62, 216, 130, 128, 196); x.fill();
  x.fillStyle = '#4a0606';
  for (const [dx, h] of [[-18, 34], [4, 52], [22, 26]]) { x.beginPath(); x.ellipse(128 + dx, 190 + h / 2, 5, h / 2, 0, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let shieldMat: THREE.MeshStandardMaterial | null = null;
export function buildShield(): THREE.Group {
  const g = new THREE.Group();
  shieldMat ??= new THREE.MeshStandardMaterial({ map: heartTexture(), roughness: 0.6, metalness: 0.1 });
  const m = mesh(geo('heater', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.26, 0.3); s.lineTo(0.26, 0.3); s.lineTo(0.26, 0.02); s.quadraticCurveTo(0.24, -0.26, 0, -0.4); s.quadraticCurveTo(-0.24, -0.26, -0.26, 0.02); s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
    const uv = e.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.52 + 0.5, (uv.getY(i) + 0.4) / 0.7);
    return e;
  }), shieldMat);
  m.position.set(0, -0.02, 0.05);
  g.add(m);
  return g;
}

// ------------------------------------------------------------------ the rig

interface Arm { upper: THREE.Group; fore: THREE.Group; hand: THREE.Group }
interface Leg { thigh: THREE.Group; shin: THREE.Group }

export class Rig {
  root = new THREE.Group();
  body = new THREE.Group();
  hips = new THREE.Group();
  chest = new THREE.Group();
  head = new THREE.Group();
  arms: { L: Arm; R: Arm };
  legs: { L: Leg; R: Leg };
  weapon: THREE.Group | null = null;
  shield: THREE.Group | null = null;
  stumps = {} as Record<Limb, THREE.Mesh>;
  /** Meshes that pick up blood, with their clean material. */
  private stainable: THREE.Mesh[] = [];
  private bloodLevel = 0;
  private pose: Pose;
  private idleKey: string;
  private walk = 0;
  private seed = Math.random() * 10;
  private fall = Math.random() < 0.5 ? 1 : -1;
  twoHanded = false;
  scale = 1;
  /** Armour meshes by piece id, so a broken piece can fall away. */
  armourMeshes = new Map<string, THREE.Mesh[]>();

  constructor(public look: string, weaponModel: string | null, opts: { scale?: number; kit?: string; shield?: boolean; twoHanded?: boolean } = {}) {
    this.scale = opts.scale ?? 1;
    this.twoHanded = !!opts.twoHanded;
    this.idleKey = look === 'knight' ? 'knight' : weaponModel === 'pitchfork' || weaponModel === 'rake' ? 'fork' : weaponModel === 'axe' ? 'axe' : 'one';
    this.pose = { ...IDLE[this.idleKey] };
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = DIM.hip;
    this.hips.add(this.chest);
    this.chest.position.y = DIM.torso;
    this.chest.add(this.head);
    this.head.position.y = 0.06;
    const arm = (side: number): Arm => {
      const upper = new THREE.Group(), fore = new THREE.Group(), hand = new THREE.Group();
      upper.position.set(side * DIM.shoulder, -0.03, 0);
      fore.position.y = -DIM.upper; hand.position.y = -DIM.fore;
      upper.add(fore); fore.add(hand); this.chest.add(upper);
      return { upper, fore, hand };
    };
    const leg = (side: number): Leg => {
      const thigh = new THREE.Group(), shin = new THREE.Group();
      thigh.position.set(side * DIM.legX, 0, 0); shin.position.y = -DIM.thigh;
      thigh.add(shin); this.hips.add(thigh);
      return { thigh, shin };
    };
    this.arms = { L: arm(1), R: arm(-1) };
    this.legs = { L: leg(1), R: leg(-1) };
    if (look === 'knight') this.dressKnight(opts.kit ?? 'mail'); else this.dressPeasant(look);
    this.addStumps();
    if (weaponModel) { this.weapon = buildWeapon(weaponModel); this.arms.R.hand.add(this.weapon); }
    if (opts.shield) { this.shield = buildShield(); this.arms.L.hand.add(this.shield); }
    this.root.scale.setScalar(this.scale);
  }

  private part(parent: THREE.Object3D, m: THREE.Mesh, stain = true, piece?: string): THREE.Mesh {
    parent.add(m);
    if (stain) this.stainable.push(m);
    m.userData.clean = m.material;
    if (piece) { const l = this.armourMeshes.get(piece) ?? []; l.push(m); this.armourMeshes.set(piece, l); }
    return m;
  }

  private addStumps(): void {
    const gore = mat(0x5a0a0a, 0.3);
    const mk = (parent: THREE.Object3D, x: number, y: number, r: number) => {
      const s = ball(r, gore); s.scale.y = 0.5; s.position.set(x, y, 0); s.visible = false; parent.add(s); return s;
    };
    this.stumps.head = mk(this.chest, 0, 0.07, 0.055);
    this.stumps.armL = mk(this.chest, DIM.shoulder, -0.04, 0.06);
    this.stumps.armR = mk(this.chest, -DIM.shoulder, -0.04, 0.06);
    this.stumps.legL = mk(this.hips, DIM.legX, -0.06, 0.08);
    this.stumps.legR = mk(this.hips, -DIM.legX, -0.06, 0.08);
  }

  private dressPeasant(look: string): void {
    const rnd = (a: readonly number[]) => a[Math.floor(Math.random() * a.length)];
    const skin = mat(rnd(SKIN), 0.75), tunic = mat(look === 'woodcutter' ? 0x4a3a2c : rnd(TUNICS), 0.95), hose = mat(rnd(HOSE), 0.95);
    const fat = look === 'woodcutter' ? 1.2 : 0.9 + Math.random() * 0.3;
    const torso = this.part(this.chest, mesh(geo('ptorso', () => { const c = new THREE.CylinderGeometry(0.2, 0.19, 0.56, 12); c.translate(0, -0.25, 0); return c; }), tunic));
    torso.scale.set(1.08, 1, 0.72 * fat);
    const skirt = this.part(this.hips, mesh(geo('pskirt', () => { const c = new THREE.CylinderGeometry(0.2, 0.27, 0.36, 12, 1, true); c.translate(0, -0.12, 0); return c; }), tunic));
    skirt.scale.set(1.05, 1, 0.78 * fat); (skirt.material as THREE.Material).side = THREE.DoubleSide;
    const belt = cyl(0.205, 0.205, 0.05, mat(0x2a1c14, 0.8), 12); belt.scale.set(1.08, 1, 0.76 * fat); belt.position.y = 0.06; this.hips.add(belt);
    if (look === 'woodcutter') { const apron = this.part(this.chest, box(0.3, 0.62, 0.02, mat(0x3a2a1c, 0.7))); apron.position.set(0, -0.36, 0.15 * fat); }
    for (const a of [this.arms.L, this.arms.R]) {
      this.part(a.upper, seg(DIM.upper, 0.062, 0.05, tunic));
      this.part(a.upper, ball(0.068, tunic));
      this.part(a.fore, seg(DIM.fore, 0.048, 0.038, skin));
      this.part(a.hand, ball(0.045, skin));
    }
    for (const l of [this.legs.L, this.legs.R]) {
      this.part(l.thigh, seg(DIM.thigh, 0.085, 0.062, hose));
      this.part(l.shin, seg(DIM.shin - 0.06, 0.06, 0.045, hose));
      const foot = this.part(l.shin, box(0.09, 0.07, 0.22, mat(0x2a2018, 0.9))); foot.position.set(0, -DIM.shin + 0.035, 0.05);
    }
    // Bruegel heads: heavy jaws, bulbous noses, small suspicious eyes.
    const h = this.head;
    const skull = this.part(h, ball(0.115, skin)); skull.position.y = 0.13; skull.scale.set(0.95, 1.05, 1);
    const jaw = this.part(h, box(0.15, 0.09, 0.14, skin)); jaw.position.set(0, 0.055, 0.025); jaw.scale.x = 0.8 + Math.random() * 0.4;
    const nose = this.part(h, ball(0.03 + Math.random() * 0.022, mat(0xb5745f, 0.7))); nose.position.set(0, 0.115, 0.115); nose.scale.set(1, 1.2, 1.2);
    const dark = mat(0x16100c, 0.6);
    for (const s of [-1, 1]) { const e = ball(0.014, dark); e.position.set(s * 0.042, 0.155, 0.098); h.add(e); }
    const neck = this.part(this.chest, cyl(0.05, 0.06, 0.1, skin, 8)); neck.position.y = 0.05;
    const hat = Math.floor(Math.random() * 4);
    if (look === 'farmhand' || hat === 0) { // straw hat
      const straw = mat(0x9a8450, 0.95);
      const brim = cyl(0.22, 0.24, 0.02, straw, 14); brim.position.y = 0.2; h.add(brim);
      const crown = cyl(0.09, 0.115, 0.1, straw, 12); crown.position.y = 0.25; h.add(crown);
    } else if (look === 'woodcutter' || hat === 1) { // hood
      const hood = this.part(h, mesh(geo('hood', () => new THREE.SphereGeometry(0.135, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62)), mat(look === 'woodcutter' ? 0x2e2a22 : rnd(TUNICS), 0.95)));
      hood.position.y = 0.135; hood.rotation.x = -0.35;
    } else if (hat === 2) { // linen coif
      const coif = mesh(geo('coif', () => new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), mat(0xa39a86, 0.95));
      coif.position.y = 0.135; coif.rotation.x = -0.2; h.add(coif);
    } else { const hair = mesh(geo('hair', () => new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.42)), mat(rnd([0x2a2018, 0x4a3a28, 0x77705f]), 1)); hair.position.y = 0.135; hair.rotation.x = -0.25; h.add(hair); }
    if (look === 'woodcutter' || Math.random() < 0.3) { const beard = box(0.14, 0.1, 0.09, mat(rnd([0x2a2018, 0x4a3a28, 0x6a6458]), 1)); beard.position.set(0, 0.03, 0.07); h.add(beard); }
  }

  private dressKnight(kit: string): void {
    const plate = kit === 'plate';
    const mail = mat(MAIL, 0.55, 0.55), steel = mat(STEEL, 0.32, 0.9), surcoat = mat(CRIMSON, 0.9), leather = mat(0x2a1c14, 0.75);
    const limbMat = plate ? steel : mail;
    const pc = { head: plate ? 'greatHelm' : 'nasalHelm', torso: plate ? 'cuirass' : 'hauberk', arms: plate ? 'plateArms' : 'mailSleeves', legs: plate ? 'plateLegs' : 'chausses' };
    const torso = this.part(this.chest, mesh(geo('ktorso', () => { const c = new THREE.CylinderGeometry(0.215, 0.19, 0.56, 14); c.translate(0, -0.25, 0); return c; }), plate ? steel : surcoat), true, pc.torso);
    torso.scale.set(1.1, 1, 0.78);
    if (plate) { const tab = this.part(this.chest, box(0.2, 0.4, 0.02, surcoat)); tab.position.set(0, -0.28, 0.172); }
    // Surcoat skirt, split front and back so the legs can move.
    for (const s of [-1, 1]) {
      const panel = this.part(this.hips, mesh(geo('kskirt', () => { const b = new THREE.BoxGeometry(0.4, 0.5, 0.025); b.translate(0, -0.25, 0); return b; }), surcoat));
      panel.position.set(0, 0.04, s * 0.15); panel.rotation.x = -s * 0.1; panel.name = s > 0 ? 'skirtF' : 'skirtB';
    }
    const fauld = this.part(this.hips, cyl(0.21, 0.23, 0.2, limbMat, 14), true, pc.torso); fauld.scale.set(1.08, 1, 0.8); fauld.position.y = -0.03;
    const belt = cyl(0.222, 0.222, 0.05, leather, 14); belt.scale.set(1.1, 1, 0.8); belt.position.y = 0.07; this.hips.add(belt);
    for (const a of [this.arms.L, this.arms.R]) {
      this.part(a.upper, seg(DIM.upper, 0.07, 0.056, limbMat), true, pc.arms);
      const sh = this.part(a.upper, ball(plate ? 0.095 : 0.078, limbMat), true, pc.arms); if (plate) sh.scale.set(1, 0.8, 1.1);
      this.part(a.fore, seg(DIM.fore, 0.056, 0.045, limbMat), true, pc.arms);
      if (plate) { const co = this.part(a.fore, ball(0.062, steel), true, pc.arms); co.position.y = 0; }
      this.part(a.hand, ball(0.052, leather));
    }
    for (const l of [this.legs.L, this.legs.R]) {
      this.part(l.thigh, seg(DIM.thigh, 0.092, 0.068, limbMat), true, pc.legs);
      this.part(l.shin, seg(DIM.shin - 0.06, 0.066, 0.05, limbMat), true, pc.legs);
      const knee = this.part(l.shin, ball(0.072, plate ? steel : mail), true, pc.legs); knee.scale.z = 1.15;
      const foot = this.part(l.shin, box(0.095, 0.075, 0.24, plate ? steel : leather)); foot.position.set(0, -DIM.shin + 0.037, 0.05);
    }
    const h = this.head;
    const neck = this.part(this.chest, cyl(0.06, 0.075, 0.1, mail, 10)); neck.position.y = 0.05;
    if (plate) {
      const helm = this.part(h, cyl(0.13, 0.135, 0.27, steel, 16), true, pc.head); helm.position.y = 0.14;
      const top = this.part(h, cyl(0.115, 0.13, 0.03, steel, 16), true, pc.head); top.position.y = 0.288;
      const slit = box(0.2, 0.014, 0.02, mat(0x050505, 1)); slit.position.set(0, 0.175, 0.125); h.add(slit);
      const ridge = box(0.014, 0.2, 0.02, steel); ridge.position.set(0, 0.12, 0.134); h.add(ridge);
    } else {
      const coif = this.part(h, ball(0.128, mail)); coif.position.y = 0.13;
      const face = ball(0.1, mat(0xb98d6f, 0.75)); face.position.set(0, 0.115, 0.04); h.add(face);
      const helm = this.part(h, mesh(geo('nasal', () => { const g = new THREE.SphereGeometry(0.136, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5); g.scale(1, 1.25, 1); return g; }), steel), true, pc.head);
      helm.position.y = 0.14;
      const nasal = this.part(h, box(0.028, 0.12, 0.014, steel), true, pc.head); nasal.position.set(0, 0.1, 0.136);
      const rim = this.part(h, cyl(0.139, 0.139, 0.022, steel, 16), true, pc.head); rim.position.y = 0.145;
    }
  }

  /** A broken armour piece falls away, leaving the padding underneath. */
  breakArmour(piece: string): void {
    const pad = mat(0x8a7a5c, 0.95);
    for (const m of this.armourMeshes.get(piece) ?? []) { m.material = pad; m.userData.clean = pad; }
    this.bloodLevel = -1;
  }

  setBlood(v: number): void {
    const lvl = Math.min(3, Math.floor(v * 4));
    if (lvl === this.bloodLevel) return;
    this.bloodLevel = lvl;
    for (const m of this.stainable) {
      const c = (m.userData.clean as THREE.MeshStandardMaterial);
      const u = c.userData as { color: number; rough: number; metal: number };
      if (u.color === undefined) continue;
      m.material = mat(u.color, u.rough, u.metal, lvl / 3);
    }
  }

  /** Detach a limb for the gore system: returns the group (still parented) or null if already gone. */
  limbGroup(limb: Limb): THREE.Group | null {
    const g = limb === 'head' ? this.head : limb === 'armL' ? this.arms.L.upper : limb === 'armR' ? this.arms.R.upper : limb === 'legL' ? this.legs.L.thigh : this.legs.R.thigh;
    return g.parent ? g : null;
  }

  // ---------------------------------------------------------------- animation

  private target(f: Fighter, dt: number): { pose: Pose; rate: number } {
    const idle = IDLE[this.idleKey];
    const t = f.stateT;
    switch (f.state) {
      case 'attack': {
        const mv = f.move!;
        const a = ANIMS[mv.anim] ?? ANIMS.club;
        if (f.phase === 'windup') {
          const p = ease(Math.min(1, t / mv.windup));
          const wind = mix(idle, a.wind, 1);
          // Charging: draw further back and tremble a little.
          if (f.charge > 0) { wind.twist *= 1 + f.charge * 0.3; wind.lean -= f.charge * 0.1; wind.rh = [wind.rh[0] + Math.sin(this.seed + t * 60) * 0.008 * f.charge, wind.rh[1], wind.rh[2]]; }
          return { pose: mix(idle, wind, p), rate: Math.max(9, 3.5 / mv.windup) };
        }
        const keys = a.keys;
        if (f.phase === 'active') {
          const p = Math.min(0.999, (t - mv.windup) / mv.active) * (keys.length - 1);
          const i = Math.floor(p);
          const from = mix(idle, a.wind, 1);
          const k0 = i === 0 ? mix(from, keys[0], 1) : this.accum(from, keys, i);
          return { pose: mix(k0, keys[i + 1] ?? keys[i], p - i), rate: 55 };
        }
        const end = this.accum(mix(idle, a.wind, 1), keys, keys.length - 1);
        const p = ease(Math.min(1, (t - mv.windup - mv.active) / mv.recovery));
        return { pose: mix(end, idle, Math.max(0, p * 1.4 - 0.4)), rate: 16 };
      }
      case 'block':
        return { pose: mix(idle, { lh: [0.04, -0.12, 0.42], ldir: [0, 0.05, 1], rh: [-0.32, -0.3, 0.02], rdir: [0.2, 0.6, 0.7], crouch: 0.1, lean: 0.12, twist: 0.35, stance: 0.5 }, 1), rate: 30 };
      case 'dodge':
        return { pose: mix(idle, { crouch: 0.22, lean: 0.3, stance: 0.8, headPitch: 0.2 }, 1), rate: 25 };
      case 'stagger': {
        const w = Math.sin(t * 9 + this.seed) * 0.15;
        return { pose: mix(idle, { lean: -0.32, twist: w * 2, rh: [-0.5, -0.12, -0.1], rdir: [-0.6, 0.3, 0.6], lh: [0.5, -0.1, -0.05], headPitch: -0.35, crouch: 0.08, roll: w }, 1), rate: 18 };
      }
      case 'down':
        if (f.crippled && f.team === 1) return { pose: mix(idle, { pitch: Math.PI / 2, lift: 0.14, rh: [-0.25, 0.4 + Math.sin(t * 3) * 0.12, 0.2], rdir: [0, 1, 0.2], lh: [0.25, 0.4 - Math.sin(t * 3) * 0.12, 0.2], lean: 0, headPitch: -0.5, crouch: 0, twist: 0 }, 1), rate: 6 };
        return { pose: mix(idle, { pitch: -Math.PI / 2, lift: 0.14, rh: [-0.5, 0.05, 0.1], rdir: [-0.7, 0.2, 0.6], lh: [0.5, 0, 0.1], lean: 0, crouch: 0, headPitch: 0.2, twist: 0 }, 1), rate: 9 };
      case 'getup':
        return { pose: mix(idle, { crouch: 0.3, lean: 0.4 }, 1 - t / Math.max(0.01, f.stateDur)), rate: 10 };
      case 'dead': case 'gone':
        return { pose: mix(idle, { pitch: (this.fall * Math.PI) / 2, lift: 0.12, rh: [-0.45, 0.1 * this.fall, 0.05], rdir: [-0.8, 0, 0.5], lh: [0.5, -0.2, 0.05], lean: 0, crouch: 0, twist: 0.3 * this.fall, headPitch: 0.3, roll: 0.15, stance: 0.4 }, 1), rate: 7 };
      case 'finished':
        return { pose: mix(idle, { crouch: 0.46, lean: 0.25, headPitch: 0.5, rh: [-0.3, -0.45, 0.1], rdir: [0, -0.6, 0.6], lh: [0.3, -0.45, 0.1], pitch: 0, lift: 0, twist: 0, stance: 0 }, 1), rate: 8 };
      case 'finishing': {
        if (t < 0.9) return { pose: mix(idle, { rh: [-0.42, 0.42, -0.2], rdir: [-0.5, 0.75, -0.45], twist: -0.9, lean: -0.08, stance: 0.6 }, ease(Math.min(1, t / 0.6))), rate: 7 };
        return { pose: mix(idle, { rh: [0.44, 0.0, 0.3], rdir: [0.95, -0.05, 0.25], twist: 0.95, lean: 0.22, stance: 0.8 }, 1), rate: t < 1.15 ? 40 : 6 };
      }
    }
    // idle and locomotion
    const ai = f.ai;
    if (ai?.mode === 'cower') return { pose: mix(idle, { crouch: 0.4, lean: 0.5, rh: [-0.12, 0.2, 0.16], rdir: [0.3, 0.8, 0.3], lh: [0.12, 0.2, 0.16], headPitch: 0.5 }, 1), rate: 8 };
    if (ai?.mode === 'flee') return { pose: mix(idle, { rh: [-0.34, 0.3 + Math.sin(this.walk) * 0.1, 0.12], rdir: [-0.3, 0.9, 0], lh: [0.34, 0.3 - Math.sin(this.walk) * 0.1, 0.12], lean: 0.3 }, 1), rate: 10 };
    const breathe = Math.sin(performance.now() / 600 + this.seed) * 0.008;
    const p = { ...idle, rh: [idle.rh[0], idle.rh[1] + breathe, idle.rh[2]] as V3 };
    if (f.sprinting) { p.lean += 0.22; }
    if (f.crippled) { p.crouch = 0.44; p.lean += 0.1; }
    // A peasant holding an attack token shifts his weight forward: a small tell before the wind-up.
    if (ai?.hasToken) p.lean += 0.08;
    return { pose: p, rate: 12 };
  }
  private accum(from: Pose, keys: PartialPose[], upTo: number): Pose {
    let p = from;
    for (let i = 0; i <= upTo; i++) p = mix(p, keys[i], 1);
    return p;
  }

  private _a = new THREE.Vector3(); private _b = new THREE.Vector3(); private _c = new THREE.Vector3();
  private _q = new THREE.Quaternion(); private _q2 = new THREE.Quaternion();
  private static DOWN = new THREE.Vector3(0, -1, 0);
  private static FWD = new THREE.Vector3(0, 0, 1);

  private solveArm(arm: Arm, side: number, hand: V3, dir: V3): void {
    if (!arm.upper.parent) return;
    const s = this._a.set(side * DIM.shoulder, -0.03, 0);
    const t = this._b.set(hand[0], hand[1], hand[2]).sub(s);
    const maxLen = DIM.upper + DIM.fore - 0.005;
    let d = t.length();
    if (d > maxLen) { t.multiplyScalar(maxLen / d); d = maxLen; }
    if (d < 0.12) { t.set(0, -0.12, 0.01); d = t.length(); }
    const a = DIM.upper, b = DIM.fore;
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const along = this._c.copy(t).multiplyScalar(1 / d);
    // Elbow pole: down, outward and a little back.
    const pole = new THREE.Vector3(side * 0.6, -1, -0.5);
    pole.addScaledVector(along, -pole.dot(along)).normalize();
    const e = new THREE.Vector3().copy(along).multiplyScalar(a * cosA).addScaledVector(pole, a * Math.sqrt(1 - cosA * cosA));
    arm.upper.quaternion.setFromUnitVectors(Rig.DOWN, new THREE.Vector3().copy(e).normalize());
    const d2 = new THREE.Vector3().copy(t).sub(e).normalize();
    this._q.setFromUnitVectors(Rig.DOWN, d2);
    arm.fore.quaternion.copy(arm.upper.quaternion).invert().multiply(this._q);
    // Hand: point the held item along `dir` (chest space).
    const w = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const qh = new THREE.Quaternion().setFromUnitVectors(Rig.FWD, w);
    arm.hand.quaternion.copy(this._q).invert().multiply(qh);
  }

  private solveLeg(leg: Leg, swing: number, knee: number, crouchA: number, spread: number): void {
    leg.thigh.rotation.set(-swing - crouchA, 0, spread);
    leg.shin.rotation.set(knee + crouchA * 2, 0, 0);
  }

  /** Advance the procedural animation toward this fighter's current state. */
  update(f: Fighter, dt: number, speed: number, moveDot: number): void {
    const { pose: tgt, rate } = this.target(f, dt);
    const k = 1 - Math.exp(-rate * dt);
    const p = this.pose;
    for (const key of ['rh', 'rdir', 'lh', 'ldir'] as const) for (let i = 0; i < 3; i++) p[key][i] = lerp(p[key][i], tgt[key][i], k);
    for (const key of ['twist', 'lean', 'crouch', 'stance', 'pitch', 'lift', 'headPitch', 'roll'] as const) p[key] = lerp(p[key], tgt[key], k);

    // Legs: stride length follows actual ground speed so feet don't skate much.
    const moving = Math.min(1, speed / 3.2);
    this.walk += speed * dt * 2.4 * (moveDot < -0.3 ? -1 : 1);
    const amp = 0.62 * moving, sw = Math.sin(this.walk), cw = Math.cos(this.walk);
    const crouch = Math.min(0.5, p.crouch + moving * 0.03);
    const ca = Math.acos(Math.max(0.2, 1 - crouch / (DIM.thigh + DIM.shin)));
    const upright = Math.abs(p.pitch) < 0.5 ? 1 : 0.25;
    const st = p.stance * (1 - moving) * upright;
    this.solveLeg(this.legs.L, (sw * amp + st * 0.42) * upright, Math.max(0, cw) * amp * 1.3 + st * 0.2, ca * upright, 0.04 + st * 0.05);
    this.solveLeg(this.legs.R, (-sw * amp - st * 0.38) * upright, Math.max(0, -cw) * amp * 1.3, ca * upright, -0.04 - st * 0.05);

    const bob = Math.abs(cw) * 0.035 * moving;
    this.hips.position.y = DIM.hip - (DIM.thigh + DIM.shin) * (1 - Math.cos(ca)) * 0.98 - bob - st * 0.03;
    this.hips.rotation.set(p.lean * 0.5, p.twist * 0.35 + sw * 0.08 * moving, p.roll);
    this.chest.rotation.set(p.lean * 0.5, p.twist * 0.65 - sw * 0.1 * moving, 0);
    this.head.rotation.set(p.headPitch - p.lean * 0.6, -p.twist * 0.7, 0);
    this.body.rotation.x = p.pitch;
    this.body.position.y = p.lift;
    // On the ground the body pivots at the feet; slide it so the corpse lies where the man stood.
    this.body.position.z = -Math.sin(p.pitch) * DIM.hip * 0.6;

    // Arms. Arm swing while walking is layered on the hand targets.
    const swing = sw * 0.07 * moving;
    const rh: V3 = [p.rh[0], p.rh[1], p.rh[2] - swing];
    this.solveArm(this.arms.R, -1, rh, p.rdir);
    let lh: V3 = [p.lh[0], p.lh[1], p.lh[2] + swing];
    let ld = p.ldir;
    if (this.twoHanded && this.weapon?.parent === this.arms.R.hand) {
      // Off hand grips further down the haft.
      const n = Math.hypot(p.rdir[0], p.rdir[1], p.rdir[2]) || 1;
      lh = [rh[0] + (p.rdir[0] / n) * 0.42, rh[1] + (p.rdir[1] / n) * 0.42, rh[2] + (p.rdir[2] / n) * 0.42];
      ld = p.rdir;
    }
    this.solveArm(this.arms.L, 1, lh, ld);
  }
}
