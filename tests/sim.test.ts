import { describe, expect, it } from 'vitest';
import { MOVESETS } from '../src/data/moves';
import { WEAPONS } from '../src/data/gear';
import { TUNING } from '../src/data/tuning';
import { WAVES } from '../src/data/waves';
import { applyHit, computeHit, pickZone, rawDamage } from '../src/sim/damage';
import { pickSoftTarget, scoreCandidates } from '../src/sim/targeting';
import { BTN, type Command } from '../src/sim/types';
import { generateWave } from '../src/sim/waves';
import { World } from '../src/sim/world';

const sword = WEAPONS.armingSword;
const l1 = MOVESETS.oneHandShield.moves.l1;

function peasant(w: World, type = 'mob') {
  return w.spawn({ type, at: 0, gate: 0, name: 'Test Gareth', elite: false, weapon: 'club' });
}

describe('damage calculation', () => {
  it('raw damage is weapon x move x charge', () => {
    expect(rawDamage(sword, l1)).toBeCloseTo(30);
    const heavy = MOVESETS.oneHandShield.moves.heavy;
    expect(rawDamage(sword, heavy, 1)).toBeCloseTo(30 * 1.7 * 1.7);
  });
  it('unarmoured zones hurt more, armoured zones less', () => {
    const w = new World(1);
    const p = peasant(w);
    const bare = computeHit(p, 'torso', 30, 'cut');
    expect(bare.dealt).toBeCloseTo(30 * TUNING.combat.unarmouredMul);
    const k = computeHit(w.knight, 'torso', 30, 'cut'); // mail: 70% vs cut
    expect(k.dealt).toBeCloseTo(30 * 0.3);
    const blunt = computeHit(w.knight, 'torso', 30, 'blunt'); // mail is poor against blunt
    expect(blunt.dealt).toBeGreaterThan(k.dealt * 2);
  });
  it('plate protects better than mail and worn armour protects less', () => {
    const w = new World(1);
    const mail = computeHit(w.knight, 'torso', 40, 'cut').dealt;
    w.applyKit(w.knight, 'plate');
    const plate = computeHit(w.knight, 'torso', 40, 'cut').dealt;
    expect(plate).toBeLessThan(mail);
    w.knight.armour.find((a) => a.def.zones.includes('torso'))!.cond = 0.1;
    expect(computeHit(w.knight, 'torso', 40, 'cut').dealt).toBeGreaterThan(plate);
  });
  it('hits wear armour until the piece breaks and the zone is exposed', () => {
    const w = new World(1);
    let broke = false;
    for (let i = 0; i < 200 && !broke; i++) broke = applyHit(w.knight, 'head', 30, 'blunt').armourBroke;
    expect(broke).toBe(true);
    w.knight.hp = 100;
    expect(computeHit(w.knight, 'head', 30, 'blunt').protection).toBe(0);
  });
  it('full plate is heavier, slower and has less stamina than mail', () => {
    const w = new World(1);
    const mail = { kg: w.knight.kitWeight, speed: w.knight.speedMul, stam: w.knight.maxStamina, cls: w.knight.weightClass };
    w.applyKit(w.knight, 'plate');
    expect(w.knight.kitWeight).toBeGreaterThan(mail.kg);
    expect(w.knight.speedMul).toBeLessThan(mail.speed);
    expect(w.knight.maxStamina).toBeLessThan(mail.stam);
    expect(mail.cls).toBe('medium');
    expect(w.knight.weightClass).toBe('heavy');
  });
});

describe('limb loss', () => {
  it('a cut that empties a limb severs it; blunt never does', () => {
    const w = new World(1);
    const a = peasant(w), b = peasant(w);
    expect(applyHit(a, 'armL', 30, 'cut').severed).toBe(true);
    expect(a.limbs.armL.state).toBe('severed');
    expect(applyHit(b, 'armL', 30, 'blunt').severed).toBe(false);
    expect(b.limbs.armL.state).toBe('ok');
  });
  it('losing the head is fatal', () => {
    const w = new World(1);
    const p = peasant(w);
    const r = applyHit(p, 'head', 30, 'cut');
    expect(r.severed && r.killed).toBe(true);
  });
  it('severed limbs are never picked as hit zones again', () => {
    const w = new World(1);
    const p = peasant(w);
    p.limbs.armL.state = 'severed';
    for (let i = 0; i < 50; i++) expect(pickZone(p, { armL: 1, torso: 0.01 }, i / 50)).toBe('torso');
  });
  it('a peasant who loses his weapon arm drops the weapon and runs', () => {
    const w = new World(3);
    w.wave.queue = [];
    w.wave.phase = 'fight';
    const p = peasant(w);
    p.x = 0; p.z = -3.6; w.knight.x = 0; w.knight.z = -5; w.knight.facing = 0;
    // Force every knight hit onto the right arm.
    for (const m of Object.values(w.knight.moveset.moves)) m.zones = { armR: 1 };
    const cmd: Command = { mx: 0, mz: 0, buttons: BTN.LIGHT, aimYaw: 0, lock: 0 };
    const seen: string[] = [];
    for (let i = 0; i < 120; i++) { w.step(i === 0 ? cmd : { ...cmd, buttons: 0 }); for (const e of w.events) seen.push(e.t); w.events.length = 0; }
    expect(seen).toContain('sever');
    expect(seen).toContain('drop');
    expect(p.weapon).toBeNull();
    expect(['flee', 'cower']).toContain(p.ai!.mode);
  });
});

