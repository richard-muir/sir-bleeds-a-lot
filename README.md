# The Tales of Sir Bleedsalot

A browser game: a medieval knight against escalating waves of angry peasants. Grim world, dry jokes.

This is **Milestone 1 (playable core)** of the brief: one arena, one polished moveset (one-handed weapon and shield), soft targeting and lock-on, three peasant types, five waves, HUD, saving. The armoury, bosses, Smithy and the rest come in later milestones.

## Run, test, build

Needs Node 20 or newer.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # unit tests (damage, limb loss, wave generation, targeting, a full bot run)
npm run build      # typecheck, then a static site in dist/
npm run preview    # serve dist/ locally
```

`dist/` is a plain static folder with relative paths, so it can be hosted anywhere.

## Deploy

`.github/workflows/pages.yml` tests, builds and publishes to GitHub Pages on every push to the default branch.

One-time setup: in the repository's **Settings > Pages**, set **Source** to **GitHub Actions**. On the free plan, Pages needs the repository to be public.

For Netlify or similar: build command `npm run build`, publish directory `dist`.

## Controls

| Action | Keyboard and mouse | Gamepad |
| --- | --- | --- |
| Move / look | WASD / mouse | Left stick / right stick |
| Light attack | Left click | R1 |
| Heavy attack (hold to charge) | Right click | R2 |
| Block (tap just before a hit to parry) | Q, Ctrl or mouse side button | L1 |
| Dodge | Space | Circle |
| Shield bash | E | Square |
| Shield charge (one bar of Wrath) | R | Triangle |
| Finisher | F | Cross |
| Sprint | Shift | L3 |
| Lock on (flick to switch target) | Tab | R3 |
| Pause | Esc or P | Start |
| Debug panel | ` (backquote) | |

Combos: light-light-light, light-light-heavy (sweep), light-heavy (armour-breaker), sprint + light, dodge then light, parry then light (riposte).

The debug panel can skip to a wave, add gold, toggle invincibility, show hitboxes and targeting scores, spawn peasants (including a crowd of 40 for performance checks), swap between the mail and plate kits, and run an autoplay bot.

## Engine choice

Three.js, TypeScript, Vite and Rapier, as the brief suggested. The brief requires the simulation to be separate from rendering, so the engine only has to be a renderer. Three.js is the lighter option with good glTF, KTX2 and meshopt support; Babylon's built-in GUI, physics and scene tooling would sit on the wrong side of that split.

## How the code is laid out

```
src/
  sim/      Fixed-tick (60 Hz) simulation. No three.js, no DOM. Deterministic for a seed and a command stream.
    world.ts      fighters, combat resolution, waves, tokens, morale
    damage.ts     pure damage and limb-loss rules
    targeting.ts  soft-target scoring and stickiness
    ai.ts         peasant brain; outputs Commands
    waves.ts      deterministic wave generation
  data/     Everything tunable: moves, gear, peasants, waves, names, barks, tuning numbers
  input/    Devices -> actions -> Command. The only place keys and buttons are read
  render/   Scene, procedural characters, camera, gore, post-processing
  ui/       DOM overlay: title, HUD, barks, panels, debug
  audio/    Web Audio effects and placeholder music
  save/     localStorage
tests/      Vitest unit tests for the sim
public/music/   Drop-in folder for real music tracks
```

Every fighter, player or peasant, is driven by a `Command` (`src/sim/types.ts`): a move vector, a button bitmask, an aim yaw and a lock target. The local player, the AI and a future network peer all produce the same structure. Boss knights will use it too.

## How to add things

**A weapon.** Add an entry to `WEAPONS` in `src/data/gear.ts` (damage, type, reach, weight, `model`). If it needs a new look, add a builder to `src/render/models/weapons.ts`. Give it to a peasant by listing its id in that peasant's `weapons`.

**A peasant type.**
1. Add a `FighterDef` to `src/data/peasants.ts` (health, speed, morale, token cost, preferred range, `moveset`, `weapons`, `look`).
2. If it attacks differently, add a moveset to `src/data/moves.ts`. Each move names an `anim`; add that animation to `ANIMS` in `src/render/rig.ts` if it is new.
3. If it looks different, add a branch to `randomBody` / `randomHead` in `src/render/models/`.
4. If it behaves differently (not just circle, wait for a token, attack), add the behaviour to `think` in `src/sim/ai.ts`.
5. Put it in a wave in `src/data/waves.ts`.

**A wave.** Add a `WaveDef` to `src/data/waves.ts`: title, announcer line, groups of peasants, how many may attack at once, and how fast they arrive.

**Jokes.** Names, barks, death lines and finisher captions are all in `src/data/text.ts` and `src/data/moves.ts`.

**A boss knight** (Milestone 3). Bosses will be `FighterDef`s with a kit from `KITS` and the knight's moveset, driven by an AI that outputs Commands. The elite "foreman" on wave 5 already exercises the poise bar and the non-lethal finisher path that bosses need.

**Music.** Put audio files in `public/music/` and list them in `public/music/tracks.json`:

```json
{ "menu": ["court.ogg"], "fight": ["bard1.ogg", "bard2.ogg"] }
```

While the lists are empty, synthesised placeholder loops play.

## Decisions

Calls made where the brief was silent or contradicted itself.

