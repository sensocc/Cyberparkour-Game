# Cyberparkour — Technical Demo

[![CI](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml/badge.svg)](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml)

A low-poly, Quake-styled **first-person parkour game** set in a cyberpunk city,
in the spirit of *Mirror's Edge*.

This repository currently contains **V0.0 — the technical demo**: the engine
skeleton the rest of the game will be built on. It is not a game yet. It is a
window that opens onto a rooftop you can walk around, with the camera, physics,
collision and diagnostics plumbing already in place and tested.

---

## Table of contents

1. [Status](#status)
2. [What V0.0 delivers](#what-v00-delivers)
3. [Quick start](#quick-start)
4. [Controls](#controls)
5. [What you should see](#what-you-should-see)
6. [Architecture](#architecture)
7. [How a frame works](#how-a-frame-works)
8. [The simulation model](#the-simulation-model)
9. [Collision](#collision)
10. [Crash reporting](#crash-reporting)
11. [Debug HUD](#debug-hud)
12. [Testing](#testing)
13. [Continuous integration](#continuous-integration)
14. [Project layout](#project-layout)
15. [Deliberate deviations and limitations](#deliberate-deviations-and-limitations)
16. [Out of scope for V0.0](#out-of-scope-for-v00)
17. [Roadmap](#roadmap)

---

## Status

| | |
| --- | --- |
| Version | `0.0.0` (V0.0 Technical Demo) |
| Stage | Pre-alpha engine skeleton |
| Stack | TypeScript · three.js · Vite · Vitest |
| Runs in | Any modern desktop browser with WebGL 2 |
| Tests | 468 across 21 files |
| Coverage | ~89% of statements (of the unit-testable surface) |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

V0.0 is finished and frozen. Work on V0.1 has not started.

---

## What V0.0 delivers

Every item from the V0.0 section of the project roadmap, and where it lives:

| Feature | Where |
| --- | --- |
| Window with the 3D game opening | `index.html`, `src/ui/screens.ts` (title screen) |
| A basic game loop | `src/core/loop.ts` |
| A delta time system | `src/core/delta.ts` |
| Automatic error/crash reporting | `src/diagnostics/*`, `src/ui/screens.ts` (crash screen) |
| First-person camera | `src/render/view.ts` |
| Mouse look | `src/input/domInput.ts`, `src/game/look.ts` |
| WASD movement | `src/input/inputState.ts`, `src/game/player.ts` |
| Basic 3D rendering | `src/render/sceneBuilder.ts` |
| Basic colours | `src/game/level/levelData.ts` |
| Basic directional lighting | `src/render/sceneBuilder.ts` |
| Basic collision physics | `src/game/physics/*` |
| Simple roof | `src/game/level/levelData.ts` |
| Simple objects | `src/game/level/levelData.ts` |
| Cleanly close the game or restart it | `src/game/game.ts` (`restart`, `quit`) |
| Basic debug data (FPS, velocity, coordinates) | `src/ui/hud.ts` |

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
npm run typecheck    # tsc --noEmit (src and tests)
npm test             # unit + integration tests, once
npm run test:watch   # tests in watch mode
npm run test:coverage
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
| `F3` (or `` ` ``) | Toggle the debug overlay |
| `Esc` | Pause (releases the mouse) |
| `R` | Restart |

Click **Start session** on the title screen to begin. The click is also what
lets the browser grant pointer lock, which is what mouse look requires.

---

## What you should see

A rooftop: a 34 × 30 m deck ringed by a low parapet, a few dark tower blocks
standing around it, AC units, a vent stack, a roof hatch, a low block, a small
step, a stacked crate cluster, and a ground grid far below for a sense of scale.
One directional sun casts real shadows across the deck, and everything fades
into fog at the horizon.

The **start screen**, **pause menu**, **ended screen** and **crash screen** are
all real DOM overlays with real buttons, so the demo is keyboard-navigable.

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
render/        the only place three.js is imported
ui/            DOM overlays, HUD, report export
```

That is why the whole simulation, the crash reporter and the UI can be tested in
Node and jsdom with no WebGL anywhere. Consequently the only source that the
test suite does not reach is the part that genuinely needs a GPU
(`render/sceneBuilder.ts`, `render/view.ts`) plus the composition root
(`main.ts`), which is exercised by running the demo instead.

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
        ├─ FrameStats.push(dt)
        ├─ render the interpolated eye position
        └─ update the HUD (throttled to 10 Hz)
```

Two details worth knowing:

- **Simulation is fixed-step, rendering is not.** Physics always advances in
  exact 1/60 s steps, so behaviour is identical on a 60 Hz and a 240 Hz display.
  The leftover fraction of a step is used to interpolate the camera position
  between the previous and current step, which removes judder.
- **The loop keeps running while paused.** Simulation, statistics and rendering
  are skipped, but the loop still ticks so the menus stay responsive and key
  handling lives in exactly one place. A paused frame costs nothing measurable.

---

## The simulation model

Movement is the classic *Quake* model, because it is the foundation the later
parkour mechanics need:

1. Build a wish direction from the input, rotated by the camera yaw.
2. Apply ground friction.
3. Accelerate, capped so the wish speed can never be exceeded.
4. Integrate gravity.
5. Sweep the player box through the collision world.

Because step 3 is capped, the player settles at **exactly** the walk speed
(7.5 m/s) rather than oscillating around it, and reversing direction feels
responsive without being instant. Air acceleration is much weaker than ground
acceleration, which is what will make air control feel right once jumping lands
in V0.1.

All tuning lives in one table — `src/core/config.ts`. Nothing else hard-codes a
constant.

---

## Collision

The player is an axis-aligned box (0.7 m wide, 1.8 m tall) swept against a set
of static boxes.

The solver moves the player along **one axis at a time** (X, then Z, then Y) in
sub-steps, and pushes the box back out along the axis it was travelling on when
it overlaps something. That single decision gives three properties for free:

- **Sliding.** Running into a wall at an angle keeps the tangential component,
  so the player skims along it instead of sticking.
- **No tunnelling.** Movement is sub-divided so the box can never skip past a
  collider, and the sub-step is additionally clamped to the thinnest collider in
  the level. A level author cannot accidentally create a surface you fall
  through — `validateLevel()` rejects geometry thinner than the sub-step at
  start-up and in the test suite.
- **Stable resting contact.** A hair-thin separation (`COLLISION_SKIN = 1e-3`)
  is left between the player and every surface. The solver also probes a couple
  of centimetres downwards, so "standing still" is still *grounded* — without
  which friction would never apply and the player would slide forever.

The integration test asserts the strongest available invariant: after every
single step of a simulated minute of motion, the player box overlaps **no**
collider at all.

---

## Crash reporting

Reporting is local-only by design: reports are written to the browser's
`localStorage` and exported as a JSON file. Nothing is uploaded anywhere.

Three capture paths feed one reporter:

| Source | Caught by |
| --- | --- |
| `game-loop` | `GameLoop`'s error containment around every frame |
| `window-error` | `window.onerror` |
| `unhandled-rejection` | `window.onunhandledrejection` |
| `webgl-context-lost` | the canvas's `webglcontextlost` event |
| `startup` | a failure while creating the renderer |

When anything is captured, a report is built and the crash screen appears with
the error, its stack, a fingerprint, the last 80 log lines, and a snapshot of
the live game state (level, frame count, FPS, and the player's exact position
and velocity). Two buttons export it: **Download report (.json)** and
**Copy report**.

Some details that make it useful rather than decorative:

- **It survives the crash.** Reports are persisted, so after a reload the title
  screen shows a banner — "2 crash reports saved from an earlier session" — with
  a button to download them. A crash the player never reported still reaches you.
- **Repeat failures do not flood storage.** Reports are identified by a
  fingerprint built from the source, the error name and the *first line* of the
  message — deliberately not the stack, because line numbers change with every
  commit and would make one bug look like hundreds. A repeat replaces its stored
  entry and increments an occurrence counter.
- **A broken sink cannot lose the report.** Every sink is written inside its own
  try/catch, promises are handled, and `capture()` never throws. The same goes
  for the state/environment providers: if collecting context fails, the report
  is still produced with placeholders.
- **It is pluggable.** Sinks implement a two-method interface
  (`src/diagnostics/crashSinks.ts`). Adding a remote collector later is a new
  class, not a rewrite.

Storage key: `cyberparkour.crash-reports.v1` (at most 10 reports). In a browser
where `localStorage` is unavailable, the sink falls back to memory
automatically.

---

## Debug HUD

Always on, toggled with `F3`, refreshed at 10 Hz so DOM layout never shows up in
the frame budget:

```
DEBUG
FPS     59.9 (16.68 ms)
WORST   16.90 ms
POS        0.00     0.00    11.00
VEL        0.00     0.00    -7.50
SPEED   7.52 m/s
LOOK    yaw -12°  pitch -3°
STATE   grounded (roof-deck)
FRAMES  1234 in 20.5 s
GPU     ANGLE (NVIDIA, ...)
```

`STATE` names the collider the player is standing on, which makes collision bugs
immediately obvious rather than mysterious.

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

468 tests in 21 files, in three layers:

- **Unit tests** — maths, the delta-time system, the game loop (driven by a fake
  scheduler, so no timing flakiness), the input state, the AABB helpers, the
  collision solver, movement, look maths, level validation, frame statistics,
  the crash reporter/sinks/report builder, the HUD and every screen.
- **Integration tests** (`tests/integration/simulation.test.ts`) — the real
  pipeline, level → collision world → fixed-step accumulator → player, run
  headlessly. These assert the invariants unit tests cannot see: no tunnelling,
  no sinking, no escaping the level, no lateral drift, and bit-for-bit
  determinism for a scripted input.
- **DOM tests** (`// @vitest-environment jsdom`) — the browser boundaries: the
  screens and their callbacks, report export, keyboard handling and the pointer
  lock lifecycle.

A few of the tests exist because they caught real bugs during development:

- `GameLoop` could not be stopped by a fatal frame error, because inside a frame
  callback the pending handle is already null. Stopping now sets a flag.
- `clampSpeed` returned *without* clamping a non-finite velocity, letting
  `Infinity` reach the solver.
- A browser without pointer-lock support paused the game the instant it started,
  because a refused lock was being reported as a lost one.
- `serializeError` fell back to `[object Object]` for a thrown circular object.

The simulation is deliberately dependency-free, which is what makes these tests
possible. `tests/helpers/` holds the two shared fakes (a frame scheduler and a
log observer); `tests/setup.ts` silences the logger's console mirror so test
output stays readable.

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, on every pull request,
and on demand. On Node 22 and Node 24 it:

1. checks out the repository and installs with `npm ci`;
2. runs `npm run typecheck` (which covers the tests as well as `src/`);
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
├── tsconfig.json               strict TypeScript, src and tests
├── .github/workflows/ci.yml    the CI pipeline
└── src
    ├── main.ts                 composition root: builds and wires everything
    ├── style.css               all UI styling
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
    │   ├── player.ts           movement integration
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
    │   ├── inputState.ts       pure input state (held keys, motion, actions)
    │   └── domInput.ts         keyboard listeners + pointer lock
    ├── render
    │   ├── types.ts            GameViewLike - the renderer contract
    │   ├── view.ts             WebGLRenderer, camera, resize, teardown
    │   └── sceneBuilder.ts     builds the three.js scene from level data
    └── ui
        ├── dom.ts              small element helpers
        ├── hud.ts              the debug overlay
        ├── screens.ts          title / pause / ended / crash screens
        └── reportIO.ts         report download and clipboard export
```

---

## Deliberate deviations and limitations

Two decisions in V0.0 were made specifically to keep the demo usable, and both
are worth knowing about:

**The roof is ringed by a parapet.** Fall detection and respawn are V0.1
features, and there is no jump yet either — so an unguarded edge would drop the
player onto the ground with no way back up, ending the demo. The parapet is also
what a real roof looks like. V0.1 will open an edge and add the fall/death path.

**Movement already uses acceleration and friction.** V0.1 lists "basic movement
speed acceleration and deceleration" as a feature, but the movement model cannot
be retrofitted onto instant-velocity movement without rewriting it. V0.0 ships
the physics model with fixed tuning; V0.1 is where it gets *tuned* alongside
sprint, crouch and jump.

Also by design:

- **No audio, no textures, no skybox, no animations.** Colours and one
  directional light only, exactly as scoped.
- **No jump, sprint, crouch or fall damage.** All V0.1.
- **A safety floor exists** (`config.world.safetyFloorY`) purely to guarantee
  the demo cannot end up staring into the void. It is a defensive guard, not a
  gameplay system.
- **The two WebGL modules are not unit-tested** (`render/view.ts`,
  `render/sceneBuilder.ts`): jsdom has no WebGL implementation. They are
  verified by running the demo in a real browser instead, which is how the
  render path, the resize handling, the shadow setup and the context-loss
  handling were checked.
- **The crash reporter is local-only.** Nothing is uploaded. Remote collection
  would be a new `CrashSink`, and would need a privacy decision first.
- **No `LICENSE` file yet.** Without one, the default is "all rights reserved".

---

## Out of scope for V0.0

The roadmap continues past this demo. Nothing below is implemented, and none of
it is stubbed:

**V0.1** bare rooftop with objects, city backdrop, sky, walk/sprint/jump/crouch,
fall detection, respawn, gravity, movement feel.

**V0.2** environment models, skybox, mantling, pull-ups, climbing, sliding,
sound effects, music, head bob, fall damage.

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

V0.0 is complete. The next milestone is V0.1 — a full bare rooftop, a proper city
backdrop, and the first real movement verbs (jump, sprint, crouch), together
with fall detection and respawn to make the roof edges meaningful.
