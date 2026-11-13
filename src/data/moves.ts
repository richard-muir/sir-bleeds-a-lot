import type { MoveDef, Moveset } from '../sim/types';

const spread = { head: 0.14, torso: 0.4, armL: 0.14, armR: 0.14, legL: 0.09, legR: 0.09 };
const high = { head: 0.45, torso: 0.27, armL: 0.14, armR: 0.14 };
const low = { torso: 0.3, legL: 0.3, legR: 0.3, armL: 0.05, armR: 0.05 };
const centre = { torso: 0.6, head: 0.12, armL: 0.08, armR: 0.08, legL: 0.06, legR: 0.06 };

function set(id: string, moves: MoveDef[], slots: Omit<Moveset, 'id' | 'moves'>): Moveset {
  return { id, moves: Object.fromEntries(moves.map((m) => [m.id, m])), ...slots };
}

/** The Milestone 1 moveset: one-handed weapon and shield. Every moveset will share this structure. */
const oneHandShield = set('oneHandShield', [
  { id: 'l1', anim: 'slashR', windup: 0.16, active: 0.1, recovery: 0.3, dmg: 1, arc: 120, stamina: 8, lunge: 1.3, poise: 20, hitstop: 55, zones: spread, next: { light: 'l2', heavy: 'breaker' } },
  { id: 'l2', anim: 'slashL', windup: 0.14, active: 0.1, recovery: 0.3, dmg: 1.05, arc: 120, stamina: 8, lunge: 1.3, poise: 20, hitstop: 55, zones: spread, next: { light: 'l3', heavy: 'sweep' } },
  { id: 'l3', anim: 'overhead', windup: 0.26, active: 0.12, recovery: 0.46, dmg: 1.7, arc: 70, stamina: 12, lunge: 1.5, poise: 50, knockdown: true, hitstop: 110, zones: high },
  { id: 'heavy', anim: 'overhead', windup: 0.36, active: 0.12, recovery: 0.52, dmg: 1.7, arc: 80, stamina: 20, lunge: 1.5, poise: 55, hitstop: 120, chargeMax: 0.7, chargeDmg: 0.7, zones: high },
  { id: 'sweep', anim: 'sweep', windup: 0.28, active: 0.18, recovery: 0.5, dmg: 1.05, arc: 240, reachAdd: 0.35, stamina: 18, lunge: 0.8, poise: 60, knockdown: true, push: 5, hitstop: 90, zones: low },
  { id: 'breaker', anim: 'thrust', windup: 0.28, active: 0.1, recovery: 0.48, dmg: 1.5, type: 'pierce', arc: 40, reachAdd: 0.2, stamina: 16, lunge: 1.5, poise: 90, wear: 4, hitstop: 120, zones: centre },
  { id: 'sprintAtk', anim: 'thrust', windup: 0.18, active: 0.12, recovery: 0.42, dmg: 1.4, type: 'pierce', arc: 60, reachAdd: 0.2, stamina: 12, lunge: 2.6, poise: 45, push: 4, hitstop: 90, zones: centre },
  { id: 'dodgeAtk', anim: 'slashL', windup: 0.1, active: 0.1, recovery: 0.32, dmg: 1.15, arc: 120, stamina: 8, lunge: 1.6, poise: 25, hitstop: 60, zones: spread, next: { light: 'l3', heavy: 'sweep' } },
  { id: 'riposte', anim: 'thrust', windup: 0.08, active: 0.1, recovery: 0.34, dmg: 2.3, type: 'pierce', arc: 60, reachAdd: 0.2, stamina: 6, lunge: 2, poise: 90, hitstop: 120, zones: centre },
  { id: 'bash', anim: 'bash', windup: 0.14, active: 0.09, recovery: 0.3, dmg: 0.2, type: 'blunt', arc: 110, reach: 1.25, stamina: 10, lunge: 0.9, poise: 70, guardBreak: true, push: 8, hitstop: 70, zones: { torso: 0.8, head: 0.2 } },
  { id: 'charge', anim: 'charge', windup: 0.16, active: 0.42, recovery: 0.36, dmg: 0.7, type: 'blunt', arc: 150, reach: 1.3, stamina: 0, lunge: 0, dash: 11, poise: 100, knockdown: true, guardBreak: true, push: 7, hitstop: 80, wrathCost: 100 / 3, zones: { torso: 0.7, head: 0.3 } },
], { light: 'l1', heavy: 'heavy', sprint: 'sprintAtk', dodge: 'dodgeAtk', riposte: 'riposte', kick: 'bash', special: 'charge' });

// Peasant attacks have long, readable wind-ups on purpose.
const mob = set('mob', [
  { id: 'swing', anim: 'club', windup: 0.5, active: 0.1, recovery: 0.6, dmg: 1, arc: 80, stamina: 0, lunge: 0.7, poise: 12, hitstop: 50, zones: spread },
], { light: 'swing' });

const farmhand = set('farmhand', [
  { id: 'poke', anim: 'poke', windup: 0.6, active: 0.1, recovery: 0.7, dmg: 1, arc: 30, stamina: 0, lunge: 0.6, poise: 14, hitstop: 55, zones: centre },
], { light: 'poke' });

const woodcutter = set('woodcutter', [
  { id: 'chop', anim: 'chop', windup: 0.7, active: 0.12, recovery: 1.0, dmg: 1, arc: 60, stamina: 0, lunge: 1, poise: 42, hitstop: 90, zones: high },
  { id: 'chargeChop', anim: 'chop', windup: 0.5, active: 0.14, recovery: 1.25, dmg: 1.3, arc: 60, stamina: 0, lunge: 2.6, poise: 60, hitstop: 110, zones: high },
], { light: 'chop', sprint: 'chargeChop' });

export const MOVESETS: Record<string, Moveset> = { oneHandShield, mob, farmhand, woodcutter };

/** Dry one-liners shown under a finishing move. The only joke the fight is allowed. */
export const FINISHER_CAPTIONS = [
  'A difference of opinion, resolved.',
  'He had been meaning to lose weight.',
  'Tax collected.',
  'The matter was not appealed.',
  'Regrettable. Thorough, but regrettable.',
  'He is survived by several turnips.',
  'A short career in rebellion.',
  'Nothing personal. Slightly personal.',
];
