import type { ArmourPieceDef, KitDef, WeaponDef } from '../sim/types';

export const WEAPONS: Record<string, WeaponDef> = Object.fromEntries(([
  { id: 'armingSword', name: 'Arming sword', damage: 30, type: 'cut', reach: 1.55, weight: 1.2, model: 'sword' },
  { id: 'club', name: 'Club', damage: 9, type: 'blunt', reach: 1.15, weight: 1.5, model: 'club' },
  { id: 'rake', name: 'Rake', damage: 8, type: 'pierce', reach: 1.5, weight: 1.6, twoHanded: true, model: 'rake' },
  { id: 'fryingPan', name: 'Frying pan', damage: 8, type: 'blunt', reach: 1.0, weight: 1.8, model: 'pan' },
  { id: 'rollingPin', name: 'Rolling pin', damage: 7, type: 'blunt', reach: 0.95, weight: 0.9, model: 'pin' },
  { id: 'pitchfork', name: 'Pitchfork', damage: 12, type: 'pierce', reach: 2.25, weight: 2, twoHanded: true, model: 'pitchfork' },
  { id: 'fellingAxe', name: 'Felling axe', damage: 22, type: 'cut', reach: 1.5, weight: 2.4, twoHanded: true, model: 'axe' },
] as WeaponDef[]).map((w) => [w.id, w]));

const mail = { cut: 0.7, blunt: 0.25, pierce: 0.45 };
const plate = { cut: 0.9, blunt: 0.5, pierce: 0.75 };

export const ARMOUR: Record<string, ArmourPieceDef> = Object.fromEntries(([
  // Mail kit: Sir Bleedsalot's starting harness.
  { id: 'greatHelm', name: 'Great helm and coif', zones: ['head'], prot: { cut: 0.8, blunt: 0.4, pierce: 0.6 }, durability: 150, weight: 3.2, material: 'plate' },
  { id: 'hauberk', name: 'Mail hauberk', zones: ['torso'], prot: mail, durability: 260, weight: 10, material: 'mail' },
  { id: 'mailSleeves', name: 'Mail sleeves', zones: ['armL', 'armR'], prot: mail, durability: 160, weight: 3, material: 'mail' },
  { id: 'chausses', name: 'Mail chausses', zones: ['legL', 'legR'], prot: mail, durability: 170, weight: 5, material: 'mail' },
  // Plate kit: used by the debug panel to prove the weight trade-off before the armoury exists.
  { id: 'bascinet', name: 'Houndskull bascinet', zones: ['head'], prot: plate, durability: 260, weight: 4.5, material: 'plate' },
  { id: 'cuirass', name: 'Cuirass', zones: ['torso'], prot: plate, durability: 420, weight: 14, material: 'plate' },
  { id: 'plateArms', name: 'Pauldrons and vambraces', zones: ['armL', 'armR'], prot: plate, durability: 260, weight: 6, material: 'plate' },
  { id: 'plateLegs', name: 'Cuisses and greaves', zones: ['legL', 'legR'], prot: plate, durability: 280, weight: 9, material: 'plate' },
  { id: 'heater', name: 'Heater shield', zones: [], prot: { cut: 1, blunt: 1, pierce: 1 }, durability: 320, weight: 3, material: 'plate' },
  // Peasant "armour".
  { id: 'salvagedMail', name: 'Salvaged mail', zones: ['torso'], prot: { cut: 0.5, blunt: 0.15, pierce: 0.3 }, durability: 90, weight: 6, material: 'mail' },
] as ArmourPieceDef[]).map((a) => [a.id, a]));

export const KITS: Record<string, KitDef> = {
  mail: { id: 'mail', name: 'Mail harness', weapon: 'armingSword', shield: 'heater', armour: ['greatHelm', 'hauberk', 'mailSleeves', 'chausses'] },
  plate: { id: 'plate', name: 'Full plate', weapon: 'armingSword', shield: 'heater', armour: ['bascinet', 'cuirass', 'plateArms', 'plateLegs'] },
};

/** Weight classes from the brief (kg of kit, weapon and shield included). */
export function weightClass(kg: number): 'light' | 'medium' | 'heavy' {
  return kg < 15 ? 'light' : kg <= 30 ? 'medium' : 'heavy';
}
/** Movement speed multiplier from kit weight: 10 kg costs nothing, 40 kg costs about a quarter. */
export function speedFromWeight(kg: number): number {
  return Math.max(0.7, 1 - Math.max(0, kg - 10) * 0.0085);
}
/** Stamina pool and regen multiplier from kit weight. */
export function staminaFromWeight(kg: number): number {
  return Math.max(0.6, 1 - Math.max(0, kg - 10) * 0.011);
}