- **Milestone 1 scope follows section 5, not the shorter list in section 10.** Dodge, parry and riposte, the full combo table, shield bash, the Wrath meter with the shield-charge special, finishers, input buffering, cancel windows, hit-stop and basic morale are all in, because they are what makes the moveset feel right. Bloodrage is not; it is the first thing to build in Milestone 2.
- **Five waves, the fifth led by an elite foreman** standing in for Sir Vival, who arrives with the boss system in Milestone 3.
- **WebGL 2 renderer for now.** Three's WebGPU renderer needs a different material and post-processing stack. It is deferred to Milestone 4 so it does not hold up combat feel.
- **Characters are sculpted in code.** `src/render/models/` holds a small modelling toolkit (`geo.ts`: lofted sections, swept tubes, displaced spheres, painted vertex colour) and the models built with it: the knight in two harnesses (`knight.ts`), peasant bodies and clothes (`peasants.ts`), faces, hair and hats (`heads.ts`), weapons and shield (`weapons.ts`). `src/render/skin.ts` bakes each figure into a few skinned meshes on one 19-bone skeleton: cloth and mail near a joint are weighted to both bones so sleeves, hose and hauberks bend, while plate stays rigid. Materials are three shared families (cloth/skin, mail, plate), each with four blood levels. Peasants mix body and head variants so a mob rarely repeats. Animation is procedural (`rig.ts`): arm IK driven by hand targets, FK legs whose stride is locked to ground speed and follows the direction of travel, springs for weight, hit flinches and head tracking. Deaths are Rapier ragdolls (`ragdoll.ts`) started from the pose at the moment of death and pushed along the killing blow. No third-party art, audio or model assets are used, so there are no asset licences to list yet. Fonts are Pirata One and IM Fell English (SIL Open Font Licence), bundled through Fontsource.
- **Model gallery.** Add `?gallery=all` to the URL (or `knight`, `plate`, `mob`, `farmhand`, `woodcutter`, `foreman`) to inspect models without a fight. Options: `rot` (degrees), `dist`, `h` (look height), `n`, `blood` (0 to 1), `break` (armour piece ids), `spin=1`, `kill=1` (drop everyone as ragdolls), `sever=armR,legL` (with `kill`).
- **Rapier drives only cosmetic physics** (severed limbs, heads, dropped weapons, ragdolls). Hits use the sim's own deterministic arc-and-reach test on a 2D plane, so the same commands always give the same fight, which future PvP needs.
- **Hit-stop lives in the simulation** (as frozen ticks) so it stays deterministic.
- **Only cuts sever limbs.** Blunt and pierce damage the limb and the health bar but leave it attached.
- **The knight's limbs can be lost too.** Losing the sword arm drops the sword; losing a leg leaves him fighting from his knees. Limbs are sewn back on between waves, and armour is patched to 40%.
- **Health is restored between waves.** With no Smithy yet, this keeps Milestone 1 fair. Armour damage carries over.
- **Block has a second binding** (Ctrl and the mouse side button) because Q shares a finger with A.
- **Gamepad lock-on fires on release of R3**, so L3 + R3 stays free for Bloodrage.
- **Farmhands cost half an attack token**, which is how "gangs up" is implemented.
- **Quality presets are Low and High for now**, picked automatically on first launch. Low drops shadows and post-processing.
- **The plate kit exists only in the debug panel**, to show the weight trade-off (slower, less stamina, no dodge, tougher) before the armoury exists.
- **All sound is synthesised** with Web Audio. Each effect is one small function to replace with a sample player later.

## Milestone 1: status

**Done**

- Fixed-tick deterministic simulation, separate from rendering and input, driven by serialisable commands.
- One-handed + shield moveset: three-hit chain, charged heavy, sweep, armour-breaker, running attack, dodge attack, parry and riposte, shield bash, shield charge, finishers with slow camera and caption.
- Feel systems: 0.25 s input buffer, cancel windows, attack magnetism, cleave, poise, hit-stop scaled by weapon weight, camera shake, blade trails.
- Soft targeting with scoring, stickiness and the attacker-first rule; hard lock-on with flick switching and auto-switch on kill; debug overlay of scores.
- Damage by type against armour per body zone; armour wear and breakage; limb loss for everyone.
- Three peasant types with distinct behaviour, attack tokens, telegraphed attacks, names, barks, morale and fleeing.
- Five data-driven waves, rewards summary, retry on death with the kit from the wave start.
- Arena, weather, fires, gore (sprays, pooling decals, severed limbs with physics, blood building up on clothes and armour), gore level setting.
- HUD with paper doll, off-screen threat markers, target plate, combo counter; title, pause and settings screens; saving.
- Debug panel and 17 unit tests.

**Rough**

- Feel has only been checked by automated runs and screenshots in a headless browser. Nobody has played it with a mouse yet. The targeting acceptance test (9 in 10 intended hits in a crowd of 20+) and the frame-rate target need a human on real hardware.
- Sound is still synthesised placeholder. Animation is procedural, not motion capture: it moves with weight but has no authored follow-through or secondary motion on cloth.
- Ragdolls do not collide with other corpses (only with the ground, the square's furniture and loose limbs), so bodies can overlap in a pile.
- The knight has no roll animation for a light kit; no light kit exists yet, so nothing uses it.
- Rapier is most of the download (1.7 MB gzipped). It now loads after the title screen; until it arrives, severed limbs vanish instead of flying and corpses fall by animation.

**Suggested balance tweaks to try first**

- Parry window (`combat.parryWindow`, 0.2 s) is generous; try 0.15 s once it has been played.
- Woodcutter charge damage is the main threat to a mail kit; if wave 3 spikes, lower `fellingAxe.damage` from 22 to 19.
- Morale shocks may empty wave 1 too quickly after a couple of dismemberments; lower `ai.moraleSever` from 0.4 to 0.3 if peasants flee too readily.
- Wrath gain may be fast enough for a shield charge every few seconds in big waves; lower `wrath.hit` from 4 to 3.
