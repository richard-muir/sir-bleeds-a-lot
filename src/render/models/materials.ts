import * as THREE from 'three';

// Three surface families cover every character: matte (cloth, skin, leather, wood), mail and
// plate. All use vertex colours for the base paint, so one material serves many parts. Each has
// four blood levels: a splatter map multiplied over the paint, so stains build up in blotches
// rather than tinting the whole figure.

export type Kind = 'matte' | 'mail' | 'plate';
export const BLOOD_LEVELS = 4;

function canvas(size: number, draw: (x: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return c;
}
function tex(c: HTMLCanvasElement, repeat: number | [number, number] = 1, srgb = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const r = typeof repeat === 'number' ? [repeat, repeat] : repeat;
  t.repeat.set(r[0], r[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let seed = 1234;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/** Blood splatter at a given level: white where clean, deep red where soaked. Multiplied over the paint. */
function splat(level: number): THREE.CanvasTexture {
  return tex(canvas(256, (x, s) => {
    seed = 99 + level * 7;
    x.fillStyle = '#fff'; x.fillRect(0, 0, s, s);
    const blots = [0, 5, 11, 20][level];
    for (let i = 0; i < blots; i++) {
      const cx = rnd() * s, cy = rnd() * s, r = 10 + rnd() * (18 + level * 12);
      for (let k = 0; k < 14; k++) {
        const a = rnd() * 6.28, d = rnd() * r, rr = r * (0.25 + rnd() * 0.5) * (1 - d / (r * 1.4));
        for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { // wrap
          const g = x.createRadialGradient(cx + Math.cos(a) * d + ox, cy + Math.sin(a) * d + oy, 0, cx + Math.cos(a) * d + ox, cy + Math.sin(a) * d + oy, rr);
          g.addColorStop(0, 'rgba(150,14,16,0.95)'); g.addColorStop(0.7, 'rgba(165,18,18,0.85)'); g.addColorStop(1, 'rgba(170,20,20,0)');
          x.fillStyle = g; x.beginPath(); x.arc(cx + Math.cos(a) * d + ox, cy + Math.sin(a) * d + oy, rr, 0, 7); x.fill();
        }
      }
      // runs: gravity pulls it down the cloth
      x.strokeStyle = 'rgba(150,14,16,0.8)'; x.lineWidth = 1.5 + rnd() * 2.5;
      for (let k = 0; k < 2; k++) { const sx = cx + (rnd() - 0.5) * r; x.beginPath(); x.moveTo(sx, cy); x.lineTo(sx + (rnd() - 0.5) * 4, cy + r * (0.8 + rnd() * 1.6)); x.stroke(); }
    }
    for (let i = 0; i < level * 40; i++) { x.fillStyle = 'rgba(150,14,16,0.85)'; x.beginPath(); x.arc(rnd() * s, rnd() * s, 0.6 + rnd() * 2.2, 0, 7); x.fill(); }
  }), 1, true);
}

/** Coarse wool/linen weave, used as a bump map. */
function weave(): THREE.CanvasTexture {
  return tex(canvas(128, (x, s) => {
    x.fillStyle = '#808080'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 4) {
      x.fillStyle = `rgba(255,255,255,${0.1 + rnd() * 0.12})`; x.fillRect(i, 0, 2, s);
      x.fillStyle = `rgba(0,0,0,${0.1 + rnd() * 0.12})`; x.fillRect(0, i, s, 2);
    }
    for (let i = 0; i < 900; i++) { const v = rnd() < 0.5 ? 0 : 255; x.fillStyle = `rgba(${v},${v},${v},${rnd() * 0.16})`; x.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 3, 1 + rnd() * 3); }
  }), [10, 12]);
}

/** Riveted mail: offset rows of rings. Height in the bump map, the same pattern roughens the gaps. */
function rings(): { bump: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const draw = (rough: boolean) => canvas(128, (x, s) => {
    x.fillStyle = rough ? '#e8e8e8' : '#101010'; x.fillRect(0, 0, s, s);
    const n = 8, w = s / n;
    x.lineWidth = w * 0.3;
    for (let r = -1; r <= n * 2; r++) for (let c = -1; c <= n; c++) {
      const cx = (c + (r % 2 ? 0.5 : 0)) * w + w / 2, cy = r * w * 0.5 + w / 4;
      x.strokeStyle = rough ? '#5a5a5a' : r % 2 ? '#f4f4f4' : '#b0b0b0';
      x.beginPath(); x.ellipse(cx, cy, w * 0.42, w * 0.3, 0, 0, 7); x.stroke();
    }
  });
  return { bump: tex(draw(false), [7, 7]), rough: tex(draw(true), [7, 7]) };
}

/** Worked steel: fine directional scratches and the odd ding, as roughness. */
function scratches(): THREE.CanvasTexture {
  return tex(canvas(256, (x, s) => {
    x.fillStyle = '#6a6a6a'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const v = 60 + rnd() * 150; x.strokeStyle = `rgba(${v},${v},${v},${0.15 + rnd() * 0.35})`; x.lineWidth = 0.5 + rnd();
      const px = rnd() * s, py = rnd() * s, l = 4 + rnd() * 40, a = (rnd() - 0.5) * 0.5 + (rnd() < 0.15 ? 1.2 : 0);
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
    for (let i = 0; i < 50; i++) { const g = x.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, 'rgba(210,210,210,0.5)'); g.addColorStop(1, 'rgba(210,210,210,0)'); x.save(); x.translate(rnd() * s, rnd() * s); x.scale(4 + rnd() * 14, 4 + rnd() * 14); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 1, 0, 7); x.fill(); x.restore(); }
  }), [2, 2]);
}