describe('wave generation', () => {
  it('is deterministic for a seed and matches the definition', () => {
    for (const def of WAVES) {
      const a = generateWave(def, 42), b = generateWave(def, 42);
      expect(a).toEqual(b);
      const want = def.groups.reduce((n, g) => n + g.count, 0);
      expect(a.length).toBe(want);
      for (const g of def.groups) expect(a.filter((e) => e.type === g.type && e.elite === !!g.elite).length).toBe(g.count);
    }
  });
  it('spawn times are ordered, and elites arrive last', () => {
    const w = generateWave(WAVES[4], 7);
    for (let i = 1; i < w.length; i++) expect(w[i].at).toBeGreaterThanOrEqual(w[i - 1].at);
    expect(w[w.length - 1].elite).toBe(true);
    expect(w[w.length - 1].at).toBeLessThanOrEqual(WAVES[4].spawnOver + 1.6);
  });
  it('different seeds give different crowds', () => {
    expect(generateWave(WAVES[2], 1)).not.toEqual(generateWave(WAVES[2], 2));
  });
});

describe('targeting', () => {
  it('prefers the enemy in the pushed direction and sticks to it', () => {
    const w = new World(1);
    const k = w.knight; k.x = 0; k.z = 0;
    const a = peasant(w), b = peasant(w);
    a.x = 0; a.z = 3; b.x = 3; b.z = 0.3;
    const fwd = scoreCandidates(k, w.fighters, 0);
    expect(pickSoftTarget(0, fwd, true)).toBe(a.id);
    // Nudge the input a little toward b: not enough to beat stickiness.
    const nudged = scoreCandidates(k, w.fighters, 0.6);
    expect(pickSoftTarget(a.id, nudged, false)).toBe(a.id);
    const right = scoreCandidates(k, w.fighters, Math.PI / 2);
    expect(pickSoftTarget(a.id, right, true)).toBe(b.id);
  });
  it('an attacker outranks a bystander in the same direction', () => {
    const w = new World(1);
    const k = w.knight; k.x = 0; k.z = 0;
    const near = peasant(w), attacker = peasant(w);
    near.x = 0.2; near.z = 2; attacker.x = -0.3; attacker.z = 3.2;
    attacker.state = 'attack'; attacker.phase = 'windup';
    expect(pickSoftTarget(0, scoreCandidates(k, w.fighters, 0), true)).toBe(attacker.id);
  });
});

describe('a whole fight', () => {
  it('a simple bot can play through waves without the sim breaking', () => {
    const w = new World(5);
    w.cheats.invincible = true;
    let ticks = 0, maxAlive = 0;
    while (w.wave.phase !== 'victory' && ticks < 60 * 60 * 12) {
      const k = w.knight;
      const t = w.get(k.softTarget) ?? w.enemies.find((e) => e.state !== 'dead' && e.state !== 'gone');
      const cmd: Command = { mx: 0, mz: 0, buttons: 0, aimYaw: k.facing, lock: 0 };
      if (t) {
        const dx = t.x - k.x, dz = t.z - k.z, d = Math.hypot(dx, dz);
        cmd.mx = dx / d; cmd.mz = dz / d;
        if (d < 2.6 && ticks % 14 === 0) cmd.buttons = ticks % 3 === 0 ? BTN.HEAVY : BTN.LIGHT;
        if (ticks % 400 === 7) cmd.buttons = BTN.FINISH;
      }
      w.step(cmd);
      w.events.length = 0;
      if (w.wave.phase === 'cleared') w.nextWave();
      maxAlive = Math.max(maxAlive, w.fighters.length);
      for (const f of w.fighters) expect(Number.isFinite(f.x + f.z + f.hp + f.facing)).toBe(true);
      ticks++;
    }
    expect(w.wave.phase).toBe('victory');
    expect(w.gold).toBeGreaterThan(100);
    expect(maxAlive).toBeGreaterThan(10);
  });
  it('the same seed and commands reproduce the same fight', () => {
    const run = () => {
      const w = new World(9);
      for (let i = 0; i < 1500; i++) { w.step({ mx: Math.sin(i / 40), mz: Math.cos(i / 55), buttons: i % 20 === 0 ? BTN.LIGHT : 0, aimYaw: 0, lock: 0 }); w.events.length = 0; }
      return w.fighters.map((f) => [f.x, f.z, f.hp, f.state]);
    };
    expect(run()).toEqual(run());
  });
  it('death lets you retry the wave with the kit you started it with', () => {
    const w = new World(2);
    w.knight.armour[0].cond = 0.8;
    w.startWave(1);
    w.knight.armour[0].cond = 0.2;
    w.knight.hp = 0.01; w.knight.bleed = 5; w.knight.bleedT = 5;
    w.step({ mx: 0, mz: 0, buttons: 0, aimYaw: 0, lock: 0 });
    expect(w.wave.phase).toBe('dead');
    w.retryWave();
    expect(w.wave.index).toBe(1);
    expect(w.knight.hp).toBe(w.knight.maxHp);
    expect(w.knight.armour[0].cond).toBeCloseTo(0.8);
  });
});
