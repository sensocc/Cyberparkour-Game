# Cyberparkour — Technical Demo

[![CI](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml/badge.svg)](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml)

A low-poly, Quake-styled **first-person parkour game** set in a cyberpunk city,
in the spirit of *Mirror's Edge*.

This repository currently contains **V0.1**: a bare rooftop you can sprint,
jump and crouch across, with open edges that will kill you, a painted city
skyline behind it, and an automatic respawn. It is still a technical demo — the
parkour verbs arrive in the next versions — but it is now a place rather than an
engine skeleton.

---

## Table of contents

1. [Status](#status)
2. [What V0.1 delivers](#what-v01-delivers)
3. [Quick start](#quick-start)
4. [Controls](#controls)
5. [What you should see](#what-you-should-see)
6. [Locomotion](#locomotion)
7. [Fall detection and respawn](#fall-detection-and-respawn)
8. [The rooftop](#the-rooftop)
9. [The sky and the city](#the-sky-and-the-city)
10. [How the textures are made](#how-the-textures-are-made)
11. [Architecture](#architecture)
12. [How a frame works](#how-a-frame-works)
13. [Collision](#collision)
14. [Crash reporting](#crash-reporting)
15. [Debug HUD](#debug-hud)
16. [Testing](#testing)
17. [Continuous integration](#continuous-integration)
18. [Project layout](#project-layout)
19. [Deliberate decisions and limitations](#deliberate-decisions-and-limitations)
20. [Out of scope for V0.1](#out-of-scope-for-v01)
21. [Roadmap](#roadmap)

---

## Status

| | |
| --- | --- |
| Version | `0.1.0` |
| Stage | Pre-alpha, playable demo |
| Stack | TypeScript · three.js · Vite · Vitest |
| Runs in | Any modern desktop browser with WebGL 2 |
| Tests | 624 across 24 files |
| Coverage | ~93% of statements (of the unit-testable surface) |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

V0.1 is finished and frozen. Work on V0.2 has not started.

---

## What V0.1 delivers

Every item from the V0.1 section of the project roadmap, and where it lives:

| Feature | Where |
| --- | --- |
| A full bare rooftop with some simple objects | `src/game/level/levelData.ts` |
| PNG/flat-texture city backdrop | `tools/textures/`, `src/render/sceneBuilder.ts` |
| Simple one-colour/gradient sky | `tools/textures/generate.ts` (sky gradient), `src/render/sceneBuilder.ts` |
| Turn / Look | `src/game/look.ts`, `src/input/domInput.ts` |
| Walk | `src/game/player.ts` |
| Sprint | `src/game/player.ts`, `src/input/bindings.ts` |
| Jump | `src/game/player.ts` |
| Crouch | `src/game/player.ts` (`updateStance`) |
| Fall detection (falling off the roof is fatal) | `src/game/player.ts` (`killPlaneY`), `levelData.ts` |
| Respawn | `src/game/player.ts` (`respawnPlayer`), `src/game/game.ts` |
| Gravity | `src/game/player.ts` |
| Sprint speed difference | `src/core/config.ts` (`sprintSpeed`) |
| Crouch height change | `src/core/config.ts` (`crouchHeight`, `crouchEyeHeight`) |
| Movement speed acceleration and deceleration | `src/game/player.ts`, one tuning table in `src/core/config.ts` |

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Other commands:

```bash
npm run build        # typecheck + production bundle into dist/
npm run preview      # serve the production build
npm run typecheck    # tsc --noEmit (src, tests and tools)
npm test             # unit + integration tests, once
npm run test:coverage
npm run assets       # regenerate src/assets/textures/*.png
npm run ci           # exactly what GitHub Actions runs
```

The production build uses relative asset paths (`base: './'`), so `dist/` can be
served from any sub-path — or even opened straight from the filesystem.

---

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Move |
| Mouse | Look |
| `Shift` | Sprint (hold) |
| `Space` | Jump (hold to hop repeatedly on landing) |
| `Ctrl` or `C` | Crouch (hold) |
| `F3` (or `` ` ``) | Toggle the debug overlay |
| `Esc` | Pause (releases the mouse) |
| `R` | Restart |

Click **Start session** on the title screen to begin. The click is also what lets
the browser grant pointer lock, which is what mouse look requires.

---

## What you should see

A bare 48 × 40 m rooftop deck with **open edges** — no railings, because falling
off is now something the game handles. On it: a roof access block, a row of AC
units, a vent, a skylight, jumpable ledges, a crate stack, a pipe run, an antenna
mast, and a low service duct you can only get under while crouched.

Around and below it: a painted night skyline with lit windows wrapping the level
at 150 m, a few mid-ground tower blocks for parallax, a gradient sky that is dark
at the zenith and glows magenta at the horizon, and a ground grid far below for a
sense of scale. One directional sun casts real shadows across the deck.

---

## Locomotion

All four modes run through the same accelerator, so switching between them is
just a change of target speed. Every number lives in `src/core/config.ts`.

| Mode | Target speed | Box height | Eye height |
| --- | --- | --- | --- |
| Walk | 7.5 m/s | 1.8 m | 1.65 m |
| Sprint | 11.5 m/s | 1.8 m | 1.65 m |
| Crouch | 3.8 m/s | 1.1 m | 0.95 m |

**Sprint.** Holding Shift raises the wish speed. Because acceleration is capped
at the wish speed, letting go is enough: friction sheds the surplus and the
player settles back to exactly walking speed, with no special code for it.

**Jump.** Only possible from the ground, at 7.2 m/s upward, which gives an apex
of about 1.0 m under 26 m/s² gravity. Jump is a *held* state rather than a
one-shot: holding the key while landing jumps again. That is what players expect
and it avoids needing an input buffer. Air control is deliberately much weaker
than ground control, so a jump commits to its arc.

**Crouch.** Crouching is instant — shrinking the box can never hit anything — but
standing back up is conditional: the game tests whether a full-height box fits
where the player is, and refuses if it does not. Without that check, releasing
crouch under the duct would grow the player into the ceiling, leaving the solver
to unpick a position it cannot resolve. Feet never move; only the top of the box
and the camera drop.

**Ledges need jumping onto.** There is no step-up or mantling until V0.2, so
walking into a 0.6 m ledge stops you. The demo roof is laid out around that:
`ledge-low` is a 0.6 m step you can clear from the deck, and `ledge-mid` (1.2 m)
is only reachable by hopping up from `ledge-low`. The test suite asserts that
relationship against the configured jump apex, so retuning gravity cannot
silently make the level unplayable.

---

## Fall detection and respawn

The deck edges are open on purpose. A level declares `killPlaneY` (12 m below the
deck here); the moment the player's feet reach it, they die.

Dying does not freeze the player in mid-air. Gravity keeps pulling the body down
so the fall reads as a fall, no input is accepted, and the death cannot
re-trigger. After a 1.6 s delay the player is put back at the spawn point,
standing, with their velocity cleared. Deaths are counted and shown in the debug
overlay, and `Esc` → **Respawn** returns to the spawn point without a full
restart.

Two separate safety nets exist and are worth distinguishing:

- the level's **kill plane** is gameplay: fall past it and you die;
- the world's **emergency floor** (`safetyFloorY`) is defensive: an
  impenetrably deep guard that guarantees the simulation can never end up staring
  into the void, whatever happens to the geometry.

---

## The rooftop

The level is plain data, validated at start-up. Named landmarks the tests and
code rely on:

| Id | What it is |
| --- | --- |
| `deck` | the walkable surface, top at Y = 0, 48 × 40 m |
| `tower-body` | the building below, from Y = −34.8 up to the deck |
| `penthouse` | the roof access block, 3.2 m tall |
| `ledge-low` / `ledge-mid` / `ledge-high` | 0.6 m, 1.2 m and 1.8 m steps |
| `duct` + `duct-support-north/south` | a service duct with 1.4 m of clearance — passable only crouched |
| `crate-a/b/c` | a stack, one crate on top of another |
| `ac-unit-a…d`, `penthouse-vent`, `skylight`, `pipe-run`, `antenna-mast` | clutter |
| `tower-a/b/c` | mid-ground blocks outside the deck, for parallax |
| `city-ground` | the ground plane, far below and fogged |

Validation (`validateLevel`) rejects a level whose colliders are too thin for the
collision sub-step, whose spawn point starts inside geometry or hangs in mid-air,
whose kill plane would execute the player on sight, or whose environment has an
inverted fog range, an unparseable colour, or a backdrop that the sky dome would
clip. It runs at boot *and* in the test suite.

---

## The sky and the city

Both are **flat textures**, as the roadmap asks:

- A **gradient sky** on the inside of a 500 m sphere. The texture's vertical
  centre is the sphere's horizon, so that is where the bright magenta band sits,
  with the zenith darkening above it. The material has `fog: false` — the dome is
  further away than the fog's far plane, so with fog on it would be entirely
  fog-coloured — and `depthWrite: false`, so it is simply the backdrop.
- A **painted skyline** wrapped around an open-ended cylinder 150 m out and 150 m
  tall. The material is `MeshBasicMaterial`, because a backdrop is a painting,
  not a lit surface. Crucially the PNG carries its own **alpha**: transparent
  above the rooftops, opaque below, which is what lets the gradient sky show
  through the gaps in the skyline instead of the city sitting on a rectangle.

The skyline texture is authored so that buildings are packed edge to edge with
the last one clipped at the image boundary, which means wrapping it around the
cylinder produces no visible seam — the wrap point just looks like two
neighbouring buildings of different heights.

---

## How the textures are made

`src/assets/textures/*.png` are generated, not drawn. `tools/textures/png.ts`
contains a small, dependency-free PNG encoder (8-bit RGBA, filter type 0, one
IDAT chunk, CRCs via `node:zlib`), and `tools/textures/generate.ts` builds both
images from a seeded PRNG.

That has three consequences worth the trouble:

- **The palette lives in code.** Recolouring the city is an edit to one table,
  reviewable in a diff, rather than a binary blob nobody can read.
- **It is reproducible.** `npm run assets` regenerates exactly the same images,
  on any machine, every time.
- **It cannot silently drift.** The PNGs are committed, and
  `tests/render/textures.test.ts` decodes the committed file and compares its
  *pixels* against a freshly generated image. Comparing pixels rather than bytes
  keeps that stable across different `zlib` implementations and Node versions.

The generator is run with Node's native TypeScript stripping (Node ≥ 22.18),
which is why `tools/` imports with explicit `.ts` specifiers while `src/` — which
Vite bundles — uses the usual `.js`-for-a-`.ts`-file convention.

---

## Architecture

The codebase is split along one rule: **nothing that can be computed is allowed
to depend on the browser.**

```
core/          pure utilities: math, vectors, delta time, the loop, logging
game/physics/  AABB collision solver                     (no three.js)
game/level/    declarative level data + validation        (no three.js)
game/          player movement, look maths, the state machine
diagnostics/   crash reports, sinks, frame statistics     (no three.js)
input/         input state (pure) + DOM/pointer-lock glue
render/        the only place three.js is imported at runtime
tools/         the texture generator, run directly on Node
ui/            DOM overlays, HUD, report export
```

That is why the whole simulation, the crash reporter, the UI **and the scene
graph** can be tested in Node and jsdom. three.js scene objects are pure
JavaScript — only `WebGLRenderer` needs a GPU — so `sceneBuilder` is covered by
tests too. The only module the suite cannot reach is `render/view.ts`, which
exists precisely to own the WebGL context; that one is verified by running the
demo in a real browser.

`game.ts` does not import three.js at all: it receives a `createView` function
(see `render/types.ts`). `main.ts` is the composition root that wires the real
`GameView` in.

---

## How a frame works

```
requestAnimationFrame
        │
        ▼
GameLoop                clamps dt to 0.25 s, contains thrown errors
        │
        ▼
Game.handleFrame
        ├─ drain queued UI actions (F3 / Esc / R)
        ├─ apply accumulated mouse motion to yaw + pitch   ← once per frame
        ├─ FixedStepAccumulator.run(dt)                    ← 0..5 × 1/60 s
        │       └─ stepPlayer() → CollisionWorld.move()
        │              ├─ updates the stance (crouch / stand)
        │              ├─ applies friction, acceleration, gravity and jump
        │              ├─ sweeps the box through the level
        │              └─ checks the kill plane
        ├─ on death: show the overlay; on respawn: hide it
        ├─ FrameStats.push(dt)
        ├─ render the interpolated eye position at the stance eye height
        └─ update the HUD (throttled to 10 Hz)
```

Two details worth knowing:

- **Simulation is fixed-step, rendering is not.** Physics always advances in
  exact 1/60 s steps, so behaviour is identical on a 60 Hz and a 240 Hz display.
  The leftover fraction of a step is used to interpolate the camera position
  between the previous and current step, which removes judder.
- **The loop keeps running while paused.** Simulation, statistics and rendering
  are skipped, but the loop still ticks so the menus stay responsive and key
  handling lives in exactly one place. That is also why the respawn timer stops
  while paused — it is driven by the simulation.

---

## Collision

The player is an axis-aligned box, 0.7 m wide and between 1.1 m and 1.8 m tall
depending on stance, swept against a set of static boxes.

The solver moves the player along **one axis at a time** (X, then Z, then Y) in
sub-steps, and pushes the box back out along the axis it was travelling on when
it overlaps something. That single decision gives three properties for free:

- **Sliding.** Running into a wall at an angle keeps the tangential component,
  so the player skims along it instead of sticking.
- **No tunnelling.** Movement is sub-divided so the box can never skip past a
  collider, and the sub-step is additionally clamped to the thinnest collider in
  the level. A level author cannot accidentally create a surface you fall
  through — `validateLevel()` rejects geometry thinner than the sub-step.
- **Stable resting contact.** A hair-thin separation (`COLLISION_SKIN = 1e-3`)
  is left between the player and every surface. The solver also probes a couple
  of centimetres downwards, so "standing still" is still *grounded* — without
  which friction would never apply and the player would slide forever. A
  *rising* player is deliberately not probed: they are leaving the ground, and
  reporting them as supported there would let a jump re-trigger every step.

The same solver answers a second question for the crouch: `isFree(box)` reports
whether the taller standing box would fit where the player is, which is what
decides whether they may stand up. (Standing up is tested against `isFree`
rather than by sweeping, because growing a box in place is not a movement.)

The integration test asserts the strongest available invariant: after every
single step of a simulated minute of motion, the player box overlaps **no**
collider at all.

---

## Crash reporting

Reporting is local-only by design: reports are written to the browser's
`localStorage` and exported as a JSON file. Nothing is uploaded anywhere.

| Source | Caught by |
| --- | --- |
| `game-loop` | `GameLoop`'s error containment around every frame |
| `window-error` | `window.onerror` |
| `unhandled-rejection` | `window.onunhandledrejection` |
| `webgl-context-lost` | the canvas's `webglcontextlost` event |
| `startup` | a failure while creating the renderer |

When anything is captured, a report is built and the crash screen appears with
the error, its stack, a fingerprint, the last 80 log lines, and a snapshot of
the live game state — now including the player's stance, life state and death
count alongside position and velocity. Two buttons export it: **Download report
(.json)** and **Copy report**.

Some details that make it useful rather than decorative:

- **It survives the crash.** Reports are persisted, so after a reload the title
  screen shows a banner — "2 crash reports saved from an earlier session" — with a
  button to download them.
- **Repeat failures do not flood storage.** Reports are identified by a
  fingerprint built from the source, the error name and the *first line* of the
  message — deliberately not the stack, because line numbers change with every
  commit and would make one bug look like hundreds.
- **A broken sink cannot lose the report.** Every sink is written inside its own
  try/catch, promises are handled, and `capture()` never throws.
- **It is pluggable.** Sinks implement a two-method interface. Adding a remote
  collector later is a new class, not a rewrite.

Storage key: `cyberparkour.crash-reports.v1` (at most 10 reports).

---

## Debug HUD

Always on, toggled with `F3`, refreshed at 10 Hz so DOM layout never shows up in
the frame budget:

```
DEBUG
FPS     59.9 (16.68 ms)
WORST   16.90 ms
POS        0.00     0.01    18.03
VEL        0.00     0.00   -11.50
SPEED  11.50 m/s
GAIT    sprint
LOOK    yaw 179°  pitch -21°
STATE   grounded (deck)
DEATHS  1
FRAMES  1234 in 20.5 s
GPU     ANGLE (NVIDIA, ...)
```

`GAIT` names the locomotion mode (`idle` / `walk` / `sprint` / `crouch`), which
is how you confirm the V0.1 abilities are actually doing something, and `STATE`
names the collider the player is standing on. `DEATHS` is the fall count.

You can also poke the live game from the devtools console:

```js
cyberparkour.game.snapshot()
cyberparkour.reporter.reports
cyberparkour.logs.entries()
```

---

## Testing

```bash
npm test
```

624 tests in 24 files, in four layers:

- **Unit tests** — maths, the delta-time system, the game loop (driven by a fake
  scheduler, so no timing flakiness), the input state, the AABB helpers, the
  collision solver, movement (walk / sprint / jump / crouch), look maths, level
  validation, frame statistics, the crash reporter/sinks/report builder, the HUD
  and every screen.
- **Integration tests** (`tests/integration/simulation.test.ts`) — the real
  pipeline, level → collision world → fixed-step accumulator → player, run
  headlessly. These assert the invariants unit tests cannot see: no tunnelling,
  no sinking, no escaping the level, no lateral drift, bit-for-bit determinism
  for a scripted input, that a fall from *every* edge of the deck is fatal, and
  that the duct lets a crouched player through while stopping a standing one.
- **DOM tests** (`// @vitest-environment jsdom`) — the browser boundaries: the
  screens and their callbacks, the death overlay, report export, keyboard
  handling and the pointer-lock lifecycle.
- **Asset tests** (`tests/render/`) — the scene graph (sky, backdrop, lighting,
  disposal) and the committed textures against their generators.

A few of the tests exist because they caught real bugs during development:

- `GameLoop` could not be stopped by a fatal frame error, because inside a frame
  callback the pending handle is already null. Stopping now sets a flag.
- `clampSpeed` returned *without* clamping a non-finite velocity, letting
  `Infinity` reach the solver.
- A browser without pointer-lock support paused the game the instant it started,
  because a refused lock was being reported as a lost one.
- `serializeError` fell back to `[object Object]` for a thrown circular object.
- A toggle's "no respawn configured" default meant *respawn immediately*, which
  made death invisible and uncountable.
- `mesh.geometry` disposal in `buildScene` released the textures too, which
  would have left every session after a restart with a black sky.

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, on every pull request,
and on demand. On Node 22 and Node 24 it:

1. checks out the repository and installs with `npm ci`;
2. runs `npm run typecheck` (covering `src/`, `tests/` and `tools/`);
3. runs `npm run test:coverage`;
4. runs `npm run build:only` to prove the demo still bundles;
5. uploads the coverage report and the built `dist/` as artifacts.

`npm run ci` runs the identical sequence locally, so a green local run means a
green build. Runs in flight for the same branch are cancelled when a new push
arrives.

---

## Project layout

```
.
├── index.html                  entry document (canvas host + UI root + favicon)
├── vite.config.ts              Vite and Vitest configuration
├── tsconfig.json               strict TypeScript: src, tests and tools
├── .github/workflows/ci.yml    the CI pipeline
├── tools
│   ├── generate-textures.ts    CLI: writes the PNGs into src/assets/textures
│   └── textures
│       ├── png.ts              dependency-free PNG encoder + image helpers
│       └── generate.ts         the skyline and sky-gradient generators
└── src
    ├── main.ts                 composition root: shells, loads assets, wires up
    ├── style.css               all UI styling
    ├── assets/textures         the generated PNGs (committed)
    ├── core
    │   ├── config.ts           every tuning constant, in one table
    │   ├── delta.ts            DeltaTimer + FixedStepAccumulator
    │   ├── loop.ts             GameLoop with error containment
    │   ├── log.ts              bounded log buffer + safe serialisation
    │   ├── math.ts             clamp, lerp, damp, angle helpers
    │   ├── vec3.ts             allocation-conscious vector maths
    │   └── version.ts          build version
    ├── game
    │   ├── game.ts             the state machine: start/pause/restart/quit
    │   ├── look.ts             mouse-look maths (yaw/pitch conventions)
    │   ├── player.ts           movement, stance, fall death, respawn
    │   ├── level
    │   │   ├── levelData.ts    the demo rooftop, as plain data
    │   │   └── level.ts        validation + collision world construction
    │   └── physics
    │       ├── aabb.ts         box maths
    │       └── collision.ts    the axis-separated sweep solver
    ├── diagnostics
    │   ├── crashReport.ts      report shape and construction
    │   ├── crashReporter.ts    capture, fingerprinting, global handlers
    │   ├── crashSinks.ts       where reports go (console / memory / storage)
    │   └── stats.ts            frame-time statistics
    ├── input
    │   ├── bindings.ts         the key map
    │   ├── inputState.ts       pure input state (keys, motion, actions)
    │   └── domInput.ts         keyboard listeners + pointer lock
    ├── render
    │   ├── types.ts            GameViewLike + SceneAssets: the renderer contract
    │   ├── assets.ts           texture loading (non-fatal, injectable loader)
    │   ├── view.ts             WebGLRenderer, camera, resize, teardown
    │   └── sceneBuilder.ts     level geometry, lighting, sky dome, city backdrop
    └── ui
        ├── dom.ts              small element helpers
        ├── hud.ts              the debug overlay
        ├── screens.ts          title / pause / ended / crash + death overlay
        └── reportIO.ts         report download and clipboard export
```

---

## Deliberate decisions and limitations

**V0.0's parapet is gone.** V0.0 walled the roof in because a fall had no
consequence and no way back. Fall detection and respawn exist now, so the edges
are open and stepping off is fatal — which is the point.

**Holding jump re-jumps on landing.** A deliberate choice over a one-shot
trigger: it is what players expect from a parkour game and it removes the need
for an input buffer.

**No step-up or mantling.** Walking into a ledge stops you; you have to jump onto
it. That is V0.2's mantling, and the roof is designed around its absence.

**Crouching is instant.** The camera drops in one frame. Smoothing the stance
transition is V0.2's head bob / V0.6's "better movement feel".

**Sprint has no visual feedback yet.** No FOV kick, no head bob, no sound. It is
a speed change and nothing more until V0.2 and V0.6.

**The two painted textures opt into fog but not into lighting.** The sky dome has
fog off (it is beyond the fog's far plane) and the skyline is a `MeshBasicMaterial`
so its painted colours survive. Both are still tone-mapped with the rest of the
scene, which is why the generator's palette is authored brighter than the final
on-screen value.

**One module has no unit tests:** `render/view.ts`, which exists to own the WebGL
context. It is verified by running the demo in a real browser, which is also how
the sky, the backdrop, the shadows and context-loss handling were checked.

**The crash reporter is local-only.** Nothing is uploaded. Remote collection
would be a new `CrashSink`, and would need a privacy decision first.

**No `LICENSE` file yet.** Without one, the default is "all rights reserved".

---

## Out of scope for V0.1

The roadmap continues past this demo. Nothing below is implemented, and none of
it is stubbed:

**V0.2** environment models, skybox, mantling, pull-ups, climbing, sliding, sound
effects, background music, head bob, fall damage.

**V0.3** wall-running, wall-jumping, landing roll, vaulting, Kong vault,
checkpoints, UI and menus, multiple roofs, gaps, traversal routes.

**V0.4** neon signs, doors, interiors, surface-aware footstep sounds, pipe
climbing, a movement state machine.

**V0.5** a complete small district, elevators, emissive neon, fog and smoke,
a better skybox, collectibles, level completion, time trials.

**V0.6** feel, camera effects, animations, lighting, audio, models, UI,
optimisation, settings (sensitivity, FOV, graphics, keybinds), player model.

**V0.7** polish, and labelling the district as Level 1.

---

## Roadmap

V0.0 built the engine skeleton; V0.1 turned it into a place you can move around
and die in. The next milestone is V0.2 — the parkour verbs that make the roof a
route rather than a plane: mantling, climbing, sliding, vaulting, plus the sound
and head bob that make movement legible.
