import { ARMOUR, KITS, WEAPONS, speedFromWeight, staminaFromWeight, weightClass } from '../data/gear';
import { FINISHER_CAPTIONS, MOVESETS } from '../data/moves';
import { ELITE, FIGHTERS } from '../data/peasants';
import { BARKS } from '../data/text';
import { TUNING } from '../data/tuning';
import { WAVES } from '../data/waves';
import { think } from './ai';
import { applyHit, pickZone, rawDamage } from './damage';
import { Rng, angleDiff, clamp, DEG } from './rng';
import { isFinishable, pickSoftTarget, scoreCandidates, type Obstacle, type TargetScore } from './targeting';
import { BTN, LIMBS, type Command, type Fighter, type Limb, type MoveDef, type SimEvent, type Zone } from './types';
import { generateWave, type SpawnEntry } from './waves';

const DT = 1 / TUNING.tickRate;
const C = TUNING.combat;
export const GATES = [0.5, 2.1, 3.7, 5.3];

export type WavePhase = 'intro' | 'fight' | 'cleared' | 'dead' | 'victory';
export interface WaveStats { kills: number; severs: number; finishers: number; parries: number; damageTaken: number; time: number; fled: number; bestCombo: number }
export interface WaveSummary { index: number; gold: number; lines: [string, number][]; stats: WaveStats }

export class World {
  tick = 0;
  time = 0;
  rng: Rng;
  fighters: Fighter[] = [];
  private byId = new Map<number, Fighter>();
  private nextId = 1;
  knight!: Fighter;
  events: SimEvent[] = [];
  obstacles: Obstacle[] = [
    { x: 0, z: 0, r: 1.25 }, // the well
    { x: -7.5, z: 6, r: 1.7 }, // the cart
    { x: 8, z: -6.5, r: 0.55 }, // the gibbet post
  ];
  radius = TUNING.arenaRadius;
  wave = { index: 0, phase: 'intro' as WavePhase, t: 0, queue: [] as SpawnEntry[], tokens: 2, total: 0 };
  stats: WaveStats = newStats();
  summary: WaveSummary | null = null;
  gold = 0;
  /** Ticks of frozen simulation left (hit-stop). */
  hitstop = 0;
  cheats = { invincible: false };
  targetScores: TargetScore[] = [];
  kitId = 'mail';
  private barkT = 0;
  private tokenT = 0;
  private snapshot: number[] = [];
  private baseSeed: number;

  constructor(seed = 1) {
    this.baseSeed = seed;
    this.rng = new Rng(seed);
    this.knight = this.makeFighter('knight', 'Sir Bleedsalot', 0);
    this.knight.x = 0; this.knight.z = -5; this.knight.facing = Math.PI;
    this.applyKit(this.knight, this.kitId);
    this.startWave(0);
  }

  get(id: number): Fighter | undefined { return this.byId.get(id); }
  get enemies(): Fighter[] { return this.fighters.filter((f) => f.team === 1); }
  /** Enemies still in play: alive and not escaped over the palisade. */
  get remaining(): number {
    let n = this.wave.queue.length;
    for (const f of this.fighters) if (f.team === 1 && f.state !== 'dead' && f.state !== 'gone') n++;
    return n;
  }

  // ---------------------------------------------------------------- setup

  private makeFighter(type: string, name: string, team: 0 | 1, elite = false): Fighter {
    const def = FIGHTERS[type];
    const e = elite ? ELITE : null;
    const limbHp = def.limbHp * (e ? e.limbHp : 1);
    const limbs = Object.fromEntries(LIMBS.map((l) => [l, { hp: limbHp, max: limbHp, state: 'ok' }])) as Fighter['limbs'];
    const hp = def.hp * (e ? e.hp : 1);
    const f: Fighter = {
      id: this.nextId++, team, def, name, elite,
      x: 0, z: 0, vx: 0, vz: 0, kx: 0, kz: 0, facing: 0,
      hp, maxHp: hp, stamina: def.stamina, maxStamina: def.stamina, staminaDelay: 0,
      poise: e ? e.poise : def.poise, maxPoise: e ? e.poise : def.poise, poiseDelay: 0, wrath: 0,
      limbs, armour: [], shield: null, weapon: null, moveset: MOVESETS[def.moveset],
      speedMul: 1, weightClass: 'light', kitWeight: 0,
      state: 'idle', stateT: 0, stateDur: 0, move: null, phase: 'windup', charge: 0, hitIds: [], landed: false,
      moveYaw: 0, lungeV: 0, buffer: null, bufferT: 0, combo: 0, comboT: 0, chainT: 0, blockT: 99, riposteT: 0, riposteTarget: 0,
      dodgeX: 0, dodgeZ: 0, sinceDodge: 99, staggerImmune: 0, invuln: false, sprinting: false, crippled: false,
      bleed: 0, bleedT: 0, prevButtons: 0, softTarget: 0, softDir: 0, lock: 0, partner: 0,
      morale: e ? e.morale : def.morale ?? 1, fled: false, blood: 0, ai: null, lastHitBy: 0, combatT: 99,
    };
    this.fighters.push(f);
    this.byId.set(f.id, f);
    return f;
  }

  /** Dress a fighter from a kit definition and derive weight class, speed and stamina from the total weight. */
  applyKit(f: Fighter, kitId: string): void {
    const kit = KITS[kitId];
    if (f === this.knight) this.kitId = kitId;
    f.armour = kit.armour.map((id) => ({ def: ARMOUR[id], cond: 1 }));
    f.shield = kit.shield ? { def: ARMOUR[kit.shield], cond: 1 } : null;
    f.weapon = WEAPONS[kit.weapon];
    this.recalcWeight(f);
    f.stamina = f.maxStamina;
  }

