import { TUNING } from '../data/tuning';
import type { ArmourState, DamageType, Fighter, Limb, MoveDef, WeaponDef, Zone } from './types';

export interface HitResult {
  zone: Zone;
  type: DamageType;
  raw: number;
  /** Health actually removed. */
  dealt: number;
  /** Fraction stopped by armour on that zone (0 when bare). */
  protection: number;
  armourPiece: ArmourState | null;
  armourBroke: boolean;
  severed: boolean;
  killed: boolean;
}

export function armourOn(f: Pick<Fighter, 'armour'>, zone: Zone): ArmourState | null {
  for (const a of f.armour) if (a.cond > 0 && a.def.zones.includes(zone)) return a;
  return null;
}

/** Protection falls with condition: a battered piece still helps, but only 40% as much at its last gasp. */
export function effectiveProtection(a: ArmourState | null, type: DamageType): number {
  if (!a || a.cond <= 0) return 0;
  return a.def.prot[type] * (0.4 + 0.6 * a.cond);
}

/** Raw damage before armour: weapon damage x move multiplier x charge bonus x any outside multiplier. */
export function rawDamage(weapon: WeaponDef | null, move: MoveDef, charge = 0, mul = 1): number {
  const base = weapon ? weapon.damage : 5;
  return base * move.dmg * (1 + (move.chargeDmg ?? 0) * charge) * mul;
}

/** Pure damage calculation: what would this hit do? Nothing is mutated. */
export function computeHit(target: Fighter, zone: Zone, raw: number, type: DamageType): Omit<HitResult, 'armourBroke' | 'severed' | 'killed'> {
  const piece = armourOn(target, zone);
  const protection = effectiveProtection(piece, type);
  const bare = piece ? 1 : TUNING.combat.unarmouredMul;
  const through = raw * (1 - protection) * bare;
  const dealt = through * TUNING.combat.zoneHpMul[zone];
  return { zone, type, raw, dealt, protection, armourPiece: piece };
}

/**
 * Apply a hit: wears armour, damages the limb, severs it if a cut takes it to zero,
 * and removes health. Returns what happened so the caller can raise events.
 */
export function applyHit(target: Fighter, zone: Zone, raw: number, type: DamageType, wearMul = 1): HitResult {
  const r = computeHit(target, zone, raw, type);
  let armourBroke = false;
  if (r.armourPiece) {
    const wear = (raw * TUNING.combat.wearByType[type] * wearMul) / r.armourPiece.def.durability;
    r.armourPiece.cond = Math.max(0, r.armourPiece.cond - wear);
    armourBroke = r.armourPiece.cond <= 0;
  }
  let severed = false;
  if (zone !== 'torso') {
    const limb = target.limbs[zone as Limb];
    if (limb.state === 'ok') {
      // Limbs take the damage that got through the armour, before the zone's health multiplier.
      limb.hp -= raw * (1 - r.protection);
      if (limb.hp <= 0) {
        limb.hp = 0;
        // Only an edge takes a limb off. Blunt and pierce still wreck the health bar.
        if (type === 'cut') { limb.state = 'severed'; severed = true; }
      }
    }
  }
  target.hp -= r.dealt;
  let killed = false;
  if (severed && zone === 'head') target.hp = 0;
  if (target.hp <= 0) { target.hp = 0; killed = true; }
  return { ...r, armourBroke, severed, killed };
}

/** Weighted zone pick, skipping limbs that are already gone. `roll` is 0..1. */
export function pickZone(target: Fighter, weights: Partial<Record<Zone, number>>, roll: number): Zone {
  let total = 0;
  const opts: [Zone, number][] = [];
  for (const k of Object.keys(weights) as Zone[]) {
    if (k !== 'torso' && target.limbs[k as Limb].state !== 'ok') continue;
    const w = weights[k]!;
    opts.push([k, w]);
    total += w;
  }
  if (!opts.length) return 'torso';
  let x = roll * total;
  for (const [k, w] of opts) { if ((x -= w) <= 0) return k; }
  return opts[opts.length - 1][0];
}
