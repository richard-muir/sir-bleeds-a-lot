import * as THREE from 'three';
import type { Fighter, Limb } from '../sim/types';
import { buildKnight } from './models/knight';
import { BLOOD_LEVELS, material, type Kind } from './models/materials';
import { buildPeasant, stump, type Part, type Seg } from './models/peasants';
import { buildShield, buildWeapon } from './models/weapons';
import { Ragdoll, type RapierNS } from './ragdoll';
import { BONES, skinParts, type BoneName, type SkinGroup } from './skin';
import type * as RAPIER from '@dimforge/rapier3d-compat';

// The skeleton and its procedural animation (two-bone arm IK driven by hand targets, FK legs),
// with springs for weight, a stride locked to ground speed, hit flinches and head tracking.
// The meshes are sculpted in ./models and skinned to these bones in ./skin. The joint names and the "pose" structure are
// the seam where authored glTF models and animation clips could drop in later.
//
// Character space: +Z forward, +Y up, +X is the character's LEFT.

const ANKLE = 0.42;
const DIM = { hip: 0.95, torso: 0.5, waist: 0.2, shoulder: 0.21, upper: 0.3, fore: 0.28, thigh: 0.45, shin: 0.48, legX: 0.1 };
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
  knight: { rh: [-0.28, -0.34, 0.22], rdir: [0.15, 0.8, 0.55], lh: [0.2, -0.3, 0.3], ldir: [0.35, 0, 1], twist: 0.25, lean: 0.05, crouch: 0.02, stance: 0.3, pitch: 0, lift: 0, headPitch: 0, roll: 0 },
  one: { rh: [-0.3, -0.3, 0.2], rdir: [0.1, 0.85, 0.5], lh: [0.25, -0.5, 0.05], ldir: [0, -0.3, 1], twist: 0.1, lean: 0.1, crouch: 0.015, stance: 0.18, pitch: 0, lift: 0, headPitch: 0.05, roll: 0 },
  fork: { rh: [-0.26, -0.36, -0.08], rdir: [0.1, 0.22, 1], lh: [0, 0, 0], ldir: [0, 0, 1], twist: -0.35, lean: 0.12, crouch: 0.025, stance: 0.35, pitch: 0, lift: 0, headPitch: 0, roll: 0 },
  axe: { rh: [-0.2, -0.32, 0.16], rdir: [0.55, 0.75, 0.3], lh: [0, 0, 0], ldir: [0, 0, 1], twist: -0.1, lean: 0.09, crouch: 0.015, stance: 0.26, pitch: 0, lift: 0, headPitch: 0, roll: 0 },
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

// ------------------------------------------------------------------ the rig

interface Arm { upper: THREE.Bone; fore: THREE.Bone; hand: THREE.Bone }
interface Leg { thigh: THREE.Bone; shin: THREE.Bone; foot: THREE.Bone }
let stumpGeo: Record<string, THREE.BufferGeometry> | null = null;
const skinCache = new WeakMap<Part[], SkinGroup[]>();
const FOOT_OFFSET = new THREE.Matrix4().makeTranslation(0, ANKLE, 0);

/** Critically damped spring toward a target. Exact for any dt, so a long frame never overshoots or explodes. */
function spring(x: number, v: number, target: number, w: number, dt: number): [number, number] {
  const y = x - target, e = Math.exp(-w * dt), tmp = (v + w * y) * dt;
  return [target + (y + tmp) * e, (v - w * tmp) * e];
}

