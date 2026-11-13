import { TUNING } from '../data/tuning';
import { angleDiff } from '../sim/rng';
import { BTN, type Command, type Fighter } from '../sim/types';
import type { World } from '../sim/world';

// Input abstraction. Devices are read here and nowhere else; the rest of the game sees
// actions, and the simulation sees only Commands. Touch controls (Milestone 5) plug in
// as one more source that sets the same actions.

export type Action = 'up' | 'down' | 'left' | 'right' | 'light' | 'heavy' | 'block' | 'dodge' | 'kick' | 'special' | 'finish' | 'sprint' | 'lock' | 'pause' | 'debug';

/** Default bindings. Key rebinding (Milestone 4) only needs to edit this table. */
export const BINDINGS: Record<string, Action> = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Mouse0: 'light', Mouse2: 'heavy', KeyQ: 'block', Mouse3: 'block', ControlLeft: 'block', Space: 'dodge', KeyE: 'kick', KeyR: 'special', KeyF: 'finish',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Tab: 'lock', Escape: 'pause', Backquote: 'debug', KeyP: 'pause',
};
// Gamepad (standard mapping): R1 light, R2 heavy, L1 block, Circle dodge, Square kick, Triangle special,
// Cross finisher, L3 sprint, R3 lock-on (on release, so L3+R3 stays free for Bloodrage later).
const PAD: [number, Action][] = [[5, 'light'], [7, 'heavy'], [4, 'block'], [1, 'dodge'], [2, 'kick'], [3, 'special'], [0, 'finish'], [10, 'sprint'], [11, 'lock'], [9, 'pause']];
const BTN_OF: Partial<Record<Action, number>> = { light: BTN.LIGHT, heavy: BTN.HEAVY, block: BTN.BLOCK, dodge: BTN.DODGE, kick: BTN.KICK, special: BTN.SPECIAL, finish: BTN.FINISH, sprint: BTN.SPRINT };

