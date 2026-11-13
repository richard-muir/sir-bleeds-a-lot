import type * as RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GROUP_DEBRIS, GROUP_GROUND, type Ragdoll, type RapierNS } from './ragdoll';

// Blood, decals, flying body parts and ragdolls. Everything is pooled and capped so a long
// fight cannot grow memory or draw calls without bound. Rapier drives only cosmetic things, so it
// lives on the render side and never touches the deterministic sim. It loads in the background
// (it is most of the download), and until it arrives limbs just vanish and corpses fall by pose.

export type GoreLevel = 'full' | 'reduced' | 'off';
const MAX_DROPS = 700, MAX_DECALS = 420, MAX_DEBRIS = 48, MAX_RAGDOLLS = 12, RAGDOLL_LIFE = 7;

interface Debris { obj: THREE.Object3D; body: RAPIER.RigidBody; age: number; bleed: number }

function splatTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * 6.28, r = Math.random() * Math.random() * 44, s = 5 + Math.random() * 20 * (1 - r / 50);
    const g = x.createRadialGradient(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0, 64 + Math.cos(a) * r, 64 + Math.sin(a) * r, s);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, s, 0, 7); x.fill();
  }
  return new THREE.CanvasTexture(c);
}

export class Gore {
  level: GoreLevel = 'full';
  private drops: THREE.InstancedMesh;
  private dp = new Float32Array(MAX_DROPS * 7); // x y z vx vy vz life
  private dropN = 0;
  private decals: THREE.InstancedMesh;
  private decalN = 0;
  private decalInfo: { x: number; z: number; rot: number; size: number; grow: number }[] = [];
  private debris: Debris[] = [];
  physics: RAPIER.World | null = null;
  R: RapierNS | null = null;
  private ragdolls: Ragdoll[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  constructor(private scene: THREE.Scene) {
    const dm = new THREE.MeshStandardMaterial({ color: 0x6a0407, roughness: 0.25, metalness: 0 });
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 5, 4), dm, MAX_DROPS);
    this.drops.frustumCulled = false; this.drops.count = MAX_DROPS;
    const pm = new THREE.MeshStandardMaterial({ color: 0x420305, roughness: 0.2, alphaMap: splatTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), pm, MAX_DECALS);
    this.decals.frustumCulled = false; this.decals.receiveShadow = true; this.decals.renderOrder = 2;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_DROPS; i++) { this.drops.setMatrixAt(i, zero); this.dp[i * 7 + 6] = 0; }
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, zero);
    scene.add(this.drops, this.decals);
  }

  async init(): Promise<void> {
    const R = (await import('@dimforge/rapier3d-compat')).default;
    await R.init();
    const w = new R.World({ x: 0, y: -18, z: 0 });
    const C = R.ColliderDesc, G = GROUP_GROUND;
    w.createCollider(C.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0).setFriction(1.1).setCollisionGroups(G));
    // The square's furniture, so bodies and limbs fetch up against it.
    w.createCollider(C.cylinder(0.45, 1.15).setTranslation(0, 0.45, 0).setCollisionGroups(G));
    w.createCollider(C.cylinder(2.5, 0.17).setTranslation(8, 2.5, -6.5).setCollisionGroups(G));
    w.createCollider(C.cuboid(1.3, 0.55, 0.75).setTranslation(-7.5, 0.6, 6).setRotation({ x: 0, y: Math.sin(0.25), z: 0, w: Math.cos(0.25) }).setCollisionGroups(G));
    this.R = R;
    this.physics = w;
  }

  /** Register a ragdoll so it is stepped, aged and eventually frozen in place. */
  addRagdoll(r: Ragdoll): void {
    this.ragdolls.push(r);
    while (this.ragdolls.length > MAX_RAGDOLLS) this.ragdolls.shift()!.freeze();
  }

  /** A burst of blood from a wound, thrown along the blow. */
  spray(x: number, y: number, z: number, dirX: number, dirZ: number, amount: number, speed = 4): void {
    if (this.level === 'off') return;
    const n = Math.round(amount * (this.level === 'reduced' ? 0.3 : 1));
    for (let i = 0; i < n; i++) {
      const j = (this.dropN = (this.dropN + 1) % MAX_DROPS) * 7, d = this.dp;
      const sp = speed * (0.3 + Math.random());
      d[j] = x; d[j + 1] = y; d[j + 2] = z;
      d[j + 3] = dirX * sp + (Math.random() - 0.5) * 3; d[j + 4] = 1 + Math.random() * 3.5; d[j + 5] = dirZ * sp + (Math.random() - 0.5) * 3;
      d[j + 6] = 1.6;
    }
  }

  decal(x: number, z: number, size: number, grow = 0): void {
    if (this.level !== 'full') { if (this.level === 'off' || Math.random() < 0.6) return; }
    const i = (this.decalN = (this.decalN + 1) % MAX_DECALS);
    this.decalInfo[i] = { x, z, rot: Math.random() * 6.28, size, grow };
    this.writeDecal(i);
  }
  private writeDecal(i: number): void {
    const d = this.decalInfo[i];
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), d.rot).multiply(this.flat);
    this.m.compose(this.v.set(d.x, 0.012 + (i % 20) * 0.0004, d.z), this.q, this.s.set(d.size, d.size, 1));
    this.decals.setMatrixAt(i, this.m);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /**
   * Hand a severed piece (limb group, head, dropped weapon) to physics. `obj` keeps its world pose;
   * `len` is the piece's length hanging below its origin, used for the collider.
   */
  fling(obj: THREE.Object3D, len: number, radius: number, vel: THREE.Vector3, bleed = 0): void {
    const R = this.R;
    if (!this.physics || !R) { obj.removeFromParent(); return; }
    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    obj.matrixWorld.decompose(pos, quat, scl);
    const wrap = new THREE.Group();
    const centre = new THREE.Vector3(0, -len / 2, 0).multiply(scl).applyQuaternion(quat).add(pos);
    wrap.position.copy(centre); wrap.quaternion.copy(quat); wrap.scale.copy(scl);
    obj.removeFromParent();
    obj.position.set(0, len / 2, 0); obj.quaternion.identity(); obj.scale.setScalar(1);
    wrap.add(obj);
    this.scene.add(wrap);
    if (this.level === 'off') { wrap.visible = false; }
    const body = this.physics.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(centre.x, Math.max(radius + 0.02, centre.y), centre.z).setRotation(quat)
        .setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 14 })
        .setLinearDamping(0.3).setAngularDamping(1.2));
    const half = Math.max(0.01, (len * scl.y) / 2 - radius);
    const col = len > radius * 2.5 ? R.ColliderDesc.capsule(half, radius) : R.ColliderDesc.ball(radius);
    this.physics.createCollider(col.setFriction(1).setRestitution(0.15).setDensity(1.2).setCollisionGroups(GROUP_DEBRIS), body);
    this.debris.push({ obj: wrap, body, age: 0, bleed });
    if (this.debris.length > MAX_DEBRIS) this.removeDebris(0);
  }
  private removeDebris(i: number): void {
    const d = this.debris.splice(i, 1)[0];
    this.physics!.removeRigidBody(d.body);
    d.obj.removeFromParent();
  }

  update(dt: number): void {
    // Drops: simple ballistics; each one that lands may leave a stain.
    const d = this.dp;
    for (let i = 0; i < MAX_DROPS; i++) {
      const j = i * 7;
      if (d[j + 6] <= 0) continue;
      d[j + 6] -= dt;
      d[j + 4] -= 14 * dt;
      d[j] += d[j + 3] * dt; d[j + 1] += d[j + 4] * dt; d[j + 2] += d[j + 5] * dt;
      if (d[j + 1] <= 0.02 || d[j + 6] <= 0) {
        if (d[j + 1] <= 0.02 && Math.random() < 0.3) this.decal(d[j], d[j + 2], 0.2 + Math.random() * 0.5);
        d[j + 6] = 0;
        this.m.makeScale(0, 0, 0);
      } else {
        const sp = Math.hypot(d[j + 3], d[j + 4], d[j + 5]);
        this.v.set(d[j + 3], d[j + 4], d[j + 5]).normalize();
        this.q.setFromUnitVectors(Gore.UP, this.v);
        this.m.compose(this.s.set(d[j], d[j + 1], d[j + 2]), this.q, new THREE.Vector3(0.7, 1 + sp * 0.35, 0.7));
      }
      this.drops.setMatrixAt(i, this.m);
    }
    this.drops.instanceMatrix.needsUpdate = true;

    // Pools spread slowly under bodies.
    for (let i = 0; i < this.decalInfo.length; i++) {
      const p = this.decalInfo[i];
      if (p && p.grow > 0) { const g = Math.min(p.grow, dt * 0.35); p.grow -= g; p.size += g; this.writeDecal(i); }
    }

    if (this.physics) {
      this.physics.timestep = Math.min(dt, 1 / 30);
      this.physics.step();
      for (let i = this.debris.length - 1; i >= 0; i--) {
        const b = this.debris[i];
        b.age += dt;
        const t = b.body.translation(), r = b.body.rotation();
        b.obj.position.set(t.x, t.y, t.z); b.obj.quaternion.set(r.x, r.y, r.z, r.w);
        if (b.bleed > 0 && b.age < 2.5 && Math.random() < 0.4) {
          const l = b.body.linvel();
          this.spray(t.x, t.y, t.z, l.x * 0.1, l.z * 0.1, 1, 1);
        }
        if (b.age > 3 && b.age < 3.1 && b.bleed > 0) this.decal(t.x, t.z, 0.5, 0.5);
        if (b.age > 4 && !b.body.isSleeping()) b.body.sleep();
      }
      for (let i = this.ragdolls.length - 1; i >= 0; i--) {
        const r = this.ragdolls[i];
        r.age += dt;
        if (r.frozen || r.age > RAGDOLL_LIFE || (r.age > 1.5 && r.sleeping)) { r.freeze(); this.ragdolls.splice(i, 1); }
      }
    }
  }
  private static UP = new THREE.Vector3(0, 1, 0);

  clear(): void {
    while (this.debris.length) this.removeDebris(0);
    for (const r of this.ragdolls) r.freeze();
    this.ragdolls = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, zero);
    this.decalInfo = [];
    this.decals.instanceMatrix.needsUpdate = true;
  }
}