export class Rig {
  root = new THREE.Group();
  body = new THREE.Bone();
  hips = new THREE.Bone();
  /** Waist joint: lean and twist pivot here, so the ribcage bends over the belt rather than swinging from the neck. */
  spine = new THREE.Bone();
  chest = new THREE.Bone();
  head = new THREE.Bone();
  arms: { L: Arm; R: Arm };
  legs: { L: Leg; R: Leg };
  private skirts = { L: new THREE.Bone(), R: new THREE.Bone() };
  skeleton: THREE.Skeleton;
  weapon: THREE.Group | null = null;
  shield: THREE.Group | null = null;
  /** Body-side wounds, shown when the limb goes. */
  stumps = {} as Record<Limb, THREE.Mesh>;
  /** Set by the renderer each frame: a world point to turn the head toward. */
  lookAt: THREE.Vector3 | null = null;
  ragdoll: Ragdoll | null = null;
  private parts: Part[];
  private meshes: THREE.SkinnedMesh[] = [];
  private gone = new Set<Limb>();
  private broken = new Set<string>();
  private bloodLevel = 0;
  private pose: Pose;
  private vel: Pose;
  private idleKey: string;
  private walk = 0;
  private seed = Math.random() * 10;
  private fall = Math.random() < 0.5 ? 1 : -1;
  private headScale: number;
  /** Additive hit reaction: an underdamped spring on the spine (x: pitch, z: roll). */
  private fl = { x: 0, vx: 0, z: 0, vz: 0 };
  private gaze = { yaw: 0, vy: 0, pitch: 0, vp: 0 };
  private clock = 0;
  twoHanded = false;
  scale = 1;
  private byPiece = new Map<string, THREE.Object3D[]>();
  private hiddenUntil = new Map<string, THREE.Object3D[]>();

  constructor(public look: string, weaponModel: string | null, opts: { scale?: number; kit?: string; shield?: boolean; twoHanded?: boolean; seed?: number } = {}) {
    this.scale = opts.scale ?? 1;
    this.twoHanded = !!opts.twoHanded;
    this.idleKey = look === 'knight' ? 'knight' : weaponModel === 'pitchfork' || weaponModel === 'rake' ? 'fork' : weaponModel === 'axe' ? 'axe' : 'one';
    this.pose = structuredClone(IDLE[this.idleKey]);
    this.vel = { rh: [0, 0, 0], rdir: [0, 0, 0], lh: [0, 0, 0], ldir: [0, 0, 0], twist: 0, lean: 0, crouch: 0, stance: 0, pitch: 0, lift: 0, headPitch: 0, roll: 0 };
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = DIM.hip;
    this.hips.add(this.spine, this.skirts.L, this.skirts.R);
    this.spine.position.y = DIM.waist;
    this.spine.add(this.chest);
    this.chest.position.y = DIM.torso - DIM.waist;
    this.chest.add(this.head);
    this.head.position.y = 0.06;
    const arm = (side: number): Arm => {
      const upper = new THREE.Bone(), fore = new THREE.Bone(), hand = new THREE.Bone();
      upper.position.set(side * DIM.shoulder, -0.03, 0);
      fore.position.y = -DIM.upper; hand.position.y = -DIM.fore;
      upper.add(fore); fore.add(hand); this.chest.add(upper);
      return { upper, fore, hand };
    };
    const leg = (side: number): Leg => {
      const thigh = new THREE.Bone(), shin = new THREE.Bone(), foot = new THREE.Bone();
      thigh.position.set(side * DIM.legX, 0, 0); shin.position.y = -DIM.thigh; foot.position.y = -ANKLE;
      thigh.add(shin); shin.add(foot); this.hips.add(thigh);
      return { thigh, shin, foot };
    };
    this.arms = { L: arm(1), R: arm(-1) };
    this.legs = { L: leg(1), R: leg(-1) };
    // Peasant heads are a touch oversized: caricature reads better at fighting distance.
    this.headScale = look === 'knight' ? 1.07 : 1.13;
    this.head.scale.setScalar(this.headScale);

    const bones: Record<BoneName, THREE.Bone> = {
      body: this.body, hips: this.hips, spine: this.spine, chest: this.chest, head: this.head,
      upperL: this.arms.L.upper, foreL: this.arms.L.fore, handL: this.arms.L.hand, upperR: this.arms.R.upper, foreR: this.arms.R.fore, handR: this.arms.R.hand,
      thighL: this.legs.L.thigh, shinL: this.legs.L.shin, footL: this.legs.L.foot, thighR: this.legs.R.thigh, shinR: this.legs.R.shin, footR: this.legs.R.foot,
      skirtL: this.skirts.L, skirtR: this.skirts.R,
    };
    for (const n of BONES) bones[n].name = n;
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(BONES.map((n) => bones[n]));

    this.parts = look === 'knight' ? buildKnight(opts.kit ?? 'mail') : buildPeasant(look, opts.seed ?? 0);
    let groups = skinCache.get(this.parts);
    if (!groups) {
      const rest = Object.fromEntries(BONES.map((n) => [n, bones[n].matrixWorld.clone()])) as Record<BoneName, THREE.Matrix4>;
      groups = skinParts(this.parts, rest, { footL: FOOT_OFFSET, footR: FOOT_OFFSET });
      skinCache.set(this.parts, groups);
    }
    const bind = new THREE.Matrix4();
    for (const g of groups) {
      const m = new THREE.SkinnedMesh(g.geo, g.decal ?? material(g.kind, 0));
      m.bind(this.skeleton, bind);
      m.frustumCulled = false; // bounds are for the bind pose; a falling body leaves them
      m.castShadow = !g.decal;
      m.userData.kind = g.decal ? null : g.kind;
      this.root.add(m);
      this.meshes.push(m);
      for (const id of [g.piece, g.hideWith]) if (id) { const l = this.byPiece.get(id) ?? []; l.push(m); this.byPiece.set(id, l); }
      if (g.showWhenBroken) { m.visible = false; const l = this.hiddenUntil.get(g.showWhenBroken) ?? []; l.push(m); this.hiddenUntil.set(g.showWhenBroken, l); }
    }
    this.addWounds();
    if (weaponModel) { this.weapon = buildWeapon(weaponModel); this.arms.R.hand.add(this.weapon); this.weapon.position.set(0, -0.045, 0); }
    if (opts.shield) { this.shield = buildShield(); this.arms.L.hand.add(this.shield); }
    this.root.scale.setScalar(this.scale);
  }