export class Input {
  yaw = 0;
  pitch = 0.24;
  lock = 0;
  sensitivity = 1;
  autoLock = true;
  autoplay = false;
  enabled = false;
  onAction: (a: Action) => void = () => {};
  private held = new Set<Action>();
  private padHeld = new Set<Action>();
  /** Presses that happened between ticks, so a tap shorter than a tick is never lost. */
  private taps = 0;
  private flick = 0;
  private flickT = 0;
  private lockLost = 0;
  private botT = 0;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const a = BINDINGS[e.code];
      if (!a) return;
      if (a === 'lock' || (this.enabled && e.code !== 'Escape')) e.preventDefault();
      if (!e.repeat) this.press(a);
    });
    window.addEventListener('keyup', (e) => { const a = BINDINGS[e.code]; if (a) this.held.delete(a); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) { this.grab(); return; }
      const a = BINDINGS[`Mouse${e.button}`]; if (a) this.press(a);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { const a = BINDINGS[`Mouse${e.button}`]; if (a) this.held.delete(a); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas || !this.enabled) return;
      const s = 0.0024 * this.sensitivity;
      if (this.lock) { this.flick += e.movementX; this.flickT = 0.18; }
      else this.yaw -= e.movementX * s;
      this.pitch = Math.max(-0.2, Math.min(1.05, this.pitch + e.movementY * s));
    });
    window.addEventListener('blur', () => this.held.clear());
  }

  grab(): void { try { const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* headless or denied */ } }
  release(): void { if (document.pointerLockElement) document.exitPointerLock(); this.held.clear(); }

  private press(a: Action): void {
    this.held.add(a);
    const b = BTN_OF[a]; if (b && this.enabled) this.taps |= b;
    this.onAction(a);
  }

  private pollPad(dt: number): { x: number; y: number } {
    const pad = navigator.getGamepads?.().find((p) => p && p.mapping === 'standard');
    const out = { x: 0, y: 0 };
    if (!pad) { this.padHeld.clear(); return out; }
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    out.x = dz(pad.axes[0]); out.y = dz(pad.axes[1]);
    const rx = dz(pad.axes[2]), ry = dz(pad.axes[3]);
    if (this.lock) { if (Math.abs(rx) > 0.7 && this.flickT <= 0) { this.flick = rx * 200; this.flickT = 0.01; } }
    else this.yaw -= rx * 3 * dt * this.sensitivity;
    this.pitch = Math.max(-0.2, Math.min(1.05, this.pitch + ry * 2 * dt * this.sensitivity));
    for (const [i, a] of PAD) {
      const down = !!pad.buttons[i]?.pressed, was = this.padHeld.has(a);
      if (a === 'lock') { if (!down && was && !pad.buttons[10]?.pressed) this.onAction('lock'); }
      else if (down && !was) this.press(a);
      if (down) this.padHeld.add(a); else { this.padHeld.delete(a); if (was && a !== 'lock') this.held.delete(a); }
    }
    return out;
  }

  /** Hard lock-on: toggle, pick the enemy nearest the camera's forward, flick to switch. */
  toggleLock(world: World): void {
    if (this.lock) { this.lock = 0; return; }
    this.lock = this.pickLock(world, this.yaw, 0, 0)?.id ?? 0;
  }
  private pickLock(world: World, dir: number, side: number, exclude: number): Fighter | null {
    const k = world.knight;
    let best: Fighter | null = null, bs = Infinity;
    for (const f of world.fighters) {
      if (f.team !== 1 || f.id === exclude || f.state === 'dead' || f.state === 'gone') continue;
      const d = Math.hypot(f.x - k.x, f.z - k.z);
      if (d > TUNING.targeting.lockRange) continue;
      const a = angleDiff(Math.atan2(f.x - k.x, f.z - k.z), dir);
      if (side && Math.sign(-a) !== side) continue; // negative angle is screen-right
      const s = Math.abs(a) * (side ? 1 : 3) + d * 0.08;
      if (s < bs) { bs = s; best = f; }
    }
    return best;
  }

  /** Per-frame upkeep: gamepad, lock-on tracking and target switching. */
  update(world: World, dt: number): void {
    this.pollPad(dt);
    const k = world.knight;
    if (this.lock) {
      const t = world.get(this.lock);
      const dist = t ? Math.hypot(t.x - k.x, t.z - k.z) : 99;
      if (!t || t.state === 'dead' || t.state === 'gone') {
        // Target died: move to the nearest enemy that is attacking, if the player wants that.
        let next: Fighter | null = null, bd = TUNING.targeting.lockRange;
        if (this.autoLock) for (const f of world.fighters) {
          if (f.team !== 1 || f.state === 'dead' || f.state === 'gone') continue;
          const d = Math.hypot(f.x - k.x, f.z - k.z) - (f.state === 'attack' ? 6 : 0);
          if (d < bd) { bd = d; next = f; }
        }
        this.lock = next?.id ?? 0;
      } else if (dist > TUNING.targeting.lockRange) {
        this.lockLost += dt;
        if (this.lockLost > TUNING.targeting.lockLostTime) this.lock = 0;
      } else {
        this.lockLost = 0;
        // Frame both: ease the camera toward the line from knight to target.
        const want = Math.atan2(t.x - k.x, t.z - k.z);
        this.yaw += angleDiff(want, this.yaw) * (1 - Math.exp(-5 * dt));
        this.pitch += (0.3 - this.pitch) * (1 - Math.exp(-3 * dt));
        if (Math.abs(this.flick) > 70) {
          const n = this.pickLock(world, want, Math.sign(this.flick), t.id);
          if (n) this.lock = n.id;
          this.flick = 0;
        }
      }
      this.flickT -= dt;
      if (this.flickT <= 0) this.flick = 0;
    }
  }

  /** Build this tick's Command for the knight. Movement is made camera-relative here. */
  command(world: World): Command {
    if (this.autoplay) return this.bot(world);
    const pad = navigator.getGamepads?.().find((p) => p && p.mapping === 'standard');
    let ax = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    let ay = (this.held.has('up') ? 1 : 0) - (this.held.has('down') ? 1 : 0);
    if (pad && Math.hypot(pad.axes[0], pad.axes[1]) > 0.2) { ax = pad.axes[0]; ay = -pad.axes[1]; }
    const m = Math.hypot(ax, ay);
    if (m > 1) { ax /= m; ay /= m; }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let buttons = this.taps;
    this.taps = 0;
    for (const a of this.held) buttons |= BTN_OF[a] ?? 0;
    return { mx: fx * ay - fz * ax, mz: fz * ay + fx * ax, buttons: this.enabled ? buttons : 0, aimYaw: this.yaw, lock: this.lock };
  }

  /** Autoplay bot for soak tests and the debug panel: walks at the soft target and swings. */
  private bot(world: World): Command {
    const k = world.knight;
    this.botT++;
    const t = world.get(k.softTarget) ?? world.fighters.find((e) => e.team === 1 && e.state !== 'dead' && e.state !== 'gone');
    const cmd: Command = { mx: 0, mz: 0, buttons: 0, aimYaw: this.yaw, lock: 0 };
    if (!t) return cmd;
    const dx = t.x - k.x, dz = t.z - k.z, d = Math.hypot(dx, dz) || 1;
    cmd.mx = dx / d; cmd.mz = dz / d;
    this.yaw += angleDiff(Math.atan2(dx, dz), this.yaw) * 0.02;
    if (d < 2.6 && this.botT % 13 === 0) cmd.buttons = this.botT % 4 === 0 ? BTN.HEAVY : BTN.LIGHT;
    if (this.botT % 240 === 100) cmd.buttons = BTN.FINISH;
    if (this.botT % 300 > 270) cmd.buttons |= BTN.BLOCK;
    return cmd;
  }
}
