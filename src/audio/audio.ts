import type { SimEvent } from '../sim/types';
import type { World } from '../sim/world';

// All sound is synthesised with the Web Audio API for now, so the game ships with no audio
// files and no licences to track. Each effect is one small function: replace its body with a
// sample player to drop real audio in. Music reads public/music/tracks.json; while that lists
// no files, the placeholder loops below play instead.

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private menuGain!: GainNode;
  private fightGain!: GainNode;
  private noise!: AudioBuffer;
  private volume = 0.8;
  private musicVol = 0.5;
  private mode: 'menu' | 'fight' = 'menu';
  private nextBeat = 0;
  private beat = 0;
  private riff = 0;
  private stepT = 0;
  private ambT = 4;
  private files: { menu: HTMLAudioElement[]; fight: HTMLAudioElement[] } = { menu: [], fight: [] };
  private current: HTMLAudioElement | null = null;

  /** Must be called from a user gesture (browsers block audio until then). */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(comp);
    this.musicBus = c.createGain(); this.musicBus.connect(comp);
    this.menuGain = c.createGain(); this.menuGain.connect(this.musicBus);
    this.fightGain = c.createGain(); this.fightGain.gain.value = 0; this.fightGain.connect(this.musicBus);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.setVolumes(this.volume, this.musicVol);
    this.ambience();
    this.nextBeat = c.currentTime + 0.1;
    void this.loadFiles();
  }

  private async loadFiles(): Promise<void> {
    try {
      const list = await (await fetch('music/tracks.json')).json();
      for (const k of ['menu', 'fight'] as const) for (const f of list[k] ?? []) { const a = new Audio(`music/${f}`); a.loop = true; a.volume = 0; this.files[k].push(a); }
      if (this.files.menu.length || this.files.fight.length) this.setMusic(this.mode, true);
    } catch { /* no manifest: keep the placeholder loops */ }
  }

  setVolumes(volume: number, music: number): void {
    this.volume = volume; this.musicVol = music;
    if (!this.ctx) return;
    this.master.gain.value = volume;
    this.musicBus.gain.value = music * 0.5;
    if (this.current) this.current.volume = volume * music;
  }

  /** Crossfade between the menu track and a randomly chosen fight track. */
  setMusic(mode: 'menu' | 'fight', force = false): void {
    if (mode === this.mode && !force) return;
    this.mode = mode;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const pool = this.files[mode];
    if (pool.length) { // real files
      const next = pool[Math.floor(Math.random() * pool.length)], prev = this.current;
      if (prev && prev !== next) { const fade = setInterval(() => { prev.volume = Math.max(0, prev.volume - 0.05); if (prev.volume <= 0) { prev.pause(); clearInterval(fade); } }, 60); }
      next.volume = this.volume * this.musicVol; void next.play().catch(() => {});
      this.current = next;
      this.menuGain.gain.setTargetAtTime(0, t, 0.3); this.fightGain.gain.setTargetAtTime(0, t, 0.3);
      return;
    }
    this.menuGain.gain.setTargetAtTime(mode === 'menu' ? 1 : 0, t, 0.6);
    this.fightGain.gain.setTargetAtTime(mode === 'fight' ? 1 : 0, t, 0.6);
    if (mode === 'fight') this.riff = Math.floor(Math.random() * RIFFS.length);
  }

  // ---------------------------------------------------------------- building blocks

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  private burst(type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number, out: AudioNode = this.sfx, at = 0): void {
    const c = this.ctx!, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loopStart = Math.random(); s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = c.createGain(); this.env(g, t, peak, attack, decay);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random()); s.stop(t + attack + decay + 0.05);
  }
  private tone(type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, out: AudioNode = this.sfx, at = 0): void {
    const c = this.ctx!, t = c.currentTime + at;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = c.createGain(); this.env(g, t, peak, attack, decay);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  // ---------------------------------------------------------------- effects

  swing(heavy: boolean): void { this.burst('bandpass', heavy ? 500 : 900, heavy ? 1500 : 2600, 1.2, heavy ? 0.35 : 0.22, 0.05, heavy ? 0.2 : 0.12); }
  /** Heavy, wet, crunching: a low thump, a slap of flesh and a squelch. */
  impact(heavy: boolean, blunt: boolean): void {
    const v = heavy ? 1 : 0.7;
    this.tone('sine', blunt ? 110 : 140, 38, 0.9 * v, 0.004, 0.16);
    this.burst('lowpass', 1800, 300, 0.7, 0.6 * v, 0.003, 0.09);
    this.burst('bandpass', 700, 240, 3, 0.35 * v, 0.02, 0.16, this.sfx, 0.02);
    if (heavy) for (let i = 0; i < 3; i++) this.burst('highpass', 2200, 1400, 1, 0.16, 0.002, 0.03, this.sfx, 0.02 + i * 0.03); // bone
  }
  clang(parry: boolean): void {
    const base = parry ? 1900 : 1300;
    for (const [m, g] of [[1, 0.22], [1.51, 0.16], [2.17, 0.12], [2.83, 0.08]]) this.tone('triangle', base * m * (0.97 + Math.random() * 0.06), base * m * 0.99, g * (parry ? 1.3 : 0.8), 0.002, parry ? 0.6 : 0.22);
    this.burst('highpass', 3000, 5000, 0.8, 0.25, 0.001, 0.05);
    if (!parry) this.tone('sine', 150, 70, 0.4, 0.004, 0.1);
  }
  sever(): void { this.impact(true, false); this.burst('bandpass', 420, 160, 4, 0.5, 0.03, 0.3, this.sfx, 0.04); }
  /** A voice of sorts: a sawtooth through two formants. Pitch and length carry the meaning. */
  voice(kind: 'grunt' | 'scream' | 'death' | 'effort', pitch = 1): void {
    const c = this.ctx!, t = c.currentTime;
    const p = pitch * (0.85 + Math.random() * 0.3);
    const [f0, f1, dur, vol] = kind === 'scream' ? [260 * p, 360 * p, 0.7, 0.2] : kind === 'death' ? [200 * p, 80 * p, 0.55, 0.22] : kind === 'effort' ? [120 * p, 95 * p, 0.14, 0.1] : [150 * p, 100 * p, 0.2, 0.18];
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 18 + Math.random() * 12; vg.gain.value = kind === 'scream' ? 22 : 8; vib.connect(vg); vg.connect(o.frequency);
    const g = c.createGain(); this.env(g, t, vol, 0.03, dur);
    for (const [ff, q] of [[kind === 'scream' ? 1000 : 650, 5], [kind === 'scream' ? 2400 : 1250, 7]]) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = ff * (0.9 + Math.random() * 0.2); f.Q.value = q; o.connect(f); f.connect(g); }
    g.connect(this.sfx);
    o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  }
  step(armoured: boolean): void {
    this.burst('lowpass', 420, 140, 1, 0.16, 0.005, 0.09);
    this.burst('bandpass', 900, 500, 2, 0.05, 0.02, 0.07, this.sfx, 0.015); // mud
    if (armoured) this.burst('highpass', 4500, 3800, 3, 0.02, 0.002, 0.05); // mail
  }
  coin(): void { this.tone('triangle', 2400, 2300, 0.05, 0.002, 0.12); this.tone('triangle', 3200, 3100, 0.04, 0.002, 0.14, this.sfx, 0.05); }
  bell(out: AudioNode = this.sfx, vol = 0.12): void { for (const [m, g] of [[1, 1], [2.02, 0.5], [2.76, 0.35], [5.4, 0.15]]) this.tone('sine', 196 * m, 195 * m, vol * g, 0.01, 3.5, out); }
  private caw(): void { for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) { this.tone('sawtooth', 620, 480, 0.035, 0.02, 0.16, this.sfx, i * 0.3); this.burst('bandpass', 1400, 1100, 4, 0.05, 0.02, 0.16, this.sfx, i * 0.3); } }

  private ambience(): void {
    const c = this.ctx!;
    const mk = (type: BiquadFilterType, freq: number, gain: number, lfo: number) => {
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); g.gain.value = gain;
      if (lfo) { const o = c.createOscillator(), og = c.createGain(); o.frequency.value = lfo; og.gain.value = gain * 0.6; o.connect(og); og.connect(g.gain); o.start(); }
      s.connect(f); f.connect(g); g.connect(this.sfx); s.start();
    };
    mk('lowpass', 320, 0.11, 0.07); // wind
    mk('highpass', 5200, 0.022, 0); // rain
    mk('bandpass', 1800, 0.012, 0.31);
  }

  // ---------------------------------------------------------------- placeholder music

  /** Schedule placeholder music a little ahead of the clock. Call every frame. */
  update(dt: number, world: World | null, playing: boolean): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    while (this.nextBeat < c.currentTime + 0.25) {
      const at = this.nextBeat - c.currentTime, b = this.beat++;
      // Menu: slow court lute in D dorian over a drone.
      if (b % 4 === 0) { const n = LUTE[(b / 4) % LUTE.length]; if (n) this.pluck(n, 0.16, this.menuGain, at); }
      if (b % 32 === 0) { this.tone('sine', 73.4, 73.4, 0.12, 1.5, 5, this.menuGain, at); this.tone('sine', 110, 110, 0.06, 1.5, 5, this.menuGain, at); }
      // Fight: frame drum, drone and a reedy riff.
      const s = b % 16;
      if (s === 0 || s === 6 || s === 10) { this.tone('sine', 95, 48, 0.55, 0.004, 0.22, this.fightGain, at); this.burst('lowpass', 500, 150, 1, 0.25, 0.003, 0.1, this.fightGain, at); }
      if (s === 4 || s === 12 || s === 14) this.burst('bandpass', 1900, 1500, 2, 0.14, 0.002, 0.07, this.fightGain, at);
      if (s === 0) { this.tone('sawtooth', 73.4, 73.4, 0.07, 0.05, 1.7, this.fightGain, at); this.tone('sawtooth', 110.2, 110, 0.04, 0.05, 1.7, this.fightGain, at); }
      const r = RIFFS[this.riff], n = r[b % r.length];
      if (n) this.reed(n, this.fightGain, at);
      this.nextBeat += 0.14;
    }
    if (!world || !playing) return;
    // Footsteps and the world going about its business.
    const k = world.knight;
    const sp = Math.hypot(k.vx, k.vz);
    if (sp > 1 && (k.state === 'idle' || k.state === 'block')) { this.stepT -= dt * sp; if (this.stepT <= 0) { this.stepT = 1.9; this.step(true); } }
    this.ambT -= dt;
    if (this.ambT <= 0) { this.ambT = 6 + Math.random() * 12; if (Math.random() < 0.75) this.caw(); else this.bell(this.sfx, 0.035); }
  }
  private pluck(freq: number, vol: number, out: AudioNode, at: number): void {
    this.tone('triangle', freq, freq, vol, 0.004, 0.9, out, at);
    this.tone('sine', freq * 2, freq * 2, vol * 0.3, 0.004, 0.4, out, at);
  }
  private reed(freq: number, out: AudioNode, at: number): void {
    const c = this.ctx!, t = c.currentTime + at;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.5;
    const g = c.createGain(); this.env(g, t, 0.07, 0.015, 0.2);
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3);
  }

  // ---------------------------------------------------------------- sim events

  handle(e: SimEvent, world: World): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const k = world.knight.id;
    switch (e.t) {
      case 'swing': this.swing(e.heavy); if (e.id === k && e.heavy) this.voice('effort', 0.8); break;
      case 'hit':
        this.impact(e.heavy, e.type === 'blunt');
        if (e.id === k) this.voice('grunt', 0.75);
        else if (!e.killed && Math.random() < 0.5) this.voice('grunt', 1 + Math.random() * 0.4);
        break;
      case 'block': this.clang(false); break;
      case 'parry': this.clang(true); break;
      case 'sever': this.sever(); if (e.limb !== 'head') this.voice('scream', 1 + Math.random() * 0.3); break;
      case 'death': this.voice('death', e.id === k ? 0.7 : 1 + Math.random() * 0.3); break;
      case 'flee': this.voice('scream', 1.2); break;
      case 'windup': if (e.id !== k) this.tone('triangle', 1700, 2100, 0.035, 0.01, 0.12); break; // incoming-attack cue
      case 'dodge': this.burst('bandpass', 600, 1200, 1, 0.15, 0.04, 0.12); break;
      case 'knockdown': this.tone('sine', 90, 40, 0.5, 0.005, 0.2); this.burst('lowpass', 600, 200, 1, 0.3, 0.005, 0.15); break;
      case 'armourBreak': this.clang(false); this.burst('highpass', 2500, 1500, 1, 0.3, 0.002, 0.2); break;
      case 'gold': if (e.amount >= 3) this.coin(); break;
      case 'finisher': this.tone('sine', 55, 40, 0.5, 0.3, 1.2); break;
      case 'wave':
        if (e.phase === 'intro') this.bell(this.sfx, 0.1);
        if (e.phase === 'dead') { this.tone('sine', 110, 50, 0.5, 0.05, 2); }
        if (e.phase === 'cleared' || e.phase === 'victory') { for (const [f, at] of [[293.7, 0], [349.2, 0.18], [440, 0.36]]) this.pluck(f, 0.2, this.sfx, at); }
        break;
    }
  }
}

// D dorian: D E F G A B C
const D = 146.83, E = 164.81, F = 174.61, G = 196, A = 220, B = 246.94, C5 = 261.63, D5 = 293.66, E5 = 329.63, F5 = 349.23;
const LUTE = [D, A, F, 0, E, G, A, 0, D, F, A, D5, C5, A, G, 0, F, A, C5, 0, B, G, E, 0, D, 0, A, F, E, D, 0, 0];
const RIFFS = [
  [D5, 0, D5, E5, F5, 0, E5, D5, C5, 0, D5, 0, A, 0, 0, 0, D5, 0, D5, E5, F5, 0, E5, F5, 0, E5, D5, 0, D5, 0, 0, 0],
  [A, 0, D5, 0, C5, D5, 0, A, 0, G, A, 0, F, 0, G, 0, A, 0, D5, 0, E5, F5, 0, E5, 0, D5, C5, 0, D5, 0, 0, 0],
  [D5, D5, 0, C5, 0, A, C5, 0, D5, 0, 0, F5, E5, 0, D5, 0, C5, C5, 0, A, 0, G, A, 0, C5, 0, D5, 0, 0, 0, D5, 0],
];
