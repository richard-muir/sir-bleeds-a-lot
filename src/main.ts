import '@fontsource/pirata-one';
import '@fontsource/im-fell-english';
import '@fontsource/im-fell-english/400-italic.css';
import './ui/style.css';
import { GameAudio } from './audio/audio';
import { TUNING } from './data/tuning';
import { Input } from './input/input';
import { GameRenderer } from './render/renderer';
import { loadSave, writeSave } from './save/save';
import { World } from './sim/world';
import { UI } from './ui/ui';

type Mode = 'title' | 'playing' | 'paused' | 'panel';
const DT = 1 / TUNING.tickRate;

async function boot(): Promise<void> {
  const save = loadSave();
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('game') as HTMLCanvasElement;

  // Quality: 'auto' picks low for software or integrated-looking renderers on first launch.
  let quality = save.settings.quality === 'auto' ? guessQuality() : save.settings.quality;
  if (params.get('quality') === 'low' || params.get('quality') === 'high') quality = params.get('quality') as 'low' | 'high';

  const renderer = new GameRenderer(canvas, quality);
  await renderer.init();
  if (params.has('gallery')) { gallery(renderer, params); return; }
  const input = new Input(canvas);
  const audio = new GameAudio();
  let world = new World(Date.now() % 100000);
  let mode: Mode = 'title';
  let acc = 0, last = performance.now(), slow = 1, frames = 0, fpsT = 0;

  const applySettings = () => {
    const s = save.settings;
    input.sensitivity = s.sensitivity; input.autoLock = s.autoLock;
    renderer.setGore(s.gore);
    audio.setVolumes(s.volume, s.music);
    writeSave(save);
  };
  const persist = () => { save.gold = world.gold; save.bestWave = Math.max(save.bestWave, world.wave.index + (world.wave.phase === 'cleared' || world.wave.phase === 'victory' ? 1 : 0)); save.kit = world.kitId; writeSave(save); };

  const setMode = (m: Mode) => {
    mode = m;
    input.enabled = m === 'playing';
    ui.showHud(m !== 'title');
    if (m === 'playing') { ui.clearScreen(); if (!input.autoplay) input.grab(); } else input.release();
    audio.setMusic(m === 'title' ? 'menu' : world.wave.phase === 'fight' || world.wave.phase === 'intro' ? 'fight' : 'menu');
  };

  const ui = new UI({
    start(from) {
      audio.start();
      const gold = from > 0 ? save.gold : 0;
      world = new World((Date.now() % 100000) + 1);
      if (save.kit !== 'mail') world.applyKit(world.knight, save.kit);
      world.gold = gold;
      if (from > 0) world.startWave(from);
      renderer.clearField();
      input.lock = 0; input.yaw = 0; input.pitch = 0.24;
      setMode('playing');
    },
    resume() { audio.start(); applySettings(); if (mode === 'paused') setMode('playing'); else { setMode('title'); ui.title(); } },
    quit() { persist(); setMode('title'); ui.title(); },
    next() { save.wave = world.wave.index + 1; world.nextWave(); persist(); setMode('playing'); },
    retry() { world.retryWave(); input.lock = 0; setMode('playing'); },
    settings() { audio.start(); ui.pause(false, applySettings); },
    debug(cmd, arg) {
      world.cheats.invincible = ui.flags.invincible; input.autoplay = ui.flags.autoplay;
      if (cmd === 'wave') { world.debugSkipTo(arg as number); if (mode !== 'playing') setMode('playing'); }
      if (cmd === 'spawn') world.debugSpawn(arg as string, 1);
      if (cmd === 'spawn10') world.debugSpawn(arg as string, 10);
      if (cmd === 'elite') world.debugSpawn('woodcutter', 1, true);
      if (cmd === 'crowd') { world.debugSpawn('mob', 24); world.debugSpawn('farmhand', 10); world.debugSpawn('woodcutter', 6); }
      if (cmd === 'gold') world.addGold(100);
      if (cmd === 'wrath') world.knight.wrath = TUNING.wrath.max;
      if (cmd === 'kit') world.applyKit(world.knight, world.kitId === 'mail' ? 'plate' : 'mail');
      if (cmd === 'clear') renderer.clearField();
    },
  }, save);

  input.onAction = (a) => {
    if (a === 'debug') ui.toggleDebug();
    if (a === 'lock' && mode === 'playing') input.toggleLock(world);
    if (a === 'pause') {
      if (mode === 'playing') { setMode('paused'); ui.pause(true, applySettings); }
      else if (mode === 'paused') { applySettings(); setMode('playing'); }
    }
  };
  // Losing pointer lock (Esc in most browsers) pauses the fight.
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && mode === 'playing' && !input.autoplay && !ui.debugOpen) { setMode('paused'); ui.pause(true, applySettings); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') { setMode('paused'); ui.pause(true, applySettings); } });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' || mode !== 'panel') return;
    if (world.wave.phase === 'cleared') (document.querySelector('#next') as HTMLElement | null)?.click();
    else if (world.wave.phase === 'dead') (document.querySelector('#retry') as HTMLElement | null)?.click();
  });

  applySettings();
  setMode('title');
  ui.title();

  // Test and soak hooks: ?autoplay=1 starts a bot-driven run, ?wave=N picks the wave.
  if (params.has('autoplay')) {
    input.autoplay = true; ui.flags.autoplay = true;
    world = new World(7);
    if (params.has('wave')) world.startWave(Math.max(0, +params.get('wave')! - 1));
    if (params.has('invincible')) world.cheats.invincible = ui.flags.invincible = true;
    setMode('playing');
  }
  const hook = { get world() { return world; }, ui, input, renderer, get mode() { return mode; }, timeScale: 1 };
  (window as unknown as Record<string, unknown>).__game = hook;

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frames++; fpsT += dt;
    if (fpsT >= 0.5) { ui.fps = frames / fpsT; frames = 0; fpsT = 0; }

    let advanced = 0;
    if (mode === 'playing') {
      input.update(world, dt);
      // Finishers play out slow and heavy.
      const wantSlow = world.knight.state === 'finishing' ? 0.42 : 1;
      slow += (wantSlow - slow) * (1 - Math.exp(-10 * dt));
      acc += dt * slow * hook.timeScale;
      let guard = 0;
      while (acc >= DT && guard++ < 6) {
        acc -= DT;
        const before = world.tick;
        world.step(input.command(world));
        if (world.tick !== before) advanced++;
        for (const e of world.events) {
          renderer.handle(e, world); audio.handle(e, world); ui.handle(e, world, renderer);
          if (e.t === 'wave') {
            if (e.phase === 'cleared') { persist(); setTimeout(() => { if (world.wave.phase === 'cleared') { setMode('panel'); ui.cleared(world); if (input.autoplay) setTimeout(() => (document.querySelector('#next') as HTMLElement | null)?.click(), 1200); } }, 1400); }
            if (e.phase === 'victory') { save.wave = 0; persist(); setTimeout(() => { setMode('panel'); ui.victory(world); }, 1800); }
            if (e.phase === 'dead') { input.lock = 0; setTimeout(() => { if (world.wave.phase === 'dead') { setMode('panel'); ui.dead(world); } }, 2200); }
            if (e.phase === 'intro') audio.setMusic('fight');
          }
        }
        world.events.length = 0;
      }
      if (guard >= 6) acc = 0;
    } else if (mode === 'panel') {
      // The world keeps breathing behind a panel (peasants gloat, bodies settle) but takes no input.
      acc += dt;
      while (acc >= DT) { acc -= DT; const before = world.tick; world.step({ mx: 0, mz: 0, buttons: 0, aimYaw: input.yaw, lock: 0 }); if (world.tick !== before) advanced++; for (const e of world.events) { renderer.handle(e, world); audio.handle(e, world); ui.handle(e, world, renderer); } world.events.length = 0; }
    }
    const simDt = mode === 'title' ? dt : advanced * DT;
    renderer.frame(world, dt, simDt, { yaw: input.yaw, pitch: input.pitch, lock: input.lock, debugHitboxes: ui.flags.hitboxes, paused: mode === 'paused', menu: mode === 'title' });
    if (mode !== 'title') ui.update(world, renderer, dt, input.lock);
    audio.update(dt, world, mode === 'playing');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/**
 * Model gallery: ?gallery=knight|plate|mob|farmhand|woodcutter|foreman|all
 * Optional: rot (degrees), dist, h (look height), n (how many), blood (0..1), break (armour piece id), spin=1.
 */
