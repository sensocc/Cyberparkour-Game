# Cyberparkour — Technical Demo

[![CI](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml/badge.svg)](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml)

A low-poly, Quake-styled **first-person parkour game** set in a cyberpunk city,
in the spirit of *Mirror's Edge*.

This repository currently contains **V0.2**: a 72 × 60 m rooftop with two stacked
terraces, mantle-able steps, grab-able ledges, a climbable riser pipe, a duct you
can only slide under, textures on everything, a cube skybox, procedurally
synthesised sound, and fall damage. It is the first version that feels like a
parkour game rather than a walking simulator.

---

## Table of contents

1. [Status](#status)
2. [What V0.2 delivers](#what-v02-delivers)
3. [Quick start](#quick-start)
4. [Controls](#controls)
5. [What you should see](#what-you-should-see)
6. [Locomotion](#locomotion)
7. [The manoeuvre bands](#the-manoeuvre-bands)
8. [Roof verticality](#roof-verticality)
9. [Fall damage and health](#fall-damage-and-health)
10. [Models and surfaces](#models-and-surfaces)
11. [The skybox](#the-skybox)
12. [Sound](#sound)
13. [How the textures are made](#how-the-textures-are-made)
14. [Architecture](#architecture)
15. [How a frame works](#how-a-frame-works)
16. [Collision](#collision)
17. [Crash reporting](#crash-reporting)
18. [Debug HUD](#debug-hud)
19. [Testing](#testing)
20. [Continuous integration](#continuous-integration)
21. [Project layout](#project-layout)
22. [Deliberate decisions and limitations](#deliberate-decisions-and-limitations)
23. [Out of scope for V0.2](#out-of-scope-for-v02)
24. [Roadmap](#roadmap)

---

## Status

| | |
| --- | --- |
| Version | `0.2.0` |
| Stage | Pre-alpha, playable demo |
| Stack | TypeScript · three.js · Vite · Vitest |
| Runs in | Any modern desktop browser with WebGL 2 and Web Audio |
| Tests | 727 across 27 files |
| Coverage | ~94% of statements (of the unit-testable surface) |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

V0.2 is finished and frozen. Work on V0.3 has not started.

---

## What V0.2 delivers

Every item from the V0.2 section of the project roadmap, and where it lives:

| Feature | Where |
| --- | --- |
| Simplistic models for roof environment (vents, pipes, AC units, blocks, boxes, ledges, other architecture) | `src/game/level/models.ts`, `sceneBuilder.ts` |
| Simplistic object textures | `tools/textures/surfaces.ts`, `src/game/level/surfaces.ts` |
| Roof verticality | `levelData.ts` (terraces, stairs, penthouse), `player.ts` (mantle / pull-up / climb) |
| Bigger roof | `levelData.ts` — 48 × 40 m became 72 × 60 m |
| Skybox | `tools/textures/skybox.ts`, `src/render/assets.ts`, `sceneBuilder.ts` |
| Mantling | `player.ts` (`tryMantle`), `physics/ledges.ts` |
| Pull-ups | `player.ts` (`tryGrab`, `stepHanging`) |
| Climbing | `player.ts` (`tryClimb`, `stepClimbing`), `ColliderKind: 'climbable'` |
| Sliding | `player.ts` (`updateSlide`, `applySteering`) |
| Basic sound effects for walking, sprinting, sliding, falling | `src/audio/synth.ts`, `src/audio/director.ts` |
| Basic background music | `src/audio/synth.ts` (`renderMusic`) |
| Head bobs | `player.ts` (`advanceHeadBob`, `headBobOffset`) |
| Fall damage | `player.ts` (`applyLanding`), `config.ts` (`fallDamage`) |

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
| `Space` | Jump; also hauls you up while hanging |
| `Ctrl` or `C` | Crouch; at speed, starts a slide |
| `W` into a ledge | Mantle (automatic) |
| `F3` (or `` ` ``) | Toggle the debug overlay |
| `M` | Mute |
| `Esc` | Pause (releases the mouse) |
| `R` | Restart |

Click **Start session** on the title screen to begin. That click is also what lets
the browser grant pointer lock — and what lets it start an audio context.

---

## What you should see

A textured tread-plate deck with **open edges**, furnished with ribbed crates,
fan-fronted AC units, louvred vents, skylights, cable spools, water tanks,
satellite dishes, junction boxes, barriers and an antenna mast — all built from
multi-part models rather than single boxes.

Two stacked terraces rise 2 m and 4.2 m in the north-east, with a flight of 0.5 m
steps up the near side. A roof access block sits in the north-west with its own
0.6 m steps and a climbable riser pipe beside it. Ledges at 0.6, 1.2 and 2.4 m
step the difficulty up. A service duct hangs 1.4 m above the deck: walk into it
and you stop, slide under it and you pass.

Above it all, a six-face **cube skybox** — dark at the zenith, glowing magenta at
the horizon — and a painted city skyline wrapped around the level with lit windows
showing through the gaps between buildings.

---

## Locomotion

Six modes share one accelerator, so switching between them is just a change of
target speed. Every number lives in `src/core/config.ts`.

| Mode | Target speed | Box height | Eye height |
| --- | --- | --- | --- |
| Walk | 7.5 m/s | 1.8 m | 1.65 m |
| Sprint | 11.5 m/s | 1.8 m | 1.65 m |
| Crouch | 3.8 m/s | 1.1 m | 0.95 m |
| Slide | entry speed × 1.12 | 1.1 m | 0.95 m |

**Sprint.** Holding Shift raises the wish speed. Because acceleration is capped at
the wish speed, letting go is enough: friction sheds the surplus and the player
settles back to exactly walking speed, with no special code for it.

**Jump.** Only from the ground, at 7.2 m/s upward, for an apex of about 1.0 m
under 26 m/s² gravity. Jump is a *held* state rather than a one-shot, so holding
it while landing jumps again — which is what players expect and avoids needing an
input buffer.

**Crouch.** Instant to enter (shrinking the box cannot hit anything), but standing
up is conditional on `CollisionWorld.isFree`, so releasing crouch under the duct
does not grow the player into the ceiling. Feet never move; only the top of the
box and the camera drop.

**Slide.** Crouching *while running* — above 6.5 m/s — starts a slide: a crouched
pose with its own much lower friction, kicked off with a 12% speed boost so it is
briefly faster than a sprint. Steering bends the direction without adding speed.
It ends on its own once friction has bled it below 2.6 m/s, or after 2.6 seconds,
or when the crouch key is released. Because a slide keeps the crouch height, it is
also how you get under the duct at speed.

**Head bob.** The phase is advanced by *distance travelled*, not by time, so the
cadence rises with speed without needing a timer and is identical at any frame
rate. Two vertical bobs per stride (one per foot) and one lateral sway, fading in
and out with a `damp` so stopping does not snap the camera.

---

## The manoeuvre bands

Mantling, pull-ups and climbing all ask the same question — "is there a face I
could get up, and is there room to stand on top of it?" — so they share one probe
(`findLedge` in `src/game/physics/ledges.ts`). What differs is which *height band*
each ability accepts, and that is the whole design:

| Situation | Ledge height above the feet | Result |
| --- | --- | --- |
| Grounded | 0.4 – 1.4 m | **Mantle** — automatic, no key needed |
| Grounded | above 1.4 m | blocked; you have to jump |
| Airborne | 1.4 – 2.6 m | **Grab** — catch it and hang |
| Hanging | `Space` (pressed *after* releasing) | **Pull-up** onto the top |
| Facing a tagged face, holding forward | any height > 1.6 m | **Climb** at 2.4 m/s |

The bands do not overlap, which is what keeps the three abilities distinct rather
than one doing all the work: a ledge you can step onto is mantled, a ledge you can
only just reach is grabbed, and a face taller than a jump and a grab together is
climbed. Reachability of every ledge on the roof is a *consequence* of these
numbers, so the level tests assert the relationships rather than the heights —
retuning gravity cannot silently make a route impossible.

Two details that matter:

- **Mantling is automatic** when you walk into a low ledge, which is what makes the
  staircase work: each 0.5 m riser is inside the mantle band, so holding forward
  walks you up a flight of stairs with no input beyond a direction.
- **A hang needs a fresh jump press.** The press that got you to the ledge is
  latched, so you have to release and press again to haul up. Without that you
  would grab and pull up in consecutive steps and never see the hang at all.

---

## Roof verticality

The roof was flat in V0.1. It now has four usable levels, reachable in more than
one way each:

| Height | What | Reachable by |
| --- | --- | --- |
| 0 m | the deck | — |
| 0.6 – 1.2 m | `ledge-low`, `ledge-mid` | walking into them (mantle) |
| 1.4 m | a crate | walking into it (mantle) |
| 2.0 m | first terrace | jump + grab, or the 0.5 m stair flight, or the crate |
| 2.4 m | `ledge-high` | jump + grab |
| 2.8 m | the crate stack | pull-up from the 1.4 m crate |
| 3.8 m | the penthouse roof | the 0.6 m stair flight, or a pull-up from a crate |
| 4.2 m | second terrace | jump + grab from the first terrace |
| 6 m | the riser pipe top | climbing |

Climbing is the only way to something a pull-up cannot reach, which is what keeps
it from being redundant.

---

## Fall damage and health

Landing hurts above 12 m/s of impact — a free fall of about 2.8 m — and is fatal
at 26 m/s, about 13 m. Damage scales linearly between the two, so a 6 m drop costs
about 30 health and a 9.5 m drop about 53. Death from impact is reported to the
game exactly like a fall off the level, so it gets the same overlay and respawn;
the overlay's wording differs (`YOU DIED` rather than `YOU FELL`).

Three things are worth knowing:

- **There is no health regeneration.** It is not on the roadmap, so inventing a
  rule for it would be scope creep. A `Respawn` restores full health, and so does
  dying — which is a discoverable way out, and all a technical demo needs.
- **The level's kill plane still wins.** A fall off the roof reaches −12 m long
  before it reaches the ground, so roof falls are always fatal. Fall damage is for
  the drops *inside* the level: off a terrace, off the penthouse, off the mast.
- **Landings do not count while mantling or climbing**, because those reset the
  fall tracker — being hauled up a wall is not a fall.

Feedback for a damaging landing is a brief red vignette and a hurt sound. The
health *bar* is V0.3's UI work; the debug overlay shows the number.

---

## Models and surfaces

Every prop is an instance of a model from `src/game/level/models.ts` — twenty of
them, from a two-box `crate` to a ten-part `pipe-vertical`. V0.1's props were
single boxes.

Parts are expressed in **normalised** coordinates: `[0, 1]` across the prop's own
bounding box, with `y` from its underside to its top. That one decision means any
model fits any prop size, so the same `ac-unit` works at 3 × 1.7 × 2.4 m and a
`slab` works for a 72 m deck and a 0.4 m barrier. A part may exceed `[0, 1]`, which
is how detail is added that deliberately overhangs the collider.

**Collision stays the prop's box.** The parts are surface detail — inset grilles,
flush trim, overhanging lips — and a box is the right approximation for all of
them. This also means the change is purely visual: every V0.1 collision test still
holds, byte for byte, which is exactly what happened.

Each part names a **surface**, and a prop may recolour any of them:

```
{ id: 'metal', texture: 'metal-panel', tint: '#67717f', metresPerTile: 2 }
```

The detail maps are authored *light* on purpose, because `tint × map` should read
as the tint: the tint is the albedo and the map is only the detail on top. Twelve
surfaces cover the roof, and one model serving four differently-tinted AC units is
the point of the indirection.

---

## The skybox

V0.1's sky was a gradient stretched over a sphere. V0.2 replaces it with a real
**six-face cube skybox**, built by evaluating a single function of direction:

```
skyColorAt(direction) -> colour
```

Each face is then just that function sampled over the directions its texels point
at, using the standard OpenGL cube map mapping. This is what makes the seams
disappear for free — two neighbouring faces agree along their shared edge because
the edge's texels point the same way on *both* — and it also makes the whole thing
testable: a test samples a face's pixels and compares them against the function
evaluated at the same directions.

The sky itself is a four-stop elevation gradient, dark at the zenith and glowing
magenta at the horizon, with a cloud band whose modulation is a sum of sines of the
*azimuth*. Azimuth wraps, so the pattern is continuous all the way around and the
faces stay seamless by construction.

A cube skybox needs no geometry at all: it is simply `scene.background`, which
three.js renders without fog and without lighting. If the textures are missing it
falls back to a flat colour.

---

## Sound

There are no audio files. Both the effects and the music are synthesised from
scratch into plain `Float32Array`s at 48 kHz — the same trick the textures use, so
the "palette" lives in code, is reviewable, and cannot drift from what ships.

- **`src/audio/synth.ts`** is the synthesiser: one-pole filters, envelopes, noise,
  and the note generators. Pure functions from parameters to samples.
- **`src/audio/director.ts`** decides *what* to play. It is pure too: it watches the
  player and emits cues. The footstep cadence is driven by distance travelled, so
  a sprint steps faster than a walk without a timer; the wind is a continuous level
  that follows falling speed and drops the instant you catch a ledge.
- **`src/audio/engine.ts`** is the only Web Audio code: it builds the buffers once
  and plays them. A browser that refuses an audio context, or throws on playback,
  degrades to `SilentAudio` rather than breaking the game. `M` mutes.

The music is a 16-second bar-aligned loop: a bass pulse on each beat, a sustained
detuned pad, a soft kick on one and three, and a quiet tick on the off-beats. The
seam is silent rather than a click, because every voice decays well before the
loop point.

**I cannot judge how it sounds.** Everything is verified numerically — length,
peak, RMS, DC offset, determinism, that a sprint step is longer than a crouched
one, that a gust swells and dies — but taste is not testable. All the parameters
are in one place if the balance needs adjusting.

---

## How the textures are made

`src/assets/textures/*.png` are generated, not drawn. `tools/textures/png.ts`
contains a small, dependency-free PNG encoder (8-bit RGBA, filter type 0, one IDAT
chunk, CRCs via `node:zlib`); the generators build a 2048 × 512 skyline, six
skybox faces and six tileable object surfaces from a seeded PRNG.

That has three consequences worth the trouble:

- **The palette lives in code.** Recolouring the city is an edit to one table,
  reviewable in a diff, rather than a binary blob nobody can read.
- **It is reproducible.** `npm run assets` regenerates exactly the same images, on
  any machine, every time.
- **It cannot silently drift.** The PNGs are committed, and
  `tests/render/textures.test.ts` decodes each committed file and compares its
  *pixels* against a freshly generated image. Comparing pixels rather than bytes
  keeps that stable across different `zlib` implementations and Node versions.

The generator runs with Node's native TypeScript stripping (Node ≥ 22.18), which is
why `tools/` imports with explicit `.ts` specifiers while `src/` — which Vite
bundles — uses the usual `.js`-for-a-`.ts`-file convention. The surface *ids and
tile sizes* live in `src/` (the renderer needs them at runtime) and a test asserts
the two agree.

---

## Architecture

The codebase is split along one rule: **nothing that can be computed is allowed to
depend on the browser.**

```
core/          pure utilities: math, vectors, randomness, delta time, loop, logging
game/physics/  AABB collision solver + ledge probing          (no three.js)
game/level/    declarative level data, models, surfaces, validation
game/          player movement (six modes), look maths, the state machine
audio/         synthesiser + cue director (pure); Web Audio playback
diagnostics/   crash reports, sinks, frame statistics          (no three.js)
input/         input state (pure) + DOM/pointer-lock glue
render/        the only place three.js is imported at runtime
tools/         the texture generator, run directly on Node
ui/            DOM overlays, HUD, report export
```

That is why the whole simulation, the audio synthesiser, the crash reporter, the UI
**and the scene graph** can be tested in Node and jsdom. three.js scene objects are
pure JavaScript — only `WebGLRenderer` needs a GPU — so `sceneBuilder` is covered
by tests too. The only module the suite cannot reach is `render/view.ts`, which
exists precisely to own the WebGL context; that one is verified by running the demo
in a real browser.

`game.ts` does not import three.js at all: it receives a `createView` function and
an `AudioOutput`. `main.ts` is the composition root that wires the real ones in.

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
        ├─ drain queued UI actions (F3 / M / Esc / R)
        ├─ apply accumulated mouse motion to yaw + pitch   ← once per frame
        ├─ FixedStepAccumulator.run(dt)                    ← 0..5 × 1/60 s
        │       └─ stepPlayer()  ← the mode priority chain:
        │              dead → mantling → hanging → climbing → sliding → ordinary
        │              (each reports started / ended / landing events)
        ├─ play the audio cues those steps produced
        ├─ FrameStats.push(dt)
        ├─ render the interpolated eye position, stance height and head bob
        └─ update the HUD (throttled to 10 Hz)
```

Two details worth knowing:

- **Simulation is fixed-step, rendering is not.** Physics always advances in exact
  1/60 s steps, so behaviour is identical on a 60 Hz and a 240 Hz display. The
  leftover fraction of a step interpolates the camera between the previous and
  current step, which removes judder.
- **The loop keeps running while paused.** Simulation, statistics, rendering and
  audio are all skipped, but the loop still ticks so the menus stay responsive and
  key handling lives in exactly one place. That is why the respawn timer stops while
  paused — it is driven by the simulation.

---

## Collision

The player is an axis-aligned box, 0.7 m wide and between 1.1 m and 1.8 m tall
depending on stance, swept against a set of static boxes.

The solver moves the player along **one axis at a time** (X, then Z, then Y) in
sub-steps, and pushes the box back out along the axis it was travelling on when it
overlaps something. That single decision gives three properties for free:

- **Sliding.** Running into a wall at an angle keeps the tangential component, so
  the player skims along it instead of sticking.
- **No tunnelling.** Movement is sub-divided so the box can never skip past a
  collider, and the sub-step is additionally clamped to the thinnest collider in
  the level. A level author cannot accidentally create a surface you fall through —
  `validateLevel()` rejects geometry thinner than the sub-step.
- **Stable resting contact.** A hair-thin separation (`COLLISION_SKIN = 1e-3`) is
  left between the player and every surface. The solver also probes a couple of
  centimetres downwards, so "standing still" is still *grounded* — without which
  friction would never apply. A *rising* player is deliberately not probed: they
  are leaving the ground, and reporting them as supported there would let a jump
  re-trigger every step.

The same solver answers the crouch's question (`isFree`), and the ledge probe is
built on top of it: `findLedge` shifts the player's box forward, finds a collider
whose top is inside the requested band, and then asks the world whether a
standing player would fit on top of it. That last check is what stops the game from
starting a mantle into a space with no room for the body it is about to move there.

The integration test asserts the strongest available invariant: after every single
step of a simulated minute of motion, the player box overlaps **no** collider —
except mid-manoeuvre, where passing through the volume being climbed is the point.

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

When anything is captured, a report is built and the crash screen appears with the
error, its stack, a fingerprint, the last 80 log lines, and a snapshot of the live
game state — now including health, death count, death cause and locomotion mode
alongside position and velocity. Two buttons export it: **Download report (.json)**
and **Copy report**.

Some details that make it useful rather than decorative:

- **It survives the crash.** Reports are persisted, so after a reload the title
  screen shows a banner with a button to download them.
- **Repeat failures do not flood storage.** Reports are identified by a fingerprint
  built from the source, the error name and the *first line* of the message —
  deliberately not the stack, because line numbers change with every commit.
- **A broken sink cannot lose the report.** Every sink is written inside its own
  try/catch, promises are handled, and `capture()` never throws.
- **It is pluggable.** Sinks implement a two-method interface.

Storage key: `cyberparkour.crash-reports.v1` (at most 10 reports).

---

## Debug HUD

Always on, toggled with `F3`, refreshed at 10 Hz so DOM layout never shows up in
the frame budget:

```
DEBUG
FPS     59.9 (16.68 ms)
WORST   16.90 ms
POS        0.00     0.01   -12.65
VEL        0.00     0.00     0.00
SPEED   0.00 m/s
GAIT    idle
HEALTH  ########## 100
LOOK    yaw 179°  pitch -21°
STATE   HANGING
DEATHS  1
FRAMES  1234 in 20.5 s
GPU     ANGLE (NVIDIA, ...)
```

`GAIT` names the walking mode (`idle` / `walk` / `sprint` / `crouch`), `HEALTH` is
a bar, and `STATE` names the locomotion mode — `grounded (deck)`, `airborne`,
`MANTLING`, `PULL-UP`, `HANGING`, `CLIMBING`, `SLIDING`, `DEAD`. Those two rows are
how you confirm the movement abilities are doing anything at all.

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

727 tests in 27 files, in four layers:

- **Unit tests** — maths, the delta-time system, the game loop (driven by a fake
  scheduler), the input state, the AABB helpers, the collision solver, all six
  movement modes and their transitions, ledge probing, look maths, models, level
  validation, frame statistics, the crash reporter/sinks/report builder, the audio
  synthesiser and director, the HUD and every screen.
- **Integration tests** (`tests/integration/simulation.test.ts`) — the real
  pipeline, level → collision world → fixed-step accumulator → player, run
  headlessly *on the roof that ships*. They assert the invariants unit tests cannot
  see: no tunnelling, no sinking, no escaping the level, determinism, that a fall
  from every edge is fatal, and that mantling, pull-ups and sliding all work on the
  real geometry.
- **DOM tests** (`// @vitest-environment jsdom`) — the browser boundaries: the
  screens and their callbacks, the death overlay, the damage flash, report export,
  keyboard handling and the pointer-lock lifecycle.
- **Asset tests** (`tests/render/`) — the scene graph (skybox, backdrop, lighting,
  materials, UV scaling, disposal) and the committed textures against their
  generators.

Nine tests exist because they caught real bugs during development:

- `GameLoop` could not be stopped by a fatal frame error, because inside a frame
  callback the pending handle is already null. Stopping now sets a flag.
- `clampSpeed` returned *without* clamping a non-finite velocity, letting
  `Infinity` reach the solver.
- A browser without pointer-lock support paused the game the instant it started,
  because a refused lock was being reported as a lost one.
- `serializeError` fell back to `[object Object]` for a thrown circular object.
- A "no respawn configured" default meant *respawn immediately*, which made death
  invisible and uncountable.
- `buildScene` disposed textures it borrowed, which would have left every session
  after a restart with a bare sky.
- The landing box for a mantle sat exactly on the ledge top, so rounding decided
  whether it overlapped by 1e-16 — and a strict overlap test read that as "no room
  to stand". Some ledges were unmantleable depending on nothing but the height's
  last bit. It now lands one collision skin above, as the solver would.
- Grabbing a ledge snapped *both* horizontal axes to the collider's corner, which
  on a 20 m terrace teleported the player 8 m sideways.
- Deaths from fall damage were never reported to the game, so they got no overlay
  and no respawn.

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, on every pull request, and
on demand. On Node 22 and Node 24 it:

1. checks out the repository and installs with `npm ci`;
2. runs `npm run typecheck` (covering `src/`, `tests/` and `tools/`);
3. runs `npm run test:coverage`;
4. runs `npm run build:only` to prove the demo still bundles;
5. uploads the coverage report and the built `dist/` as artifacts.

`npm run ci` runs the identical sequence locally, so a green local run means a green
build. Runs in flight for the same branch are cancelled when a new push arrives.

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
│       ├── city.ts             the painted skyline
│       ├── skybox.ts           the directional sky and its six faces
│       ├── surfaces.ts         the tileable object textures
│       └── index.ts            the asset registry
└── src
    ├── main.ts                 composition root: shell, assets, audio, wiring
    ├── style.css               all UI styling
    ├── assets/textures         the generated PNGs (committed)
    ├── core
    │   ├── config.ts           every tuning constant, in one table
    │   ├── delta.ts            DeltaTimer + FixedStepAccumulator
    │   ├── loop.ts             GameLoop with error containment
    │   ├── log.ts              bounded log buffer + safe serialisation
    │   ├── math.ts             clamp, lerp, damp, angle helpers
    │   ├── random.ts           the shared seeded PRNG
    │   ├── vec3.ts             allocation-conscious vector maths
    │   └── version.ts          build version
    ├── audio
    │   ├── synth.ts            the soundbank, rendered from parameters
    │   ├── director.ts         which cue to play, and when (pure)
    │   └── engine.ts           Web Audio playback + a silent fallback
    ├── game
    │   ├── game.ts             the state machine: start/pause/restart/quit
    │   ├── look.ts             mouse-look maths
    │   ├── player.ts           six movement modes, head bob, health
    │   ├── level
    │   │   ├── levelData.ts    the demo rooftop, as plain data
    │   │   ├── models.ts       the model library
    │   │   ├── surfaces.ts     the surface (material) table
    │   │   └── level.ts        validation, model resolution, collision world
    │   └── physics
    │       ├── aabb.ts         box maths
    │       ├── collision.ts    the axis-separated sweep solver
    │       └── ledges.ts       ledge and climbable-face probing
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
    │   ├── assets.ts           texture loading (non-fatal, injectable loaders)
    │   ├── view.ts             WebGLRenderer, camera, resize, teardown
    │   └── sceneBuilder.ts     level geometry, lighting, skyline
    └── ui
        ├── dom.ts              small element helpers
        ├── hud.ts              the debug overlay
        ├── screens.ts          title / pause / ended / crash + death + damage
        └── reportIO.ts         report download and clipboard export
```

---

## Deliberate decisions and limitations

**Collision ignores the models.** A prop collides as its box, not as its parts. The
parts are inset trim and surface detail, so a box is the right approximation — and
it kept every V0.1 collision guarantee intact. Better collision is V0.6.

**Mantling is automatic.** Walking into a low ledge mantles it with no keypress.
That is what makes stairs work, and it is the Mirror's Edge feel; the alternative
was a dedicated key, which would have been a fourth movement input.

**No wall-running, vaulting or rolls yet.** V0.3's list starts with wall-running;
none of it is stubbed here.

**No health regeneration, and no health bar.** See above: a regen rule is not on the
roadmap, and the UI is V0.3.

**Head bob has no lateral roll**, only vertical and sideways travel. Camera *effects*
are V0.6.

**The audio is synthesised and unverified by ear.** Structure is tested; taste is
not testable. It is deliberately quiet and simple.

**Performance: the props are many small meshes.** Models made the draw-call count
roughly ten times higher, which is invisible on a GPU but noticeable under software
rendering. Batching and merging are V0.6's optimisation work.

**One module has no unit tests:** `render/view.ts`, which exists to own the WebGL
context. It is verified by running the demo in a real browser, which is also how
the skybox, the textures, the lighting and the movement abilities were checked.

**The crash reporter is local-only.** Nothing is uploaded.

**No `LICENSE` file yet.** Without one, the default is "all rights reserved".

---

## Out of scope for V0.2

The roadmap continues past this demo. Nothing below is implemented, and none of it
is stubbed:

**V0.3** wall-running, wall-jumping, landing roll, vaulting, Kong vault,
checkpoints, UI and menus, multiple roofs, gaps, traversal routes.

**V0.4** neon signs, doors, interiors, surface-aware footstep sounds, pipe
climbing, a movement state machine.

**V0.5** a complete small district, elevators, emissive neon, fog and smoke, a
better skybox, collectibles, level completion, time trials.

**V0.6** feel, camera effects, animations, lighting, audio, models, UI,
optimisation, settings (sensitivity, FOV, graphics, keybinds), player model.

**V0.7** polish, and labelling the district as Level 1.

---

## Roadmap

V0.0 built the engine skeleton, V0.1 made it a place, and V0.2 made it a place you
can move through properly — with verticality that mantling, pull-ups and climbing
each open up in a different way. The next milestone is V0.3: the mechanics that
turn the roof into a route rather than a series of ledges — wall-running,
wall-jumping, vaulting and the landing roll.
