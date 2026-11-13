import * as THREE from 'three';
import { TUNING } from '../data/tuning';
import { GATES } from '../sim/world';

// The village square of Tale 1: churned mud inside a palisade, burnt cottages beyond it,
// a well, a broken cart, a gibbet. Overcast, raining, lit by a low sun and three fires.

const R = TUNING.arenaRadius;
export const FOG_COLOR = 0x2b2f35;

function noiseCanvas(size: number, draw: (x: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return c;
}

function mudMaterial(): THREE.MeshStandardMaterial {
  const col = noiseCanvas(1024, (x, s) => {
    x.fillStyle = '#54432f'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) {
      const px = Math.random() * s, py = Math.random() * s, r = 3 + Math.random() * 30;
      const v = Math.random();
      x.fillStyle = v < 0.45 ? `rgba(30,22,14,${0.05 + Math.random() * 0.12})` : v < 0.8 ? `rgba(110,88,60,${0.04 + Math.random() * 0.08})` : `rgba(84,88,56,${0.03 + Math.random() * 0.05})`;
      x.beginPath(); x.ellipse(px, py, r, r * (0.4 + Math.random() * 0.6), Math.random() * 3, 0, 7); x.fill();
    }
    // cart ruts
    x.strokeStyle = 'rgba(10,8,6,0.25)'; x.lineWidth = 5;
    for (let i = 0; i < 14; i++) { x.beginPath(); const y = Math.random() * s; x.moveTo(0, y); x.bezierCurveTo(s * 0.3, y + 60 * (Math.random() - 0.5), s * 0.6, y + 90 * (Math.random() - 0.5), s, y + 40 * (Math.random() - 0.5)); x.stroke(); }
  });
  const rough = noiseCanvas(512, (x, s) => {
    x.fillStyle = '#d8d8d8'; x.fillRect(0, 0, s, s);
    // Puddles: dark in the roughness map means wet and reflective.
    for (let i = 0; i < 70; i++) {
      const px = Math.random() * s, py = Math.random() * s, r = 8 + Math.random() * 34;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(20,20,20,0.95)'); g.addColorStop(0.7, 'rgba(40,40,40,0.7)'); g.addColorStop(1, 'rgba(216,216,216,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r, r * 0.6, Math.random() * 3, 0, 7); x.fill();
    }
  });
  const bump = noiseCanvas(512, (x, s) => {
    x.fillStyle = '#808080'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 6000; i++) { const v = Math.random() < 0.5 ? 255 : 0; x.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.12})`; x.beginPath(); x.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 7, 0, 7); x.fill(); }
  });
  const tex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return new THREE.MeshStandardMaterial({ map: tex(col, true), roughnessMap: tex(rough, false), bumpMap: tex(bump, false), bumpScale: 1.2, roughness: 1, metalness: 0.05 });
}

function skyDome(): THREE.Mesh {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: new THREE.Vector3(-0.75, 0.12, -0.65).normalize() } },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 d; uniform vec3 sun;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float y = max(d.y, 0.0);
        vec3 top = vec3(0.075,0.085,0.10), hor = vec3(0.20,0.205,0.21);
        vec3 c = mix(hor, top, pow(y, 0.45));
        float cl = n(d.xz/(y+0.25)*2.0)*0.6 + n(d.xz/(y+0.25)*5.0)*0.4;
        c *= 0.75 + cl*0.5;
        float s = pow(max(dot(normalize(d), sun), 0.0), 6.0);
        c += vec3(0.55,0.33,0.16) * s * 0.55 * (1.0 - y);
        c = mix(vec3(0.169,0.184,0.208), c, smoothstep(-0.02, 0.12, d.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 16), m);
  s.renderOrder = -10;
  return s;
}

function flameTexture(): THREE.Texture {
  const c = noiseCanvas(64, (x) => {
    const g = x.createRadialGradient(32, 40, 2, 32, 34, 30);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.3, 'rgba(255,160,50,0.8)'); g.addColorStop(0.7, 'rgba(200,50,10,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function softTexture(): THREE.Texture {
  return new THREE.CanvasTexture(noiseCanvas(64, (x) => {
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  }));
}

interface Fire { light: THREE.PointLight; flames: THREE.Sprite[]; base: THREE.Vector3; seed: number }

export class Arena {
  group = new THREE.Group();
  sun: THREE.DirectionalLight;
  private fires: Fire[] = [];
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private smoke: THREE.Points;
  private smokeData: Float32Array;
  private embers: THREE.Points;
  private crows: THREE.Group[] = [];
  private t = 0;

  constructor(scene: THREE.Scene, quality: 'low' | 'high', renderer?: THREE.WebGLRenderer) {
    scene.add(this.group);
    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.026);
    const sky = skyDome();
    this.group.add(sky);
    // Image-based lighting from the overcast sky itself, so steel has something to reflect.
    if (renderer) {
      const envScene = new THREE.Scene();
      const envSky = sky.clone(); envScene.add(envSky);
      const warm = new THREE.Mesh(new THREE.SphereGeometry(14, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb070 }));
      warm.position.set(-120, 30, -100); envScene.add(warm);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 16), new THREE.MeshBasicMaterial({ color: 0x17120d }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(envScene, 0.04, 1, 300).texture;
      scene.environmentIntensity = 2.2;
      pm.dispose();
    }

    const hemi = new THREE.HemisphereLight(0x9fb0c8, 0x4a3a2a, 1.7);
    this.sun = new THREE.DirectionalLight(0xffd2a4, 4.6);
    this.sun.position.set(-26, 11, -22);
    this.sun.castShadow = quality === 'high';
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 5; sc.far = 80;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.03;
    // A cool fill from the opposite side so figures read against the gloom. No shadows.
    const fill = new THREE.DirectionalLight(0x8ea4c4, 1.1);
    fill.position.set(20, 14, 24);
    this.group.add(hemi, this.sun, this.sun.target, fill);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(70, 64), mudMaterial());
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.group.add(ground);

    this.palisade();
    this.props();
    this.village();

    // Rain: streaks in a box that follows the camera.
    const N = quality === 'high' ? 1400 : 500;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.resetDrop(i, true);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9aa4b0, transparent: true, opacity: 0.22, fog: false }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    // Smoke from the fires and the ruins, and drifting embers.
    const S = 90;
    this.smokeData = new Float32Array(S * 2);
    const sp = new Float32Array(S * 3);
    for (let i = 0; i < S; i++) { this.smokeData[i * 2] = Math.random(); this.smokeData[i * 2 + 1] = i; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({ map: softTexture(), color: 0x15161a, size: 5, transparent: true, opacity: 0.32, depthWrite: false, sizeAttenuation: true }));
    this.smoke.frustumCulled = false;
    const E = 70, ep = new Float32Array(E * 3);
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xff8a30, size: 0.06, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.embers.frustumCulled = false;
    this.group.add(this.smoke, this.embers);

    // Crows, circling. They know.
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.18, 0, 0, -0.14, 0.55, 0.1, -0.05, 0, 0, 0.18, -0.55, 0.1, -0.05, 0, 0, -0.14]), 3));
    const cm = new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) { const c = new THREE.Group(); c.add(new THREE.Mesh(wing, cm)); c.userData = { r: 14 + Math.random() * 22, h: 13 + Math.random() * 9, sp: (0.12 + Math.random() * 0.12) * (i % 2 ? 1 : -1), ph: Math.random() * 6.28 }; this.crows.push(c); this.group.add(c); }
  }

  private resetDrop(i: number, anywhere: boolean): void {
    const p = this.rainPos, j = i * 6;
    const x = (Math.random() - 0.5) * 36, z = (Math.random() - 0.5) * 36, y = anywhere ? Math.random() * 16 : 16;
    p[j] = x; p[j + 1] = y; p[j + 2] = z; p[j + 3] = x + 0.06; p[j + 4] = y - 0.55; p[j + 5] = z + 0.03;
  }

  private palisade(): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 0.95 });
    const g = new THREE.CylinderGeometry(0.09, 0.13, 1, 6); g.translate(0, 0.5, 0);
    const tip = new THREE.ConeGeometry(0.09, 0.22, 6); tip.translate(0, 1.11, 0);
    const n = 230;
    const stakes = new THREE.InstancedMesh(g, wood, n), tips = new THREE.InstancedMesh(tip, wood, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let c = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // Gaps where the peasants come in.
      if (GATES.some((gt) => Math.abs(Math.atan2(Math.sin(a - gt), Math.cos(a - gt))) < 0.085)) continue;
      const h = 1.5 + Math.random() * 0.7, r = R + 0.55 + Math.random() * 0.12;
      e.set((Math.random() - 0.5) * 0.16, Math.random() * 3, (Math.random() - 0.5) * 0.16);
      m.compose(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r), q.setFromEuler(e), new THREE.Vector3(1 + Math.random() * 0.4, h, 1 + Math.random() * 0.4));
      stakes.setMatrixAt(c, m); tips.setMatrixAt(c, m); c++;
    }
    stakes.count = tips.count = c;
    stakes.castShadow = tips.castShadow = true; stakes.receiveShadow = true;
    this.group.add(stakes, tips);
    // A rail lashed along the stakes.
    const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 0.5, 0.05, 5, 120), wood);
    rail.rotation.x = Math.PI / 2; rail.position.y = 1.05;
    this.group.add(rail);
  }

  private fire(x: number, z: number, y = 0.25, size = 1): void {
    const light = new THREE.PointLight(0xff7a2a, 26 * size, 22, 1.8);
    light.position.set(x, y + 0.9, z);
    const flames: THREE.Sprite[] = [];
    const tex = (this.flameTex ??= flameTexture());
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0xffc890 }));
      s.position.set(x, y + 0.3 + i * 0.22, z); flames.push(s); this.group.add(s);
    }
    this.fires.push({ light, flames, base: new THREE.Vector3(x, y, z), seed: Math.random() * 10 });
    this.group.add(light);
  }
  private flameTex: THREE.Texture | null = null;

  private props(): void {
    const stone = new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x33271c, roughness: 0.9 });
    const char = new THREE.MeshStandardMaterial({ color: 0x121110, roughness: 1 });
    const add = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; this.group.add(m); return m; };

    // The well (obstacle at the centre).
    stone.side = THREE.DoubleSide;
    add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.8, 14, 1, true), stone), 0, 0.4, 0);
    add(new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.1, 6, 14), stone), 0, 0.8, 0).rotation.x = Math.PI / 2;
    add(new THREE.Mesh(new THREE.CircleGeometry(1, 14), new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.1 })), 0, 0.5, 0).rotation.x = -Math.PI / 2;
    for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6), wood), s * 1.0, 1.1, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 6), wood), 0, 2.15, 0).rotation.z = Math.PI / 2;
    const roof = add(new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.7, 4), char), 0, 2.6, 0); roof.rotation.y = Math.PI / 4;

    // The cart, on its side with a broken wheel.
    const cart = new THREE.Group(); cart.position.set(-7.5, 0, 6); cart.rotation.y = 0.5;
    const cb = (w: number, h: number, d: number, x: number, y: number, z: number, m = wood) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; cart.add(b); return b; };
    cb(2.6, 0.12, 1.4, 0, 0.75, 0).rotation.z = 0.12;
    cb(2.6, 0.5, 0.08, 0, 1.05, 0.7).rotation.z = 0.12; cb(2.6, 0.5, 0.08, 0, 1.05, -0.7).rotation.z = 0.12;
    cb(1.6, 0.08, 0.08, 2, 0.55, 0.4).rotation.z = -0.3; cb(1.6, 0.08, 0.08, 2, 0.55, -0.4).rotation.z = -0.3;
    const wheelG = new THREE.TorusGeometry(0.6, 0.07, 6, 16);
    const w1 = new THREE.Mesh(wheelG, wood); w1.position.set(-0.6, 0.62, 0.85); cart.add(w1);
    const w2 = new THREE.Mesh(wheelG, wood); w2.position.set(0.9, 0.1, -1.5); w2.rotation.x = Math.PI / 2 - 0.15; cart.add(w2);
    for (let i = 0; i < 9; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(0.13 + Math.random() * 0.06, 7, 6), new THREE.MeshStandardMaterial({ color: i % 3 ? 0x8a7a8c : 0xb8a890, roughness: 0.8 })); t.position.set(-0.8 + Math.random() * 2.4, 0.12, 1.2 + Math.random() * 1.3); t.castShadow = true; cart.add(t); }
    this.group.add(cart);

    // The gibbet.
    const gx = 8, gz = -6.5;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 5, 7), wood), gx, 2.5, gz);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.16), wood), gx + 0.9, 4.8, gz);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.1), wood), gx + 0.45, 4.35, gz).rotation.z = 0.8;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 4), char), gx + 1.8, 4.2, gz);
    const cage = add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 1.5, 8, 3), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.6, metalness: 0.7, wireframe: true })), gx + 1.8, 2.9, gz);
    cage.userData.sway = true; this.cage = cage;
    add(new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.8, 3, 6), char), gx + 1.8, 2.85, gz);

    // Fires: a brazier by the well, a burning cart-load, a pyre by the fence.
    for (const [x, z] of [[4.5, 7.5], [-11, -6], [10.5, 3.5]] as const) {
      for (let i = 0; i < 5; i++) { const l = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 5), char), x + (Math.random() - 0.5) * 0.5, 0.2, z + (Math.random() - 0.5) * 0.5); l.rotation.set(1.2 + Math.random() * 0.5, Math.random() * 6, 0); }
      this.fire(x, z);
    }
    // Scattered debris: stones, dropped tools, straw.
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, r = 3 + Math.random() * (R - 4);
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06 + Math.random() * 0.12, 0), stone);
      s.position.set(Math.sin(a) * r, 0.03, Math.cos(a) * r); s.rotation.set(Math.random() * 3, Math.random() * 3, 0); s.scale.y = 0.6; s.receiveShadow = true;
      this.group.add(s);
    }
  }
  private cage: THREE.Mesh | null = null;

  private village(): void {
    const wall = new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 1 });
    const char = new THREE.MeshStandardMaterial({ color: 0x0f0e0d, roughness: 1 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xff6a20, fog: false });
    const roofG = new THREE.CylinderGeometry(0.01, 1, 1, 4, 1); roofG.rotateY(Math.PI / 4);
    const beam = new THREE.BoxGeometry(0.16, 1, 0.16);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.35, r = R + 5.5 + Math.random() * 6;
      const g = new THREE.Group(); g.position.set(Math.sin(a) * r, 0, Math.cos(a) * r); g.rotation.y = a + (Math.random() - 0.5) * 0.8;
      const w = 4 + Math.random() * 2.5, d = 3.5 + Math.random() * 2, h = 2.2 + Math.random() * 0.8;
      const burnt = i % 3 !== 0;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), burnt ? char : wall); body.position.y = h / 2; body.castShadow = body.receiveShadow = true; g.add(body);
      if (burnt) { // rafters only
        for (let k = 0; k < 5; k++) for (const s of [-1, 1]) { const b = new THREE.Mesh(beam, char); b.scale.y = d * 0.75; b.position.set(-w / 2 + (k + 0.5) * (w / 5), h + d * 0.26, s * d * 0.24); b.rotation.x = s * 0.85; b.castShadow = true; g.add(b); }
        if (i % 2) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), glow); e.position.set(0, 1.1, d / 2 + 0.01); g.add(e); this.fire(g.position.x, g.position.z, 0.4, 0.9); }
      } else { const roof = new THREE.Mesh(roofG, new THREE.MeshStandardMaterial({ color: 0x4a4332, roughness: 1 })); roof.scale.set(w * 0.78, 2, d * 0.78); roof.position.y = h + 1; roof.castShadow = true; g.add(roof); }
      this.group.add(g);
    }
    // Dead trees on the skyline.
    const bark = new THREE.MeshStandardMaterial({ color: 0x16130f, roughness: 1 });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * 6.28, r = R + 9 + Math.random() * 22;
      const t = new THREE.Group(); t.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      const h = 4 + Math.random() * 4;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.28, h, 6), bark); trunk.position.y = h / 2; t.add(trunk);
      for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07, 1.6 + Math.random() * 1.5, 4), bark); b.position.y = h * (0.5 + Math.random() * 0.45); b.rotation.set((Math.random() - 0.5) * 2.2, Math.random() * 6, 0.9 + Math.random() * 0.6); b.translateY(0.8); t.add(b); }
      this.group.add(t);
    }
  }

  update(dt: number, cam: THREE.Vector3): void {
    this.t += dt;
    const t = this.t;
    for (const f of this.fires) {
      const n = Math.sin(t * 11 + f.seed) * 0.5 + Math.sin(t * 23.7 + f.seed * 2) * 0.3 + Math.sin(t * 5.3 + f.seed) * 0.2;
      f.light.intensity = (f.light.userData.base ??= f.light.intensity) * (1 + n * 0.22);
      f.flames.forEach((s, i) => {
        const p = (t * 1.6 + i * 0.25 + f.seed) % 1;
        s.position.y = f.base.y + 0.25 + p * 1.0; s.position.x = f.base.x + Math.sin(t * 3 + i * 2 + f.seed) * 0.12 * p;
        const sc = (1.25 - p * 0.9) * (1 + n * 0.1); s.scale.set(sc, sc * 1.3, 1);
        s.material.opacity = 1 - p * p;
      });
    }
    // Rain
    const p = this.rainPos;
    for (let i = 0; i < p.length; i += 6) {
      const d = 21 * dt;
      p[i + 1] -= d; p[i + 4] -= d; p[i] -= d * 0.1; p[i + 3] -= d * 0.1;
      if (p[i + 4] < 0) this.resetDrop(i / 6, false);
    }
    this.rain.position.set(cam.x, 0, cam.z);
    this.rain.geometry.attributes.position.needsUpdate = true;
    // Smoke columns
    const sp = this.smoke.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const f = this.fires[i % this.fires.length];
      const life = (this.smokeData[i * 2] = (this.smokeData[i * 2] + dt * 0.07) % 1);
      sp.setXYZ(i, f.base.x + life * 9 + Math.sin(i * 12.9 + life * 5) * (0.5 + life * 2), 1.5 + life * 20, f.base.z + life * 4 + Math.cos(i * 7.3 + life * 4) * (0.5 + life * 2));
    }
    sp.needsUpdate = true;
    const ep = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ep.count; i++) {
      const f = this.fires[i % this.fires.length];
      const life = (t * (0.18 + (i % 7) * 0.02) + i * 0.37) % 1;
      ep.setXYZ(i, f.base.x + life * 2.5 + Math.sin(i * 3.1 + t * 2) * 0.5 * life, 0.5 + life * 5, f.base.z + Math.cos(i * 5.7 + t * 1.6) * 0.6 * life + life);
    }
    ep.needsUpdate = true;
    for (const c of this.crows) {
      const u = c.userData, a = u.ph + t * u.sp;
      c.position.set(Math.sin(a) * u.r, u.h + Math.sin(t * 0.5 + u.ph) * 1.5, Math.cos(a) * u.r);
      c.rotation.y = a + (u.sp > 0 ? Math.PI / 2 : -Math.PI / 2);
      c.children[0].scale.y = 1 + Math.sin(t * 7 + u.ph) * 2.2;
    }
    if (this.cage) this.cage.rotation.z = Math.sin(t * 0.8) * 0.05;
  }
}
