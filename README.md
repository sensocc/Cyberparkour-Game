# Cyberparkour — Technical Demo

[![CI](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml/badge.svg)](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml)

A low-poly, Quake-styled **first-person parkour game** set in a cyberpunk city,
in the spirit of *Mirror's Edge*.

This repository currently contains **V0.4**. V0.3 turned the roof into a route -
five roofs with real gaps, crossed by wall running, vaults and rolls. V0.4 goes
*inside*: two of the roofs now carry machine rooms you can walk into through doors
you open yourself, the signage across the district glows, a pipe can be climbed
both ways, footsteps finally know what they are standing on, and the movement
modes - which had grown into an ad-hoc chain - are now an explicit state machine.

---

## Table of contents

1. [Status](#status)
2. [What V0.4 delivers](#what-v04-delivers)
3. [Quick start](#quick-start)
4. [Controls](#controls)
5. [What you should see](#what-you-should-see)
6. [Locomotion](#locomotion)
7. [The movement state machine](#the-movement-state-machine)
8. [The manoeuvre bands](#the-manoeuvre-bands)
9. [Wall running](#wall-running)
10. [Wall jumping](#wall-jumping)
11. [Vaulting and the Kong vault](#vaulting-and-the-kong-vault)
12. [The landing roll](#the-landing-roll)
13. [Pipe climbing](#pipe-climbing)
14. [Interiors and doors](#interiors-and-doors)
15. [Neon signage](#neon-signage)
16. [Checkpoints and respawn](#checkpoints-and-respawn)
17. [The district](#the-district)
18. [Fall damage and health](#fall-damage-and-health)
19. [Models and surfaces](#models-and-surfaces)
20. [The skybox](#the-skybox)
21. [Sound](#sound)
22. [How the textures are made](#how-the-textures-are-made)
23. [Architecture](#architecture)
24. [How a frame works](#how-a-frame-works)
25. [Collision](#collision)
26. [Crash reporting](#crash-reporting)
27. [The HUDs](#the-huds)
28. [Testing](#testing)
29. [Continuous integration](#continuous-integration)
30. [Project layout](#project-layout)
31. [Deliberate decisions and limitations](#deliberate-decisions-and-limitations)
32. [Out of scope for V0.4](#out-of-scope-for-v04)
33. [Roadmap](#roadmap)

---

## Status

| | |
| --- | --- |
| Version | `0.4.0` |
| Stage | Pre-alpha, playable demo |
| Stack | TypeScript · three.js · Vite · Vitest |
| Runs in | Any modern desktop browser with WebGL 2 and Web Audio |
| Tests | 850 across 32 files |
| Coverage | ~94% of statements (of the unit-testable surface) |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

V0.4 is finished and frozen. Nothing from V0.5 onward is implemented, and none of
it is stubbed.

---

## What V0.4 delivers

Every item from the V0.4 section of the project roadmap, and where it lives:

| Feature | Where |
| --- | --- |
| A movement state machine | `src/game/movement.ts` (`deriveMotionState`, `MOTION_TRANSITIONS`, `MotionTracker`) |
| Pipe climbing | `player.ts` (`tryPipe`, `stepPiping`), `config.ts` (`maneuver.pipe`), `ColliderKind: 'pipe'` |
| Interiors | `levelData.ts` (`room()`), `level.ts` (`validateLights`) |
| Doors | `levelData.ts` (`DoorDefinition`), `level/doors.ts` (`DoorSystem`), `sceneBuilder.ts`, `render/view.ts` |
| Neon signs | `tools/textures/surfaces.ts` (`generateSign`), `surfaces.ts` (`neon`), `models.ts` (`neon-sign`), `sceneBuilder.ts` (`emissive`) |
| Surface-aware footstep sounds | `surfaces.ts` (`AcousticMaterial`), `collision.ts` (`Collider.surface`), `audio/director.ts`, `audio/synth.ts` |

Everything V0.1-V0.3 built is still here - the district, the traversal moves, the
checkpoints, the softer head bob and footsteps - and V0.4 builds on top of it
rather than beside it: the pipe is a new ability in the *existing* movement
system, and the interiors are rooms in the *existing* district.

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
| `Space` | Jump; pull up from a hang; kick off a wall or a pipe |
| `Ctrl` or `C` | Crouch; at speed, slide; on a hard landing, roll |
| `W` into a ledge | Mantle (automatic); keep running into a waist-high rail to vault it |
| Sprint at a rail | Kong vault — a diving vault that keeps its speed |
| Aim along a wall | Wall run (airborne, at speed); chain two facing walls to climb |
| `W` into a pipe | Climb it; `C` or `S` slides down it, and `Space` kicks off |
| `E` at a door | Open or close it |
| `F3` (or `` ` ``) | Toggle the debug overlay |
| `M` | Mute |
| `Esc` | Pause (releases the mouse) |
| `R` | Restart |

The title screen offers **Play / Controls / About**. Pressing Esc opens a pause
menu of **Resume / Respawn / Controls / Restart run / Main menu / Quit demo**.
Apart from the doors, every move engages from the movement itself: there is no
key to learn for mantling, wall running, vaulting or climbing a pipe.

Click **Play** to begin. That click is also what lets the browser grant pointer
lock — and what lets it start an audio context.

---

## What you should see

A **district** of five furnished rooftops at different heights, each a platform on
its own tower with a canyon of air between it and its neighbours — and, on the
east and far roofs, **machine rooms you can walk into**: walls, a roof, fittings
inside, a lit sign on the back wall, and a door in the doorway that only opens
when you ask it to.

Outside, **neon signs** hang on the canyon facade and on the rooms' walls,
glowing cyan, magenta and amber against the dark. The canyon keeps its shape from
V0.3 — a 12 m gap much wider than a sprint jump, a tall facade to run along, and a
service beam for the slow way across — plus a pipe up the side of the east machine
room that climbs to its roof.

Above it all, a six-face **cube skybox** — dark at the zenith, glowing magenta at
the horizon — and a painted city skyline wrapped around the level with lit windows
showing through the gaps between buildings. Progression is visible: a health bar
and a row of checkpoint pips sit at the bottom of the screen.

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
and out with a `damp` so stopping does not snap the camera. The bob is deliberately
quiet: 3.4 cm vertical, 1.7 cm lateral, a slow fade, and an amplitude that falls
off with speed so a sprint does not shake the camera half again as fast.

---

## The movement state machine

V0.1 had one movement mode, V0.2 six, and V0.3 more again, all resolved by an
ad-hoc priority chain. V0.4 makes the modes explicit, in `src/game/movement.ts`:

- **`deriveMotionState`** is the *one* place that decides what the player is
  doing, from their flags. Nothing else may guess: `locomotion()` in `player.ts`
  is now a thin adapter over it.
- **`MOTION_TRANSITIONS`** states which one-tick transitions are legal, so "what
  the state is" and "what it may become" are written down together.
- **`MotionTracker`** follows the player across ticks and reports the moves
  between states - including, in the game itself, when one is *not* allowed.

| State | May become |
| --- | --- |
| `grounded` | airborne, sliding, mantling, vaulting, climbing, piping, dead |
| `airborne` | grounded, hanging, wall-running, rolling, dead |
| `sliding` | grounded, airborne, mantling, vaulting, dead |
| `wall-running` | airborne, grounded, dead |
| `mantling` / `pulling-up` / `vaulting` / `rolling` | grounded, airborne, dead |
| `hanging` | pulling-up, airborne, grounded, dead |
| `climbing` / `piping` | mantling, airborne, grounded, dead |
| `dead` | airborne, grounded |

Why a table and not just the chain? Because the chain only says what the state
*is*. A change that let a wall run turn straight into a climb would be one line
that no obvious test would catch — but it is an *illegal transition*, and both the
suite and the running game assert every move is a legal one. The graph is the
regression guard, and it is checked for reachability too: a state nothing can
reach is a missing transition somewhere else.

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
one doing all the work. Reachability of every ledge on a roof is a *consequence*
of these numbers, so the level tests assert the relationships rather than the
heights — retuning gravity cannot silently make a route impossible.

---

## Wall running

Aim along a wall while airborne and, above 6 m/s, you attach to it and run along
it. Gravity drops to **16%** while you are on the wall, so a run is a controlled
descent rather than a fall, and a run is only good for **1.5 seconds** before it
lets go.

The probe (`findWallRunSurface`) only accepts a wall *parallel* to your travel —
a face straight ahead is something to run into or climb, not along — and of the
walls that qualify it takes the nearest. The wall must rise at least 1.6 m above
your feet, and while attached you are pushed gently *into* it (14 m/s² of stick)
so contact is kept even as you arc away.

Leaving a wall locks it out for 0.35 s when the run ends on its own, which stops a
run restarting on the next step and becoming an indefinite hover.

---

## Wall jumping

Press jump while airborne next to a wall — or mid-run — and you kick off it: away
from the wall at **6.4 m/s**, upward at **7.8 m/s** (higher than a standing jump,
so a wall jump *gains* height), keeping **92%** of your along-wall speed.

That last number is what makes chaining work: two facing walls can be climbed by
alternating kicks because the momentum carries across the gap. And what stops a
*single* wall from being climbed is the lockout: the wall you just left is refused
for **0.55 s**, longer than the jump's own airtime.

---

## Vaulting and the Kong vault

Run into a waist-high obstacle — 0.5 m to 1.15 m tall, no more than 1.1 m deep —
and you cross it instead of stopping at it. The difference from a mantle is what
is on the far side: a **mantle ends on top** of the obstacle, a **vault ends past
it**, still on the floor. So the vault probe (`findVaultObstacle`) asks for floor
beyond the obstacle rather than room above it, and rejects anything too deep to
cross in one move.

| | Entry speed | Outcome |
| --- | --- | --- |
| **Vault** | above 7 m/s | a hop across, keeping 62% of your speed |
| **Kong vault** | above 9.5 m/s (a sprint) | a dive: further, lower, keeping 92% |

A Kong vault travels 1.3 m further and clears the obstacle 4 cm above it rather
than 12 cm, because it is a dive rather than a hop.

---

## The landing roll

Crouch *in the air* on a landing that would otherwise hurt and you roll out of it.
A roll takes only **25%** of the fall damage, carries you 3.4 m forward over half a
second and leaves you running at 3.5 m/s — and it shortens itself if a crate is in
the way rather than rolling you into it.

The move is *low-profile*: the body stays at crouch height for its whole duration,
so a roll under a duct is possible and the collision box and the eye height can
never disagree about how tall the player is.

---

## Pipe climbing

V0.4's new ability, and the only one that works **both ways**. Aim into a pipe
above 1.2 m tall and you latch onto it, flush against its face. Then:

- **Forward** climbs at 3.4 m/s — a little faster than a climbable face, because a
  pipe is the route that is *meant* to be climbed.
- **Back or crouch** slides *down* at **9.5 m/s**. Nearly three times the climb
  speed, which is what makes dropping down a pipe a move rather than a
  hand-over-hand crawl.
- **Nothing** holds position: a pipe is a place you can stop and rest on.
- **Jump** kicks off it — out and up, so leaving keeps the height gained.
- **The top** hands over to a mantle onto whatever the pipe reaches, if there is
  room; if there is not, the pipe simply stops there rather than climbing into a
  wall.

A pipe is a distinct `ColliderKind` from a climbable face, and a distinct ability
from climbing, precisely because a face can only ever be ascended. That is the
whole reason the two exist side by side.

Releasing a pipe refuses it for 0.3 s, so a jump off is not undone on the next
step. Grabbing one leaves a **collision skin** between the player and the pipe,
deliberately: landing *exactly* on the face leaves the box overlapping by a
rounding error, and the solver's response to an overlap is to push the player out
of it — which, on the wrong axis, is straight down.

---

## Interiors and doors

Two of the district's roofs carry a **machine room**: a rectangular interior built
from walls and a roof, with a doorway, a door, fittings inside, a lit sign on the
back wall and a lamp overhead. The geometry comes from one `room()` helper in
`levelData.ts`, so the two are built the same way and a third would be a few lines.

Some details that are load-bearing:

- **The floor is the deck.** A raised interior floor would put a lip across the
  doorway, and a lip is a step the mantle band will not take (its floor is 0.4 m)
  but a walk into it will not either. So a room is walls and a roof, and the deck
  is the floor.
- **A doorway is two walls and a beam.** Collision is per-prop boxes, so a wall
  with a hole in it is two wall segments, two jambs and a lintel — and the lintel
  rests *on the jambs*, which is both how a doorway is really built and what keeps
  the level's "nothing floats" rule satisfied.
- **A door is a collider the game can switch off.** `CollisionWorld` gained
  `setColliderEnabled`; a door past halfway open stops blocking, and its mesh
  swings to match. Between shut and half-open the mesh and the collider disagree,
  which is a deliberate simplification — modelling a *swinging* box is a
  swept-rotation problem this demo does not need.
- **`DoorSystem` owns the state and nothing else.** It returns the fractions that
  changed each frame and the renderer does the turning, so the whole thing is
  testable without WebGL.
- **The lamps matter.** The sun and the hemisphere light do not reach inside a
  building, and a room with no light of its own is a black hole you can hear your
  footsteps in. `LevelDefinition.lights` places point lights, and the scene builder
  gives each one a `PointLight` that casts no shadow — a point-light shadow is a
  cube map per light, and the demo's look does not need one.

Press `E` next to a door to work it. There is no "use" target: doing nothing when
no door is in reach is correct.

---

## Neon signage

Signs are **emissive surfaces**. A surface can now be marked `emissive`, and the
scene builder responds by making the tint the *emissive* colour and the sign
texture the *emissive map* — so only the lit parts of the texture glow, and the
albedo goes dark so the sun does not wash the glow out.

The texture is generated like every other one (`generateSign`): bright glyph bars
on a dark backing, with a panel edge and a little wear. The glyphs are abstract
blocks rather than letters — at the distance a sign is read in this demo, a real
typeface would only be mush, and bars read as "sign" from across the canyon.

Three signs hang in the district — one on the canyon facade, one inside each
machine room — each with a dim point light beside it, so a sign lights the wall it
is on rather than being a glowing rectangle on a black one.

---

## Checkpoints and respawn

Pass within 3 m of a checkpoint (and within 2.5 m vertically) and it becomes your
new respawn point. Four of them trace the route — annex, east, high, far — and the
play HUD shows how many you have secured.

Three rules make them kind rather than fiddly:

- **Only ever forwards.** Walking back over an earlier checkpoint changes nothing.
- **A checkpoint can be skipped.** Reaching a *later* one on foot still records.
- **Progress survives a respawn.** `respawnPlayer` returns you to your *respawn*
  point — the spawn until you reach a checkpoint, and to the facing you had when
  you got there. Only *Restart run* forgets checkpoints and the death count.

---

## The district

The demo is five roofs, and the gaps between them are the reason each move exists:

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

V0.4 adds a **machine room to the east and far roofs**, and a pipe up the east
room's side that reaches its roof — so the district now has a vertical route that
is not a staircase and a doorway that is not decoration.

---

## Fall damage and health

Landing hurts above 12 m/s of impact — a free fall of about 2.8 m — and is fatal
at 26 m/s, about 13 m. Damage scales linearly between the two. Death from impact is
reported to the game exactly like a fall off the level, so it gets the same overlay
and respawn; the overlay's wording differs (`YOU DIED` rather than `YOU FELL`).

Four things are worth knowing:

- **A roll cuts the damage to 25%**, which is what turns a fatal drop into a
  survivable one.
- **There is no health regeneration.** It is not on the roadmap, so inventing a
  rule for it would be scope creep.
- **The level's kill plane still wins.** A fall into a canyon reaches −12 m long
  before it reaches the street, so canyon falls are always fatal.
- **Landings do not count while mantling, climbing, piping or wall running**,
  because those reset the fall tracker.

Feedback for a damaging landing is a brief red vignette and a hurt sound.

---

## Models and surfaces

Every prop is an instance of a model from `src/game/level/models.ts` — twenty-one
of them now, from a five-part `crate` to a ten-part `pipe-vertical`. V0.4 adds the
`neon-sign` and a `door-panel` the scene builder hangs off a pivot.

Parts are expressed in **normalised** coordinates: `[0, 1]` across the prop's own
bounding box, with `y` from its underside to its top. That one decision means any
model fits any prop size, so the same `ac-unit` works at 3 × 1.7 × 2.4 m and a
`slab` works for a 30 m roof body and a 0.5 m barrier.

**Collision stays the prop's box.** The parts are surface detail, and a box is the
right approximation for all of them.

Each part names a **surface**, and a prop may recolour any of them:

```
{ id: 'metal', texture: 'metal-panel', tint: '#67717f', metresPerTile: 2 }
```

V0.4 gives a surface two more jobs. It can be **emissive** (it lights itself), and
it now has an **acoustic** character:

```
texture      ->  acoustic material
deck-plate   ->  metal
metal-panel  ->  metal
concrete     ->  concrete
hazard       ->  metal      (a painted rail is still a steel rail)
grille       ->  grate
glass        ->  glass
sign         ->  glass      (a lit sign is a glass tube in a metal frame)
```

That mapping lives in `surfaces.ts` rather than in the audio code, so what a
surface *sounds* like follows from what it is made of, decided in one place. The
level gives every collider an acoustic material — taken from the surface of the
prop's **topmost part**, which is what you would stand on — and the physics layer
carries it as a plain string, so it never has to know what a surface is.

---

## The skybox

V0.1's sky was a gradient stretched over a sphere. V0.2 replaces it with a real
**six-face cube skybox**, built by evaluating a single function of direction:

```
skyColorAt(direction) -> colour
```

Each face is that function sampled over the directions its texels point at, using
the standard OpenGL cube map mapping. This is what makes the seams disappear for
free — two neighbouring faces agree along their shared edge because the edge's
texels point the same way on *both* — and it also makes the whole thing testable.

The sky itself is a four-stop elevation gradient, dark at the zenith and glowing
magenta at the horizon, with a cloud band whose modulation is a sum of sines of the
*azimuth*, so the pattern is continuous all the way around.

A cube skybox needs no geometry at all: it is simply `scene.background`. If the
textures are missing it falls back to a flat colour.

---

## Sound

There are no audio files. Both the effects and the music are synthesised from
scratch into plain `Float32Array`s at 48 kHz — the same trick the textures use, so
the "palette" lives in code, is reviewable, and cannot drift from what ships.

- **`src/audio/synth.ts`** is the synthesiser: one-pole filters, envelopes, noise,
  and the note generators. Pure functions from parameters to samples.
- **`src/audio/director.ts`** decides *what* to play. It is pure too: it watches the
  player and emits cues. The footstep cadence is driven by distance travelled, so
  a sprint steps faster than a walk without a timer.
- **`src/audio/engine.ts`** is the only Web Audio code: it builds the buffers once
  and plays them. A browser that refuses an audio context, or throws on playback,
  degrades to `SilentAudio` rather than breaking the game. `M` mutes.

**Footsteps are surface-aware.** V0.4 made the step a two-axis sound: the *gait*
picks the pace, and the *material underfoot* picks the character — where the scuff
is filtered, how low and long the body thump is, and how the two are balanced. A
metal deck rings, a concrete roof thuds, a grate rattles and a glass panel tinks,
and the two axes are independent, so every combination is covered without a sample
per case. The default is metal, which is exactly the V0.3 sound, byte for byte.

**Pipes tick and scrape.** Working a pipe up ticks like a face climb — they are the
same hand-over-hand sound against metal — and sliding *down* one drags like a slide
does, because it is the same event against the same surface.

**The footsteps are deliberately soft.** V0.2's version had a 2 ms attack, a 35 ms
decay and a bright 2.6 kHz filter, which at three and a half steps a second read as
a snare roll. The attack is now a slow-in over 10 ms, the decay is longer, the
filter is darker, and most of the level is in the low body rather than the scuff.

**I cannot judge how it sounds.** Everything is verified numerically — length,
peak, RMS, DC offset, determinism, that a sprint step is longer than a crouched
one, that a grate is brighter than concrete — but taste is not testable.

---

## How the textures are made

`src/assets/textures/*.png` are generated, not drawn. `tools/textures/png.ts`
contains a small, dependency-free PNG encoder (8-bit RGBA, filter type 0, one IDAT
chunk, CRCs via `node:zlib`); the generators build a 2048 × 512 skyline, six
skybox faces and seven tileable object surfaces from a seeded PRNG.

That has three consequences worth the trouble:

- **The palette lives in code.** Recolouring the city is an edit to one table,
  reviewable in a diff, rather than a binary blob nobody can read.
- **It is reproducible.** `npm run assets` regenerates exactly the same images, on
  any machine, every time.
- **It cannot silently drift.** The PNGs are committed, and
  `tests/render/textures.test.ts` decodes each committed file and compares its
  *pixels* against a freshly generated image.

The surface *ids and tile sizes* live in `src/` (the renderer needs them at
runtime) and a test asserts the two agree. The sign texture is the one surface
that is deliberately **dark**, because it is used as an emissive map — that is the
exception the "every surface is authored light" rule carries.

---

## Architecture

The codebase is split along one rule: **nothing that can be computed is allowed to
depend on the browser.**

```
core/          pure utilities: math, vectors, randomness, delta time, loop, logging
game/physics/  AABB collision solver + ledge, wall and vault probing   (no three.js)
game/level/    declarative level data, models, surfaces, doors, validation
game/          player movement, the movement state machine, look maths
audio/         synthesiser + cue director (pure); Web Audio playback
diagnostics/   crash reports, sinks, frame statistics          (no three.js)
input/         input state (pure) + DOM/pointer-lock glue
render/        the only place three.js is imported at runtime
tools/         the texture generator, run directly on Node
ui/            DOM overlays, the two HUDs, menus, report export
```

That is why the whole simulation, the audio synthesiser, the crash reporter, the
door state, the movement machine, the UI **and the scene graph** can be tested in
Node and jsdom. three.js scene objects are pure JavaScript — only `WebGLRenderer`
needs a GPU — so `sceneBuilder` is covered by tests too. The only module the suite
cannot reach is `render/view.ts`, which exists precisely to own the WebGL context;
that one is verified by running the demo in a real browser.

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
        ├─ drain queued UI actions (F3 / M / Esc / R / E)
        ├─ apply accumulated mouse motion to yaw + pitch   ← once per frame
        ├─ FixedStepAccumulator.run(dt)                    ← 0..5 × 1/60 s
        │       └─ stepPlayer()  ← the mode priority chain:
        │              dead → scripted move → hanging → climbing → piping → locomotion
        │              (locomotion itself resolves wall running and sliding;
        │               every mode reports started / ended / landing events)
        ├─ watch the movement state machine for illegal transitions
        ├─ play the audio cues those steps produced
        ├─ swing any door that is moving, and hand the fraction to the view
        ├─ FrameStats.push(dt)
        ├─ render the interpolated eye position, stance height and head bob
        └─ update the HUDs (throttled to 10 Hz)
```

Two details worth knowing:

- **Simulation is fixed-step, rendering is not.** Physics always advances in exact
  1/60 s steps, so behaviour is identical on a 60 Hz and a 240 Hz display. The
  leftover fraction of a step interpolates the camera, which removes judder.
- **The loop keeps running while paused.** Simulation, statistics, rendering and
  audio are all skipped, but the loop still ticks so the menus stay responsive and
  key handling lives in exactly one place.

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
  the level. `validateLevel()` rejects geometry thinner than the sub-step — which
  is why a door panel is a chunky 0.3 m: the solver has no idea it is a door.
- **Stable resting contact.** A hair-thin separation (`COLLISION_SKIN = 1e-3`) is
  left between the player and every surface, and the solver probes a couple of
  centimetres downwards so "standing still" is still *grounded*.

V0.4 adds two things to the world itself: a collider may carry an **acoustic
surface** (so a step knows what it landed on), and a collider may be **switched
off** at runtime (`setColliderEnabled`) — which is how an open door stops being
solid without the world being rebuilt.

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
game state — including health, death cause, locomotion mode and the checkpoint
reached. An illegal movement transition is logged by name, so it reaches a report
too.

Storage key: `cyberparkour.crash-reports.v1` (at most 10 reports).

---

## The HUDs

**The play HUD** (`src/ui/gameHud.ts`) is the one a player is meant to read. It
shows exactly two things: **health**, as a banded bar scaled with a compositor
transform, and **checkpoints**, as `CP n / total` beside a row of pips.

**The debug overlay** (`src/ui/hud.ts`, toggled with `F3`) is for developing the
game, refreshed at 10 Hz so DOM layout never shows up in the frame budget:

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
STATE   PIPE
DEATHS  1
FRAMES  1234 in 20.5 s
GPU     ANGLE (NVIDIA, ...)
```

`GAIT` names the walking mode (`idle` / `walk` / `sprint` / `crouch` / `roll`), and
`STATE` names the locomotion mode — `grounded (deck)`, `airborne`, `MANTLING`,
`PULL-UP`, `HANGING`, `CLIMBING`, `PIPE`, `SLIDING`, `WALL RUN`, `VAULTING`,
`ROLLING`, `DEAD`. Those two rows are how you confirm the abilities are doing
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

850 tests in 32 files, in five layers:

- **Unit tests** — maths, the delta-time system, the game loop, the input state,
  the AABB helpers, the collision solver, every movement mode and their
  transitions, the movement state machine and its transition graph, ledge, wall
  and vault probing, pipe climbing, the door system, models, level validation,
  frame statistics, the crash reporter/sinks/report builder, the audio
  synthesiser and director, the play HUD, the debug HUD and every screen.
- **Traversal tests** (`tests/game/traversal.test.ts`) — the V0.3 moves against
  small, purpose-built worlds: wall running, wall jumping, rolling, vaulting, the
  Kong vault and checkpoints.
- **Integration tests** (`tests/integration/simulation.test.ts`) — the real
  pipeline, level → collision world → fixed-step accumulator → player, run
  headlessly *on the district that ships*. They assert the invariants unit tests
  cannot see: no tunnelling, no sinking, no escaping the level, determinism, that a
  fall from every edge is fatal, and that the abilities all work on the real
  geometry — including climbing the pipe the district actually has.
- **DOM tests** (`// @vitest-environment jsdom`) — the browser boundaries: the
  screens, their menu navigation and callbacks, the death overlay, the damage
  flash, the doors (worked with `E`, and pushed to a fresh view), report export,
  keyboard handling and the pointer-lock lifecycle.
- **Asset tests** (`tests/render/`) — the scene graph (skybox, backdrop, lighting,
  point lights, emissive signs, door pivots, UV scaling, disposal) and the
  committed textures against their generators.

Several tests exist because they caught real bugs during development:

- `GameLoop` could not be stopped by a fatal frame error, because inside a frame
  callback the pending handle is already null. Stopping now sets a flag.
- `clampSpeed` returned *without* clamping a non-finite velocity, letting
  `Infinity` reach the solver.
- A browser without pointer-lock support paused the game the instant it started.
- `serializeError` fell back to `[object Object]` for a thrown circular object.
- `buildScene` disposed textures it borrowed, leaving every session after a
  restart with a bare sky.
- The landing box for a mantle sat exactly on the ledge top, so rounding decided
  whether it overlapped — making some ledges unmantleable depending on nothing
  more than a height's last bit.
- Grabbing a ledge snapped *both* horizontal axes to the collider's corner, which
  on a 20 m terrace teleported the player 8 m sideways.
- Deaths from fall damage were never reported to the game, so they got no overlay.
- The head bob read its fade rate as a `damp` fraction, so anything above a rate of
  1 was clamped to 1 — "arrive immediately" — and the bob snapped on and off at
  every start and stop.
- A pipe grab left the player *exactly* flush against the pipe, so the box
  overlapped by a rounding error and the solver pushed the player a metre and a
  half straight down. Latching on now leaves a collision skin.

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
│       ├── surfaces.ts         the tileable object textures, incl. the sign
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
    │   ├── synth.ts            the soundbank, incl. per-surface footsteps
    │   ├── director.ts         which cue to play, and when (pure)
    │   └── engine.ts           Web Audio playback + a silent fallback
    ├── game
    │   ├── game.ts             the state machine: start/pause/restart/quit/menu
    │   ├── movement.ts         the movement state machine + transition graph
    │   ├── look.ts             mouse-look maths
    │   ├── player.ts           movement modes, traversal moves, head bob, health
    │   ├── level
    │   │   ├── levelData.ts    the demo district, as plain data
    │   │   ├── models.ts       the model library
    │   │   ├── surfaces.ts     the surface, acoustic and emissive tables
    │   │   ├── doors.ts        the runtime state of every swinging door
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
    │   ├── view.ts             WebGLRenderer, camera, doors, resize, teardown
    │   └── sceneBuilder.ts     level geometry, lights, signs, doors, skyline
    └── ui
        ├── dom.ts              small element helpers
        ├── gameHud.ts          the play HUD: health bar and checkpoint pips
        ├── hud.ts              the debug overlay
        ├── screens.ts          title / controls / about / pause / ended / crash
        └── reportIO.ts         report download and clipboard export
```

---

## Deliberate decisions and limitations

**Collision ignores the models.** A prop collides as its box, not as its parts.
Better collision is V0.6.

**Mantling is automatic**, and so is every other move but the door. There is no
key for a wall run, a vault, a roll or a pipe: in a game about maintaining flow, a
route should not be lost to remembering which button starts which move. Doors are
the exception because a door is a *choice about the world*, not a movement.

**A door is solid or it is not.** Between shut and half-open the mesh and the
collider disagree. Modelling a swinging box properly is a swept-rotation problem
this demo does not need, and the alternative — a door that blocks until it is
fully open — reads as a bug.

**The rooms have no floor of their own.** They stand on the deck, because a raised
floor would put a lip across the doorway that neither a walk nor a mantle takes.

**Neon signs glow but do not light the world.** They are emissive surfaces with a
dim point light beside them for spill. Full emissive neon, fog and smoke are V0.5.

**The audio is synthesised and unverified by ear.** Structure is tested; taste is
not testable. It is deliberately quiet and simple.

**Head bob has no lateral roll.** Camera *effects* are V0.6.

**Performance: the props are many small meshes.** V0.4 added a bar of point lights
and more geometry, which is invisible on a GPU but noticeable under software
rendering. Batching and merging are V0.6's optimisation work.

**One module has no unit tests:** `render/view.ts`, which exists to own the WebGL
context. It is verified by running the demo in a real browser, which is also how
the skybox, the textures, the lighting and the movement abilities were checked.

**The crash reporter is local-only.** Nothing is uploaded.

**No `LICENSE` file yet.** Without one, the default is "all rights reserved".

---

## Out of scope for V0.4

The roadmap continues past this demo. Nothing below is implemented, and none of it
is stubbed:

**V0.5** a complete small district, elevators, emissive neon, fog and smoke, a
better skybox, collectibles, level completion, time trials.

**V0.6** feel, camera effects, animations, lighting, audio, models, UI,
optimisation, settings (sensitivity, FOV, graphics, keybinds), player model.

**V0.7** polish, and labelling the district as Level 1.

---

## Roadmap

V0.0 built the engine skeleton, V0.1 made it a place, V0.2 made it a place you can
move through, and V0.3 turned it into a route across a district.

V0.4, this version, opens the district up: the movement modes became an explicit
state machine, a pipe joined the abilities as the one that goes both ways, two
roofs gained machine rooms behind doors you open yourself, the signage glows, and
footsteps finally know whether they landed on metal, concrete, a grate or glass.

The next milestone is V0.5: a complete small district, elevators, emissive neon,
fog and smoke, a better skybox, collectibles, level completion and time trials.
