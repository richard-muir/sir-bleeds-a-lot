import { FIGHTERS } from '../data/peasants';
import { EPITHETS, FIRST_NAMES, PLAIN_NAMES } from '../data/text';
import type { WaveDef } from '../data/waves';
import { Rng } from './rng';

export interface SpawnEntry { type: string; at: number; gate: number; name: string; elite: boolean; weapon: string }

export function makeName(rng: Rng): string {
  if (rng.chance(0.16)) return rng.pick(PLAIN_NAMES);
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(EPITHETS)}`;
}

/**
 * Turn a wave definition into a deterministic spawn list: who arrives, when, through which gap in
 * the palisade, carrying what. The same definition and seed always give the same wave.
 */
export function generateWave(def: WaveDef, seed: number): SpawnEntry[] {
  const rng = new Rng(seed);
  const list: SpawnEntry[] = [];
  for (const g of def.groups) {
    const fd = FIGHTERS[g.type];
    if (!fd) throw new Error(`Unknown peasant type "${g.type}" in wave "${def.title}"`);
    for (let i = 0; i < g.count; i++) {
      list.push({ type: g.type, at: 0, gate: 0, name: g.name ?? makeName(rng), elite: !!g.elite, weapon: rng.pick(fd.weapons) });
    }
  }
  // Shuffle the rank and file; elites always arrive last so the wave builds to them.
  const rank = list.filter((e) => !e.elite), elites = list.filter((e) => e.elite);
  for (let i = rank.length - 1; i > 0; i--) { const j = rng.int(i + 1); [rank[i], rank[j]] = [rank[j], rank[i]]; }
  const ordered = [...rank, ...elites];
  const rest = Math.max(1, ordered.length - def.firstRush);
  ordered.forEach((e, i) => {
    e.at = i < def.firstRush ? i * 0.25 : 1.5 + ((i - def.firstRush + 1) / rest) * def.spawnOver;
    e.gate = rng.int(4);
  });
  return ordered;
}
