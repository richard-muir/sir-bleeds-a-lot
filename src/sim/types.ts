// Core simulation types. Nothing in src/sim may import three.js, the DOM or anything else
// that isn't plain data: the sim must run the same in a browser, in a test, or on a server.

export type DamageType = 'cut' | 'blunt' | 'pierce';
export type Limb = 'head' | 'armL' | 'armR' | 'legL' | 'legR';
export type Zone = Limb | 'torso';
export const LIMBS: Limb[] = ['head', 'armL', 'armR', 'legL', 'legR'];
export const ZONES: Zone[] = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];

/** Button bitmask carried by a Command. The sim derives press/release edges itself. */
export const BTN = {
  LIGHT: 1, HEAVY: 2, BLOCK: 4, DODGE: 8, KICK: 16, SPRINT: 32, SPECIAL: 64, FINISH: 128,
} as const;

/**
 * One tick of intent for one fighter. Plain and serialisable: the local player, the peasant AI
 * and (later) a network peer all drive fighters through exactly this.
 */
export interface Command {
  /** Desired movement in world space, length 0..1. */
  mx: number;
  mz: number;
  buttons: number;
  /** Yaw the fighter is "looking" along (camera yaw for the player); used when not pushing a direction. */
  aimYaw: number;
  /** Hard lock-on target id, 0 for none. */
  lock: number;
}
export const NO_COMMAND: Command = { mx: 0, mz: 0, buttons: 0, aimYaw: 0, lock: 0 };

export interface MoveDef {
  id: string;
  anim: string;
  windup: number;
  active: number;
  recovery: number;
  /** Multiplier on weapon damage. */
  dmg: number;
  type?: DamageType;
  /** Full arc in degrees. */
  arc: number;
  reachAdd?: number;
  /** Fixed reach that ignores the weapon (kicks, bashes). */
  reach?: number;
  stamina: number;
  /** Max distance the attacker steps or lunges toward the target. */
  lunge: number;
  poise: number;
  knockdown?: boolean;
  guardBreak?: boolean;
  unblockable?: boolean;
  /** Extra hold time allowed on the windup while the button is held. */
  chargeMax?: number;
  chargeDmg?: number;
  /** Multiplier on armour wear. */
  wear?: number;
  push?: number;
  /** Hit-stop in milliseconds, before weapon-weight scaling. */
  hitstop: number;
  /** Forward dash speed during the active window (shield charge). */
  dash?: number;
  wrathCost?: number;
  zones: Partial<Record<Zone, number>>;
  next?: { light?: string; heavy?: string };
}

export interface Moveset {
  id: string;
  moves: Record<string, MoveDef>;
  light: string;
  heavy?: string;
  sprint?: string;
  dodge?: string;
  riposte?: string;
  kick?: string;
  special?: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  type: DamageType;
  reach: number;
  weight: number;
  twoHanded?: boolean;
  /** Visual key for the renderer. */
  model: string;
}

export interface ArmourPieceDef {
  id: string;
  name: string;
  zones: Zone[];
  prot: Record<DamageType, number>;
  durability: number;
  weight: number;
  material: 'cloth' | 'mail' | 'plate' | 'leather';
}

export interface KitDef {
  id: string;
  name: string;
  weapon: string;
  shield?: string;
  armour: string[];
}

export interface ArmourState {
  def: ArmourPieceDef;
  /** 0..1 */
  cond: number;
}

export interface LimbState {
  hp: number;
  max: number;
  state: 'ok' | 'severed';
}

export type FighterState =
  | 'idle' | 'attack' | 'block' | 'dodge' | 'stagger' | 'down' | 'getup'
  | 'dead' | 'finishing' | 'finished' | 'gone';

export interface FighterDef {
  id: string;
  label: string;
  hp: number;
  stamina: number;
  poise: number;
  speed: number;
  sprintMul: number;
  radius: number;
  limbHp: number;
  moveset: string;
  weapons: string[];
  kit?: string;
  /** AI */
  range?: number;
  tokenCost?: number;
  morale?: number;
  gold?: number;
  cooldown?: [number, number];
  charges?: boolean;
  scale?: number;
  /** Visual key for the renderer. */
  look: string;
}

export interface AIState {
  hasToken: boolean;
  wait: number;
  cooldown: number;
  strafe: number;
  strafeT: number;
  ringR: number;
  mode: 'approach' | 'ring' | 'flee' | 'cower' | 'crawl';
  barkT: number;
  charging: boolean;
  fleeT: number;
}

export interface Fighter {
  id: number;
  team: 0 | 1;
  def: FighterDef;
  name: string;
  elite: boolean;
  x: number; z: number;
  vx: number; vz: number;
  /** Knockback velocity, decays quickly. */
  kx: number; kz: number;
  facing: number;
  hp: number; maxHp: number;
  stamina: number; maxStamina: number; staminaDelay: number;
  poise: number; maxPoise: number; poiseDelay: number;
  wrath: number;
  limbs: Record<Limb, LimbState>;
  armour: ArmourState[];
  shield: ArmourState | null;
  weapon: WeaponDef | null;
  moveset: Moveset;
  speedMul: number;
  weightClass: 'light' | 'medium' | 'heavy';
  kitWeight: number;

  state: FighterState;
  stateT: number;
  stateDur: number;
  move: MoveDef | null;
  phase: 'windup' | 'active' | 'recovery';
  charge: number;
  hitIds: number[];
  landed: boolean;
  moveYaw: number;
  lungeV: number;
  buffer: 'light' | 'heavy' | 'dodge' | 'kick' | null;
  bufferT: number;
  combo: number;
  comboT: number;
  chainT: number;
  blockT: number;
  riposteT: number;
  riposteTarget: number;
  dodgeX: number; dodgeZ: number;
  sinceDodge: number;
  staggerImmune: number;
  invuln: boolean;
  sprinting: boolean;
  crippled: boolean;
  bleed: number;
  bleedT: number;
  prevButtons: number;
  softTarget: number;
  softDir: number;
  lock: number;
  partner: number;
  morale: number;
  fled: boolean;
  blood: number;
  ai: AIState | null;
  lastHitBy: number;
  combatT: number;
}

export type SimEvent =
  | { t: 'spawn'; id: number }
  | { t: 'swing'; id: number; move: string; heavy: boolean }
  | { t: 'windup'; id: number; move: string }
  | { t: 'hit'; id: number; by: number; zone: Zone; dmg: number; type: DamageType; killed: boolean; x: number; z: number; dirX: number; dirZ: number; heavy: boolean }
  | { t: 'block'; id: number; by: number; broke: boolean }
  | { t: 'parry'; id: number; by: number }
  | { t: 'sever'; id: number; limb: Limb; dirX: number; dirZ: number; force: number }
  | { t: 'drop'; id: number; what: 'weapon' | 'shield' }
  | { t: 'armourBreak'; id: number; piece: string }
  | { t: 'death'; id: number; by: number }
  | { t: 'flee'; id: number }
  | { t: 'escaped'; id: number }
  | { t: 'bark'; id: number; text: string }
  | { t: 'dodge'; id: number }
  | { t: 'knockdown'; id: number }
  | { t: 'finisher'; id: number; target: number; caption: string }
  | { t: 'gold'; amount: number; x: number; z: number }
  | { t: 'wave'; phase: 'intro' | 'fight' | 'cleared' | 'dead' | 'victory'; index: number }
  | { t: 'announce'; text: string };
