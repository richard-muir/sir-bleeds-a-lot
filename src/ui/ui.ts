import { KITS } from '../data/gear';
import { FIGHTERS } from '../data/peasants';
import { CLEAR_LINES, DEATH_LINES, VICTORY_LINE } from '../data/text';
import { TUNING } from '../data/tuning';
import { WAVES } from '../data/waves';
import type { GameRenderer } from '../render/renderer';
import type { SaveData } from '../save/save';
import { armourOn } from '../sim/damage';
import { isFinishable, isThreat } from '../sim/targeting';
import type { SimEvent, Zone } from '../sim/types';
import type { World } from '../sim/world';

// DOM overlay for everything that is text or chrome: title, HUD, barks, panels, debug.
// It reads the world and never writes to it; anything the player decides goes out through
// the `on` callbacks.

const CONTROLS: [string, string][] = [
  ['WASD', 'Move'], ['Mouse', 'Look'], ['Left click', 'Light attack (x3 to chain)'], ['Right click', 'Heavy (hold to charge)'],
  ['Q / Ctrl', 'Block. Tap just before a hit to parry'], ['Space', 'Dodge'], ['E', 'Shield bash'], ['R', 'Shield charge (costs Wrath)'],
  ['F', 'Finish a downed or staggered enemy'], ['Shift', 'Sprint'], ['Tab', 'Lock on'], ['Esc', 'Pause'],
];
const COMBOS: [string, string][] = [['Light, light, heavy', 'Wide sweep'], ['Light, heavy', 'Armour-breaker'], ['Parry, then light', 'Riposte']];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const dl = (rows: [string, string][]) => `<dl class="controls">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

export interface UIHandlers {
  start(fromWave: number): void; resume(): void; quit(): void; next(): void; retry(): void;
  settings(): void; debug(cmd: string, arg?: number | string): void;
}

interface Bark { e: HTMLElement; id: number; t: number }

export class UI {
  private root = document.getElementById('ui')!;
  private hud = el('div', 'hidden'); private screen = el('div');
  private hp!: HTMLElement; private hpLag!: HTMLElement; private st!: HTMLElement; private wr: HTMLElement[] = [];
  private doll!: SVGElement; private waveEl!: HTMLElement; private leftEl!: HTMLElement; private goldEl!: HTMLElement;
  private target!: HTMLElement; private tName!: HTMLElement; private tHp!: HTMLElement; private tPoise!: HTMLElement;
  private combo!: HTMLElement; private hint!: HTMLElement; private announce!: HTMLElement; private caption!: HTMLElement; private cine!: HTMLElement;
  private kitEl!: HTMLElement;
  private layer = el('div'); private prompt = el('div', 'prompt hidden', 'F');
  private barks: Bark[] = [];
  private threats: HTMLElement[] = [];
  private scores: HTMLElement[] = [];
  private debugEl = el('div', 'hidden');
  private announceT = 0; private captionT = 0; private hintT = 30;
  debugOpen = false;
  flags = { hitboxes: false, scores: false, invincible: false, autoplay: false };
  fps = 0;

  constructor(private on: UIHandlers, private save: SaveData) {
    this.hud.id = 'hud'; this.debugEl.id = 'debug';
    this.root.append(this.hud, this.screen, this.debugEl);
    this.buildHud();
    this.buildDebug();
  }

  // ---------------------------------------------------------------- HUD

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="bars-cine"></div>
      <div class="top"><div class="wave"></div><div class="left"></div>
        <div class="target"><div class="name"></div><div class="bar"><i></i></div><div class="bar poise"><i></i></div></div></div>
      <div class="gold"><small>Gold</small><span>0</span></div>
      <div class="combo"><b>0</b><span>hits</span></div>
      <div class="announce"><div class="n"></div><div class="t"></div><div class="l"></div></div>
      <div class="caption"></div>
      <div class="vitals">
        <svg class="doll" viewBox="0 0 54 86" aria-label="Armour and limbs">
          <circle data-z="head" cx="27" cy="10" r="8"/><rect data-z="torso" x="16" y="20" width="22" height="30" rx="2"/>
          <rect data-z="armR" x="5" y="21" width="8" height="30" rx="3"/><rect data-z="armL" x="41" y="21" width="8" height="30" rx="3"/>
          <rect data-z="legR" x="16" y="53" width="9" height="31" rx="3"/><rect data-z="legL" x="29" y="53" width="9" height="31" rx="3"/>
        </svg>
        <div class="bars"><div class="kit"></div>
          <div class="bar hp"><i class="lag"></i><i></i></div><div class="bar st"><i></i></div>
          <div class="wrath"><div class="bar"><i></i></div><div class="bar"><i></i></div><div class="bar"><i></i></div></div></div>
      </div>
      <div class="hint">${dl(CONTROLS)}<hr style="border:0;border-top:1px solid #4a443c;margin:6px 0">${dl(COMBOS)}</div>`;
    const q = (s: string) => this.hud.querySelector(s) as HTMLElement;
    this.hp = q('.hp i:not(.lag)'); this.hpLag = q('.hp .lag'); this.st = q('.st i');
    this.wr = [...this.hud.querySelectorAll('.wrath .bar')] as HTMLElement[];
    this.doll = this.hud.querySelector('.doll')!; this.waveEl = q('.wave'); this.leftEl = q('.left'); this.goldEl = q('.gold span');
    this.target = q('.target'); this.tName = q('.target .name'); this.tHp = q('.target .bar i'); this.tPoise = q('.target .poise i');
    this.combo = q('.combo'); this.hint = q('.hint'); this.announce = q('.announce'); this.caption = q('.caption'); this.cine = q('.bars-cine'); this.kitEl = q('.kit');
    this.hud.append(this.layer, this.prompt);
  }

  showHud(on: boolean): void { this.hud.classList.toggle('hidden', !on); }

  handle(e: SimEvent, world: World, r: GameRenderer): void {
    switch (e.t) {
      case 'bark': {
        const f = world.get(e.id);
        if (!f) break;
        for (const b of this.barks) if (b.id === e.id) b.t = 0;
        const d = el('div', 'bark', `<small>${f.name}</small>${e.text}`);
        this.layer.append(d);
        this.barks.push({ e: d, id: e.id, t: 3.4 });
        if (this.barks.length > 4) this.barks[0].t = 0;
        break;
      }
      case 'wave':
        if (e.phase === 'intro') {
          const w = WAVES[e.index];
          this.announce.querySelector('.n')!.textContent = `Wave ${e.index + 1} of ${WAVES.length}`;
          this.announce.querySelector('.t')!.textContent = w.title;
          this.announce.querySelector('.l')!.textContent = w.announce;
          this.announce.classList.add('on'); this.announceT = 3.6;
        }
        break;
      case 'finisher': this.caption.textContent = e.caption; this.caption.classList.add('on'); this.cine.classList.add('on'); this.captionT = 2.6; break;
      case 'gold': {
        if (e.amount < 3) break;
        const p = r.toScreen(e.x, 1.4, e.z);
        if (p.behind) break;
        const d = el('div', 'float', `+${e.amount}`);
        d.style.left = `${p.x}px`; d.style.top = `${p.y}px`;
        this.layer.append(d); setTimeout(() => d.remove(), 900);
        break;
      }
    }
  }

  update(world: World, r: GameRenderer, dt: number, lock: number): void {
    const k = world.knight;
    this.hp.style.transform = this.hpLag.style.transform = `scaleX(${Math.max(0, k.hp / k.maxHp)})`;
    this.st.style.transform = `scaleX(${Math.max(0, k.stamina / k.maxStamina)})`;
    const bar = TUNING.wrath.bar;
    this.wr.forEach((b, i) => { const v = Math.max(0, Math.min(1, (k.wrath - i * bar) / bar)); (b.firstElementChild as HTMLElement).style.transform = `scaleX(${v})`; b.classList.toggle('full', v >= 0.999); });
    this.kitEl.textContent = `${KITS[world.kitId].name} · ${k.kitWeight.toFixed(0)} kg · ${k.weightClass}`;
    // Paper doll: armour condition by zone; missing limbs shown hollow.
    for (const n of this.doll.children) {
      const z = (n as SVGElement).dataset.z as Zone;
      const gone = z !== 'torso' && k.limbs[z].state !== 'ok';
      const a = armourOn(k, z);
      const c = a ? a.cond : 0;
      const fill = gone ? 'none' : a ? `rgb(${Math.round(150 + c * 20)},${Math.round(70 + c * 95)},${Math.round(50 + c * 100)})` : '#7a1a1a';
      n.setAttribute('fill', fill); n.setAttribute('stroke', gone ? '#d11a24' : '#0b0a09'); n.setAttribute('stroke-width', gone ? '1.5' : '1');
      n.setAttribute('stroke-dasharray', gone ? '3 2' : '');
    }
    this.waveEl.textContent = `Wave ${world.wave.index + 1} · ${WAVES[world.wave.index].title}`;
    const left = world.remaining;
    this.leftEl.textContent = world.wave.phase === 'fight' ? `${left} ${left === 1 ? 'peasant remains' : 'peasants remain'}` : '';
    this.goldEl.textContent = String(world.gold);
    this.combo.classList.toggle('on', k.combo >= 3);
    if (k.combo >= 3) this.combo.firstElementChild!.textContent = String(k.combo);

    const t = world.get(lock || k.softTarget);
    const showT = !!t && t.state !== 'dead' && t.state !== 'gone';
    this.target.classList.toggle('on', showT);
    if (t && showT) {
      const label = t.elite ? '' : ` · ${FIGHTERS[t.def.id].label}`;
      this.tName.textContent = `${t.name}${label}`;
      this.tHp.style.transform = `scaleX(${Math.max(0, t.hp / t.maxHp)})`;
      (this.tPoise.parentElement as HTMLElement).style.visibility = t.maxPoise > 20 ? 'visible' : 'hidden';
      this.tPoise.style.transform = `scaleX(${Math.max(0, t.poise / Math.max(1, t.maxPoise))})`;
    }

    if ((this.announceT -= dt) <= 0) this.announce.classList.remove('on');
    if ((this.captionT -= dt) <= 0) { this.caption.classList.remove('on'); this.cine.classList.remove('on'); }
    if (this.save.settings.hints && world.wave.index === 0) { this.hintT -= dt; this.hint.classList.toggle('fade', this.hintT <= 0); } else this.hint.classList.add('fade');

    // Barks float above the speaker's head.
    for (let i = this.barks.length - 1; i >= 0; i--) {
      const b = this.barks[i];
      b.t -= dt;
      const v = r.viewPos(b.id);
      if (b.t <= 0 || !v) { b.e.remove(); this.barks.splice(i, 1); continue; }
      const p = r.toScreen(v.x, 2.05 * v.scale, v.z);
      b.e.style.display = p.behind ? 'none' : '';
      b.e.style.left = `${Math.max(120, Math.min(innerWidth - 120, p.x))}px`; b.e.style.top = `${Math.max(60, p.y)}px`;
      b.e.style.opacity = String(Math.min(1, b.t * 3));
    }

    // Finisher prompt on the finishable enemy nearest the push direction.
    let best = null as null | { x: number; z: number; s: number }, bd = TUNING.targeting.finisherRange;
    if (k.state !== 'finishing' && k.state !== 'dead') for (const f of world.fighters) {
      if (f.team !== 1 || !isFinishable(f)) continue;
      const d = Math.hypot(f.x - k.x, f.z - k.z);
      if (d < bd) { bd = d; best = { x: f.x, z: f.z, s: f.state === 'down' ? 0.5 : 1.3 }; }
    }
    this.prompt.classList.toggle('hidden', !best);
    if (best) { const p = r.toScreen(best.x, best.s, best.z); this.prompt.style.left = `${p.x}px`; this.prompt.style.top = `${p.y}px`; }

    // Threat markers at the screen edge for attackers the player cannot see.
    let n = 0;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (const f of world.fighters) {
      if (f.team !== 1 || !isThreat(f) || f.lock !== k.id) continue;
      const p = r.toScreen(f.x, 1.2, f.z);
      const on = !p.behind && p.x > 30 && p.x < innerWidth - 30 && p.y > 30 && p.y < innerHeight - 30;
      if (on) continue;
      let dx = p.x - cx, dy = p.y - cy;
      if (p.behind) { dx = -dx; dy = Math.abs(dy) + cy; }
      const a = Math.atan2(dy, dx), rad = Math.min(cx, cy) - 46;
      const m = (this.threats[n] ??= this.layer.appendChild(el('div', 'threat')));
      m.style.display = ''; m.style.left = `${cx + Math.cos(a) * rad * (cx / Math.min(cx, cy)) - 9}px`; m.style.top = `${cy + Math.sin(a) * rad - 10}px`;
      m.style.transform = `rotate(${a + Math.PI / 2}rad)`;
      n++;
    }
    for (let i = n; i < this.threats.length; i++) this.threats[i].style.display = 'none';

    // Debug: targeting scores above each candidate.
    let s = 0;
    if (this.flags.scores) for (const c of world.targetScores) {
      const f = world.get(c.id); if (!f) continue;
      const p = r.toScreen(f.x, 2.3, f.z); if (p.behind) continue;
      const m = (this.scores[s] ??= this.layer.appendChild(el('div', 'score')));
      m.style.display = ''; m.style.left = `${p.x}px`; m.style.top = `${p.y}px`;
      m.textContent = `${c.score.toFixed(2)} a${Math.round((c.angle * 180) / Math.PI)} d${c.dist.toFixed(1)}${c.threat ? ' T' : ''}${c.finishable ? ' F' : ''}${c.los ? '' : ' !los'}`;
      m.classList.toggle('sel', c.id === k.softTarget);
      s++;
    }
    for (let i = s; i < this.scores.length; i++) this.scores[i].style.display = 'none';

    if (this.debugOpen) this.debugEl.querySelector('.stat')!.textContent = `${this.fps.toFixed(0)} fps · tick ${world.tick} · ${world.fighters.length - 1} enemies · ${world.wave.phase}`;
  }

  // ---------------------------------------------------------------- screens

  private show(cls: string, html: string): HTMLElement {
    this.screen.className = `screen ${cls}`;
    this.screen.innerHTML = html;
    return this.screen;
  }
  private click(sel: string, fn: () => void): void { this.screen.querySelector(sel)?.addEventListener('click', fn); }
  clearScreen(): void { this.screen.className = 'hidden'; this.screen.innerHTML = ''; }

  title(): void {
    const s = this.save;
    const cont = s.wave > 0 && s.wave < WAVES.length;
    this.show('title', `
      <p class="kicker">The Tales of</p>
      <h1>Sir <em>Bleeds</em>alot</h1>
      <p class="sub">Tale the First: The Turnip Rebellion. The village has grievances. You have a sword, a shield and a name to live up to.</p>
      <div class="btns">
        ${cont ? `<button class="btn primary" id="cont">Continue from wave ${s.wave + 1}</button><button class="btn" id="go">Start again</button>` : `<button class="btn primary" id="go">Ride out</button>`}
        <button class="btn" id="set">Settings</button>
      </div>
      ${dl(CONTROLS.slice(0, 9))}
      <p class="record">${s.bestWave ? `Furthest: wave ${s.bestWave} of ${WAVES.length} · Purse: ${s.gold} gold` : 'No deeds recorded. The chroniclers are waiting.'}</p>`);
    this.click('#go', () => this.on.start(0));
    this.click('#cont', () => this.on.start(s.wave));
    this.click('#set', () => this.on.settings());
  }

  cleared(world: World): void {
    const sm = world.summary!;
    const next = WAVES[sm.index + 1];
    this.show('dim', `<div class="panel">
      <p class="kicker">Wave ${sm.index + 1} survived</p><h3>${WAVES[sm.index].title}</h3>
      <p class="sub" style="margin:0">${CLEAR_LINES[sm.index % CLEAR_LINES.length]}</p>
      <ul class="tally">${sm.lines.map(([l, g]) => `<li><span>${l}</span><b>+${g}</b></li>`).join('')}
        <li><span>Slain ${sm.stats.kills} · Limbs taken ${sm.stats.severs} · Fled ${sm.stats.fled}</span><b></b></li></ul>
      <div class="btns" style="justify-content:center;margin:0"><button class="btn primary" id="next">Next: ${next.title}</button></div>
      <p class="note">Your armour stays as battered as it is. The squire patches the worst of it.</p></div>`);
    this.click('#next', () => this.on.next());
  }
  dead(world: World): void {
    const by = world.get(world.knight.lastHitBy);
    this.show('dim', `<div><h2>Sir Bleedsalot has fallen</h2>
      <p class="sub" style="margin:0 auto 6px">${DEATH_LINES[(world.tick + world.wave.index) % DEATH_LINES.length]}</p>
      ${by ? `<p class="note" style="margin-bottom:20px">Struck down by ${by.name}, with a ${by.weapon?.name.toLowerCase() ?? 'bare hand'}.</p>` : ''}
      <div class="btns" style="justify-content:center"><button class="btn primary" id="retry">Try wave ${world.wave.index + 1} again</button><button class="btn" id="quit">Retire to the title</button></div>
      <p class="note">Nothing you have earned is lost. Your kit is as it was when the wave began.</p></div>`);
    this.click('#retry', () => this.on.retry());
    this.click('#quit', () => this.on.quit());
  }
  victory(world: World): void {
    const sm = world.summary!;
    this.show('dim', `<div class="panel"><p class="kicker">Tale the First, concluded</p><h3>The Turnip Rebellion</h3>
      <p class="sub" style="margin:0">${VICTORY_LINE}</p>
      <ul class="tally">${sm.lines.map(([l, g]) => `<li><span>${l}</span><b>+${g}</b></li>`).join('')}<li><span>Purse</span><b>${world.gold}</b></li></ul>
      <div class="btns" style="justify-content:center;margin:0"><button class="btn primary" id="quit">Return to the title</button></div>
      <p class="note">Sir Vival and the armoury arrive in later milestones.</p></div>`);
    this.click('#quit', () => this.on.quit());
  }

  pause(inGame: boolean, apply: () => void): void {
    const s = this.save.settings;
    this.show('dim', `<div class="panel"><h3>${inGame ? 'Paused' : 'Settings'}</h3>
      <div class="row"><label for="vol">Volume</label><input id="vol" type="range" min="0" max="1" step="0.05" value="${s.volume}"></div>
      <div class="row"><label for="mus">Music</label><input id="mus" type="range" min="0" max="1" step="0.05" value="${s.music}"></div>
      <div class="row"><label for="sens">Camera sensitivity</label><input id="sens" type="range" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}"></div>
      <div class="row"><label for="gore">Gore</label><select id="gore">${['full', 'reduced', 'off'].map((g) => `<option ${g === s.gore ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      <div class="row"><label for="qual">Quality (applies on reload)</label><select id="qual">${['auto', 'high', 'low'].map((g) => `<option ${g === s.quality ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      <div class="row"><label for="al">Lock-on moves to the next attacker</label><input id="al" type="checkbox" ${s.autoLock ? 'checked' : ''}></div>
      <div class="row"><label for="hi">Show the controls hint</label><input id="hi" type="checkbox" ${s.hints ? 'checked' : ''}></div>
      <div class="btns" style="justify-content:center;margin:14px 0 0"><button class="btn primary" id="res">${inGame ? 'Resume' : 'Back'}</button>${inGame ? '<button class="btn" id="quit">Quit to title</button>' : ''}</div>
      <p class="note">Key rebinding arrives with the rest of the settings in Milestone 4.</p></div>`);
    const g = (id: string) => this.screen.querySelector(`#${id}`) as HTMLInputElement;
    const sync = () => {
      s.volume = +g('vol').value; s.music = +g('mus').value; s.sensitivity = +g('sens').value;
      s.gore = g('gore').value as typeof s.gore; s.quality = g('qual').value as typeof s.quality; s.autoLock = g('al').checked; s.hints = g('hi').checked;
      apply();
    };
    for (const id of ['vol', 'mus', 'sens', 'gore', 'qual', 'al', 'hi']) g(id).addEventListener('input', sync);
    this.click('#res', () => this.on.resume());
    this.click('#quit', () => this.on.quit());
  }

  // ---------------------------------------------------------------- debug panel

  private buildDebug(): void {
    const types = ['mob', 'farmhand', 'woodcutter'];
    this.debugEl.innerHTML = `<b>Debug</b> <span class="stat"></span>
      <div>Skip to wave</div><div class="g">${WAVES.map((_, i) => `<button data-c="wave" data-a="${i}">${i + 1}</button>`).join('')}</div>
      <div>Toggles</div><div class="g">${['invincible', 'hitboxes', 'scores', 'autoplay'].map((f) => `<button data-f="${f}">${f}</button>`).join('')}</div>
      <div>Spawn</div><div class="g">${types.map((t) => `<button data-c="spawn" data-a="${t}">${t}</button><button data-c="spawn10" data-a="${t}">x10</button>`).join('')}<button data-c="elite">foreman</button><button data-c="crowd">crowd of 40</button></div>
      <div>Other</div><div class="g"><button data-c="gold">+100 gold</button><button data-c="wrath">fill Wrath</button><button data-c="kit">swap mail / plate</button><button data-c="clear">clear corpses</button></div>`;
    this.debugEl.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button'); if (!b) return;
      const f = b.dataset.f as keyof UI['flags'] | undefined;
      if (f) { this.flags[f] = !this.flags[f]; b.classList.toggle('on', this.flags[f]); this.on.debug('flag'); return; }
      const a = b.dataset.a;
      this.on.debug(b.dataset.c!, a !== undefined && /^\d+$/.test(a) ? +a : a);
    });
  }
  toggleDebug(): void { this.debugOpen = !this.debugOpen; this.debugEl.classList.toggle('hidden', !this.debugOpen); }
}