  private recalcWeight(f: Fighter): void {
    let kg = (f.weapon?.weight ?? 0) + (f.shield?.def.weight ?? 0);
    for (const a of f.armour) kg += a.def.weight;
    f.kitWeight = kg;
    f.weightClass = weightClass(kg);
    f.speedMul = speedFromWeight(kg);
    f.maxStamina = Math.round(f.def.stamina * staminaFromWeight(kg));
    f.stamina = Math.min(f.stamina, f.maxStamina);
  }

  startWave(index: number): void {
    const def = WAVES[index];
    // Clear the field of the previous wave's living; the renderer keeps corpses on its own.
    for (const f of this.fighters) if (f.team === 1) this.byId.delete(f.id);
    this.fighters = [this.knight];
    this.wave = { index, phase: 'intro', t: 0, queue: generateWave(def, this.baseSeed * 1000 + index), tokens: def.tokens, total: 0 };
    this.wave.total = this.wave.queue.length;
    this.stats = newStats();
    this.summary = null;
    this.restoreKnight();
    this.snapshot = this.knight.armour.map((a) => a.cond);
    this.events.push({ t: 'wave', phase: 'intro', index }, { t: 'announce', text: def.announce });
  }

  /** Death is a setback: retry the same wave with the kit as it was when the wave began. */
  retryWave(): void {
    const snap = this.snapshot;
    this.startWave(this.wave.index);
    this.knight.armour.forEach((a, i) => (a.cond = snap[i] ?? a.cond));
    this.snapshot = snap;
    this.knight.x = 0; this.knight.z = -5;
  }

  nextWave(): void {
    if (this.wave.phase !== 'cleared') return;
    this.startWave(this.wave.index + 1);
  }

  /** Between fights the barber-surgeon sews limbs back on and the squire patches armour to a floor. */
  private restoreKnight(): void {
    const k = this.knight;
    for (const l of LIMBS) { k.limbs[l].hp = k.limbs[l].max; k.limbs[l].state = 'ok'; }
    for (const a of k.armour) a.cond = Math.max(a.cond, TUNING.squirePatch);
    const kit = KITS[this.kitId];
    k.weapon = WEAPONS[kit.weapon];
    if (kit.shield) k.shield = { def: ARMOUR[kit.shield], cond: Math.max(k.shield?.cond ?? 0, TUNING.squirePatch) };
    k.hp = k.maxHp; k.stamina = k.maxStamina; k.poise = k.maxPoise;
    k.crippled = false; k.bleed = 0; k.blood = 0; k.invuln = false; k.partner = 0;
    k.state = 'idle'; k.stateT = 0; k.move = null; k.kx = k.kz = 0; k.buffer = null;
    this.recalcWeight(k);
  }

  spawn(e: SpawnEntry): Fighter {
    const f = this.makeFighter(e.type, e.name, 1, e.elite);
    const a = GATES[e.gate % GATES.length] + this.rng.range(-0.18, 0.18);
    const r = this.radius - 0.8;
    f.x = Math.sin(a) * r; f.z = Math.cos(a) * r;
    f.facing = a + Math.PI;
    f.weapon = WEAPONS[e.weapon];
    if (e.elite) f.armour = [{ def: ARMOUR.salvagedMail, cond: 1 }];
    f.ai = {
      hasToken: false, wait: 0, cooldown: this.rng.range(0.3, 1.5), strafe: this.rng.chance(0.5) ? 1 : -1, strafeT: this.rng.range(1.5, 4),
      ringR: this.rng.range(TUNING.ai.ringInner, TUNING.ai.ringOuter), mode: 'ring', barkT: this.rng.range(2, 9), charging: false, fleeT: 0,
    };
    this.events.push({ t: 'spawn', id: f.id });
    if (e.elite) this.bark(f, 'elite', true);
    else if (this.rng.chance(0.2)) this.bark(f, 'spawn');
    return f;
  }

  // ---------------------------------------------------------------- tick

  /** Advance one fixed tick. `cmd` is the knight's command; peasants get theirs from the AI. */
  step(cmd: Command): void {
    if (this.hitstop > 0) { this.hitstop--; return; }
    this.tick++;
    this.time += DT;
    this.barkT -= DT;
    const w = this.wave;
    w.t += DT;

    if (w.phase === 'intro' && w.t > 2.2) { w.phase = 'fight'; w.t = 0; this.events.push({ t: 'wave', phase: 'fight', index: w.index }); }
    if (w.phase === 'fight') {
      this.stats.time += DT;
      while (w.queue.length && w.queue[0].at <= w.t) this.spawn(w.queue.shift()!);
    }

    this.updateSoftTarget(cmd);
    this.updateTokens();
    for (const f of this.fighters) {
      if (f.state === 'gone') continue;
      const c = f === this.knight ? cmd : think(this, f, DT);
      this.stepFighter(f, c);
    }
    this.integrate();
    this.resolveAttacks();
    this.upkeep();

    if (w.phase === 'fight' && this.knight.state !== 'dead' && this.remaining === 0) this.clearWave();
  }

  private updateSoftTarget(cmd: Command): void {
    const k = this.knight;
    const pushing = Math.hypot(cmd.mx, cmd.mz) > 0.2;
    const dir = pushing ? Math.atan2(cmd.mx, cmd.mz) : cmd.aimYaw;
    this.targetScores = scoreCandidates(k, this.fighters, dir, this.obstacles);
    const swung = Math.abs(angleDiff(dir, k.softDir)) > TUNING.targeting.inputSwingDeg * DEG;
    const picked = pickSoftTarget(k.softTarget, this.targetScores, swung);
    if (picked !== k.softTarget || swung) k.softDir = dir;
    k.softTarget = picked;
  }