function gallery(renderer: GameRenderer, q: URLSearchParams): void {
  const what = q.get('gallery') || 'all';
  const world = new World(11);
  world.wave.queue = [];
  const n = +(q.get('n') ?? 5);
  const line: { type: string; elite?: boolean }[] = what === 'all'
    ? [{ type: 'mob' }, { type: 'mob' }, { type: 'farmhand' }, { type: 'woodcutter' }, { type: 'woodcutter', elite: true }, { type: 'mob' }, { type: 'mob' }]
    : what === 'knight' || what === 'plate' ? [] : Array.from({ length: n }, () => ({ type: what === 'foreman' ? 'woodcutter' : what, elite: what === 'foreman' }));
  const k = world.knight;
  if (what === 'plate' || q.get('kit') === 'plate') world.applyKit(k, 'plate');
  const cx = 6, cz = 6, gap = 1.05;
  const showKnight = what === 'all' || what === 'knight' || what === 'plate';
  k.x = showKnight ? cx : 60; k.z = cz; k.facing = Math.PI;
  line.forEach((l, i) => {
    const fd = l.type;
    const f = world.spawn({ type: fd, at: 0, gate: 0, name: 'Model', elite: !!l.elite, weapon: ({ mob: ['club', 'rake', 'fryingPan', 'rollingPin'][i % 4], farmhand: 'pitchfork', woodcutter: 'fellingAxe' } as Record<string, string>)[fd] });
    const slot = showKnight ? (i < line.length / 2 ? i - Math.ceil(line.length / 2) : i - Math.floor(line.length / 2) + 1) : i - (line.length - 1) / 2;
    f.x = cx + slot * gap; f.z = cz; f.facing = Math.PI;
  });
  const rot = ((+(q.get('rot') ?? 0)) * Math.PI) / 180, dist = +(q.get('dist') ?? 3.2), h = +(q.get('h') ?? 1.0), blood = +(q.get('blood') ?? 0);
  let t = 0, last = performance.now(), broke = false, killed = false;
  const start = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
    for (const f of world.fighters) { if (f.state !== 'dead') f.facing = Math.PI + rot + (q.has('spin') ? t * 0.6 : 0); f.blood = blood; }
    renderer.frame(world, dt, dt, { yaw: 0, pitch: 0, lock: 0, debugHitboxes: false, paused: false, menu: false, cam: { pos: [cx, h + dist * 0.12, cz - dist], look: [cx, h, cz], fov: 34 } });
    if (!broke && q.get('break')) { broke = true; for (const id of q.get('break')!.split(',')) renderer.rigOf(k.id)?.breakArmour(id); }
    // ?kill=1 drops every peasant as if struck from the camera side; ?sever=armR,head takes those off first.
    if (q.has('kill') && !killed && now - start > 1500) {
      killed = true;
      for (const f of world.fighters) {
        if (f.team !== 1) continue;
        for (const limb of (q.get('sever') ?? '').split(',').filter(Boolean)) renderer.handle({ t: 'sever', id: f.id, limb: limb as never, dirX: 0.3, dirZ: 1, force: 1 }, world);
        renderer.handle({ t: 'hit', id: f.id, by: k.id, zone: 'torso', dmg: 40, type: 'cut', killed: true, x: f.x, z: f.z, dirX: (Math.random() - 0.5) * 0.6, dirZ: 1, heavy: true }, world);
        f.state = 'dead';
        renderer.handle({ t: 'death', id: f.id, by: k.id }, world);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function guessQuality(): 'low' | 'high' {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|intel\(r\) (hd|uhd) graphics [2-6]/i.test(name) ? 'low' : 'high';
  } catch { return 'low'; }
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('ui')!.innerHTML = `<div class="screen dim"><div class="panel"><h3>It would not start</h3><p class="sub">This game needs WebGL 2. ${String(err?.message ?? err)}</p></div></div>`;
});
