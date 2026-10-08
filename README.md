# Cyberparkour — Technical Demo

[![CI](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml/badge.svg)](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml)

A low-poly, Quake-styled **first-person parkour game** set in a cyberpunk city,
in the spirit of *Mirror's Edge*.

This repository currently contains **V0.3**: a district of five furnished roofs
separated by gaps you cannot simply run across, and the moves that cross them —
wall running, wall jumping, vaulting, Kong vaults and the landing roll — with
checkpoints, a health bar and a proper title/pause menu. V0.2 made the roof a
place you can move through; V0.3 makes it a *route*, where each gap is a decision
and every ability earns its place.

---

## Table of contents

1. [Status](#status)
2. [What V0.3 delivers](#what-v03-delivers)
3. [Quick start](#quick-start)
4. [Controls](#controls)
5. [What you should see](#what-you-should-see)
6. [Locomotion](#locomotion)
7. [The manoeuvre bands](#the-manoeuvre-bands)
8. [Wall running](#wall-running)
9. [Wall jumping](#wall-jumping)
10. [Vaulting and the Kong vault](#vaulting-and-the-kong-vault)
11. [The landing roll](#the-landing-roll)
12. [Checkpoints and respawn](#checkpoints-and-respawn)
13. [The district](#the-district)
14. [Fall damage and health](#fall-damage-and-health)
15. [Models and surfaces](#models-and-surfaces)
16. [The skybox](#the-skybox)
17. [Sound](#sound)
18. [How the textures are made](#how-the-textures-are-made)
19. [Architecture](#architecture)
20. [How a frame works](#how-a-frame-works)
21. [Collision](#collision)
22. [Crash reporting](#crash-reporting)
23. [The HUDs](#the-huds)
24. [Testing](#testing)
25. [Continuous integration](#continuous-integration)
26. [Project layout](#project-layout)
27. [Deliberate decisions and limitations](#deliberate-decisions-and-limitations)
28. [Out of scope for V0.3](#out-of-scope-for-v03)
29. [Roadmap](#roadmap)

---

## Status

| | |
| --- | --- |
| Version | `0.3.0` |
| Stage | Pre-alpha, playable demo |
| Stack | TypeScript · three.js · Vite · Vitest |
| Runs in | Any modern desktop browser with WebGL 2 and Web Audio |
| Tests | 792 across 29 files |
| Coverage | ~94% of statements (of the unit-testable surface) |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

V0.3 is finished and frozen. Nothing from V0.4 onward is implemented, and none of
it is stubbed.

---

## What V0.3 delivers

Every item from the V0.3 section of the project roadmap, and where it lives:

| Feature | Where |
| --- | --- |
| Multiple roofs, gaps and traversal routes | `levelData.ts` (`DEMO_DISTRICT`) |
| Wall running | `player.ts` (`updateWallRun`, `probeWall`), `physics/ledges.ts` (`findWallRunSurface`), `config.ts` (`wallRun`) |
| Wall jumping | `player.ts` (`tryWallJump`), `config.ts` (`wallJump`) |
| Vaulting | `player.ts` (`tryVault`), `physics/ledges.ts` (`findVaultObstacle`), `config.ts` (`vault`) |
| Kong vaults | `player.ts` (`tryVault`, the fast branch), `config.ts` (`vault.kong`) |
| Landing rolls | `player.ts` (`applyLanding`, `tryRoll`, `rollDistance`), `config.ts` (`roll`) |
| Checkpoints | `player.ts` (`updateCheckpoints`), `levelData.ts`, `game.ts` (`handleCheckpoint`) |
| UI and menus | `ui/screens.ts` (title / controls / about / pause screens), `ui/gameHud.ts` (health bar and checkpoint pips) |

The V0.2 abilities and feel that V0.3 builds on are all still here, and two of
them were retuned as part of this version: the **head bob** is gentler, and the
**footsteps** are softer. See [Locomotion](#locomotion) and [Sound](#sound).

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
| `Space` | Jump; pull up from a hang; kick off a wall while airborne |
| `Ctrl` or `C` | Crouch; at speed, slide; on a hard landing, roll |
| `W` into a ledge | Mantle (automatic); keep running into a waist-high rail to vault it |
| Sprint at a rail | Kong vault — a diving vault that keeps its speed |
| Aim along a wall | Wall run (airborne, at speed); chain two facing walls to climb |
| `F3` (or `` ` ``) | Toggle the debug overlay |
| `M` | Mute |
| `Esc` | Pause (releases the mouse) |
| `R` | Restart |

The title screen offers **Play / Controls / About**. Pressing Esc opens a pause
menu of **Resume / Respawn / Controls / Restart run / Main menu / Quit demo**.
The manoeuvres are not on a key of their own: every one of them engages from the
movement itself, so there is nothing to memorise beyond moving.

Click **Play** to begin. That click is also what lets the browser grant pointer
lock — and what lets it start an audio context.

---

## What you should see

A **district**, not a single roof: five furnished rooftops at different heights,
each a platform on its own tower with a real canyon of air between it and its
neighbours. The home roof carries a roof-access block with its own stair flight,
a climbable riser pipe and antenna mast, a barred rail, a service duct you can
only pass crouched, crates and AC units. The roofs to the east climb through
annex, east and high before a wide canyon separates the final, distant roof.

A tall facade lines the canyon's north side, with a narrow service beam spanning
it a metre below the parapets — the slow way across, next to the fast way (a wall
run). Above it all, a six-face **cube skybox** — dark at the zenith, glowing
magenta at the horizon — and a painted city skyline wrapped around the level with
lit windows showing through the gaps between buildings.

Progression is visible: a health bar and a row of checkpoint pips sit at the
bottom of the screen, and crossing a checkpoint raises a toast.

---

## Locomotion

The ordinary gaits share one accelerator, so switching between them is just a
change of target speed. Every number lives in `src/core/config.ts`.

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
also how you get under a duct at speed.

**Head bob.** The phase is advanced by *distance travelled*, not by time, so the
cadence rises with speed without needing a timer and is identical at any frame
rate. Two vertical bobs per stride (one per foot) and one lateral sway, fading in
and out with a `damp` so stopping does not snap the camera.

The bob is deliberately *quiet*, and V0.3 turned it down further:

- **The amplitude is small** — 3.4 cm of vertical travel and 1.7 cm sideways
  (down from 5.5 cm / 3.2 cm in V0.2). A first-person camera that moves as much
  as the body would read as a loose camera, not as a walk.
- **The fade is a fade.** The rate constant is converted into the fraction `damp`
  actually wants (`1 - exp(-rate·dt)`) before it is passed in. Passing the rate
  straight through had clamped everything above 1 to 1, and 1 means *arrive
  immediately*: the bob was snapping on and off at every start and stop, which
  read as a jolt on top of the bob itself.
- **Speed scales the amplitude down, not up.** The bob's *frequency* rises with
  speed, so a constant amplitude would mean sprinting shakes the camera half
  again as fast at the same throw. `speedFalloff` (0.6) scales the amplitude back
  to about 60% at sprint speed, so the perceived shake stays roughly constant.

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

The bands do not overlap, which is what keeps the abilities distinct rather than
one doing all the work: a ledge you can step onto is mantled, a ledge you can
only just reach is grabbed, and a face taller than a jump and a grab together is
climbed. Reachability of every ledge on a roof is a *consequence* of these
numbers, so the level tests assert the relationships rather than the heights —
retuning gravity cannot silently make a route impossible.

Two details that matter:

- **Mantling is automatic** when you walk into a low ledge, which is what makes
  the staircases work: each 0.5 m riser is inside the mantle band, so holding
  forward walks you up a flight of stairs with no input beyond a direction.
- **A hang needs a fresh jump press.** The press that got you to the ledge is
  latched, so you have to release and press again to haul up. Without that you
  would grab and pull up in consecutive steps and never see the hang at all.

V0.3 adds three more bands on top of these — the **wall run**, the **vault** and
the **roll** — each with its own probe and its own set of numbers, described
below. What they share with the V0.2 moves is the philosophy: a *geometry* query
that returns what is possible, and a *config* table that decides how fast, how
high and how far.

---

## Wall running

Aim along a wall while airborne and, above 6 m/s, you attach to it and run along
it. Gravity drops to **16%** while you are on the wall, so a run is a controlled
descent rather than a fall, and a run is only good for **1.5 seconds** before it
lets go.

The probe (`findWallRunSurface`) only accepts a wall *parallel* to your travel —
a face straight ahead is something to run into or climb, not along — and of the
walls that qualify it takes the nearest, so a corridor attaches you to the side
you are closest to rather than picking arbitrarily. The wall must rise at least
1.6 m above your feet, so a kerb is not a wall, and while attached you are pushed
gently *into* it (14 m/s² of stick) so contact is kept even as you arc away.

Two things keep a wall run from being a hover:

- **Leaving a wall locks it out for 0.35 s** when the run ends on its own. Without
  that the run would simply start again on the next step and the duration limit
  would mean nothing — a player could hold forward against one wall and stay up
  forever. It is short, because deliberately dropping back onto a long wall is
  legitimate.
- **It is a controlled descent, not a fall.** Peak fall speed is reset while on
  the wall, so landing after a long run does not hurt as though you had dropped
  the whole height.

---

## Wall jumping

Press jump while airborne next to a wall — or mid-run — and you kick off it: away
from the wall at **6.4 m/s**, upward at **7.8 m/s** (higher than a standing jump,
so a wall jump *gains* height), keeping **92%** of your along-wall speed.

That last number is what makes chaining work: two facing walls can be climbed by
alternating kicks because the momentum carries across the gap. And what stops a
*single* wall from being climbed is the lockout: the wall you just left is refused
for **0.55 s**, which is longer than the jump's own airtime. Holding jump against
one wall gains you nothing, but a second wall immediately across the way is always
available.

---

## Vaulting and the Kong vault

Run into a waist-high obstacle — 0.5 m to 1.15 m tall, no more than 1.1 m deep —
and you cross it instead of stopping at it. The difference from a mantle is what
is on the far side: a **mantle ends on top** of the obstacle, a **vault ends past
it**, still on the floor. So the vault probe (`findVaultObstacle`) asks for floor
beyond the obstacle rather than room above it, and rejects anything too deep to
cross in one move — otherwise you could "vault" a 20 m table.

Vaulting is designed to reward speed, and it does that with two moves off one
obstacle:

| | Entry speed | Outcome |
| --- | --- | --- |
| **Vault** | above 7 m/s | a hop across, keeping 62% of your speed |
| **Kong vault** | above 9.5 m/s (a sprint) | a dive: further, lower, keeping 92% |

A Kong vault travels 1.3 m further and clears the obstacle 4 cm above it rather
than 12 cm, because it is a dive rather than a hop — and it keeps nearly all of
its speed, which is exactly what makes it worth winding up for. One obstacle, two
moves, chosen by how fast you hit it.

---

## The landing roll

Crouch *in the air* on a landing that would otherwise hurt and you roll out of
it. A roll is the reward for a well-timed landing, not an immunity: it turns a
**fatal drop into a survivable one** and a survivable one into a scratch, taking
only **25%** of the fall damage. It carries you 3.4 m forward over half a second
and leaves you running at 3.5 m/s — and it shortens itself if a crate is in the
way rather than rolling you into it, or refusing to roll at all.

The move is a *low-profile* scripted move: the body stays at crouch height for
its whole duration, so a roll under a duct is possible and the collision box and
the eye height can never disagree about how tall the player is. Crouching on a
landing that does **not** need a roll does nothing — there is a 13 m/s impact
threshold, below which a roll would be pointless anyway.

---

## Checkpoints and respawn

V0.2 respawned you at the level spawn. On a district crossed by falling, a single
slip would cost the whole traverse, so V0.3 adds **checkpoints**: pass within 3 m
of one (and within 2.5 m vertically) and it becomes your new respawn point. Four
of them trace the route — annex, east, high, far — and the play HUD shows how many
you have secured.

Three rules make them kind rather than fiddly:

- **Only ever forwards.** Walking back over an earlier checkpoint changes nothing;
  the last one reached is the one you keep.
- **A checkpoint can be skipped.** Reaching a *later* one on foot still records,
  because refusing to would strand a player who found a shortcut or a hard route.
- **Progress survives a respawn.** `respawnPlayer` returns you to your *respawn*
  point — the level spawn until you reach a checkpoint, and to the facing you had
  when you got there — so a death is a setback, not a restart. Only
  `resetPlayerState` (the pause menu's *Restart run*) forgets checkpoints, the
  death count and everything else.

The toast matters more than it looks: the radius is generous, so a checkpoint can
be crossed without noticing, and being told is the difference between "the game
saved my progress" and "the game moved me somewhere strange after I fell".

---

## The district

The demo is five roofs, and the gaps between them are the reason each new move
exists:

```
home  (0 m)   -- 6 m gap, +1.2 m ---->  east (1.2 m)   the warm-up
home  (0 m)   -- 6 m gap, +2.0 m ---->  annex (2.0 m)  jump and grab
east  (1.2 m) -- 6 m gap, +2.4 m ---->  high (3.6 m)   jump, grab, haul up
high  (3.6 m) -- 12 m canyon ------>   far (1.2 m)     wall run, or the beam
```

The **12 m canyon** is wider than a sprint jump can clear (about 6.4 m at the
configured gravity and sprint speed) and it has a tall facade along its north
side, so the fast route across is a **wall run** from the edge of `high`. There is
a second, slower route — a narrow 1 m service beam — because a route that can only
be taken one way is a checkpoint rather than a decision.

Heights are chosen from the movement config, not by eye: a 6 m gap with a 2.4 m
rise is inside what a jump plus a grab reaches, a 12 m gap is outside it, and the
level tests assert those relationships rather than the metres.

---

## Fall damage and health

Landing hurts above 12 m/s of impact — a free fall of about 2.8 m — and is fatal
at 26 m/s, about 13 m. Damage scales linearly between the two, so a 6 m drop costs
about 30 health and a 9.5 m drop about 53. Death from impact is reported to the
game exactly like a fall off the level, so it gets the same overlay and respawn;
the overlay's wording differs (`YOU DIED` rather than `YOU FELL`).

Four things are worth knowing:

- **A roll cuts the damage to 25%** (see [the landing roll](#the-landing-roll)),
  which is what turns a fatal drop into a survivable one.
- **There is no health regeneration.** It is not on the roadmap, so inventing a
  rule for it would be scope creep. A `Respawn` restores full health, and so does
  dying — which is a discoverable way out, and all a technical demo needs.
- **The level's kill plane still wins.** A fall into a canyon reaches −12 m long
  before it reaches the street, so canyon falls are always fatal. Fall damage is
  for the drops *inside* the district: off a terrace, off a mast, off a parapet.
- **Landings do not count while mantling, climbing or wall running**, because
  those reset the fall tracker — being hauled up a wall, or running along one, is
  not a fall.

Feedback for a damaging landing is a brief red vignette and a hurt sound. The
health *bar* is now the play HUD (see [The HUDs](#the-huds)); the debug overlay
shows the number.

---

## Models and surfaces

Every prop is an instance of a model from `src/game/level/models.ts` — nineteen of
them, from a five-part `crate` to a ten-part `pipe-vertical`. V0.1's props were
single boxes.

Parts are expressed in **normalised** coordinates: `[0, 1]` across the prop's own
bounding box, with `y` from its underside to its top. That one decision means any
model fits any prop size, so the same `ac-unit` works at 3 × 1.7 × 2.4 m and a
`slab` works for a 30 m roof body and a 0.5 m barrier. A part may exceed `[0, 1]`,
which is how detail is added that deliberately overhangs the collider.

**Collision stays the prop's box.** The parts are surface detail — inset grilles,
flush trim, overhanging lips — and a box is the right approximation for all of
them. This also means the change is purely visual: every collision test still
holds, which is exactly what happened.

Each part names a **surface**, and a prop may recolour any of them:

```
{ id: 'metal', texture: 'metal-panel', tint: '#67717f', metresPerTile: 2 }
```

The detail maps are authored *light* on purpose, because `tint × map` should read
as the tint: the tint is the albedo and the map is only the detail on top. Twelve
surfaces cover the district, and one model serving four differently-tinted AC
units is the point of the indirection.

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

V0.3 adds a **whoosh** — one breathy swell of filtered air — for the moves that
are mostly a change of direction: a wall run, a wall jump and a roll all use it,
and a vault or a Kong vault adds a landing on top. A wall run then scrapes
underneath it exactly as a slide does, because a slide and a wall run are the same
*event* (a committed drag against a surface) differing only in which surface.

**The footsteps are deliberately soft.** V0.2's version had a 2 ms attack, a 35 ms
decay and a bright 2.6 kHz filter, which at three and a half steps a second read
as a snare roll. V0.3 slows the attack in over 10 ms, stretches the decay, drops
the filter to 1.5 kHz (a duller 650 Hz while crouched), and shifts most of the
level into the low body rather than the scuff. The whole bank was also normalised
quieter, so footsteps sit under the music instead of over it.

**I cannot judge how it sounds.** Everything is verified numerically — length,
peak, RMS, DC offset, determinism, that a sprint step is longer than a crouched
one, that a gust swells and dies, that the whoosh swells rather than bursts — but
taste is not testable. All the parameters are in one place if the balance needs
adjusting.

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
game/physics/  AABB collision solver + ledge, wall and vault probing   (no three.js)
game/level/    declarative level data, models, surfaces, validation
game/          player movement, look maths, the state machine
audio/         synthesiser + cue director (pure); Web Audio playback
diagnostics/   crash reports, sinks, frame statistics          (no three.js)
input/         input state (pure) + DOM/pointer-lock glue
render/        the only place three.js is imported at runtime
tools/         the texture generator, run directly on Node
ui/            DOM overlays, the two HUDs, menus, report export
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
        │              dead → scripted move → hanging → climbing → locomotion
        │              (locomotion itself resolves wall running and sliding;
        │               every mode reports started / ended / landing events)
        ├─ play the audio cues those steps produced
        ├─ FrameStats.push(dt)
        ├─ render the interpolated eye position, stance height and head bob
        └─ update the HUDs (throttled to 10 Hz)
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
  the player skims along it instead of sticking — and a wall run is built on the
  same behaviour.
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

The same solver answers the crouch's question (`isFree`), and every probe is built
on top of it. `findLedge` shifts the player's box forward, finds a collider whose
top is inside the requested band, and then asks the world whether a standing player
would fit on top of it — that last check is what stops the game from starting a
mantle into a space with no room for the body it is about to move there.
`findWallRunSurface` finds a wall parallel to travel with a face beside the player,
and `findVaultObstacle` additionally asks for floor on the far side, so you cannot
vault out of the level.

The integration test asserts the strongest available invariant: after every single
step of a simulated minute of motion, the player box overlaps **no** collider —
except mid-manoeuvre, where passing through the volume being crossed is the point.

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
game state — including health, death count, death cause, locomotion mode and the
checkpoint reached, alongside position and velocity. Two buttons export it:
**Download report (.json)** and **Copy report**.

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

## The HUDs

V0.3 splits the screen furniture in two, on purpose.

**The play HUD** (`src/ui/gameHud.ts`) is the one a player is meant to read. It
shows exactly two things and nothing else:

- **Health**, as a bar scaled with a compositor transform (so it never triggers
  layout mid-frame) and coloured by band — `ok`, `hurt`, `critical`. A bar rather
  than a number, because the exact value is never a decision; the band is.
- **Checkpoints**, as `CP n / total` beside a row of pips, so how much of the
  route survives a fall is legible at a glance.

**The debug overlay** (`src/ui/hud.ts`, toggled with `F3`) is for developing the
game, and is allowed to be ugly and constant. Refreshed at 10 Hz so DOM layout
never shows up in the frame budget:

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
STATE   WALL RUN
DEATHS  1
FRAMES  1234 in 20.5 s
GPU     ANGLE (NVIDIA, ...)
```

`GAIT` names the walking mode (`idle` / `walk` / `sprint` / `crouch` / `roll`), and
`STATE` names the locomotion mode — `grounded (deck)`, `airborne`, `MANTLING`,
`PULL-UP`, `HANGING`, `CLIMBING`, `SLIDING`, `WALL RUN`, `VAULTING`, `ROLLING`,
`DEAD`. Those two rows are how you confirm the movement abilities are doing
anything at all.

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

792 tests in 29 files, in five layers:

- **Unit tests** — maths, the delta-time system, the game loop (driven by a fake
  scheduler), the input state, the AABB helpers, the collision solver, every
  movement mode and their transitions, ledge, wall and vault probing, look maths,
  models, level validation, frame statistics, the crash reporter/sinks/report
  builder, the audio synthesiser and director, the play HUD, the debug HUD and
  every screen.
- **Traversal tests** (`tests/game/traversal.test.ts`) — the V0.3 moves against
  small, purpose-built worlds: wall running, wall jumping, rolling, vaulting, the
  Kong vault and checkpoints, each with the geometry it needs stated in one place.
- **Integration tests** (`tests/integration/simulation.test.ts`) — the real
  pipeline, level → collision world → fixed-step accumulator → player, run
  headlessly *on the district that ships*. They assert the invariants unit tests
  cannot see: no tunnelling, no sinking, no escaping the level, determinism, that a
  fall from every edge is fatal, and that the abilities all work on the real
  geometry.
- **DOM tests** (`// @vitest-environment jsdom`) — the browser boundaries: the
  screens, their menu navigation and callbacks, the death overlay, the damage
  flash, report export, keyboard handling and the pointer-lock lifecycle.
- **Asset tests** (`tests/render/`) — the scene graph (skybox, backdrop, lighting,
  materials, UV scaling, disposal) and the committed textures against their
  generators.

Several tests exist because they caught real bugs during development:

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
- The head bob read its fade rate as a `damp` fraction, so anything above a rate of
  1 was clamped to 1 — "arrive immediately" — and the bob snapped on and off at
  every start and stop. It is now converted to an exponential fraction first.

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
    │   ├── game.ts             the state machine: start/pause/restart/quit/menu
    │   ├── look.ts             mouse-look maths
    │   ├── player.ts           movement modes, traversal moves, head bob, health
    │   ├── level
    │   │   ├── levelData.ts    the demo district, as plain data
    │   │   ├── models.ts       the model library
    │   │   ├── surfaces.ts     the surface (material) table
    │   │   └── level.ts        validation, model resolution, collision world
    │   └── physics
    │       ├── aabb.ts         box maths
    │       ├── collision.ts    the axis-separated sweep solver
    │       └── ledges.ts       ledge, wall and vault probing
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
        ├── gameHud.ts          the play HUD: health bar and checkpoint pips
        ├── hud.ts              the debug overlay
        ├── screens.ts          title / controls / about / pause / ended / crash
        └── reportIO.ts         report download and clipboard export
```

---

## Deliberate decisions and limitations

**Collision ignores the models.** A prop collides as its box, not as its parts. The
parts are inset trim and surface detail, so a box is the right approximation — and
it kept every collision guarantee intact. Better collision is V0.6.

**Mantling is automatic.** Walking into a low ledge mantles it with no keypress.
That is what makes stairs work, and it is the Mirror's Edge feel; the alternative
was a dedicated key, which would have been a fourth movement input.

**The traversal moves are automatic too.** A wall run attaches when you are moving
fast beside a wall; a vault fires when you run into a waist-high obstacle; a roll
fires when you crouch on a hard landing. There is no key for any of them, and that
is deliberate: in a game about maintaining flow, a route should not be lost to
remembering which of four buttons starts which move.

**A Kong vault needs a real sprint.** The vault/kong split is speed and nothing
else, so one obstacle offers two moves chosen by how you hit it. That is the skill
the move rewards, and it keeps the input surface small.

**Wall running has a lockout on purpose.** Without the 0.35 s re-attach cooldown a
run would restart on the next step and the 1.5 s duration limit would mean nothing.
The cooldown is short because dropping back onto a long wall deliberately is
legitimate.

**Checkpoints keep facing but not health.** A respawn restores full health and the
facing you had when you reached the checkpoint, but a *Restart run* — which is what
the pause menu offers — forgets checkpoints and the death count on purpose: that is
the difference between a setback and starting over.

**The audio is synthesised and unverified by ear.** Structure is tested; taste is
not testable. It is deliberately quiet and simple.

**Head bob has no lateral roll**, only vertical and sideways travel. Camera *effects*
are V0.6.

**Performance: the props are many small meshes.** Models made the draw-call count
roughly ten times higher than V0.1, which is invisible on a GPU but noticeable under
software rendering. Batching and merging are V0.6's optimisation work.

**One module has no unit tests:** `render/view.ts`, which exists to own the WebGL
context. It is verified by running the demo in a real browser, which is also how
the skybox, the textures, the lighting and the movement abilities were checked.

**The crash reporter is local-only.** Nothing is uploaded.

**No `LICENSE` file yet.** Without one, the default is "all rights reserved".

---

## Out of scope for V0.3

The roadmap continues past this demo. Nothing below is implemented, and none of it
is stubbed:

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
each open up in a different way.

V0.3, this version, turns the roof into a *route*: five roofs with real gaps
between them, crossed by wall running, wall jumping, vaulting and the Kong vault,
softened by the landing roll, and kept honest by checkpoints. The next milestone is
V0.4: neon signs, doors and interiors, surface-aware footsteps, pipe climbing and a
movement state machine.
