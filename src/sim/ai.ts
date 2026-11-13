import { TUNING } from '../data/tuning';
import { BTN, type Command, type Fighter } from './types';
import type { World } from './world';

/**
 * Peasant brain. It only ever produces a Command, the same plain structure the player's input
 * produces, so boss knights (and later network opponents) can be driven the same way.
 */
export function think(w: World, f: Fighter, dt: number): Command {
  const a = f.ai!;
  const k = w.knight;
  const cmd: Command = { mx: 0, mz: 0, buttons: 0, aimYaw: f.facing, lock: 0 };
  if (f.state === 'dead' || f.state === 'finished') return cmd;

  const dx = k.x - f.x, dz = k.z - f.z;
  const dist = Math.hypot(dx, dz) || 1e-3;
  const nx = dx / dist, nz = dz / dist;
  a.cooldown -= dt; a.barkT -= dt; a.strafeT -= dt;
  if (!a.hasToken) a.wait += dt;

  if (a.mode === 'crawl') { // crippled: drags himself away from the knight
    cmd.mx = -nx; cmd.mz = -nz;
    return cmd;
  }
  if (!f.weapon && a.mode !== 'flee' && a.mode !== 'cower') f.morale = -1;

  if (a.mode === 'flee' || a.mode === 'cower') {
    const r = Math.hypot(f.x, f.z);
    if (r > w.radius - 1.4) {
      a.mode = 'cower';
      a.fleeT += dt;
      cmd.lock = k.id;
      if (a.fleeT > TUNING.ai.fleeEdgeTime) w.escape(f);
      return cmd;
    }
    // Run for the palisade, steering away from the knight.
    const ox = f.x / (r || 1), oz = f.z / (r || 1);
    cmd.mx = ox * 0.6 - nx; cmd.mz = oz * 0.6 - nz;
    cmd.buttons = BTN.SPRINT;
    return cmd;
  }

  cmd.lock = k.id;
  cmd.aimYaw = Math.atan2(dx, dz);
  if (k.state === 'dead') { // mill about and gloat
    cmd.mx = -nz * a.strafe * 0.3; cmd.mz = nx * a.strafe * 0.3;
    return cmd;
  }
  if (f.state !== 'idle') return cmd;

  // Attack finished (or was interrupted): hand the token back.
  if (a.hasToken && a.mode === 'ring') a.hasToken = false;
  if (a.hasToken) {
    const mv = f.moveset.moves[f.moveset.light];
    const reach = w.reachOf(f, mv) + k.def.radius;
    // Woodcutters charge from distance and swing on the run.
    if (f.def.charges && f.moveset.sprint && (a.charging || dist > 4.5)) {
      a.charging = true;
      const smv = f.moveset.moves[f.moveset.sprint];
      cmd.mx = nx; cmd.mz = nz; cmd.buttons = BTN.SPRINT;
      if (dist <= w.reachOf(f, smv) + k.def.radius + smv.lunge * 0.8) { cmd.buttons |= BTN.LIGHT; finishTurn(w, f); }
      return cmd;
    }
    if (dist > reach + mv.lunge * 0.5) {
      cmd.mx = nx; cmd.mz = nz;
      if (a.wait > 6) w.releaseToken(f); // could not get there; let someone else try
    } else {
      cmd.buttons = BTN.LIGHT;
      if (w.rng.chance(0.2)) w.bark(f, 'attack');
      finishTurn(w, f);
    }
    return cmd;
  }

  // No token: circle at a respectful distance, jeer, wait your turn.
  if (a.strafeT <= 0) { a.strafe = -a.strafe; a.strafeT = w.rng.range(1.5, 4.5); }
  const want = Math.max(a.ringR, (f.def.range ?? 1.2) + 1.2);
  const err = dist - want;
  const radial = Math.max(-1, Math.min(1, err * 0.9));
  cmd.mx = nx * radial + -nz * a.strafe * 0.45;
  cmd.mz = nz * radial + nx * a.strafe * 0.45;
  const m = Math.hypot(cmd.mx, cmd.mz);
  const cap = err > 2 ? 1 : 0.55;
  if (m > cap) { cmd.mx *= cap / m; cmd.mz *= cap / m; }
  if (a.barkT <= 0) { a.barkT = w.rng.range(6, 16); if (dist < 8) w.bark(f, 'jeer'); }
  return cmd;
}

function finishTurn(w: World, f: Fighter): void {
  const a = f.ai!;
  const [lo, hi] = f.def.cooldown ?? [1, 2];
  a.cooldown = w.rng.range(lo, hi) + 1.2;
  a.wait = 0;
  // The token is held through the attack and handed back on the next idle think.
  a.mode = 'ring';
  a.charging = false;
  a.strafe = w.rng.chance(0.5) ? 1 : -1;
}