  /** Attack tokens: only a few peasants may attack at once; the rest circle and wait their turn. */
  private updateTokens(): void {
    this.tokenT -= DT;
    if (this.tokenT > 0 || this.wave.phase !== 'fight') return;
    this.tokenT = TUNING.ai.tokenInterval;
    const k = this.knight;
    let used = 0;
    const waiting: Fighter[] = [];
    for (const f of this.fighters) {
      const a = f.ai;
      if (!a || f.state === 'dead' || f.state === 'gone') continue;
      if (a.hasToken) used += f.def.tokenCost ?? 1;
      else if (a.mode === 'ring' && a.cooldown <= 0 && f.weapon && !f.crippled) waiting.push(f);
    }
    waiting.sort((p, q) => Math.hypot(p.x - k.x, p.z - k.z) - p.ai!.wait * 0.6 - (Math.hypot(q.x - k.x, q.z - k.z) - q.ai!.wait * 0.6));
    for (const f of waiting) {
      const cost = f.def.tokenCost ?? 1;
      if (used + cost > this.wave.tokens + 1e-6) continue;
      used += cost;
      f.ai!.hasToken = true; f.ai!.mode = 'approach'; f.ai!.wait = 0;
    }
  }

  // ---------------------------------------------------------------- fighter

  private stepFighter(f: Fighter, cmd: Command): void {
    const pressed = cmd.buttons & ~f.prevButtons;
    f.prevButtons = cmd.buttons;
    f.stateT += DT; f.bufferT -= DT; f.comboT -= DT; f.chainT -= DT; f.riposteT -= DT; f.sinceDodge += DT;
    f.staggerImmune -= DT; f.blockT += DT; f.combatT += DT;
    f.vx = 0; f.vz = 0;
    f.invuln = false;
    f.lock = cmd.lock;
    f.sprinting = false;

    if (f.maxStamina > 0) {
      if (f.staminaDelay > 0) f.staminaDelay -= DT;
      else f.stamina = Math.min(f.maxStamina, f.stamina + C.staminaRegen * staminaFromWeight(f.kitWeight) * (f.state === 'block' ? 0.35 : 1) * DT);
    }
    if (f.poiseDelay > 0) f.poiseDelay -= DT;
    else f.poise = Math.min(f.maxPoise, f.poise + C.poiseRegen * DT);
    if (f.comboT <= 0) f.combo = 0;
    if (f.stamina < 0) f.stamina = 0;

    // Remember the latest action pressed while busy, so combos never drop on timing.
    const act = this.pressedAction(pressed);
    if (act) { f.buffer = act; f.bufferT = C.bufferTime; }

    switch (f.state) {
      case 'dead': case 'gone': case 'finished': return;
      case 'finishing':
        f.invuln = true;
        this.stepFinisher(f);
        return;
      case 'stagger':
        if (f.stateT >= f.stateDur) this.setState(f, 'idle');
        return;
      case 'down':
        if (f.crippled && f.team === 1) { // crawl
          const m = Math.hypot(cmd.mx, cmd.mz);
          if (m > 0.1) { f.vx = (cmd.mx / m) * 0.5; f.vz = (cmd.mz / m) * 0.5; f.facing = Math.atan2(cmd.mx, cmd.mz); }
        } else if (f.stateT >= f.stateDur) { this.setState(f, 'getup'); f.stateDur = C.getupTime; }
        return;
      case 'getup':
        f.invuln = true;
        if (f.stateT >= f.stateDur) this.setState(f, 'idle');
        return;
      case 'dodge': {
        const [i0, i1] = C.dodgeIframes;
        f.invuln = f.stateT >= i0 && f.stateT <= i1;
        const p = f.stateT / f.stateDur;
        const sp = (f.weightClass === 'light' ? C.rollSpeed : C.dodgeSpeed) * (1 - p * p * 0.8);
        f.vx = f.dodgeX * sp; f.vz = f.dodgeZ * sp;
        if (f.stateT >= f.stateDur) { this.setState(f, 'idle'); f.sinceDodge = 0; }
        else return;
        break;
      }
      case 'attack':
        if (this.stepAttack(f, cmd)) return;
        break;
    }

    // Free to act (idle or block, or an attack that has reached a cancel point).
    const want = f.buffer && f.bufferT > 0 ? f.buffer : null;
    if (pressed & BTN.FINISH && this.tryFinisher(f, cmd)) return;
    if (pressed & BTN.SPECIAL && this.trySpecial(f, cmd)) return;
    if (want && this.tryAction(f, cmd, want)) { f.buffer = null; return; }

    // Block
    const canBlock = !!(f.shield || f.weapon) && f.moveset.riposte !== undefined;
    if (cmd.buttons & BTN.BLOCK && canBlock) {
      if (f.state !== 'block') { this.setState(f, 'block'); f.blockT = 0; }
    } else if (f.state === 'block') this.setState(f, 'idle');
    if (f.state === 'attack') this.setState(f, 'idle');

    this.locomote(f, cmd);
  }

  private pressedAction(pressed: number): Fighter['buffer'] {
    if (pressed & BTN.DODGE) return 'dodge';
    if (pressed & BTN.LIGHT) return 'light';
    if (pressed & BTN.HEAVY) return 'heavy';
    if (pressed & BTN.KICK) return 'kick';
    return null;
  }

