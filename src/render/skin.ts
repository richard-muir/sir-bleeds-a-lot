import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Kind } from './models/materials';
import type { Part, Seg } from './models/peasants';

// Turns a figure's parts (sculpted per body segment, in that segment's own space) into a few
// skinned meshes on one skeleton. Cloth and mail near a joint are weighted to both bones either
// side of it, so sleeves, hose and hauberks bend at shoulder, elbow, hip and knee instead of
// showing two rigid tubes meeting. Plate stays rigid on its bone, as plate does.

export const BONES = ['body', 'hips', 'spine', 'chest', 'head', 'upperL', 'foreL', 'handL', 'upperR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'skirtL', 'skirtR'] as const;
export type BoneName = (typeof BONES)[number];
const INDEX = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

/** Smoothstep from a to b (either direction). */
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The second bone a vertex leans on, and how much, given its segment and its height in that
 * segment's space. Segments hang down -Y from their joint, so y near 0 is the joint above and
 * large negative y is the joint below.
 */
function blend(seg: Seg, kind: Kind, y: number): [BoneName, number] | null {
  const s = seg.endsWith('L') ? 'L' : 'R';
  const base = seg.replace(/[LR]$/, '');
  if (base === 'skirt') return ['hips', 1 - sm(0.02, -0.36, y)]; // hangs from the belt, swings with the leg
  if (kind === 'plate') return null;
  const pick = (top: [BoneName, number], bot?: [BoneName, number]): [BoneName, number] | null => {
    const best = !bot || top[1] >= bot[1] ? top : bot;
    return best[1] > 0.001 ? best : null;
  };
  switch (base) {
    case 'head': return pick(['chest', 0.5 * sm(0.04, -0.03, y)]);
    case 'chest': return pick(['hips', 0.5 * sm(-0.22, -0.38, y)]);
    case 'hips': return pick(['chest', 0.5 * sm(0.1, 0.26, y)]);
    case 'upper': return pick(['chest', 0.55 * sm(-0.06, 0.04, y)], [`fore${s}` as BoneName, 0.5 * sm(-0.2, -0.32, y)]);
    case 'fore': return pick([`upper${s}` as BoneName, 0.5 * sm(-0.08, 0.04, y)], [`hand${s}` as BoneName, 0.35 * sm(-0.22, -0.3, y)]);
    case 'thigh': return pick(['hips', 0.5 * sm(-0.06, 0.06, y)], [`shin${s}` as BoneName, 0.5 * sm(-0.34, -0.48, y)]);
    case 'shin': return pick([`thigh${s}` as BoneName, 0.5 * sm(-0.08, 0.05, y)], [`foot${s}` as BoneName, 0.35 * sm(-0.36, -0.44, y)]);
  }
  return null;
}

export interface SkinGroup {
  geo: THREE.BufferGeometry;
  kind: Kind;
  piece?: string;
  hideWith?: string;
  showWhenBroken?: string;
  decal?: THREE.Material;
}

/**
 * Bake parts into bind space and weight them. `rest` holds each bone's world matrix in the rest
 * pose (root at identity); `offset` is any extra transform a segment's meshes sit at (feet are
 * modelled in shin space). Parts that hide and show together are merged into one geometry.
 */
export function skinParts(parts: Part[], rest: Record<BoneName, THREE.Matrix4>, offset: Partial<Record<Seg, THREE.Matrix4>>): SkinGroup[] {
  const groups = new Map<string, { info: Omit<SkinGroup, 'geo'>; geos: THREE.BufferGeometry[] }>();
  const decalIds = new Map<THREE.Material, number>();
  const m = new THREE.Matrix4();
  for (const p of parts) {
    const src = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    const pos = src.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const off = offset[p.seg];
    const own = INDEX[p.seg as BoneName];
    const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i) + (off ? off.elements[13] : 0);
      const b = blend(p.seg, p.kind, y);
      idx[i * 4] = own; wt[i * 4] = 1;
      if (b) { idx[i * 4 + 1] = INDEX[b[0]]; wt[i * 4] = 1 - b[1]; wt[i * 4 + 1] = b[1]; }
    }
    m.copy(rest[p.seg as BoneName]);
    if (off) m.multiply(off);
    src.applyMatrix4(m);
    if (!src.attributes.color) src.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    if (!src.attributes.uv) src.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!src.attributes.normal) src.computeVertexNormals();
    for (const k of Object.keys(src.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) src.deleteAttribute(k);
    src.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    src.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
    let did = '';
    if (p.decal) { if (!decalIds.has(p.decal)) decalIds.set(p.decal, decalIds.size); did = `d${decalIds.get(p.decal)}`; }
    const key = `${p.kind}|${p.piece ?? ''}|${p.hideWith ?? ''}|${p.showWhenBroken ?? ''}|${did}`;
    let g = groups.get(key);
    if (!g) { g = { info: { kind: p.kind, piece: p.piece, hideWith: p.hideWith, showWhenBroken: p.showWhenBroken, decal: p.decal }, geos: [] }; groups.set(key, g); }
    g.geos.push(src);
  }
  return [...groups.values()].map((g) => ({ ...g.info, geo: mergeGeometries(g.geos, false)! }));
}
