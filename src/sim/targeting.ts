import { TUNING } from '../data/tuning';
import { angleDiff, DEG } from './rng';
import type { Fighter } from './types';

export interface Obstacle { x: number; z: number; r: number }
export interface TargetScore { id: number; score: number; angle: number; dist: number; threat: boolean; finishable: boolean; los: boolean }

export function isFinishable(f: Fighter): boolean {
  if (f.state === 'dead' || f.state === 'gone' || f.state === 'finished') return false;
  return f.state === 'down' || f.crippled || (f.state === 'stagger' && (f.elite || f.maxPoise > 0));
}
export function isThreat(f: Fighter): boolean {
  return f.state === 'attack' && f.phase !== 'recovery';
}

function segmentHitsCircle(ax: number, az: number, bx: number, bz: number, o: Obstacle): boolean {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-6;
  let t = ((o.x - ax) * dx + (o.z - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - o.x, pz = az + dz * t - o.z;
  return px * px + pz * pz < o.r * o.r;
}

/**
 * Score every live enemy as a soft-target candidate. `dir` is the direction the player is pushing
 * (or the camera's forward when they aren't). Angle is the strongest factor, then distance, threat,
 * finishability and line of sight. Weights come from data/tuning.ts.
 */
export function scoreCandidates(self: Fighter, enemies: Fighter[], dir: number, obstacles: Obstacle[] = []): TargetScore[] {
  const T = TUNING.targeting;
  const out: TargetScore[] = [];
  for (const e of enemies) {
    if (e.team === self.team || e.state === 'dead' || e.state === 'gone' || e.state === 'finished') continue;
    const dx = e.x - self.x, dz = e.z - self.z;
    const dist = Math.hypot(dx, dz);
    if (dist > T.maxRange) continue;
    const angle = Math.abs(angleDiff(Math.atan2(dx, dz), dir));
    const threat = isThreat(e);
    const finishable = isFinishable(e);
    const los = !obstacles.some((o) => segmentHitsCircle(self.x, self.z, e.x, e.z, o));
    let score =
      T.wAngle * Math.max(0, 1 - angle / (T.angleFalloffDeg * DEG)) +
      T.wDist * (1 - dist / T.maxRange) +
      (threat ? T.wThreat : 0) +
      (finishable ? T.wFinishable : 0) -
      (los ? 0 : T.losPenalty) -
      (e.ai?.mode === 'flee' || e.ai?.mode === 'cower' ? T.fleePenalty : 0);
    out.push({ id: e.id, score, angle, dist, threat, finishable, los });
  }
  // Never targeted ahead of an attacker: within the same direction cone, anyone not attacking
  // is held below the best active attacker.
  const cone = T.sameDirectionDeg * DEG;
  let bestThreat = -Infinity;
  for (const c of out) if (c.threat && c.angle < cone) bestThreat = Math.max(bestThreat, c.score);
  if (bestThreat > -Infinity) for (const c of out) if (!c.threat && c.angle < cone) c.score = Math.min(c.score, bestThreat - 0.01);
  return out;
}

/**
 * Sticky pick: keep the previous soft target unless a new one is clearly better (stickiness)
 * or the player's input has swung away (inputSwung), which frees the pick entirely.
 */
export function pickSoftTarget(prevId: number, scores: TargetScore[], inputSwung: boolean): number {
  let best: TargetScore | null = null;
  for (const c of scores) if (!best || c.score > best.score) best = c;
  if (!best || best.score <= 0) return 0;
  const prev = scores.find((c) => c.id === prevId);
  if (!prev || inputSwung) return best.id;
  return best.score > prev.score * (1 + TUNING.targeting.stickiness) + 1e-9 ? best.id : prev.id;
}