const cache = new Map<string, THREE.MeshStandardMaterial>();
let shared: { splat: (THREE.Texture | null)[]; weave: THREE.Texture; rings: ReturnType<typeof rings>; scratch: THREE.Texture } | null = null;

/** The shared material for a surface family at a blood level (0 clean .. 3 drenched). */
export function material(kind: Kind, blood = 0): THREE.MeshStandardMaterial {
  const key = `${kind}${blood}`;
  let m = cache.get(key);
  if (m) return m;
  shared ??= { splat: [null, splat(1), splat(2), splat(3)], weave: weave(), rings: rings(), scratch: scratches() };
  const map = shared.splat[blood];
  if (kind === 'matte') m = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.86 - blood * 0.05, metalness: 0, bumpMap: shared.weave, bumpScale: 0.6 });
  else if (kind === 'mail') m = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.82, metalness: 0.55, bumpMap: shared.rings.bump, bumpScale: 5, roughnessMap: shared.rings.rough });
  else m = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 1, metalness: 0.9, roughnessMap: shared.scratch, envMapIntensity: 0.45 });
  // Firelight on polished steel was blowing out to white: keep plate from going glassy, and
  // mail (a mass of tiny rings) duller still.
  if (kind === 'plate') m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = max(roughnessFactor, 0.52);'); };
  if (kind === 'mail') m.envMapIntensity = 0.5;
  cache.set(key, m);
  return m;
}

/** A painted emblem on transparent ground, laid over cloth or steel as a decal. */
export function decalMaterial(draw: (x: CanvasRenderingContext2D, s: number) => void, size = 256): THREE.MeshStandardMaterial {
  const t = new THREE.CanvasTexture(canvas(size, draw));
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.35, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** House Bleedsalot: a bleeding heart, silver on crimson. Drawn once, used on surcoat and tabard. */
export function drawHeart(x: CanvasRenderingContext2D, s: number, withField = false): void {
  const u = s / 256;
  if (withField) {
    x.fillStyle = '#7d1016'; x.fillRect(0, 0, s, s);
    seed = 5;
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; x.fillRect(rnd() * s, rnd() * s, 2 + rnd() * 30 * u, 1.5 * u); }
    for (let i = 0; i < 60; i++) { x.strokeStyle = `rgba(20,4,4,${0.15 + rnd() * 0.3})`; x.lineWidth = (0.6 + rnd() * 1.6) * u; const px = rnd() * s, py = rnd() * s, a = rnd() * 6.28, l = (6 + rnd() * 40) * u; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  }
  x.save(); x.translate(s / 2, s * 0.44); x.scale(u, u);
  const heart = () => { x.beginPath(); x.moveTo(0, 62); x.bezierCurveTo(-92, -4, -66, -78, 0, -34); x.bezierCurveTo(66, -78, 92, -4, 0, 62); x.closePath(); };
  x.fillStyle = '#1a0506'; x.save(); x.scale(1.09, 1.09); heart(); x.fill(); x.restore();
  const g = x.createLinearGradient(-60, -60, 50, 60); g.addColorStop(0, '#e6e2d8'); g.addColorStop(1, '#a9a69c');
  x.fillStyle = g; heart(); x.fill();
  // the wound, and what comes out of it
  x.fillStyle = '#3a0406'; x.beginPath(); x.moveTo(-8, -18); x.lineTo(14, -2); x.lineTo(2, 2); x.lineTo(-14, -12); x.closePath(); x.fill();
  x.fillStyle = '#8c0c12';
  for (const [dx, top, h, w] of [[-4, 0, 74, 6], [8, 4, 104, 7.5], [20, 30, 50, 5]]) { x.beginPath(); x.moveTo(dx - w * 0.5, top); x.lineTo(dx + w * 0.5, top); x.lineTo(dx + w * 0.6, top + h - w); x.arc(dx, top + h - w, w * 0.9, 0, Math.PI); x.closePath(); x.fill(); }
  x.restore();
}
