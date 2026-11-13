import type { FighterDef } from '../sim/types';

export const FIGHTERS: Record<string, FighterDef> = Object.fromEntries(([
  { id: 'knight', label: 'Knight', hp: 100, stamina: 100, poise: 45, speed: 4.4, sprintMul: 1.5, radius: 0.42, limbHp: 60, moveset: 'oneHandShield', weapons: [], kit: 'mail', look: 'knight' },
  // The Mob: swarms. Counter with wide sweeps.
  { id: 'mob', label: 'The Mob', hp: 30, stamina: 0, poise: 0, speed: 3.4, sprintMul: 1.25, radius: 0.36, limbHp: 14, moveset: 'mob', weapons: ['club', 'rake', 'fryingPan', 'rollingPin'], range: 1.25, tokenCost: 1, morale: 0.8, gold: 3, cooldown: [0.8, 1.8], look: 'mob' },
  // Farmhand: pokes from reach and gangs up (half a token each). Close the distance.
  { id: 'farmhand', label: 'Farmhand', hp: 36, stamina: 0, poise: 0, speed: 3.1, sprintMul: 1.2, radius: 0.37, limbHp: 16, moveset: 'farmhand', weapons: ['pitchfork'], range: 2.1, tokenCost: 0.5, morale: 1, gold: 5, cooldown: [1.0, 2.0], look: 'farmhand' },
  // Woodcutter: charges in for big cut damage, then takes an age to recover. Parry him.
  { id: 'woodcutter', label: 'Woodcutter', hp: 58, stamina: 0, poise: 18, speed: 3.2, sprintMul: 1.75, radius: 0.4, limbHp: 24, moveset: 'woodcutter', weapons: ['fellingAxe'], range: 1.5, tokenCost: 1, morale: 1.4, gold: 8, cooldown: [1.6, 2.8], charges: true, scale: 1.08, look: 'woodcutter' },
] as FighterDef[]).map((f) => [f.id, f]));

/** Elites are data-only variants: bigger, tougher, with a poise bar worth breaking. */
export const ELITE = { hp: 3.2, poise: 70, limbHp: 2.6, damage: 1.3, morale: 99, gold: 40, scale: 1.2 };