  private locomote(f: Fighter, cmd: Command): void {
    const m = Math.hypot(cmd.mx, cmd.mz);
    const exhausted = f.maxStamina > 0 && f.stamina <= 0;
    let speed = f.def.speed * f.speedMul;
    const sprint = !!(cmd.buttons & BTN.SPRINT) && m > 0.5 && !exhausted && f.state !== 'block' && !f.crippled;
    if (sprint) {
      speed *= f.def.sprintMul;
      f.sprinting = true;
      if (f.maxStamina > 0) { f.stamina -= C.sprintStamina * DT; f.staminaDelay = 0.3; }
    }
    if (f.state === 'block') speed *= C.blockSpeedMul;
    if (exhausted) speed *= C.exhaustedSpeedMul;
    if (f.crippled) speed *= 0.3;
    if (m > 0.05) {
      const k = Math.min(1, m);
      f.vx = (cmd.mx / m) * speed * k; f.vz = (cmd.mz / m) * speed * k;
    }
    const target = f.lock ? this.get(f.lock) : undefined;
    let want = f.facing;
    if (target && !sprint) want = Math.atan2(target.x - f.x, target.z - f.z);
    else if (m > 0.05) want = Math.atan2(cmd.mx, cmd.mz);
    f.facing += clamp(angleDiff(want, f.facing), -12 * DT, 12 * DT);
  }

  private tryAction(f: Fighter, cmd: Command, act: NonNullable<Fighter['buffer']>): boolean {
    const ms = f.moveset;
    const exhausted = f.maxStamina > 0 && f.stamina <= 0;
    if (act === 'dodge') {
      if (!ms.dodge || exhausted || f.weightClass === 'heavy' || f.crippled) return false;
      let dx = cmd.mx, dz = cmd.mz;
      const m = Math.hypot(dx, dz);
      if (m < 0.2) { dx = -Math.sin(f.facing); dz = -Math.cos(f.facing); } else { dx /= m; dz /= m; }
      f.dodgeX = dx; f.dodgeZ = dz;
      this.setState(f, 'dodge');
      f.stateDur = f.weightClass === 'light' ? C.rollTime : C.dodgeTime;
      f.stamina -= C.dodgeStamina; f.staminaDelay = C.staminaDelay;
      this.events.push({ t: 'dodge', id: f.id });
      return true;
    }
    if (exhausted) return false;
    if (act === 'kick') {
      if (!ms.kick) return false;
      return this.startMove(f, cmd, ms.moves[ms.kick]);
    }
    if (!f.weapon || f.limbs.armR.state !== 'ok') return false;
    const chain = f.chainT > 0 ? f.move?.next : undefined;
    let id: string | undefined;
    if (act === 'light') {
      if (f.riposteT > 0 && ms.riposte) { id = ms.riposte; f.riposteT = 0; }
      else if (chain?.light) id = chain.light;
      else if (f.sinceDodge < C.dodgeAttackWindow && ms.dodge) id = ms.dodge;
      else if (cmd.buttons & BTN.SPRINT && Math.hypot(cmd.mx, cmd.mz) > 0.5 && ms.sprint) id = ms.sprint;
      else id = ms.light;
    } else {
      id = chain?.heavy ?? ms.heavy;
    }
    return id ? this.startMove(f, cmd, ms.moves[id], id === ms.riposte ? f.riposteTarget : 0) : false;
  }

  private trySpecial(f: Fighter, cmd: Command): boolean {
    const ms = f.moveset;
    if (!ms.special || !f.shield) return false;
    const mv = ms.moves[ms.special];
    if (f.wrath < (mv.wrathCost ?? 0)) return false;
    f.wrath -= mv.wrathCost ?? 0;
    return this.startMove(f, cmd, mv);
  }

  /**
   * Begin an attack. Attack magnetism lives here: the fighter turns toward the soft target
   * (capped, never a snap) and steps or lunges to close the gap, scaled by the move's lunge.
   */
  private startMove(f: Fighter, cmd: Command, mv: MoveDef, forceTarget = 0): boolean {
    const T = TUNING.targeting;
    f.stamina -= mv.stamina;
    if (mv.stamina > 0) f.staminaDelay = C.staminaDelay;
    this.setState(f, 'attack');
    f.move = mv; f.phase = 'windup'; f.charge = 0; f.hitIds = []; f.landed = false;
    const pushing = Math.hypot(cmd.mx, cmd.mz) > 0.2;
    const inputYaw = pushing ? Math.atan2(cmd.mx, cmd.mz) : f.facing;
    const reach = this.reachOf(f, mv);
    const target = this.get(forceTarget || f.lock || f.softTarget);
    f.moveYaw = inputYaw;
    let step = pushing ? mv.lunge * 0.5 : mv.lunge * 0.25;
    if (target && target.state !== 'dead' && target.state !== 'gone') {
      const dx = target.x - f.x, dz = target.z - f.z;
      const dist = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      const maxStep = Math.min(mv.lunge, f.team === 0 ? T.magnetMaxStep * (reach / 1.5) + (mv.lunge > 2 ? mv.lunge - 1.5 : 0) : mv.lunge);
      const inReach = dist - target.def.radius <= reach + maxStep;
      const inAngle = forceTarget || f.lock ? true : Math.abs(angleDiff(yaw, inputYaw)) <= T.magnetMaxTurnDeg * DEG;
      if (inReach && inAngle) {
        f.moveYaw = yaw;
        step = clamp(dist - target.def.radius - reach * 0.7, 0, maxStep);
      }
    }
    f.lungeV = step / (mv.windup + mv.active * 0.5);
    this.events.push({ t: 'windup', id: f.id, move: mv.id });
    return true;
  }

