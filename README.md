# Cyberparkour — Technical Demo

[![CI](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml/badge.svg)](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml)

A low-poly, Quake-styled **first-person parkour game** set in a cyberpunk city,
in the spirit of *Mirror's Edge*.

This repository currently contains **V0.5**. V0.3 made the roof a route, and V0.4
took the route indoors. V0.5 makes it a **level**: nine roofs on two levels, joined
by two lifts so the district closes into a loop rather than running out at one end,
with eight pickups strung along the way, a finish line that only opens when the
route is behind you, and a clock. The air has fog and drifting smoke in it, the sky
has stars in it, and the neon is on the buildings as well as the signs.

---

## Table of contents

1. [Status](#status)
2. [What V0.5 delivers](#what-v05-delivers)
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
15. [Lifts](#lifts)
16. [Pickups, the finish and the clock](#pickups-the-finish-and-the-clock)
17. [Checkpoints and respawn](#checkpoints-and-respawn)
18. [The district](#the-district)
19. [Fog, smoke and the sky](#fog-smoke-and-the-sky)
20. [Neon](#neon)
21. [Fall damage and health](#fall-damage-and-health)
22. [Models and surfaces](#models-and-surfaces)
23. [Sound](#sound)
24. [How the textures are made](#how-the-textures-are-made)
25. [Architecture](#architecture)
26. [How a frame works](#how-a-frame-works)
27. [Collision](#collision)
28. [Crash reporting](#crash-reporting)
29. [The HUDs](#the-huds)
30. [Testing](#testing)
31. [Continuous integration](#continuous-integration)
32. [Project layout](#project-layout)
33. [Deliberate decisions and limitations](#deliberate-decisions-and-limitations)
34. [Out of scope for V0.5](#out-of-scope-for-v05)
35. [Roadmap](#roadmap)

---

## Status

| | |
| --- | --- |
| Version | `0.5.0` |
| Stage | Pre-alpha, playable demo |
| Stack | TypeScript · three.js · Vite · Vitest |
| Runs in | Any modern desktop browser with WebGL 2 and Web Audio |
| Tests | 939 across 35 files |
| Coverage | ~93% of statements (of the unit-testable surface) |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

V0.5 is finished and frozen. Nothing from V0.6 onward is implemented, and none of
it is stubbed.

---

## What V0.5 delivers

Every item from the V0.5 section of the project roadmap, and where it lives:

| Feature | Where |
| --- | --- |
| A complete small district | `levelData.ts` — nine roofs on two levels, joined into a loop |
| Elevators | `level/elevators.ts` (`ElevatorSystem`, `carryRider`), `CollisionWorld` moving a collider |
| Emissive neon | `models.ts` (`neon-strip`), `levelData.ts` (bands and tower signs), `sceneBuilder.ts` (emissive materials) |
| Fog and smoke | `levelData.ts` (`environment` fog, `smoke` plumes), `render/effects.ts` (`smokePose`) |
| A better skybox | `tools/textures/skybox.ts` — a star field, a city-glow band, two cloud layers |
| Collectibles | `levelData.ts` (`collectibles`), `game.ts` (`updateTriggers`), `render/effects.ts` (`pickupPose`) |
| Level completion | `game.ts` (`completeRun`), `ui/screens.ts` (`showComplete`), `game/run.ts` (`RunState.armed`) |
| Time trials | `game/run.ts` (`RunState`, `formatRunTime`, the stored record), `ui/gameHud.ts` (the clock) |

Everything V0.1-V0.4 built is still here, and V0.5 builds *with* it rather than
beside it: the lifts are a new kind of collider in the existing collision world,
the pickups reuse the trigger test the checkpoints already had, and the run state
is driven by the checkpoint events the game was already handling.

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

Stand on a lift and it takes you with it: no key, no button. The title screen
offers **Play / Controls / About**; Esc opens **Resume / Respawn / Controls /
Restart run / Main menu / Quit demo**.

---

## What you should see

A **district on two levels**. Above, the five roofs from V0.3-V0.4 — the home roof
with its access block and machine room, the east and far roofs with rooms behind
doors you open yourself, the canyon with its facade and service beam. Below and to
the south, a **service level**: four works roofs, six metres down, carrying the
ducts, tanks, risers and cable the buildings above need. Two **lifts** link them,
one down from the far roof and one back up to the home roof, so the whole thing is
a loop you can run.

Along the way, eight **pickups** hang in the air — some over a tank, some over a
beam, one over the canyon — and a **finish** stands on the home roof under a
column of light, waiting until you have the route behind you. There is a **clock**
in the corner of the screen and a **record** kept between sessions.

In the air itself: fog that pulls the skyline into the haze, plumes of **smoke**
drifting off the plant, and a sky with **stars**, two layers of cloud and a warm
glow along the horizon where the city's light pools.

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

**Jump.** Only from the ground, at 7.2 m/s upward, for an apex of about 1.0 m under
26 m/s² gravity. Jump is a *held* state rather than a one-shot, so holding it while
landing jumps again.

**Crouch.** Instant to enter, but standing up is conditional on
`CollisionWorld.isFree`, so releasing crouch under the duct does not grow the
player into the ceiling.

**Slide.** Crouching *while running* — above 6.5 m/s — starts a slide with its own
much lower friction and a 12% speed boost. It ends once friction has bled it below
2.6 m/s, or after 2.6 seconds, or when crouch is released.

**Head bob.** Driven by *distance travelled* rather than time, so the cadence
tracks speed and is identical at any frame rate. Deliberately quiet: 3.4 cm
vertical, 1.7 cm lateral, a slow fade, and an amplitude that falls off with speed.

---

## The movement state machine

V0.1 had one movement mode, V0.2 six, and V0.3 more again, all resolved by an
ad-hoc priority chain. V0.4 made the modes explicit, in `src/game/movement.ts`:

- **`deriveMotionState`** is the *one* place that decides what the player is doing,
  from their flags. `locomotion()` in `player.ts` is a thin adapter over it.
- **`MOTION_TRANSITIONS`** states which one-tick transitions are legal.
- **`MotionTracker`** follows the player across ticks and reports the moves between
  states — including, in the running game, when one is *not* allowed.

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
*is*. A change that let a wall run turn straight into a climb would be one line that
no obvious test would catch — but it is an *illegal transition*, and both the suite
and the running game assert every move is a legal one.

---

## The manoeuvre bands

Mantling, pull-ups and climbing share one probe (`findLedge` in
`src/game/physics/ledges.ts`). What differs is which *height band* each accepts:

| Situation | Ledge height above the feet | Result |
| --- | --- | --- |
| Grounded | 0.4 – 1.4 m | **Mantle** — automatic, no key needed |
| Grounded | above 1.4 m | blocked; you have to jump |
| Airborne | 1.4 – 2.6 m | **Grab** — catch it and hang |
| Hanging | `Space` (pressed *after* releasing) | **Pull-up** onto the top |
| Facing a tagged face, holding forward | any height > 1.6 m | **Climb** at 2.4 m/s |

The bands do not overlap, so a ledge you can step onto is mantled, a ledge you can
only just reach is grabbed, and a face taller than a jump and a grab is climbed.
Reachability of every ledge is a *consequence* of these numbers, so the level tests
assert the relationships rather than the heights.

---

## Wall running

Aim along a wall while airborne and, above 6 m/s, you attach and run along it.
Gravity drops to **16%**, so a run is a controlled descent, and it lasts **1.5
seconds** before it lets go. The probe only accepts a wall *parallel* to your
travel — a face straight ahead is something to run into, not along — and takes the
nearest. Leaving a wall locks it out for 0.35 s when the run ends on its own, so a
run cannot restart on the next step and become an indefinite hover.

---

## Wall jumping

Press jump next to a wall and you kick off it: away at **6.4 m/s**, upward at
**7.8 m/s** (higher than a standing jump), keeping **92%** of your along-wall speed.
That last number is what makes chaining work. What stops a *single* wall from being
climbed is the lockout: the wall you just left is refused for **0.55 s**, longer
than the jump's own airtime.

---

## Vaulting and the Kong vault

Run into a waist-high obstacle — 0.5 m to 1.15 m tall, no more than 1.1 m deep —
and you cross it instead of stopping at it. The difference from a mantle is what is
on the far side: a **mantle ends on top** of the obstacle, a **vault ends past it**.

| | Entry speed | Outcome |
| --- | --- | --- |
| **Vault** | above 7 m/s | a hop across, keeping 62% of your speed |
| **Kong vault** | above 9.5 m/s (a sprint) | a dive: further, lower, keeping 92% |

---

## The landing roll

Crouch *in the air* on a landing that would otherwise hurt and you roll out of it,
taking **25%** of the fall damage, carried 3.4 m forward and leaving you running at
3.5 m/s. The move is *low-profile*, so a roll under a duct is possible and the
collision box and the eye height can never disagree about how tall the player is.

---

## Pipe climbing

The only ability that works **both ways**. Aim into a pipe above 1.2 m tall and you
latch onto it, flush against its face. Then:

- **Forward** climbs at 3.4 m/s — a little faster than a climbable face, because a
  pipe is the route that is *meant* to be climbed.
- **Back or crouch** slides *down* at **9.5 m/s**: nearly three times the climb
  speed, which is what makes dropping down a pipe a move rather than a crawl.
- **Nothing** holds position: a pipe is somewhere you can stop and rest.
- **Jump** kicks off — out and up, so leaving keeps the height gained.
- **The top** hands over to a mantle onto whatever the pipe reaches, if there is
  room; if there is not, the pipe simply stops there.

Releasing a pipe refuses it for 0.3 s, so a jump off is not undone on the next step.
Grabbing one leaves a **collision skin** on purpose: landing *exactly* flush leaves
the box overlapping by a rounding error, and the solver's answer to an overlap on
the wrong axis is to push the player a metre and a half straight down.

---

## Interiors and doors

Two of the roofs carry a **machine room**: walls, a roof, a doorway, a door,
fittings inside, a lit sign on the back wall and a lamp overhead. The geometry comes
from one `room()` helper, so a third would be a few lines.

Some details that are load-bearing:

- **The floor is the deck.** A raised interior floor would put a lip across the
  doorway, and a lip is a step the mantle band will not take (its floor is 0.4 m)
  but a walk into it will not either.
- **A doorway is two walls and a beam.** Collision is per-prop boxes, so a wall with
  a hole is two segments, two jambs and a lintel — and the lintel rests *on the
  jambs*, which is both how a doorway is really built and what keeps the level's
  "nothing floats" rule satisfied.
- **A door is a collider the game can switch off.** Past halfway open it stops
  blocking. Between shut and half-open the mesh and the collider disagree: a
  deliberate simplification, because modelling a *swinging* box is a swept-rotation
  problem this demo does not need.
- **The lamps matter.** The sun does not reach inside a building, and a room with no
  light of its own is a black hole you can hear your footsteps in.

Press `E` next to a door to work it. There is no "use" target: doing nothing when no
door is in reach is correct.

---

## Lifts

A lift is the one piece of geometry that moves under its own power, and it breaks
the collision world in the two places that matter:

- **Its collider has to travel with it.** The platform must be a real surface at
  every point in its travel, not a mesh that happens to be drawn there. So
  `ElevatorSystem` owns the collider's box and rewrites its `y` range as the lift
  travels — and because the solver's sub-step is clamped to the thinnest collider,
  a platform is *thick* (0.6 m) rather than a plate.
- **Whoever is standing on it has to come along.** The game moves the lift first,
  carries the rider if `groundId` matches, and *then* steps the physics — so the
  ground probe sees the new surface rather than the old one, and the floor never
  slides out from under anybody. Both the feet and the interpolated twin move, or
  the renderer would smear the rider across the whole travel for a frame.

The travel itself is a **pure function of elapsed time** rather than an integrated
state machine: a lift asked "where are you after 37.2 seconds?" answers the same
whether it got there in one step or a thousand. That makes it testable, and it makes
a long frame harmless.

A lift's numbers are its two *floors*, not its speed: it starts and ends **flush**
with the deck at each end, so getting on and off is a step and not a climb. A
fraction out either way would be an invisible lip that neither a walk nor a mantle
takes — which is exactly the sort of bug the level test checks for.

Two lifts run in the district: `lift-down` from the far roof to the works, and
`lift-up` from the works back to the home roof. They are what make the district a
loop.

---

## Pickups, the finish and the clock

V0.5 turned the district into something you **complete**, and `src/game/run.ts` is
the state that says whether you have, how long it took, and whether it was your
best. It is plain numbers and a `Set`, which is what makes a time trial testable
without a browser.

- **The clock starts when you do**, not when the session does. Standing on the spawn
  deciding where to go is not part of a run, so the first tick that reports movement
  is the first tick that counts.
- **The finish is armed, not always live.** Crossing the goal only counts once every
  checkpoint is behind you, so a level cannot be finished by touching the line at
  the start — which is exactly the exploit a goal near the spawn would otherwise
  hand out.
- **The record is kept between sessions**, in `localStorage`, and only ever
  improves. It is read and written through an injected store, so the game never
  reaches for storage itself and a test can supply a fake.

Eight pickups are strung along the route. Each one is tested **once per simulation
step** rather than once per frame — a player at sprint speed covers a third of a
metre per step, and a trigger tested per frame is one that can be run past. Taking
one hides it, plays a bell that rises a step with each one, and counts it on the
HUD. Taking the last one says so.

Reaching the finish stops the clock, weighs the record, writes it, and freezes the
world behind a **results screen** with the time, the record, the pickups and a split
per checkpoint — the same shape as pausing, because a finished run is a paused run
with a story to tell.

---

## Checkpoints and respawn

Pass within 3 m of a checkpoint (and within 2.5 m vertically) and it becomes your
new respawn point. Five trace the route — annex, east, high, far, works — and the
last one is what arms the finish.

- **Only ever forwards.** Walking back over an earlier checkpoint changes nothing.
- **A checkpoint can be skipped.** Reaching a *later* one on foot still records.
- **Progress survives a respawn.** `respawnPlayer` returns you to your *respawn*
  point. Only *Restart run* forgets checkpoints, pickups and the clock.

A checkpoint also records a **split**, so the results screen can show where the run
was won and lost.

---

## The district

Nine roofs on two levels, and the whole thing runs as a loop:

```
                       ┌───────── home (0 m) ─────────┐
                       │                               │
      annex (2 m)      │                               │     goal
                       ▼                               │
                   east (1.2 m) ──► high (3.6 m) ──[12 m canyon]──► far (1.2 m)
                       ▲                               │                 │
                       │                               │            lift-down
                       │                               │                 ▼
                  lift-up ◄──── works-4 ◄─ works-3 ◄─ works-2 ◄──── works-1 (-5 m)
```

- The **gaps** on the upper level are 6 m with a rise, which is what a jump plus a
  grab reaches. The **canyon** is 12 m — wider than a sprint jump — with a tall
  facade along its north side, so the fast way across is a wall run and the slow way
  is the 1 m service beam.
- The **works** below are four roofs 4 m apart with their heights wandering by a
  metre, carrying ducts, tanks, risers and cable. They are what the rooftops came
  from, and they are the long run home.
- The **lifts** close the loop. Without them the district would be a line that ends
  at the far roof.

Heights are chosen from the movement config, not by eye, and the level tests assert
those relationships rather than the metres.

---

## Fog, smoke and the sky

**Fog.** The district is 120 m across and the skyline is painted on a cylinder 240 m
out, so the fog range is chosen so the city *dissolves* into the haze rather than
ending at a line: it starts at 90 m and is full at 480 m, in a colour picked to
match the sky's horizon glow rather than a neutral grey.

**Smoke.** Five plumes drift off the plant and out of the canyon. They are
camera-facing sprites with their own material each — they share the puff texture,
but each fades on its own schedule, and a shared material would fade a whole plume
at once. The motion is a cycle: a puff is born at the base, climbs, spreads and
fades out, while the next one starts. It is transparent at *both* ends of its life
(`sin(πt)`), which is what stops a plume popping, and it is a pure function of the
clock, so a long frame moves it exactly as far as several short ones.

**The sky** is still built by evaluating one function of direction, so the six
faces stay seamless — but V0.5 gave it something to say:

- a **star field**, sparse and dim, thinned towards the horizon and by cloud. The
  stars come from a hash of the direction's cell rather than a random walk, so the
  sky stays deterministic and a star sits *inside* its cell — which is what keeps
  the field cheap enough to evaluate per pixel.
- a warm **city-glow band** just above the skyline, brightest where the district is.
- **two cloud layers** at different scales, lit from below near the horizon.

The skybox faces went from 256² to 512² to carry them: at 256 the stars were a pixel
or two wide and mostly aliased away. There is also a subtle bug fixed here — the
below-horizon gradient used to *restart* at a darker colour, which drew a hard line
across the sky at the skyline; it now carries the horizon colour downwards, and a
test samples either side of elevation zero to say so.

---

## Neon

Neon is an **emissive surface**: the tint becomes the *emissive* colour and the
texture becomes the *emissive map*, so only the lit parts of the texture glow and
the albedo goes dark so the sun does not wash it out.

V0.4 had signs. V0.5 puts the district's light on the *buildings* as well:

- **Lit bands** (`neon-strip`) across the canyon facade, along a machine room's
  front, and along a works roof — a neon tube on a slim housing, lit all round, so
  it works flat on a deck or mounted on a wall.
- **Signs on the towers north of the district** (`neon-sign`), which is a
  constraint worth knowing: a sign glows out of its front face, so only a facade
  facing back towards the roofs will read.
- A **dim point light** beside each, so a sign lights the wall it is on rather than
  being a glowing rectangle on a black one.

---

## Fall damage and health

Landing hurts above 12 m/s of impact — a free fall of about 2.8 m — and is fatal at
26 m/s, about 13 m. Death from impact is reported to the game exactly like a fall
off the level, so it gets the same overlay and respawn.

- **A roll cuts the damage to 25%**, which is what turns a fatal drop into a
  survivable one.
- **There is no health regeneration.** It is not on the roadmap, so inventing a rule
  for it would be scope creep.
- **The level's kill plane still wins.** It sits at −12 m, so a fall from the
  rooftop route *or* the works level is always fatal.
- **Landings do not count while mantling, climbing, piping, wall running or riding a
  lift**, because those reset the fall tracker.

---

## Models and surfaces

Every prop is an instance of a model from `src/game/level/models.ts` — twenty-four
of them now, from a five-part `crate` to a ten-part `pipe-vertical`, plus the V0.5
`neon-strip`, `lift-platform` and `data-shard`.

Parts are expressed in **normalised** coordinates: `[0, 1]` across the prop's own
bounding box, with `y` from its underside to its top. Any model fits any prop size.
**Collision stays the prop's box**: the parts are surface detail, and a box is the
right approximation for all of them.

A surface has three jobs now. It can be **emissive** (it lights itself), it has an
**acoustic** character (what it sounds like underfoot), and it has the visual tint
and detail map it always had:

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

The level gives every collider an acoustic material, taken from the surface of the
prop's **topmost part** — which is what you would stand on — and the physics layer
carries it as a plain string, so it never has to know what a surface is.

---

## Sound

There are no audio files. Both the effects and the music are synthesised from
scratch into plain `Float32Array`s at 48 kHz, so the "palette" lives in code and
cannot drift from what ships.

- **`src/audio/synth.ts`** is the synthesiser: one-pole filters, envelopes, noise,
  and the note generators. Pure functions from parameters to samples.
- **`src/audio/director.ts`** decides *what* to play, from the player's state.
- **`src/audio/engine.ts`** is the only Web Audio code, and degrades to
  `SilentAudio` rather than breaking the game. `M` mutes.

V0.5 adds two sounds to the bank. A **pickup** is a short bell that rises two
semitones with each one taken — the rising pitch is the sound's whole job, because
it tells the player how many they have without them reading the counter. The
**finish** is a major chord that blooms rather than strikes: four voices on one
root, each entering a little later and fading a little longer, which is what the end
of a run should sound like after however many minutes of footfalls.

**Footsteps are surface-aware**, added in V0.4: the *gait* picks the pace and the
*material underfoot* picks the character. A metal deck rings, a concrete roof
thuds, a grate rattles, glass tinks — and the default is byte for byte the V0.3
sound.

**I cannot judge how it sounds.** Everything is verified numerically — length, peak,
RMS, DC offset, determinism, that a pickup rises in pitch, that the finish swells
rather than strikes — but taste is not testable.

---

## How the textures are made

`src/assets/textures/*.png` are generated, not drawn. `tools/textures/png.ts`
contains a small, dependency-free PNG encoder; the generators build a 2048 × 512
skyline, six 512² skybox faces, seven tileable object surfaces and one smoke puff,
all from a seeded PRNG.

That has three consequences worth the trouble:

- **The palette lives in code.** Recolouring the city is an edit to one table,
  reviewable in a diff.
- **It is reproducible.** `npm run assets` regenerates exactly the same images, on
  any machine, every time.
- **It cannot silently drift.** The PNGs are committed, and
  `tests/render/textures.test.ts` decodes each committed file and compares its
  *pixels* against a freshly generated image.

The surface *ids and tile sizes* live in `src/` (the renderer needs them at runtime)
and a test asserts the two agree. The sign texture is the one surface that is
deliberately **dark**, because it is used as an emissive map — that is the exception
the "every surface is authored light" rule carries.

---

## Architecture

The codebase is split along one rule: **nothing that can be computed is allowed to
depend on the browser.**

```
core/          pure utilities: math, vectors, randomness, delta time, loop, logging
game/physics/  AABB collision solver + ledge, wall and vault probing   (no three.js)
game/level/    declarative level data, models, surfaces, doors, lifts, validation
game/          player movement, the movement machine, the run state, look maths
audio/         synthesiser + cue director (pure); Web Audio playback
diagnostics/   crash reports, sinks, frame statistics          (no three.js)
input/         input state (pure) + DOM/pointer-lock glue
render/        the only place three.js is imported at runtime
tools/         the texture generator, run directly on Node
ui/            DOM overlays, the two HUDs, menus, report export
```

That is why the whole simulation, the audio synthesiser, the crash reporter, the
door state, the lift travel, the run clock, the movement machine, the UI **and the
scene graph** can be tested in Node and jsdom. three.js scene objects are pure
JavaScript — only `WebGLRenderer` needs a GPU — so `sceneBuilder` is covered by
tests too. The only module the suite cannot reach is `render/view.ts`, which exists
precisely to own the WebGL context; that one is verified by running the demo in a
real browser.

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
        │       ├─ move the lifts, and carry whoever is standing on one
        │       ├─ stepPlayer()  ← the mode priority chain:
        │       │      dead → scripted move → hanging → climbing → piping → locomotion
        │       ├─ tick the run clock
        │       └─ check the pickups and the finish
        ├─ watch the movement state machine for illegal transitions
        ├─ play the audio cues those steps produced
        ├─ swing any door that is moving, and hand the fraction to the view
        ├─ animate the smoke and the pickups
        ├─ FrameStats.push(dt)
        ├─ render the interpolated eye position, stance height and head bob
        └─ update the HUDs (throttled to 10 Hz)
```

Two details worth knowing:

- **Simulation is fixed-step, rendering is not.** Physics always advances in exact
  1/60 s steps, so behaviour is identical on a 60 Hz and a 240 Hz display. The
  leftover fraction of a step interpolates the camera, which removes judder.
- **The loop keeps running while paused**, and a finished run is paused in the same
  sense: the results screen is up, the world is frozen behind it, and the loop is
  still there to be restarted.

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
  collider, and the sub-step is clamped to the thinnest collider in the level.
  `validateLevel()` rejects geometry thinner than the sub-step — which is why a door
  panel is a chunky 0.3 m and a lift platform 0.6 m: the solver has no idea either
  of them is anything but a box.
- **Stable resting contact.** A hair-thin separation (`COLLISION_SKIN = 1e-3`) is
  left between the player and every surface, and the solver probes a couple of
  centimetres downwards so "standing still" is still *grounded*.

On top of that, V0.4 and V0.5 gave the world two things a static level never needed:
a collider may carry an **acoustic surface**, may be **switched off** at runtime
(doors), and may be **moved** (lifts).

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
game state. An illegal movement transition is logged by name, so it reaches a report
too.

Storage key: `cyberparkour.crash-reports.v1` (at most 10 reports). The best time
lives under its own key, `cyberparkour.best-time.v1`.

---

## The HUDs

**The play HUD** (`src/ui/gameHud.ts`) is the one a player is meant to read:

- **Health**, as a banded bar scaled with a compositor transform.
- **Checkpoints**, as `CP n / total` beside a row of pips.
- **The trial** — the clock and the pickup count. The clock is dim until the run
  starts and gold once the finish is armed, so "which of these two numbers matters
  right now" is legible without reading either of them.

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
`ROLLING`, `DEAD`.

You can also poke the live game from the devtools console:

```js
cyberparkour.game.snapshot()
cyberparkour.game.runSnapshot
cyberparkour.reporter.reports
cyberparkour.logs.entries()
```

---

## Testing

```bash
npm test
```

939 tests in 35 files, in five layers:

- **Unit tests** — maths, the delta-time system, the game loop, the input state, the
  AABB helpers, the collision solver, every movement mode and their transitions, the
  movement state machine and its transition graph, ledge, wall and vault probing,
  pipe climbing, the door system, the lift travel and its rider carry, the run
  clock, the splits, the record and its storage, the effect poses, models, level
  validation, the crash reporter/sinks/report builder, the audio synthesiser and
  director, the play HUD, the debug HUD and every screen.
- **Traversal tests** (`tests/game/traversal.test.ts`) — the V0.3 moves against
  small, purpose-built worlds.
- **Integration tests** (`tests/integration/simulation.test.ts`) — the real
  pipeline, level → collision world → fixed-step accumulator → player, run
  headlessly *on the district that ships*. They assert the invariants unit tests
  cannot see: no tunnelling, no sinking, no escaping the level, determinism, that a
  fall from every edge is fatal, and that the abilities all work on the real
  geometry.
- **DOM tests** (`// @vitest-environment jsdom`) — the browser boundaries: the
  screens, their menu navigation and callbacks, the death overlay, the damage flash,
  the doors, the results screen, report export, keyboard handling and the
  pointer-lock lifecycle.
- **Asset tests** (`tests/render/`) — the scene graph (skybox, backdrop, lighting,
  point lights, emissive signs, door pivots, lift cars, pickups, smoke, the finish,
  UV scaling, disposal) and the committed textures against their generators.

Several tests exist because they caught real bugs during development:

- `GameLoop` could not be stopped by a fatal frame error.
- `clampSpeed` returned *without* clamping a non-finite velocity, letting `Infinity`
  reach the solver.
- A browser without pointer-lock support paused the game the instant it started.
- `buildScene` disposed textures it borrowed, leaving every session after a restart
  with a bare sky.
- The landing box for a mantle sat exactly on the ledge top, so rounding decided
  whether it overlapped — making some ledges unmantleable depending on nothing more
  than a height's last bit.
- Grabbing a ledge snapped *both* horizontal axes to the collider's corner, which on
  a 20 m terrace teleported the player 8 m sideways.
- The head bob read its fade rate as a `damp` fraction, so anything above a rate of
  1 was clamped to "arrive immediately", and the bob snapped on and off at every
  start and stop.
- A pipe grab left the player *exactly* flush against the pipe, so the box
  overlapped by a rounding error and the solver pushed the player a metre and a half
  straight down.
- A lift's falling leg measured its time from the end of the *wrong* dwell, so the
  platform came down through its own ceiling and past it. The cycle test caught it
  on the first run.
- The below-horizon sky *restarted* at a darker colour instead of carrying the
  horizon down with it, which drew a hard line across the sky.

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
build.

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
│       ├── skybox.ts           the directional sky: stars, glow, cloud
│       ├── surfaces.ts         the tileable object textures, incl. the sign
│       ├── fx.ts               the smoke puff
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
    │   ├── run.ts              the clock, the pickups, the splits, the record
    │   ├── movement.ts         the movement state machine + transition graph
    │   ├── look.ts             mouse-look maths
    │   ├── player.ts           movement modes, traversal moves, head bob, health
    │   ├── level
    │   │   ├── levelData.ts    the demo district, as plain data
    │   │   ├── models.ts       the model library
    │   │   ├── surfaces.ts     the surface, acoustic and emissive tables
    │   │   ├── doors.ts        the runtime state of every swinging door
    │   │   ├── elevators.ts    the travel of every lift, and its collider
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
    │   ├── effects.ts          the pure poses of smoke and pickups
    │   ├── view.ts             WebGLRenderer, camera, doors, lifts, animation
    │   └── sceneBuilder.ts     level geometry, lights, signs, lifts, skyline
    └── ui
        ├── dom.ts              small element helpers
        ├── gameHud.ts          the play HUD: health, checkpoints, the clock
        ├── hud.ts              the debug overlay
        ├── screens.ts          title / controls / about / pause / results / ended / crash
        └── reportIO.ts         report download and clipboard export
```

---

## Deliberate decisions and limitations

**Collision ignores the models.** A prop collides as its box, not as its parts.
Better collision is V0.6.

**Every move but the door is automatic.** There is no key for a wall run, a vault, a
roll, a pipe or a lift: in a game about maintaining flow, a route should not be lost
to remembering which button starts which move. Doors are the exception because a
door is a *choice about the world*, not a movement.

**A door is solid or it is not**, and a lift is a box that moves. Between shut and
half-open the door's mesh and its collider disagree. Modelling a swinging box
properly is a swept-rotation problem this demo does not need.

**The finish is gated on checkpoints, not on pickups.** Collecting everything is a
challenge, not a toll gate: a run should be completable without it, and the pickups
are counted on the results screen instead.

**There is a shortcut, and it is deliberate.** Because `lift-up` arrives flush with
the home roof, a player who works out that they can ride it *down* can cross the
works level in the other direction and skip the upper route. It is a long way round
for little gain, and finding it is the sort of thing a parkour game should reward
rather than forbid.

**The lifts stop the world for a moment.** A 2.4-second dwell at each end means a
lift is somewhere you stand still, which is a deliberate change of pace in a level
about momentum. It also means a run's time includes waiting, which is honest.

**The rooms have no floor of their own.** They stand on the deck, because a raised
floor would put a lip across the doorway that neither a walk nor a mantle takes.

**More lights than a roof needs.** V0.5 puts a point light on every sign, lamp and
lift — twelve in total. They are cheap individually and each one costs every fragment
in the scene, which is exactly the sort of thing V0.6's optimisation work is for. The
smoke and the shadow volume are in the same boat: 220 m of shadow across 2048 texels
is softer than V0.4's 124 m.

**Smoke does not collide, and does not move you.** It is decoration, and it is the
renderer's business: the level says where a plume is and how it behaves, and nothing
else knows it exists.

**The audio is synthesised and unverified by ear.** Structure is tested; taste is
not testable.

**Head bob has no lateral roll.** Camera *effects* are V0.6.

**One module has no unit tests:** `render/view.ts`, which exists to own the WebGL
context. It is verified by running the demo in a real browser, which is also how the
skybox, the textures, the lighting and the movement abilities were checked.

**The crash reporter is local-only.** Nothing is uploaded.

**No `LICENSE` file yet.** Without one, the default is "all rights reserved".

---

## Out of scope for V0.5

The roadmap continues past this demo. Nothing below is implemented, and none of it is
stubbed:

**V0.6** feel, camera effects, animations, lighting, audio, models, UI,
optimisation, settings (sensitivity, FOV, graphics, keybinds), player model.

**V0.7** polish, and labelling the district as Level 1.

---

## Roadmap

V0.0 built the engine skeleton, V0.1 made it a place, V0.2 made it a place you can
move through, V0.3 turned it into a route, and V0.4 opened the route up — indoors,
onto the signage, and into a movement state machine.

V0.5, this version, makes it a **level**: nine roofs on two levels joined by two
lifts into a loop, eight pickups along the way, a finish that has to be earned, and a
clock that is kept between sessions. The air has fog and smoke in it, the sky has
stars, and the neon is on the buildings.

The next milestone is V0.6: feel, camera effects, animation, lighting, audio, models
and optimisation — the polish pass that turns a level into a game.
