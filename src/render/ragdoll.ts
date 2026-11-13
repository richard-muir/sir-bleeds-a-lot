import type * as RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Limb } from '../sim/types';

// A ragdoll for a dead fighter. It is cosmetic: it lives in the gore system's physics world and
// never touches the deterministic sim. Each body's frame is its bone's world frame at the moment
// of death, so the corpse starts exactly in the pose the animation left it in.
//
// Only rotations are copied back to the bones (plus the pelvis position). Bones keep their rest
// offsets, so the figure can never visibly come apart at a joint, whatever the solver does.

export type RapierNS = typeof import("@dimforge/rapier3d-compat").default;
export const GROUP_GROUND = (0x1 << 16) | 0x7;
export const GROUP_DEBRIS = (0x2 << 16) | 0x7;
/** Ragdoll parts hit the ground and loose debris, never each other: no self-collision explosions. */
export const GROUP_RAGDOLL = (0x4 << 16) | 0x3;

export interface RagdollBones {
  root: THREE.Object3D; body: THREE.Bone; hips: THREE.Bone; spine: THREE.Bone; chest: THREE.Bone; head: THREE.Bone;
  upperL: THREE.Bone; foreL: THREE.Bone; upperR: THREE.Bone; foreR: THREE.Bone;
  thighL: THREE.Bone; shinL: THREE.Bone; thighR: THREE.Bone; shinR: THREE.Bone;
  skirtL: THREE.Bone; skirtR: THREE.Bone;
}

type Key = 'pelvis' | 'torso' | 'head' | 'upperL' | 'foreL' | 'upperR' | 'foreR' | 'thighL' | 'shinL' | 'thighR' | 'shinR';

export class Ragdoll {
  age = 0;
  frozen = false;
  private bodies = new Map<Key, RAPIER.RigidBody>();
  private joints: RAPIER.ImpulseJoint[] = [];
  private q = new Map<Key, THREE.Quaternion>();
  private m = new THREE.Matrix4(); private inv = new THREE.Matrix4();
  private v3 = new THREE.Vector3(); private s3 = new THREE.Vector3();
  private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion();