  reachOf(f: Fighter, mv: MoveDef): number {
    return (mv.reach ?? (f.weapon?.reach ?? 0.9) + (mv.reachAdd ?? 0)) * (f.elite ? 1.1 : 1);
  }

  /** Returns true while the attack still owns the fighter; false once a cancel point lets other actions through. */
  private stepAttack(f: Fighter, cmd: Command): boolean {
    const mv = f.move!;
    const turn = f.team === 0 ? TUNING.targeting.magnetTurnRate : 5;
    if (f.phase === 'windup') {
      // Peasants keep tracking for most of the wind-up, then commit, so a late sidestep works.
      if (f.team === 1 && f.stateT < mv.windup - 0.18) {
        const t = this.get(f.lock);
        if (t) f.moveYaw = Math.atan2(t.x - f.x, t.z - f.z);
      }
      f.facing += clamp(angleDiff(f.moveYaw, f.facing), -turn * DT, turn * DT);
      if (f.stateT > mv.windup * 0.35) { f.vx = Math.sin(f.facing) * f.lungeV; f.vz = Math.cos(f.facing) * f.lungeV; }
      if (f.stateT >= mv.windup) {
        if (mv.chargeMax && cmd.buttons & BTN.HEAVY && f.charge < 1) {
          f.charge = Math.min(1, f.charge + DT / mv.chargeMax);
          f.stateT = mv.windup; f.vx = f.vz = 0;
          return true;
        }
        f.phase = 'active';
        this.events.push({ t: 'swing', id: f.id, move: mv.id, heavy: mv.hitstop >= 100 });
      }
      return true;
    }
    const tA = f.stateT - mv.windup;
    if (f.phase === 'active') {
      const v = mv.dash ?? f.lungeV * 0.6;
      f.vx = Math.sin(f.facing) * v; f.vz = Math.cos(f.facing) * v;
      if (mv.dash) f.invuln = true;
      if (tA >= mv.active) f.phase = 'recovery';
      return true;
    }
    const tR = tA - mv.active;
    f.chainT = 0.3;
    if (tR >= mv.recovery) { this.setState(f, 'idle'); return false; }
    // Cancel windows: after a hit lands you may cancel into dodge or block at once; combo follow-ups
    // open a little into recovery. Slower moves commit you for longer.
    const want = f.buffer && f.bufferT > 0 ? f.buffer : null;
    if (f.team !== 0) return true;
    if (f.landed && (want === 'dodge' || cmd.buttons & BTN.BLOCK) && tR > 0.04) return false;
    if ((want === 'light' || want === 'heavy') && tR >= Math.min(0.12, mv.recovery * 0.3)) return false;
    if (want === 'dodge' && tR >= mv.recovery * 0.5) return false;
    return true;
  }

  private tryFinisher(f: Fighter, cmd: Command): boolean {
    if (f.team !== 0 || !f.weapon || f.state === 'attack') return false;
    const pushing = Math.hypot(cmd.mx, cmd.mz) > 0.2;
    const dir = pushing ? Math.atan2(cmd.mx, cmd.mz) : f.facing;
    let best: Fighter | null = null, bestA = 9;
    for (const e of this.fighters) {
      if (e.team === f.team || !isFinishable(e)) continue;
      const dx = e.x - f.x, dz = e.z - f.z;
      if (Math.hypot(dx, dz) > TUNING.targeting.finisherRange) continue;
      const a = Math.abs(angleDiff(Math.atan2(dx, dz), dir));
      if (a < bestA) { bestA = a; best = e; }
    }
    if (!best) return false;
    this.setState(f, 'finishing');
    f.stateDur = C.finisherTime; f.partner = best.id; f.hitIds = [];
    f.facing = Math.atan2(best.x - f.x, best.z - f.z);
    this.setState(best, 'finished');
    best.partner = f.id; best.facing = f.facing + Math.PI;
    this.releaseToken(best);
    this.events.push({ t: 'finisher', id: f.id, target: best.id, caption: this.rng.pick(FINISHER_CAPTIONS) });
    return true;
  }

