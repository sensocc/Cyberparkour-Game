# Cyberparkour

A first-person parkour game in a procedurally generated cyberpunk city: a kilometre of rooftops to run across, seventy-six lifts, three time trials, and a courtyard cat with a quest for ten shards. The city is dressed with imported low-poly art — Kenney facades and street furniture, Quaternius rooftop machinery and idle citizens — under a brightened night sky, with recorded SFX under the jumps and landings.

TypeScript · three.js · Vite · Vitest. Runs in any modern desktop browser with WebGL 2 and Web Audio.

▶ **Play the deployed build:** [sensocc.github.io/Cyberparkour-Game](https://sensocc.github.io/Cyberparkour-Game/)

| | |
| --- | --- |
| Version | `2.1.1` |
| Stage | Playable — one city, one quest, three trials, and a secret |
| Tests | 1322 in 51 files |
| Coverage | ~91% of statements |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

```bash
npm install
npm run dev        # play it
npm run ci         # typecheck, tests with coverage, production build
```

## The run

You start on a rooftop in the middle of the city. The first thing the game asks is that you find the alley cat — nothing in the city can be picked up until it has been talked to. Then it is ten shards, five checkpoints, and **the return trip**: the finish stands where the cat does, and crossing it only counts once the cat has been told you have them all.

A pointer in the corner of the HUD tracks the quest — at the cat before it is taken, at the nearest shard while they are out, and back at the cat once they are all in.

### Time trials and a secret

- **Three time trials**: walk into a gate to start the clock, reach the second to stop it, and score one to three stars.
- **The phone**: somewhere in the city, a phone lies on a roof. It is not one of the ten shards — its own list, its own counter — and picking it up is the one scripted moment in the game.

## Controls

| | |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look | mouse |
| Sprint | `Shift` |
| Jump | `Space` |
| Crouch / slide / roll | `Ctrl` |
| Interact | `E` — talk to the cat, call a lift, open a door |
| Floors 1–9 | `1`–`9` — pick a floor while riding a lift |
| Pause | `Esc` |
| Debug overlay | `F3` |

On a touch device the left thumb drives a stick, the right side turns the camera, and the four action buttons sit bottom-right — so the readouts move to the top corners and the joystick is never underneath anything it has to be read past.

Wall running is a sprint into a wall at a shallow angle. Vaults, mantles, pull-ups and the landing roll happen on their own when the situation calls for them.

## The city

Generated from one seed, so it is the same city every time a bug is found in it:

- A kilometre square, one building per cell, with streets sized so every neighbour is within a running jump.
- Heights between twelve and fifty-eight metres above the street, capped at a few metres over the average of their neighbours.
- Courtyards, glass towers, ~240 neon signs, rooftop furniture, and buildings you can walk into with their own lifts.
- Seventy-six lifts serving 442 floors between them, whose lowest floor is the street — the way back up when parkour cannot reach.

## Movement

Wall runs, wall jumps, vaults and the Kong vault, mantles and pull-ups, the landing roll, ladders and pipe climbs — ordinary states in one state machine, built to be felt rather than counted.

**The body is procedural, and the animation is measured.** There is no skeleton and no animation file: every angle is a target that a critically damped spring travels to, and the gait phase advances by *distance travelled* rather than by time, so the walk cannot slide against the ground. V2.1.0 fixed four faults in that system — the phone pose was overwritten before it was drawn, the shadow map ignored every pose change that was not one of five scalars, the crouched camera sat 8 cm inside the chest, and the pose branched on four move kinds that could never occur. It also filters each joint's target through an exponential approach, which cut the worst transition jerk by 53 % (a walk into a vault, 0.141 → 0.066 rad/frame) for 33 ms of extra response.

V2.1.1 fixed three more, all reported from playing it. The walk shook because `advanceHeadBob` was handed the player's *speed* where it wanted *distance* — at a 7.5 m/s walk that is 7.36 radians of gait phase per step, more than a full cycle between frames, so the stride aliased into a shudder; it now reads 1.17 Hz, exactly speed ÷ stride. The crouched knees bent backwards because the fold was pushed through an inverted sign, putting the knee 0.43 m behind the hip; the fold's signs now match the rig's convention that forward is −Z, and the foot stays on the floor. And the camera sank faster than the body because the eye read the instant `crouching` boolean while the hips followed an eased value; both read the same eased `crouchAmount` now, so the eye holds exactly 0.250 m above the shoulder for the whole transition in both directions.

**Every ladder in the city is climbed by a test.** V2.0.2 fixed the four faults that had made about three ladders in five unusable: the hand-over at the top compared the player's head against the section's face exactly, and a climb advances in 40 mm steps, so it was a condition that could never be true; a fire escape landing and a roof gangway were built across the climb column; and long ladders stood close enough to a wall that the roof deck above them capped the climb two metres under the top. A ladder now hands over on the step that would have reached its top, lets go if something genuinely blocks it, and the generator stands every one clear of the faces and the rooftop kit above it.

## Performance

The interesting bugs in this project were all in the numbers, so it measures rather than argues:

| | |
| --- | --- |
| Draw calls in a street view | ~420 (171 chunk · ~250 moving) |
| Triangles drawn | ~360k |
| Point lights lit at once | 6, of 591 |
| Building the city scene | ~0.5 s |
| Bloom (high preset only) | ~1 ms of render |

The four things that do most of the work: merged geometry (one buffer per chunk instead of one mesh per part), a pool of eight point lights, a spatial-hash collision grid, and distance/shadow culling. Add `?perf` to the URL for a live frame readout.

### What the frame shows

- **Steam off the vents**, as one batched instanced draw rather than a sprite per puff — 72 puffs for the cost of a single submission.
- **Selective bloom on the neon only.** The threshold sits above the city's lit surfaces, so the glow is the signs and not the concrete; the pass runs at half resolution and is gated to the high preset.
- **Dust on a hard landing**, scaled to the impact and aged by simulated time, so it freezes with a pause and never follows you to the spawn point.
- **A speed vignette** that closes the frame in at a sprint, eased so it never flickers, and scaled by the same Camera motion setting as the head bob.

### What it does not do

Bloom is the one effect a setting can cost. It is a full-screen post chain, so it is reserved for the preset that means "give me everything" and is the first thing a slower machine should lose — and the graphics menu is the way out.

## How it is verified

- `npm run ci` — typecheck, 1322 tests with coverage, production build. Green on Node 22, 24 and 26.
- Every push to `main` builds and deploys `dist/` to GitHub Pages automatically — the link at the top of this README is that build.
- The generator's invariants are tests, not hopes: no two buildings in one place, every neighbour inside the jump, every lift car in open air at every floor.
- **Nothing floats.** A union-find over every prop in the city — 11,736 of them — requires each one to reach the ground through a chain of touching boxes, and reports any island that does not, grouped by what kind of thing it is. V2.0.5 started from 508 such props and ended at none.
- **Every imported model is measured, not described.** `tools/models/bounds.ts` reads the glTF files directly, the level's declared sizes are generated from that, and a test fails if the two disagree by more than 2 cm.
- **Every ladder is climbed, not assumed.** The whole-city suite puts a player at the foot of each of the 368 ladder stacks, on whatever surface is really under them, and holds forward in the real collision world until they reach the top — plus a check that each ladder starts at the ground beneath it.
- The physics is compared against itself: the collision grid is held to the linear scan it replaced, over the whole city.

## Layout

```
src/
  core/       config, settings, math, version
  game/
    level/    the city generator, the models, surfaces, the lifts, level validation,
              environment.ts (the night the city is set in)
    physics/  the AABB solver and its broadphase
    player.ts the player state; pose.ts what the body is doing
  render/     the scene builder, the view, the player rig
  ui/         screens, the HUD, the settings panel
tools/        the texture generator
tests/        unit, integration, the invariants, and the authored district fixture
```

## License

UNLICENSED — all rights reserved.