  private addWounds(): void {
    stumpGeo ??= { neck: stump(0.05), arm: stump(0.058), leg: stump(0.078) };
    const gore = material('matte', 0);
    const mk = (parent: THREE.Object3D, geo: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number]) => {
      const s = new THREE.Mesh(geo, gore); s.position.set(...pos); s.rotation.set(...rot); s.visible = false; parent.add(s); return s;
    };
    const H = Math.PI / 2;
    // body side: bone points out of the wound
    this.stumps.head = mk(this.chest, stumpGeo.neck, [0, 0.075, 0], [Math.PI, 0, 0]);
    this.stumps.armL = mk(this.chest, stumpGeo.arm, [DIM.shoulder - 0.02, -0.035, 0], [0, 0, H]);
    this.stumps.armR = mk(this.chest, stumpGeo.arm, [-DIM.shoulder + 0.02, -0.035, 0], [0, 0, -H]);
    this.stumps.legL = mk(this.hips, stumpGeo.leg, [DIM.legX, -0.07, 0], [0, 0, 0]);
    this.stumps.legR = mk(this.hips, stumpGeo.leg, [-DIM.legX, -0.07, 0], [0, 0, 0]);
  }

  private visiblePart(p: Part): boolean {
    if (p.showWhenBroken) return this.broken.has(p.showWhenBroken);
    for (const id of [p.piece, p.hideWith]) if (id && this.broken.has(id)) return false;
    return true;
  }

  /** A broken armour piece falls away, leaving the gambeson (or the man) underneath. */
  breakArmour(piece: string): void {
    this.broken.add(piece);
    for (const m of this.byPiece.get(piece) ?? []) m.visible = false;
    for (const m of this.hiddenUntil.get(piece) ?? []) m.visible = true;
  }

  /** Blood builds up in blotches: swap every stainable mesh to the splattered variant of its material. */
  setBlood(v: number): void {
    const lvl = Math.min(BLOOD_LEVELS - 1, Math.floor(v * BLOOD_LEVELS));
    if (lvl === this.bloodLevel) return;
    this.bloodLevel = lvl;
    for (const m of this.meshes) if (m.userData.kind) m.material = material(m.userData.kind as Kind, lvl);
  }

  /**
   * Take a limb off. The limb's bones collapse to nothing on the body, and a rigid copy of the
   * limb, posed exactly as it was, is returned (still parented, so it has a world transform) for
   * the gore system to throw. Returns null if the limb is already gone.
   */
  detachLimb(limb: Limb): THREE.Group | null {
    if (this.gone.has(limb)) return null;
    this.gone.add(limb);
    const s = limb.endsWith('L') ? 'L' : 'R';
    const chain: [Seg, THREE.Bone][] = limb === 'head' ? [['head', this.head]]
      : limb.startsWith('arm') ? [[`upper${s}` as Seg, this.arms[s].upper], [`fore${s}` as Seg, this.arms[s].fore], [`hand${s}` as Seg, this.arms[s].hand]]
      : [[`thigh${s}` as Seg, this.legs[s].thigh], [`shin${s}` as Seg, this.legs[s].shin], [`foot${s}` as Seg, this.legs[s].foot]];
    let top: THREE.Group | null = null, parent: THREE.Object3D | null = null;
    for (const [seg, bone] of chain) {
      const g = new THREE.Group();
      g.position.copy(bone.position); g.quaternion.copy(bone.quaternion); g.scale.copy(bone.scale);
      for (const p of this.parts) {
        if (p.seg !== seg || !this.visiblePart(p)) continue;
        const m = new THREE.Mesh(p.geo, p.decal ?? material(p.kind, this.bloodLevel));
        m.castShadow = !p.decal;
        if (seg.startsWith('foot')) m.position.y = ANKLE;
        g.add(m);
      }
      if (parent) parent.add(g); else top = g;
      parent = g;
    }
    // The cut end of the piece that flies off.
    stumpGeo ??= { neck: stump(0.05), arm: stump(0.058), leg: stump(0.078) };
    const H = Math.PI / 2;
    const cap = new THREE.Mesh(limb === 'head' ? stumpGeo.neck : limb.startsWith('arm') ? stumpGeo.arm : stumpGeo.leg, material('matte', 0));
    if (limb === 'head') cap.position.set(0, -0.02, 0);
    else if (limb.startsWith('arm')) { cap.position.set(s === 'L' ? -0.02 : 0.02, 0.01, 0); cap.rotation.z = (s === 'L' ? -H : H) * 1.3; }
    else { cap.position.set(0, 0.03, 0); cap.rotation.x = Math.PI; }
    top!.add(cap);
    chain[0][1].parent!.add(top!);
    chain[0][1].scale.setScalar(1e-4);
    return top;
  }
  hasLimb(limb: Limb): boolean { return !this.gone.has(limb); }

  /** A blow lands: rock the spine and head along the direction of the blow (world space). */
  flinch(dirX: number, dirZ: number, strength: number): void {
    const yaw = this.root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = dirX * c - dirZ * s, lz = dirX * s + dirZ * c;
    this.fl.vx += lz * strength * 7;
    this.fl.vz -= lx * strength * 7;
  }

  /** Hand the body to physics. `vel` is how it was moving, `push` the blow that killed it. */
  startRagdoll(R: RapierNS, world: RAPIER.World, vel: THREE.Vector3, push: THREE.Vector3): Ragdoll {
    this.ragdoll?.freeze();
    this.ragdoll = new Ragdoll(R, world, {
      root: this.root, body: this.body, hips: this.hips, spine: this.spine, chest: this.chest, head: this.head,
      upperL: this.arms.L.upper, foreL: this.arms.L.fore, upperR: this.arms.R.upper, foreR: this.arms.R.fore,
      thighL: this.legs.L.thigh, shinL: this.legs.L.shin, thighR: this.legs.R.thigh, shinR: this.legs.R.shin, skirtL: this.skirts.L, skirtR: this.skirts.R,
    }, this.scale, this.headScale, this.gone, vel, push);
    return this.ragdoll;
  }

  dispose(): void {
    this.ragdoll?.freeze();
    this.root.removeFromParent();
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
        return { pose: mix(idle, { pitch: (this.fall * Math.PI) / 2, lift: 0.12, rh: [-0.45, 0.1 * this.fall, 0.05], rdir: [-0.8, 0, 0.5], lh: [0.5, -0.2, 0.05], lean: 0, crouch: 0, twist: 0.3 * this.fall, headPitch: 0.3, roll: 0.15, stance: 0 }, 1), rate: 7 };
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
    if (this.gone.has(side > 0 ? 'armL' : 'armR')) return;
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

  /** FK leg. `fx`/`fz` swing the thigh forward and sideways, so strafing steps sideways instead of moonwalking. */
  private solveLeg(leg: Leg, fx: number, fz: number, knee: number, crouchA: number, spread: number): void {
    leg.thigh.rotation.set(-fx - crouchA, 0, spread + fz);
    leg.shin.rotation.set(knee + crouchA * 2, 0, 0);
    // Keep the foot flat on the ground, easing off as the leg swings through so the toe still lifts and drops.
    const level = Math.abs(this.pose.pitch) < 0.5 ? 0.85 : 0;
    leg.foot.rotation.set(-(leg.thigh.rotation.x + leg.shin.rotation.x) * level, 0, -(spread + fz) * level);
  }

  /**
   * Advance the procedural animation toward this fighter's current state.
   * `fwd` and `side` are the fighter's ground velocity in its own frame (m/s; side is +X, its left).
   */
  update(f: Fighter, dt: number, fwd = 0, side = 0): void {
    if (this.ragdoll) { this.ragdoll.apply(); return; }
    if (dt <= 0) return;
    this.clock += dt;
    const { pose: tgt, rate } = this.target(f, dt);
    // Springs rather than plain easing: limbs accelerate into a move and carry momentum out of it.
    const w = rate * 0.85, p = this.pose, v = this.vel;
    for (const key of ['rh', 'rdir', 'lh', 'ldir'] as const) for (let i = 0; i < 3; i++) [p[key][i], v[key][i]] = spring(p[key][i], v[key][i], tgt[key][i], w, dt);
    for (const key of ['twist', 'lean', 'crouch', 'stance', 'pitch', 'lift', 'headPitch', 'roll'] as const) [p[key], v[key]] = spring(p[key], v[key], tgt[key], w, dt);

    // Hit reaction: an underdamped spring, so a blow rocks the man and he rocks back.
    for (let t = dt; t > 1e-6; t -= 0.008) {
      const h = Math.min(0.008, t), fl = this.fl;
      fl.vx += (-170 * fl.x - 13 * fl.vx) * h; fl.x += fl.vx * h;
      fl.vz += (-170 * fl.z - 13 * fl.vz) * h; fl.z += fl.vz * h;
    }
    const flx = Math.max(-0.6, Math.min(0.6, this.fl.x)), flz = Math.max(-0.5, Math.min(0.5, this.fl.z));

    // Legs. The stride phase advances with distance covered, at the rate a planted foot would
    // move under a hip swinging through this amplitude, so the feet stop skating.
    const speed = Math.hypot(fwd, side);
    const moving = Math.min(1, speed / 3.0);
    const amp = Math.min(0.75, 0.22 + speed * 0.11) * Math.min(1, speed / 0.6);
    const legLen = (DIM.thigh + DIM.shin) * this.scale;
    if (speed > 0.05) this.walk += (speed * dt * Math.PI) / (2 * legLen * Math.max(0.12, Math.sin(amp)));
    const dz = speed > 0.05 ? fwd / speed : 1, dx = speed > 0.05 ? side / speed : 0;
    const sw = Math.sin(this.walk), cw = Math.cos(this.walk);
    const crouch = Math.min(0.5, p.crouch + moving * 0.03);
    const ca = Math.acos(Math.max(0.2, 1 - crouch / (DIM.thigh + DIM.shin)));
    const upright = Math.abs(p.pitch) < 0.5 ? 1 : 0.25;
    const st = p.stance * (1 - moving) * upright;
    const sideAmp = 0.6;
    this.solveLeg(this.legs.L, (sw * amp * dz + st * 0.42) * upright, sw * amp * dx * sideAmp * upright, Math.max(0, cw) * amp * 1.3 + st * 0.2, ca * upright, 0.04 + st * 0.05);
    this.solveLeg(this.legs.R, (-sw * amp * dz - st * 0.38) * upright, -sw * amp * dx * sideAmp * upright, Math.max(0, -cw) * amp * 1.3, ca * upright, -0.04 - st * 0.05);

    // Hips carry the weight: bob on each footfall, sway over the planted foot, drift when idle.
    const bob = Math.abs(cw) * 0.04 * moving;
    const idle = 1 - moving;
    const drift = Math.sin(this.clock * 0.7 + this.seed) * 0.012 * idle;
    this.hips.position.set(drift + sw * 0.018 * moving * dz, DIM.hip - (DIM.thigh + DIM.shin) * (1 - Math.cos(ca)) * 0.98 - bob - st * 0.03, 0);
    this.hips.rotation.set(p.lean * 0.5 + fwd * 0.012, p.twist * 0.35 + sw * 0.1 * moving * dz, p.roll - sw * 0.035 * moving - drift * 1.5 - side * 0.01);
    const breath = Math.sin(this.clock * 1.7 + this.seed);
    this.spine.position.y = DIM.waist + breath * 0.004;
    this.spine.rotation.set(p.lean * 0.5 + flx + breath * 0.01, p.twist * 0.65 - sw * 0.12 * moving * dz, flz);
    this.skirts.L.rotation.set(this.legs.L.thigh.rotation.x * 0.62, 0, this.legs.L.thigh.rotation.z * 0.5);
    this.skirts.R.rotation.set(this.legs.R.thigh.rotation.x * 0.62, 0, this.legs.R.thigh.rotation.z * 0.5);

    // Head: counter the torso twist, then turn toward whatever he is looking at, within a neck's reach.
    let gy = -p.twist * 0.7, gp = 0;
    const alive = f.state !== 'dead' && f.state !== 'gone' && f.state !== 'finished' && f.state !== 'down';
    if (this.lookAt && alive) {
      const l = this.root.worldToLocal(this._a.copy(this.lookAt));
      gy = Math.max(-1.1, Math.min(1.1, Math.atan2(l.x, l.z) - p.twist));
      gp = Math.max(-0.35, Math.min(0.45, -Math.atan2(l.y - 1.6, Math.hypot(l.x, l.z))));
    }
    [this.gaze.yaw, this.gaze.vy] = spring(this.gaze.yaw, this.gaze.vy, gy, 9, dt);
    [this.gaze.pitch, this.gaze.vp] = spring(this.gaze.pitch, this.gaze.vp, gp, 9, dt);
    this.head.rotation.set(p.headPitch - p.lean * 0.6 + flx * 0.9 + this.gaze.pitch, this.gaze.yaw, flz * 0.7);
    this.body.rotation.x = p.pitch;
    this.body.position.y = p.lift;
    // On the ground the body pivots at the feet; slide it so the body lies where the man stood.
    this.body.position.z = -Math.sin(p.pitch) * DIM.hip * 0.6;

    // Arms. Swing against the legs while walking, layered on the hand targets.
    const swing = sw * 0.08 * moving * dz;
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