  private stepFinisher(f: Fighter): void {
    const t = this.get(f.partner);
    if (t) { // close to execution distance
      const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz) || 1;
      const v = clamp((d - 1.15) * 6, -3, 5);
      f.vx = (dx / d) * v; f.vz = (dz / d) * v;
      if (f.stateT >= C.finisherStrikeAt && !f.hitIds.length) {
        f.hitIds.push(t.id);
        const dirX = Math.sin(f.facing), dirZ = Math.cos(f.facing);
        this.stats.finishers++;
        this.addGold(TUNING.rewards.finisher, t.x, t.z);
        this.gainWrath(f, TUNING.wrath.kill);
        this.hitstop = 9;
        if (!t.elite || t.hp <= t.maxHp * 0.5) {
          t.limbs.head.state = 'severed'; t.limbs.head.hp = 0; t.hp = 0;
          this.events.push({ t: 'hit', id: t.id, by: f.id, zone: 'head', dmg: 99, type: 'cut', killed: true, x: t.x, z: t.z, dirX, dirZ, heavy: true });
          this.events.push({ t: 'sever', id: t.id, limb: 'head', dirX, dirZ, force: 1.4 });
          this.kill(t, f);
        } else {
          t.hp -= t.maxHp * 0.4;
          this.events.push({ t: 'hit', id: t.id, by: f.id, zone: 'torso', dmg: t.maxHp * 0.4, type: 'cut', killed: false, x: t.x, z: t.z, dirX, dirZ, heavy: true });
          t.state = 'idle';
          this.knockdown(t);
        }
        this.moraleShock(t.x, t.z, TUNING.ai.moraleFinisher);
      }
    }
    if (f.stateT >= f.stateDur) this.setState(f, 'idle');
  }

  private setState(f: Fighter, s: Fighter['state']): void {
    f.state = s; f.stateT = 0;
    if (s !== 'attack') f.charge = 0;
  }

  // ---------------------------------------------------------------- movement

  private integrate(): void {
    const fs = this.fighters;
    for (const f of fs) {
      if (f.state === 'gone') continue;
      f.x += (f.vx + f.kx) * DT; f.z += (f.vz + f.kz) * DT;
      const decay = Math.exp(-7 * DT);
      f.kx *= decay; f.kz *= decay;
    }
    // Separation: bodies push apart; a peasant sent flying staggers whoever he lands on.
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i];
      if (a.state === 'dead' || a.state === 'gone') continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j];
        if (b.state === 'dead' || b.state === 'gone') continue;
        if ((a.state === 'finishing' || a.state === 'finished') && a.partner === b.id) continue;
        const ra = a.state === 'down' ? a.def.radius * 0.6 : a.def.radius, rb = b.state === 'down' ? b.def.radius * 0.6 : b.def.radius;
        let dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz), min = ra + rb;
        if (d >= min) continue;
        if (d < 1e-4) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
        const overlap = min - d;
        const ma = a.team === 0 ? 4 : a.elite ? 3 : 1, mb = b.team === 0 ? 4 : b.elite ? 3 : 1;
        const sa = mb / (ma + mb), sb = ma / (ma + mb);
        a.x -= dx * overlap * sa; a.z -= dz * overlap * sa;
        b.x += dx * overlap * sb; b.z += dz * overlap * sb;
        if (a.team === 1 && b.team === 1) {
          const ka = Math.hypot(a.kx, a.kz), kb = Math.hypot(b.kx, b.kz);
          if (ka > 3.5 && kb < 1) this.shove(b, a);
          else if (kb > 3.5 && ka < 1) this.shove(a, b);
        }
      }
    }
    for (const f of fs) {
      if (f.state === 'gone') continue;
      for (const o of this.obstacles) {
        const dx = f.x - o.x, dz = f.z - o.z, d = Math.hypot(dx, dz), min = o.r + f.def.radius;
        if (d < min) { const s = d < 1e-4 ? 1 : (min - d) / d; f.x += dx * s; f.z += dz * s; }
      }
      const d = Math.hypot(f.x, f.z), max = this.radius - f.def.radius;
      if (d > max) { f.x *= max / d; f.z *= max / d; }
    }
  }

  private shove(victim: Fighter, flyer: Fighter): void {
    victim.kx += flyer.kx * 0.6; victim.kz += flyer.kz * 0.6;
    if (victim.state === 'idle' || victim.state === 'attack') this.stagger(victim, 0.5);
  }

  // ---------------------------------------------------------------- combat

  private resolveAttacks(): void {
    for (const a of this.fighters) {
      if (a.state !== 'attack' || a.phase !== 'active' || !a.move) continue;
      const mv = a.move;
      const reach = this.reachOf(a, mv);
      const half = (mv.arc / 2) * DEG;
      for (const t of this.fighters) {
        if (t.team === a.team || t.state === 'dead' || t.state === 'gone' || a.hitIds.includes(t.id)) continue;
        const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz);
        if (d > reach + t.def.radius) continue;
        const slack = Math.atan2(t.def.radius, Math.max(d, 0.3));
        if (Math.abs(angleDiff(Math.atan2(dx, dz), a.facing)) > half + slack) continue;
        a.hitIds.push(t.id);
        this.onHit(a, t, mv, d > 1e-4 ? dx / d : Math.sin(a.facing), d > 1e-4 ? dz / d : Math.cos(a.facing));
      }
    }
  }

  private onHit(a: Fighter, t: Fighter, mv: MoveDef, dirX: number, dirZ: number): void {
    if (t.invuln || t.state === 'finishing' || t.state === 'finished') return;
    if (t === this.knight && this.cheats.invincible) return;
    const knightInvolved = a === this.knight || t === this.knight;
    const eliteMul = a.elite ? ELITE.damage : 1;
    const raw = rawDamage(a.weapon, mv, a.charge, eliteMul);
    const type = mv.type ?? a.weapon?.type ?? 'blunt';
    const guardBreak = mv.guardBreak || (!!mv.chargeMax && a.charge >= 0.8);
    a.combatT = 0; t.combatT = 0;

    // Attacks from behind cannot be blocked: being surrounded is the main danger.
    const front = Math.abs(angleDiff(Math.atan2(a.x - t.x, a.z - t.z), t.facing)) < C.frontArcDeg * DEG;
    if (t.state === 'block' && front && !mv.unblockable) {
      if (t.blockT <= C.parryWindow) {
        this.stagger(a, 1.0);
        t.riposteT = C.riposteWindow; t.riposteTarget = a.id;
        this.gainWrath(t, TUNING.wrath.parry);
        if (t === this.knight) this.stats.parries++;
        if (knightInvolved) this.hitstop = Math.max(this.hitstop, 5);
        this.events.push({ t: 'parry', id: t.id, by: a.id });
        this.bark(a, 'parried');
        return;
      }
      if (!guardBreak) {
        const noShield = t.shield ? 1 : 1.7;
        t.stamina -= (mv.poise * 0.35 + raw * 0.25) * noShield;
        t.staminaDelay = C.staminaDelay;
        t.hp = Math.max(1, t.hp - raw * C.blockChip * (t.shield ? 0.5 : 1));
        if (t.shield) t.shield.cond = Math.max(0.05, t.shield.cond - (raw * 0.6) / t.shield.def.durability);
        t.kx += dirX * 1.5; t.kz += dirZ * 1.5;
        const broke = t.stamina <= 0;
        if (broke) { t.stamina = 0; this.stagger(t, 0.8); }
        if (t === this.knight) this.stats.damageTaken += raw * C.blockChip;
        this.events.push({ t: 'block', id: t.id, by: a.id, broke });
        return;
      }
      this.events.push({ t: 'block', id: t.id, by: a.id, broke: true });
    }

    const zone: Zone = pickZone(t, mv.zones, this.rng.next());
    const r = applyHit(t, zone, raw, type, mv.wear ?? 1);
    a.landed = true;
    t.lastHitBy = a.id;
    t.blood = Math.min(1, t.blood + r.dealt / 60);
    a.blood = Math.min(1, a.blood + 0.04);
    if (a === this.knight) { a.combo++; a.comboT = 2.5; this.stats.bestCombo = Math.max(this.stats.bestCombo, a.combo); this.gainWrath(a, TUNING.wrath.hit); }
    if (t === this.knight) { this.stats.damageTaken += r.dealt; t.combo = 0; if (this.rng.chance(0.15)) this.bark(a, 'hitKnight'); }
    this.events.push({ t: 'hit', id: t.id, by: a.id, zone, dmg: r.dealt, type, killed: r.killed, x: t.x, z: t.z, dirX, dirZ, heavy: mv.hitstop >= 100 });
    if (r.armourBroke && r.armourPiece) {
      this.events.push({ t: 'armourBreak', id: t.id, piece: r.armourPiece.def.id });
      this.recalcWeight(t);
    }
    if (knightInvolved) {
      const scale = 0.8 + (a.weapon?.weight ?? 1) * 0.15;
      this.hitstop = Math.max(this.hitstop, Math.round((mv.hitstop / 1000) * TUNING.tickRate * scale));
    }
    const push = (mv.push ?? C.knockback) * (t.team === 0 ? 0.35 : t.elite ? 0.4 : 1);
    t.kx += dirX * push; t.kz += dirZ * push;

    if (r.severed) this.onSever(t, zone as Limb, dirX, dirZ, a);
    if (r.killed) { this.kill(t, a); return; }
    if (t.state === 'down') return;

    t.poise -= mv.poise; t.poiseDelay = 1.5;
    if (t.staggerImmune > 0) return;
    if (mv.knockdown && (t.maxPoise < 30 || t.poise <= 0)) this.knockdown(t);
    else if (t.poise <= 0) {
      // Breaking an elite's poise staggers him long enough to open a finisher.
      this.stagger(t, t.elite ? 1.8 : t.team === 0 ? C.staggerTime : C.staggerTime + 0.15);
      t.poise = t.maxPoise;
    }
  }

  private stagger(f: Fighter, dur: number): void {
    if (f.state === 'dead' || f.state === 'down' || f.state === 'finished') return;
    this.releaseToken(f);
    this.setState(f, 'stagger');
    f.stateDur = dur; f.move = null;
    f.staggerImmune = f.team === 0 ? dur + C.staggerImmunity : 0;
  }

  private knockdown(f: Fighter): void {
    if (f.state === 'dead' || f.state === 'finished') return;
    this.releaseToken(f);
    this.setState(f, 'down');
    f.stateDur = f.team === 0 ? 0.9 : C.downTime; f.move = null; f.poise = f.maxPoise;
    f.staggerImmune = f.team === 0 ? 2 : 0;
    this.events.push({ t: 'knockdown', id: f.id });
  }

  private onSever(t: Fighter, limb: Limb, dirX: number, dirZ: number, by: Fighter): void {
    this.events.push({ t: 'sever', id: t.id, limb, dirX, dirZ, force: 1 });
    if (by === this.knight) { this.stats.severs++; this.gainWrath(by, TUNING.wrath.sever); this.addGold(TUNING.rewards.sever, t.x, t.z); }
    if (limb === 'head') return;
    t.bleed = t.team === 0 ? C.bleedKnight : C.bleedPeasant;
    t.bleedT = t.team === 0 ? C.bleedKnightTime : 999;
    if (limb === 'armR' && t.weapon) { t.weapon = null; this.events.push({ t: 'drop', id: t.id, what: 'weapon' }); this.recalcWeight(t); }
    if (limb === 'armL' && t.shield) { t.shield = null; this.events.push({ t: 'drop', id: t.id, what: 'shield' }); this.recalcWeight(t); }
    if (limb === 'legL' || limb === 'legR') {
      t.crippled = true;
      if (t.team === 1) { this.knockdown(t); t.stateDur = 999; if (t.ai) t.ai.mode = 'crawl'; }
      else this.knockdown(t);
    }
    if (t.team === 1) {
      this.bark(t, limb === 'armL' ? 'armL' : limb === 'armR' ? 'armR' : 'leg', true);
      if (!t.elite && !t.crippled && t.ai) { t.morale = Math.min(t.morale, limb === 'armR' ? -1 : 0.1); }
      this.moraleShock(t.x, t.z, TUNING.ai.moraleSever, t);
    }
  }

  private kill(t: Fighter, by: Fighter): void {
    if (t.state === 'dead') return;
    this.releaseToken(t);
    const fleeing = t.ai?.mode === 'flee' || t.ai?.mode === 'cower';
    this.setState(t, 'dead');
    t.move = null; t.hp = 0;
    this.events.push({ t: 'death', id: t.id, by: by.id });
    if (t.team === 1) {
      this.stats.kills++;
      this.addGold((t.elite ? ELITE.gold : t.def.gold ?? 1) + (fleeing ? TUNING.rewards.fleeingBonus : 0), t.x, t.z);
      this.gainWrath(this.knight, TUNING.wrath.kill);
      this.moraleShock(t.x, t.z, TUNING.ai.moraleDeath * (t.elite ? 6 : 1), t);
      if (this.rng.chance(0.25)) { const w = this.witness(t); if (w) this.bark(w, 'allyDied'); }
    } else {
      this.wave.phase = 'dead';
      this.events.push({ t: 'wave', phase: 'dead', index: this.wave.index });
    }
  }

  private witness(t: Fighter): Fighter | null {
    for (const f of this.fighters) if (f.team === 1 && f !== t && f.state !== 'dead' && f.state !== 'gone' && Math.hypot(f.x - t.x, f.z - t.z) < 6) return f;
    return null;
  }

  /** Morale: seeing a neighbour dismembered or finished makes peasants think about their choices. */
  private moraleShock(x: number, z: number, amount: number, except?: Fighter): void {
    for (const f of this.fighters) {
      if (f.team !== 1 || f === except || !f.ai || f.elite || f.state === 'dead' || f.state === 'gone') continue;
      if (Math.hypot(f.x - x, f.z - z) > TUNING.ai.moraleRadius) continue;
      f.morale -= amount * this.rng.range(0.6, 1.3);
    }
  }

  releaseToken(f: Fighter): void {
    if (f.ai?.hasToken) { f.ai.hasToken = false; f.ai.mode = f.ai.mode === 'approach' ? 'ring' : f.ai.mode; f.ai.charging = false; }
  }

  escape(f: Fighter): void {
    this.releaseToken(f);
    f.state = 'gone'; f.fled = true;
    this.stats.fled++;
    this.events.push({ t: 'escaped', id: f.id });
  }

  bark(f: Fighter, kind: string, force = false): void {
    if (!force && this.barkT > 0) return;
    const lines = BARKS[kind];
    if (!lines) return;
    this.barkT = TUNING.ai.barkGap;
    this.events.push({ t: 'bark', id: f.id, text: this.rng.pick(lines) });
  }

  private gainWrath(f: Fighter, n: number): void { f.wrath = Math.min(TUNING.wrath.max, f.wrath + n); }
  addGold(n: number, x = this.knight.x, z = this.knight.z): void { this.gold += n; this.events.push({ t: 'gold', amount: n, x, z }); }

  private upkeep(): void {
    for (const f of this.fighters) {
      if (f.state === 'dead' || f.state === 'gone') continue;
      if (f.bleed > 0 && f.state !== 'finished') {
        f.bleedT -= DT;
        f.hp -= f.bleed * DT;
        if (f.bleedT <= 0) f.bleed = 0;
        if (f.hp <= 0) { if (f === this.knight && this.cheats.invincible) f.hp = 1; else this.kill(f, this.get(f.lastHitBy) ?? this.knight); }
      }
      if (f.ai && f.morale <= 0 && f.ai.mode !== 'flee' && f.ai.mode !== 'cower' && f.ai.mode !== 'crawl' && f.state !== 'finished') {
        this.releaseToken(f);
        f.ai.mode = 'flee';
        this.events.push({ t: 'flee', id: f.id });
        this.bark(f, 'flee');
      } else if (f.ai && f.morale < (f.def.morale ?? 1)) f.morale += TUNING.ai.moraleRecover * DT;
    }
    const k = this.knight;
    if (k.combatT > TUNING.wrath.drainDelay) k.wrath = Math.max(0, k.wrath - TUNING.wrath.drain * DT);
  }

  private clearWave(): void {
    const R = TUNING.rewards, s = this.stats, i = this.wave.index;
    const lines: [string, number][] = [['Wave survived', R.waveBase + R.wavePerIndex * i]];
    if (s.damageTaken < 1) lines.push(['Not a scratch', R.flawless]);
    if (s.parries) lines.push([`Parries x${s.parries}`, s.parries * R.parry]);
    if (s.bestCombo >= 8) lines.push([`A ${s.bestCombo}-hit conversation`, s.bestCombo]);
    if (s.time < 45) lines.push(['Brisk', 10]);
    let gold = 0;
    for (const l of lines) gold += l[1];
    this.gold += gold;
    this.summary = { index: i, gold, lines, stats: { ...s } };
    const last = i >= WAVES.length - 1;
    this.wave.phase = last ? 'victory' : 'cleared';
    this.events.push({ t: 'wave', phase: this.wave.phase, index: i });
  }

  // ---------------------------------------------------------------- debug hooks

  debugSkipTo(index: number): void { this.startWave(clamp(index, 0, WAVES.length - 1)); }
  debugSpawn(type: string, count: number, elite = false): void {
    for (let i = 0; i < count; i++) {
      const fd = FIGHTERS[type];
      this.spawn({ type, at: 0, gate: this.rng.int(4), name: elite ? 'Debug Foreman' : `Debug ${fd.label} ${i + 1}`, elite, weapon: this.rng.pick(fd.weapons) });
    }
    if (this.wave.phase !== 'fight') { this.wave.phase = 'fight'; this.wave.t = 0; }
  }
}

function newStats(): WaveStats {
  return { kills: 0, severs: 0, finishers: 0, parries: 0, damageTaken: 0, time: 0, fled: 0, bestCombo: 0 };
}