  constructor(private R: RapierNS, private world: RAPIER.World, private b: RagdollBones, scale: number, headScale: number, gone: Set<Limb>, vel: THREE.Vector3, push: THREE.Vector3) {
    const s = scale;
    b.root.updateMatrixWorld(true);
    const C = R.ColliderDesc;
    const cap = (half: number, r: number, y: number) => C.capsule(half * s, r * s).setTranslation(0, y * s, 0);
    const defs: [Key, THREE.Bone, Key | null, () => RAPIER.ColliderDesc[], THREE.Vector3, THREE.Vector3, Limb | null][] = [
      ['pelvis', b.hips, null, () => [C.cuboid(0.16 * s, 0.1 * s, 0.11 * s).setTranslation(0, 0.04 * s, 0)], new THREE.Vector3(), new THREE.Vector3(), null],
      ['torso', b.chest, 'pelvis', () => [C.cuboid(0.17 * s, 0.19 * s, 0.115 * s).setTranslation(0, -0.16 * s, 0)], b.spine.position.clone(), b.chest.position.clone().negate(), null],
      ['head', b.head, 'torso', () => [C.ball(0.115 * headScale * s).setTranslation(0, 0.13 * headScale * s, 0.01 * s)], b.head.position.clone(), new THREE.Vector3(), 'head'],
      ['upperL', b.upperL, 'torso', () => [cap(0.1, 0.055, -0.15)], b.upperL.position.clone(), new THREE.Vector3(), 'armL'],
      ['foreL', b.foreL, 'upperL', () => [cap(0.11, 0.05, -0.17)], b.foreL.position.clone(), new THREE.Vector3(), 'armL'],
      ['upperR', b.upperR, 'torso', () => [cap(0.1, 0.055, -0.15)], b.upperR.position.clone(), new THREE.Vector3(), 'armR'],
      ['foreR', b.foreR, 'upperR', () => [cap(0.11, 0.05, -0.17)], b.foreR.position.clone(), new THREE.Vector3(), 'armR'],
      ['thighL', b.thighL, 'pelvis', () => [cap(0.15, 0.075, -0.225)], b.thighL.position.clone(), new THREE.Vector3(), 'legL'],
      ['shinL', b.shinL, 'thighL', () => [cap(0.17, 0.055, -0.24), C.cuboid(0.045 * s, 0.035 * s, 0.1 * s).setTranslation(0, -0.455 * s, 0.05 * s)], b.shinL.position.clone(), new THREE.Vector3(), 'legL'],
      ['thighR', b.thighR, 'pelvis', () => [cap(0.15, 0.075, -0.225)], b.thighR.position.clone(), new THREE.Vector3(), 'legR'],
      ['shinR', b.shinR, 'thighR', () => [cap(0.17, 0.055, -0.24), C.cuboid(0.045 * s, 0.035 * s, 0.1 * s).setTranslation(0, -0.455 * s, 0.05 * s)], b.shinR.position.clone(), new THREE.Vector3(), 'legR'],
    ];
    const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scl = new THREE.Vector3();
    for (const [key, bone, parent, colliders, anchorParent, anchorChild, limb] of defs) {
      if (limb && gone.has(limb)) continue;
      if (parent && !this.bodies.has(parent)) continue;
      bone.matrixWorld.decompose(pos, rot, scl);
      // Blows land on the upper body; the legs mostly just go.
      const k = key === 'torso' || key === 'head' ? 1 : key.startsWith('upper') || key.startsWith('fore') ? 0.75 : key === 'pelvis' ? 0.6 : 0.35;
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, Math.max(pos.y, 0.06), pos.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinvel(vel.x + push.x * k, vel.y + push.y * k, vel.z + push.z * k)
        .setAngvel(key === 'torso' ? { x: push.z * 1.4, y: (Math.random() - 0.5) * 2, z: -push.x * 1.4 } : { x: 0, y: 0, z: 0 })
        .setLinearDamping(0.35).setAngularDamping(key === 'head' ? 5 : 2.4));
      for (const c of colliders()) world.createCollider(c.setDensity(900).setFriction(0.95).setRestitution(0.04).setCollisionGroups(GROUP_RAGDOLL), body);
      this.bodies.set(key, body);
      this.q.set(key, new THREE.Quaternion());
      if (parent) {
        const pb = this.bodies.get(parent)!;
        const a1 = anchorParent.multiplyScalar(s), a2 = anchorChild.multiplyScalar(s);
        const knee = key === 'shinL' || key === 'shinR';
        const data = knee ? R.JointData.revolute(a1, a2, { x: 1, y: 0, z: 0 }) : R.JointData.spherical(a1, a2);
        const j = world.createImpulseJoint(data, pb, body, true);
        j.setContactsEnabled(false);
        if (knee) (j as RAPIER.RevoluteImpulseJoint).setLimits(0, 2.5);
        this.joints.push(j);
      }
    }
    // From here the pelvis drives the hips directly from the root.
    b.body.position.set(0, 0, 0); b.body.quaternion.identity();
  }

  get sleeping(): boolean {
    for (const body of this.bodies.values()) if (!body.isSleeping()) return false;
    return true;
  }

  /** Copy the physics pose onto the bones. */
  apply(): void {
    if (this.frozen || !this.bodies.size) return;
    for (const [k, body] of this.bodies) { const r = body.rotation(); this.q.get(k)!.set(r.x, r.y, r.z, r.w); }
    const b = this.b, Q = (k: Key) => this.q.get(k);
    const pelvis = this.bodies.get('pelvis')!, t = pelvis.translation(), qp = Q('pelvis')!;
    b.root.updateMatrixWorld();
    b.root.matrixWorld.decompose(this.v3, this.qa, this.s3);
    this.m.compose(new THREE.Vector3(t.x, t.y, t.z), qp, this.s3);
    this.inv.copy(b.root.matrixWorld).invert().multiply(this.m);
    this.inv.decompose(b.hips.position, b.hips.quaternion, b.hips.scale);
    const local = (bone: THREE.Bone, parent: Key, child: Key) => { const p = Q(parent), c = Q(child); if (p && c) bone.quaternion.copy(this.qb.copy(p).invert().multiply(c)); };
    local(b.spine, 'pelvis', 'torso');
    b.chest.quaternion.identity();
    local(b.head, 'torso', 'head');
    local(b.upperL, 'torso', 'upperL'); local(b.foreL, 'upperL', 'foreL');
    local(b.upperR, 'torso', 'upperR'); local(b.foreR, 'upperR', 'foreR');
    local(b.thighL, 'pelvis', 'thighL'); local(b.shinL, 'thighL', 'shinL');
    local(b.thighR, 'pelvis', 'thighR'); local(b.shinR, 'thighR', 'shinR');
    b.skirtL.quaternion.identity().slerp(b.thighL.quaternion, 0.6);
    b.skirtR.quaternion.identity().slerp(b.thighR.quaternion, 0.6);
  }

  /** Stop simulating and keep the last pose: the body has settled into the mud. */
  freeze(): void {
    if (this.frozen) return;
    this.apply();
    this.frozen = true;
    for (const j of this.joints) this.world.removeImpulseJoint(j, false);
    for (const body of this.bodies.values()) this.world.removeRigidBody(body);
    this.joints = [];
    this.bodies.clear();
  }
}
