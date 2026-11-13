import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { TUNING } from '../data/tuning';
import { angleDiff, DEG } from '../sim/rng';
import type { Fighter, Limb, SimEvent, Zone } from '../sim/types';
import type { World } from '../sim/world';
import { Arena } from './arena';
import { Gore, type GoreLevel } from './gore';
import { LIMB_LEN, Rig } from './rig';

const ZONE_Y: Record<Zone, number> = { head: 1.62, torso: 1.2, armL: 1.25, armR: 1.25, legL: 0.55, legR: 0.55 };
const MAX_CORPSES = 45;

interface View { rig: Rig; f: Fighter; x: number; z: number; yaw: number; px: number; pz: number; kit?: string; sink: number }
interface Spurt { view: View; limb: Limb; t: number }
interface Glint { s: THREE.Sprite; t: number }

/** Final grade: desaturated earth tones where blood stays saturated, vignette, grain, hurt flash. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, hurt: { value: 0 }, vig: { value: 0.55 }, low: { value: 0 }, focus: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, hurt, vig, low, focus; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float ab = (hurt * 0.006 + focus * 0.003) * dot(c, c) * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ab).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ab).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // How "blood red" is this pixel? Keep those, drain the rest.
      float red = smoothstep(0.06, 0.3, col.r - max(col.g, col.b) * 1.25);
      float fire = smoothstep(0.5, 1.0, l) * step(col.b, col.r);
      float keep = max(red, fire * 0.8);
      col = mix(mix(vec3(l), col, 0.42), col * vec3(1.12, 0.92, 0.92), keep);
      col = mix(col, col * vec3(1.02, 0.99, 0.93), 0.6);
      col = (col - 0.5) * 1.06 + 0.5;
      float r = length(c * vec2(1.0, 0.82));
      col *= 1.0 - smoothstep(0.32, 0.95, r) * (vig + focus * 0.35);
      col = mix(col, vec3(0.32, 0.0, 0.0), smoothstep(0.25, 0.8, r) * (hurt * 0.55 + low * (0.25 + 0.1 * sin(time * 5.0))));
      col += (h(vUv * 800.0 + time) - 0.5) * 0.035;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

function glintTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,240,210,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(0, 32); x.lineTo(64, 32); x.moveTo(32, 0); x.lineTo(32, 64); x.stroke();
  return new THREE.CanvasTexture(c);
}

export interface FrameOpts { yaw: number; pitch: number; lock: number; debugHitboxes: boolean; paused: boolean; menu: boolean }

export class GameRenderer {
  three: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private arena: Arena;
  gore: Gore;
  private views = new Map<number, View>();
  private corpses: View[] = [];
  private spurts: Spurt[] = [];
  private glints: Glint[] = [];
  private glintTex = glintTexture();
  private ring: THREE.Mesh;
  private lockRing: THREE.Mesh;
  private trail: THREE.Mesh;
  private trailPts: THREE.Vector3[] = [];
  private debug = new THREE.Group();
  private focus = new THREE.Vector3(0, 1.4, -5);
  private camYaw = 0;
  private trauma = 0;
  private hurt = 0;
  private fin = 0;
  private time = 0;
  private menuAngle = 0;
  private flash: THREE.PointLight;
  quality: 'low' | 'high';

  constructor(canvas: HTMLCanvasElement, quality: 'low' | 'high') {
    this.quality = quality;
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : 1));
    this.three.shadowMap.enabled = quality === 'high';
    this.three.shadowMap.type = THREE.PCFShadowMap;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.45;
    this.arena = new Arena(this.scene, quality, this.three);
    this.gore = new Gore(this.scene);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.5, 28), new THREE.MeshBasicMaterial({ color: 0xd8d2c0, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false;
    this.lockRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 4), new THREE.MeshBasicMaterial({ color: 0xb01018, transparent: true, opacity: 0.85, depthWrite: false }));
    this.lockRing.rotation.x = -Math.PI / 2; this.lockRing.visible = false;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 2 * 3), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(14 * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < 13; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    tg.setIndex(idx);
    this.trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.trail.frustumCulled = false;
    this.flash = new THREE.PointLight(0xfff0d0, 0, 8, 2);
    this.scene.add(this.ring, this.lockRing, this.trail, this.debug, this.flash);

    if (quality === 'high') {
      const c = (this.composer = new EffectComposer(this.three));
      c.addPass(new RenderPass(this.scene, this.camera));
      c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.7, 0.82));
      c.addPass((this.grade = new ShaderPass(GradeShader)));
      c.addPass(new OutputPass());
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> { await this.gore.init(); }
  setGore(level: GoreLevel): void { this.gore.level = level; }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.three.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- views

  private makeView(f: Fighter, kit?: string): View {
    const rig = new Rig(f.def.look, f.weapon?.model ?? null, { scale: (f.def.scale ?? 1) * (f.elite ? 1.2 : 0.94 + ((f.id * 37) % 13) / 100), kit, shield: !!f.shield, twoHanded: f.weapon?.twoHanded });
    this.scene.add(rig.root);
    const v: View = { rig, f, x: f.x, z: f.z, yaw: f.facing, px: f.x, pz: f.z, kit, sink: 0 };
    rig.root.position.set(f.x, 0, f.z); rig.root.rotation.y = f.facing;
    return v;
  }

  private syncViews(world: World, dt: number): void {
    const live = new Set<number>();
    for (const f of world.fighters) {
      live.add(f.id);
      let v = this.views.get(f.id);
      if (v && f === world.knight && (v.kit !== world.kitId || (f.weapon && !v.rig.weapon && f.limbs.armR.state === 'ok') || (f.limbs.head.state === 'ok' && !v.rig.head.parent) || this.knightNeedsLimbs(v, f))) {
        // New kit, or the barber-surgeon has been: rebuild the knight.
        v.rig.root.removeFromParent(); this.views.delete(f.id); v = undefined;
      }
      if (!v) { v = this.makeView(f, f === world.knight ? world.kitId : undefined); this.views.set(f.id, v); }
      v.rig.root.visible = f.state !== 'gone';
      const k = 1 - Math.exp(-28 * dt);
      v.px = v.x; v.pz = v.z;
      v.x += (f.x - v.x) * k; v.z += (f.z - v.z) * k;
      v.yaw += angleDiff(f.facing, v.yaw) * (1 - Math.exp(-22 * dt));
      v.rig.root.position.set(v.x, 0, v.z);
      v.rig.root.rotation.y = v.yaw;
      const speed = Math.hypot(v.x - v.px, v.z - v.pz) / Math.max(dt, 1e-4);
      const moveDot = speed > 0.1 ? ((v.x - v.px) * Math.sin(v.yaw) + (v.z - v.pz) * Math.cos(v.yaw)) / (speed * dt) : 1;
      v.rig.update(f, dt, f.state === 'idle' || f.state === 'block' ? speed : 0, moveDot);
      v.rig.setBlood(f.blood);
    }
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      this.views.delete(id);
      if (v.f.state === 'dead') { this.corpses.push(v); } else v.rig.root.removeFromParent();
    }
    while (this.corpses.length > MAX_CORPSES) this.corpses.shift()!.rig.root.removeFromParent();
    for (const c of this.corpses) c.rig.update(c.f, dt, 0, 1);
  }
  private knightNeedsLimbs(v: View, f: Fighter): boolean {
    for (const l of ['armL', 'armR', 'legL', 'legR'] as Limb[]) if (f.limbs[l].state === 'ok' && !v.rig.limbGroup(l)) return true;
    return false;
  }

  clearField(): void {
    for (const c of this.corpses) c.rig.root.removeFromParent();
    this.corpses = [];
    this.gore.clear();
  }

  // ---------------------------------------------------------------- events

  handle(e: SimEvent, world: World): void {
    const v = 'id' in e ? this.views.get(e.id) : undefined;
    switch (e.t) {
      case 'hit': {
        const y = ZONE_Y[e.zone] * (v?.rig.scale ?? 1);
        const cut = e.type === 'cut' ? 1 : e.type === 'pierce' ? 0.7 : 0.45;
        this.gore.spray(e.x, y, e.z, e.dirX, e.dirZ, Math.min(46, 6 + e.dmg * 0.7) * cut, e.heavy ? 6 : 4);
        if (e.killed) { this.gore.spray(e.x, y, e.z, e.dirX, e.dirZ, 30, 3); this.gore.decal(e.x + e.dirX * 0.4, e.z + e.dirZ * 0.4, 0.7, 1.3); }
        else if (Math.random() < 0.6) this.gore.decal(e.x + e.dirX * 0.8, e.z + e.dirZ * 0.8, 0.4 + Math.random() * 0.5);
        const knight = e.id === world.knight.id || e.by === world.knight.id;
        if (knight) this.trauma = Math.min(1, this.trauma + (e.heavy ? 0.5 : 0.28) + (e.killed ? 0.12 : 0));
        if (e.id === world.knight.id) this.hurt = Math.min(1, this.hurt + 0.35 + e.dmg / 40);
        break;
      }
      case 'sever': if (v) this.sever(v, e.limb, e.dirX, e.dirZ, e.force); break;
      case 'drop':
        if (v && e.what === 'weapon' && v.rig.weapon?.parent) this.flingItem(v, 'weapon', 0, 0);
        if (v && e.what === 'shield' && v.rig.shield?.parent) this.flingItem(v, 'shield', 0, 0);
        break;
      case 'armourBreak': if (v) { v.rig.breakArmour(e.piece); this.trauma = Math.min(1, this.trauma + 0.3); } break;
      case 'windup':
        if (v && v.f.team === 1 && v.rig.weapon) this.glint(v, 0.7, 0xfff2d8);
        break;
      case 'parry': {
        const a = this.views.get(e.by);
        if (v) this.glint(v, 1.6, 0xffffff, true);
        if (a && v) { this.flash.position.set((a.x + v.x) / 2, 1.3, (a.z + v.z) / 2); this.flash.intensity = 40; }
        this.trauma = Math.min(1, this.trauma + 0.35);
        break;
      }
      case 'block':
        if (v) this.glint(v, 0.9, 0xffe0b0, true);
        this.trauma = Math.min(1, this.trauma + (e.broke ? 0.45 : 0.2));
        break;
      case 'death':
        if (v && v.f.team === 1 && v.rig.weapon?.parent && Math.random() < 0.7) this.flingItem(v, 'weapon', 0, 0);
        break;
      case 'knockdown': this.trauma = Math.min(1, this.trauma + 0.12); break;
    }
  }

  private flingItem(v: View, what: 'weapon' | 'shield', dx: number, dz: number): void {
    const o = v.rig[what];
    if (!o) return;
    v.rig[what] = null;
    this.gore.fling(o, 0.1, 0.09, new THREE.Vector3(dx * 2 + (Math.random() - 0.5) * 2, 2 + Math.random() * 2, dz * 2 + (Math.random() - 0.5) * 2));
  }

  private sever(v: View, limb: Limb, dirX: number, dirZ: number, force: number): void {
    const g = v.rig.limbGroup(limb);
    if (!g) return;
    if (limb === 'armR') this.flingItem(v, 'weapon', dirX, dirZ);
    if (limb === 'armL') this.flingItem(v, 'shield', dirX, dirZ);
    v.rig.stumps[limb].visible = this.gore.level !== 'off';
    const up = limb === 'head' ? 5.5 : 3.5;
    const vel = new THREE.Vector3(dirX * 3.5 * force + (Math.random() - 0.5) * 2.5, up + Math.random() * 2, dirZ * 3.5 * force + (Math.random() - 0.5) * 2.5);
    if (this.gore.level === 'off') { g.removeFromParent(); return; }
    this.gore.fling(g, limb === 'head' ? 0.01 : LIMB_LEN[limb], limb === 'head' ? 0.12 : 0.07, vel, 1);
    this.spurts.push({ view: v, limb, t: limb === 'head' ? 2.2 : 3.2 });
    this.trauma = Math.min(1, this.trauma + 0.2);
  }

  private glint(v: View, size: number, color: number, atHand = false): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glintTex, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    const p = new THREE.Vector3(0, 0, atHand ? 0.3 : (v.f.weapon?.reach ?? 1) * 0.7);
    (atHand && v.rig.shield ? v.rig.shield : v.rig.weapon ?? v.rig.arms.R.hand).localToWorld(p);
    s.position.copy(p); s.scale.setScalar(size);
    this.scene.add(s);
    this.glints.push({ s, t: 0.32 });
  }

  // ---------------------------------------------------------------- frame

  frame(world: World, dt: number, simDt: number, o: FrameOpts): void {
    this.time += dt;
    this.syncViews(world, simDt);
    const kv = this.views.get(world.knight.id)!;
    const k = world.knight;

    // Arterial sprays pulse from fresh stumps.
    const tmp = new THREE.Vector3();
    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i];
      s.t -= simDt;
      if (s.t <= 0) { this.spurts.splice(i, 1); continue; }
      const pulse = Math.sin(s.t * 14) > 0.2;
      if (pulse && Math.random() < 0.8) {
        s.view.rig.stumps[s.limb].getWorldPosition(tmp);
        const out = s.limb === 'armL' ? 1 : s.limb === 'armR' ? -1 : 0, yaw = s.view.yaw;
        this.gore.spray(tmp.x, tmp.y, tmp.z, Math.cos(yaw) * out * 0.6, -Math.sin(yaw) * out * 0.6, s.limb === 'head' ? 4 : 2, s.limb === 'head' ? 2.5 : 3.5);
      }
    }
    this.gore.update(simDt);
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const g = this.glints[i];
      g.t -= dt;
      g.s.material.opacity = Math.max(0, g.t / 0.32);
      g.s.material.rotation += dt * 3;
      if (g.t <= 0) { g.s.removeFromParent(); g.s.material.dispose(); this.glints.splice(i, 1); }
    }
    this.flash.intensity *= Math.exp(-18 * dt);

    // Soft-target mark at their feet; lock-on mark when hard-locked.
    const st = this.views.get(k.softTarget), lt = this.views.get(o.lock);
    this.ring.visible = !!st && !lt && world.wave.phase === 'fight' && !o.menu;
    if (st) { this.ring.position.set(st.x, 0.03, st.z); this.ring.scale.setScalar(st.rig.scale); }
    this.lockRing.visible = !!lt;
    if (lt) { this.lockRing.position.set(lt.x, 0.035, lt.z); this.lockRing.rotation.z += dt * 1.5; }

    this.updateTrail(kv, k);
    this.updateDebug(world, o.debugHitboxes);
    this.updateCamera(world, kv, dt, o);
    this.arena.update(dt, this.camera.position);

    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    if (this.grade) {
      const u = this.grade.uniforms;
      u.time.value = this.time; u.hurt.value = this.hurt; u.focus.value = this.fin;
      u.low.value = k.hp < k.maxHp * 0.3 && k.state !== 'dead' ? 1 : 0;
      // Closed helms narrow the view.
      u.vig.value = world.kitId === 'plate' ? 0.9 : 0.55;
      this.composer!.render(dt);
    } else this.three.render(this.scene, this.camera);
  }

  private updateTrail(kv: View, k: Fighter): void {
    const blade = kv.rig.weapon;
    const swinging = k.state === 'attack' && k.phase === 'active' && !!blade?.parent && !k.move?.reach;
    const N = 14;
    if (swinging && blade) {
      const a = blade.localToWorld(new THREE.Vector3(0, 0, 0.35)), b = blade.localToWorld(new THREE.Vector3(0, 0, 1.05));
      this.trailPts.unshift(a, b);
    } else if (this.trailPts.length) this.trailPts.splice(-2, 2);
    this.trailPts.length = Math.min(this.trailPts.length, N * 2);
    const pos = this.trail.geometry.attributes.position as THREE.BufferAttribute, col = this.trail.geometry.attributes.color as THREE.BufferAttribute;
    const n = this.trailPts.length / 2;
    for (let i = 0; i < N; i++) {
      const j = Math.min(i, n - 1), f = n > 1 ? Math.max(0, 1 - i / n) * 0.3 : 0;
      for (let s = 0; s < 2; s++) {
        const p = n > 0 ? this.trailPts[j * 2 + s] : this.focus;
        pos.setXYZ(i * 2 + s, p.x, p.y, p.z);
        col.setXYZ(i * 2 + s, f * (s ? 1 : 0.3), f * (s ? 0.95 : 0.28), f * (s ? 0.85 : 0.25));
      }
    }
    pos.needsUpdate = col.needsUpdate = true;
    this.trail.visible = n > 1;
  }

  private updateDebug(world: World, on: boolean): void {
    for (const c of [...this.debug.children]) { c.removeFromParent(); (c as THREE.Line).geometry.dispose(); }
    if (!on) return;
    const line = (pts: THREE.Vector3[], color: number) => this.debug.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false, fog: false })));
    for (const f of world.fighters) {
      if (f.state === 'gone') continue;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 20; i++) pts.push(new THREE.Vector3(f.x + Math.sin((i / 20) * 6.283) * f.def.radius, 0.06, f.z + Math.cos((i / 20) * 6.283) * f.def.radius));
      line(pts, f.state === 'dead' ? 0x444444 : f.invuln ? 0x44aaff : f.ai?.hasToken ? 0xff4444 : 0x44ff66);
      if (f.state === 'attack' && f.move) {
        const r = world.reachOf(f, f.move), half = (f.move.arc / 2) * DEG, arc: THREE.Vector3[] = [new THREE.Vector3(f.x, 0.08, f.z)];
        for (let i = 0; i <= 14; i++) { const a = f.facing - half + (i / 14) * half * 2; arc.push(new THREE.Vector3(f.x + Math.sin(a) * r, 0.08, f.z + Math.cos(a) * r)); }
        arc.push(arc[0]);
        line(arc, f.phase === 'active' ? 0xff2222 : f.phase === 'windup' ? 0xffcc22 : 0x666666);
      }
    }
    for (const ob of world.obstacles) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 20; i++) pts.push(new THREE.Vector3(ob.x + Math.sin((i / 20) * 6.283) * ob.r, 0.06, ob.z + Math.cos((i / 20) * 6.283) * ob.r));
      line(pts, 0x8888ff);
    }
  }

  // ---------------------------------------------------------------- camera

  /** Over-the-shoulder camera: damped follow, crowd pull-back, palisade avoidance, shake, lock-on framing. */
  private updateCamera(world: World, kv: View, dt: number, o: FrameOpts): void {
    const k = world.knight;
    const R = TUNING.arenaRadius;
    if (o.menu) { // slow orbit behind the title screen
      this.menuAngle += dt * 0.07;
      const a = this.menuAngle + 2.6;
      this.camera.position.set(kv.x + Math.sin(a) * 3.4, 1.25, kv.z + Math.cos(a) * 3.4);
      this.camera.lookAt(kv.x - Math.cos(a) * 0.9, 1.3, kv.z + Math.sin(a) * 0.9);
      this.camYaw = o.yaw;
      return;
    }
    const fk = 1 - Math.exp(-11 * dt);
    this.focus.x += (kv.x - this.focus.x) * fk; this.focus.z += (kv.z - this.focus.z) * fk;
    const downY = k.state === 'down' || k.state === 'dead' ? 0.7 : k.crippled ? 1.0 : 1.5;
    this.focus.y += (downY - this.focus.y) * (1 - Math.exp(-5 * dt));
    this.fin += ((k.state === 'finishing' ? 1 : 0) - this.fin) * (1 - Math.exp(-(k.state === 'finishing' ? 3.5 : 6) * dt));

    let crowd = 0;
    for (const f of world.fighters) if (f.team === 1 && f.state !== 'dead' && f.state !== 'gone' && Math.hypot(f.x - k.x, f.z - k.z) < 7) crowd++;
    const yaw = o.yaw + this.fin * 0.75, pitch = o.pitch * (1 - this.fin * 0.5);
    this.camYaw = yaw;
    let dist = (4.5 + Math.min(1.9, crowd * 0.13)) * (1 - this.fin * 0.38);
    const fx = Math.sin(yaw) * Math.cos(pitch), fy = -Math.sin(pitch), fz = Math.cos(yaw) * Math.cos(pitch);
    const rx = -Math.cos(yaw), rz = Math.sin(yaw); // camera right
    const shoulder = 0.6 * (1 - this.fin);
    const at = (d: number, out: THREE.Vector3) => out.set(this.focus.x - fx * d + rx * shoulder, this.focus.y - fy * d + 0.25, this.focus.z - fz * d + rz * shoulder);
    const p = new THREE.Vector3();
    // Stay inside the palisade and above the mud: shorten the boom rather than clip.
    for (let i = 0; i < 6; i++) { at(dist, p); if (Math.hypot(p.x, p.z) > R + 0.2 || p.y < 0.35) dist *= 0.86; else break; }
    at(dist, p);
    p.y = Math.max(0.35, p.y);
    this.camera.position.copy(p);
    this.camera.lookAt(this.focus.x + fx * 4 + rx * shoulder, this.focus.y + fy * 4 + 0.15, this.focus.z + fz * 4 + rz * shoulder);
    // Shake: trauma squared, so small hits barely register and big ones land.
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const s = this.trauma * this.trauma, t = this.time * 38;
    this.camera.rotation.x += Math.sin(t * 1.1) * 0.02 * s; this.camera.rotation.y += Math.sin(t * 1.37 + 2) * 0.02 * s; this.camera.rotation.z += Math.sin(t * 0.93 + 4) * 0.025 * s;
    const fov = 58 + (k.sprinting ? 4 : 0) - this.fin * 10;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-6 * dt)); this.camera.updateProjectionMatrix(); }
  }

  /** World point to screen pixels, for HUD elements pinned to things in the world. */
  toScreen(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, behind: v.z > 1 };
  }
  viewPos(id: number): { x: number; z: number; scale: number } | null {
    const v = this.views.get(id);
    return v ? { x: v.x, z: v.z, scale: v.rig.scale } : null;
  }
  get yaw(): number { return this.camYaw; }
}
