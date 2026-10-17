# Cyberparkour

A first-person parkour game in a generated cyberpunk city: a kilometre of buildings to run across,
eleven thousand props, ninety lifts, and a cat in a courtyard who wants ten shards.

TypeScript · three.js · Vite · Vitest. Runs in any modern desktop browser with WebGL 2 and Web Audio.

| | |
| --- | --- |
| Version | `1.0.16` |
| Stage | Playable — one city, one quest, three trials, and a secret |
| Tests | 1158 in 42 files |
| Coverage | ~91% of statements |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

```bash
npm install
npm run dev        # play it
npm run ci         # typecheck, tests with coverage, production build
```

---

## The run

You start on a rooftop in the middle of the city. **The first thing the game asks is that you find
the cat**: an alley cat sits in a courtyard about a hundred metres away, and nothing in the city can
be picked up until you have talked to it. That is the whole reason it exists — ten unmarked shards on
a kilometre of rooftops are a scavenger hunt with no giver, and a quest you can finish before you are
given it is not a quest.

Then it is ten shards, five checkpoints, and **the return trip**: the finish stands where the cat
does, and it only counts once the cat has been told you have them all. Run the checkpoints and arrive
empty-handed and you are early rather than done.

The pointer in the corner of the HUD follows the quest — at the cat before it is taken, at the
nearest shard while they are out, and back at the cat once they are all in. It is a straight line
rather than a route: the city is a grid, so the straight line *is* the route within a street or two.

### Three time trials

A gate you walk through and a gate you have to reach, three times across the map at three different
angles. Walking into the first starts the clock; reaching the second stops it and scores **one to
three stars**, and the HUD carries the running time and the stars still achievable while it runs.

The star times come from the distance rather than from taste: a sprint is eleven and a half metres a
second and a rooftop route is never the straight line, so three stars is roughly the distance at
eight metres a second, two at five and a half, one at four.

### The phone

Somewhere in the city there is a phone lying on a roof. It is **not one of the ten** — its own list,
its own counter — so finding it does not shortcut the quest. It is the one scripted moment in the
game: the arm comes up, somebody answers, and then the announcement.

## Controls

| | |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look | mouse |
| Sprint | `Shift` |
| Jump | `Space` |
| Crouch / slide | `Ctrl` |
| Interact | `E` — talk to the cat, call a lift, open a door |
| Floors 1–8 | `1`–`8` — pick a floor while riding a lift |
| Pause | `Esc` |
| Debug overlay | `F3` |

Wall running is a sprint into a wall at a shallow angle; vaults, mantles, pull-ups and the landing
roll happen on their own when the situation calls for them.

### Getting back up

The street is thirty-five metres below the roofs, so there are several ways to be on one again:

- **Two ladders per building**, on opposite faces, so the way up is never a walk round the block.
- **Fire escapes**: two landings eight metres apart up the front of any building over twenty-four
  metres, on the same face as the ladder — places to stop rather than rungs to count.
- **Every courtyard has a ladder and a scaffold** up to its own terrace, which is within a few metres
  of the roofs around it. A yard with no way out is a trap, and the cat lives in one.
- **Ninety lifts**, whose lowest floor is the street.

A ladder is built as a stack of sections — one collider each, so the rungs keep their spacing — and
that stacking is what the V1.0.2 bug was about; see `player.ts`.

## The city

Generated from one seed, so it is the same city every time a bug is found in it.

- **A kilometre square**, sixteen cells of 62 m in each direction, one building per cell.
- **Streets of four and a half to five metres**, plus half a metre of jitter so the grid does not read
  as graph paper — and both ends inside the 5.7 m a running jump crosses, so every neighbour is
  reachable by construction rather than by repair.
- **Heights between twelve and fifty-eight metres above the street**, random per cell and capped at a
  few metres over the average of the eight around it.
- **About one cell in six is a courtyard** rather than a building: a yard with a low wall, crates, a
  cable spool, a scaffold tower and a lamp. A grid of solid blocks is a spreadsheet; a grid with yards
  in it has alleys, corners and somewhere to put things.
- **Glass towers**: about one block in twelve is a curtain wall from the pavement to the parapet.
- **354 neon signs** on the faces of buildings, in six colours and three silhouettes. They are
  emissive — a sign's own material is its light — which is what lets the city be bright *and* fast.
- **Rooftop furniture**, about 1,100 pieces of it: access huts, vent stacks, satellite dishes, water
  towers on four legs, chiller banks, aerial farms, helipads, greenhouses, crowns, and gangways over
  the street to the building next door.
- **Ground**: tarmac on two sides of every cell with a painted lane marking, 181 lampposts, planters
  and bushes on the corners.

Buildings you can go inside exist too: an interior tower has floors, a corridor on each, an atrium
with a ladderwell, and a lift whose doors face into the building rather than the street.

## The lifts

A lift is a building rather than a platform: a shaft with a doorway at every floor, a shutter on each
doorway, and a car with a state machine — `idle → closing → moving → opening` — that nothing outside
can shortcut. Call it with `E`, walk in, pick a floor with `1`–`8`, and the gate shuts behind you.

- **A gate is a collider that slides**, and it is solid unless the car is docked at *that* floor.
  Lifting them all together is the bug that makes a shaft a hole.
- **A rider is whoever is in the car's footprint and on its roof**, not whoever the physics thinks
  they are standing on: a car docked at a floor is flush with it, so the system owns that rule.
- **The top doorway opens onto the building's roof**, which is the one way out that is not the lobby
  you came in through.

## Movement

Wall runs, wall jumps, vaults and the Kong vault, mantles and pull-ups, the landing roll, ladders,
and pipe climbs — ordinary states in one machine rather than special cases, and built to be felt
rather than to be counted.

### The frame

The rendering is V1.0.3's, deliberately and exactly: the same three presets, the same exposure, the
same lighting and no post-processing chain. V1.0.4 added bloom and a higher exposure and V1.0.7 tried
to price them; the honest conclusion was that the frame the game already had is the one to keep.

There is one more thing to know about it, and it cost three versions to learn: **the fixes that made
this game playable were order-of-magnitude ones** - forty thousand draw calls to five hundred, five
hundred and forty-five lights to six - and the first of those was spent before V1.0.3, while the second
turned out not to have been spent at all until V1.0.16 (see below). What is left is a floor, and the
dials left on it (one fewer light, a smaller shadow map) are worth single-digit percent. A frame that
is missing by three times is not missing because of a graphics setting, and trimming settings until the
picture is gone will not find out what it is missing by.

So the game now measures instead. Add `?perf` to the URL and the top-left corner reports the frame:
the rate, the draw calls and triangles submitted, the milliseconds spent inside the renderer against the
milliseconds spent everywhere else, the compiled program count, the preset, and - because it matters -
whether this is a development build or a production one. The split is the point: time inside the
renderer is what a graphics setting can move, and everything else is the simulation, the pose and the
DOM, which no setting can.

**The measurement finally named it, and it was the draw calls, twice over.** A reading from the machine that
had the problem: simulation 0.0–0.2 ms, HUD 0.4–0.7 ms, render 9.9–44 ms, and **400 to 1,000 draw
calls** with 400k–700k triangles for eight to fourteen frames a second. Both halves of the frame — the
submission and the GPU work behind it — scale with what is drawn, and the thing that is drawn too many
times is *chunks*: V0.7.9 got a street view down to 90 draw calls by making the mesh count small, the
chunk has been shrunk twice since (once for culling, once by accident), and the calls came back.
Bigger chunks and a shorter draw distance now, which is the trade that version made and this one
re-makes: submit more triangles, submit far fewer things. Cutting the pixel ratio never helped because
the cost was never per-pixel.

**And then the fix that was tried and reverted.** The chunk was the *batching* key, so the count was `chunks × materials`
and it moved with the size of the map. The parts are merged flat by material now - one mesh per
material, about forty-five of them for the whole district, and 88 draw calls from a street where it
was four hundred to a thousand. The price is honest and it is the same one V0.7.9 paid: a chunk is a
culling unit, and using it to batch means the directional cull is gone, so the frame submits more
triangles and far fewer things. It was reverted in V1.0.13. Forty-five meshes, forty-four of them with a bounding
radius over two hundred metres, meant forty-four hit the "this mesh is the size of the map,
never cull it" rule: the distance cull stopped doing anything and 778,000 triangles went
out every frame against 349,000 before, for no gain. A chunk is a culling unit and it has to
stay one. The draw calls were never the chunks anyway - they were four hundred and twenty-two gate
groups and ninety lift parts, and V1.0.16 is where that was paid.

**V1.0.16: the two numbers that were actually wrong.** The readout had been reporting a frame in the
thousands of draw calls and the answer was assumed to be the chunks. It was not, on either half:

- **The gates were ten meshes each.** Everything that moves was built one mesh per model part, which
  for a shutter is a base, eight slats and a hazard stripe. The city owns four hundred and twenty-two
  shutters and ninety lift cars, and from a street they were **1,417 of the frame's 1,777 draw calls**
  for fifty thousand triangles - the exact trade the chunk merge exists to avoid, undone for the parts
  that move. They are merged per material now (a gate is three meshes) and they get the same *distance*
  cull the chunks get, because a shutter two hundred metres away is a few pixels of dark grey. From a
  street: **1,777 draw calls to 306.**
- **The lights were never cut.** V0.7.11 capped the level's point lights at twelve and V1.0.x faded the
  nearest six of the city's five hundred and seventy-six to full brightness - but three.js sizes its
  per-fragment light loop from how many lights are *visible* and unrolls it, and a light faded to zero
  intensity is still visible. Every lit pixel was running **576 light evaluations**, and each lit
  program carried about **2,300 uniforms**; the graphics presets could not buy any of it back, because
  `lightScale` only ever changed intensities. The scene now owns a **pool of eight** `PointLight`s and
  moves the nearest ones onto the lamps as the player walks - a gate that leaves the selection fades out
  where it stands, is freed when it is dark, and takes its new lamp at zero, so the fade the player sees
  is unchanged. Each lit program: **2,333 uniforms to 59.** Eight lights is also under the uniform limit
  of an integrated GPU, which five hundred and seventy-six was not.
- **The probes were walking the whole level.** Mantling, pull-ups, climbing, wall running and vaulting
  each asked "what is near me?" by testing all thirteen thousand colliders, four or five times a step,
  allocating a box per candidate. They go through the collision grid now: **0.244 ms per walking step
  to 0.007**, and the city is no longer something a step pays for by existing.
- **A restart is a new run, not a new world.** It used to throw the view away and build it again - six
  hundred milliseconds merging the city, a hundred and sixty rebuilding the level, every texture
  re-uploaded and every shader recompiled - to arrive back at the same picture. The scene is
  deterministic and the game already knows how to push its own state back into it, so it does.
- The `?perf` readout no longer measures itself (it walked every object in the scene each frame and
  built a six-hundred-character string per frame), the HUD's statistics are read once per frame instead
  of three times, and the level and scene builders resolve the gate-to-lift mapping in one pass each
  instead of a million string comparisons per lift.

**And the frame no longer makes garbage.** A frame that allocates is a frame that ends in a garbage
collection, and a collection is a dip you see while standing still doing nothing - which is exactly
where the dips were reported. Two sources: forty-four smoke puffs each returning a fresh pose object
every frame, and the play HUD rebuilding five objects and writing the DOM sixty times a second when its
fastest element is a clock that shows tenths. The puffs write into a pose they keep, and the HUD runs at
its natural ten hertz. Nothing looks different; the allocations are gone.

One regression is also gone: a start-up warm-up that compiled every shader and uploaded every buffer
before the first frame, added in V1.0.5 and removed here. It was the only start-up behaviour that
differed from V1.0.3, and start-up is where the report was.

### Nothing pops while you are moving

Rapid movement is where a world shows its seams, and two of them were showing:

- **The lamps snapped on and off.** Six of five hundred and seventy-six sources are lit at a time and
  the set changes every 24 m, so sprinting down a street used to watch pools of light switch like a
  hand on a wall. They fade over about a fifth of a second now. The *visibility* pass, which was
  briefly cached by position cell the same way, is deliberately not: cached, chunks arrive in
  twenty-metre steps — a pop is a worse glitch than the two hundred microseconds the walk costs.

### Smooth, and measured as smooth

Everything the player watches is a *velocity*, and a discontinuity in one is what an eye reads as a
jerk — more than the size of the movement, and much more than its duration. Three of them were worth
fixing, and all three were found by measuring the **eye trace**: the eye's position sampled at 240 Hz
across a simulation that steps at 60, which is what the renderer actually draws.

- **The joints are critically damped springs.** A joint that accelerates to a speed cap and drops back
  to easing has a corner in its velocity; a spring has none. V0.7 measured the difference at 4.5x.
- **The scripted moves carry momentum.** A mantle, a pull-up, a vault and a roll used to start by
  setting the velocity to zero and end by setting it to a fixed exit speed — two discontinuities in
  one move, and a sprint into a ledge stopped dead for a third of a second. The path is a cubic
  Hermite curve now, with the tangent at each end taken from the velocity either side of it, clamped
  to six tenths of the chord so a fast entry over a short mantle cannot loop back on itself. Measured
  on a vault at a sprint: **10.6 metres a second of change inside one frame before, 5.9 after.**
- **The eye's height is sprung, and nothing else is.** Every remaining snap is vertical — a landing
  kills the fall speed inside a single simulation step, a mantle's arc is vertical, a kerb is
  vertical. Springing the horizontal axes is what makes a camera feel like it is on a rubber band,
  and the horizontal discontinuities are all real events: running into a wall stops you, and it should.
  It lags a fall and never a rise, so a camera can never trail inside the floor it is standing on, and
  it is scaled by the camera-motion setting — it *is* camera motion, so "off" turns it off.

The animation itself is a pose derived from the player's own state, sampled at the moment being drawn
rather than at the last simulation step.

**And the transitions between states are measured too**, which V1.0.3 left as an argument. A sprint
into a ledge, over it and away: walk, airborne, mantle, walk, with the leg's angle sampled at 240 Hz
through the whole thing. The worst single frame moves the joint 0.026 radians and the worst change in
its *speed* is 0.0043 — which is a leg moving, and not a corner. The test holds it to 0.09 and 0.02.

## Performance

Measured rather than argued about, because the interesting bugs in this project were all in the
numbers:

| | |
| --- | --- |
| Draw calls in a street view | ~165 |
| Triangles drawn | ~350k |
| Triangles in the shadow pass | ~195k |
| Point lights lit at once | 6, of 576 |
| Collision: 200 falling moves | ~1 ms |
| Building the city scene | ~0.5 s |

Four things do most of the work, and each replaced something that could not scale:

- **Merged geometry.** One mesh per model part was 41,915 draw calls a frame. Static parts are merged
  into one buffer per (chunk, material, shadow flags) — the *same* vertices, moved rather than
  rewritten — and a chunk is 334 m because chunk size is a draw-call budget rather than a culling unit.
- **Six point lights.** A point light is a per-fragment loop over the whole screen. A kilometre of city
  generates 576 of them, and the nearest six are lit; the rest of the light is emissive surfaces, which
  cost nothing.
- **A collision grid.** Every sub-step of every axis used to walk all six thousand colliders. They are
  filed into a 16 m grid, and the grid is held to the scan it replaced: 1,200 pseudo-random moves
  through the whole city, comparing every field of the result.
- **Distance and shadow culling.** The shadow pass asks whether its volume overlaps a chunk rather than
  whether the chunk's centre is near, which is the difference between one chunk in the pass and four
  hundred.

## How it is verified

- `npm run ci` — typecheck, 1141 tests with coverage, production build. Green on Node 22, 24 and 26.
- **The generator's invariants are tests**, not hopes: no two buildings in one place, every neighbour
  inside the jump, no building far over its neighbours' average, every lift car in open air at every
  floor, and the run's own shape — an NPC, three trials, a phone that is not counted among the shards.
- **The physics is compared against itself.** `CollisionWorld` keeps the linear scan it replaced as an
  option, and a test runs both over the whole city.
- Every visual change was driven through Chromium and looked at. That is not decoration: several of the
  bugs in this project's history were only ever visible in a screenshot.

### Known and open

- **The height lead holds for 192 of 193 buildings.** One is eighteen metres over its neighbours'
  average, where the rule asks for fifteen.
- **The frame is CPU-bound.** The draw calls are low and the triangle count is not the problem; a
  machine with an integrated GPU will still feel it.

## Layout

```
src/
  core/       config, settings, math, version
  game/
    level/    the city generator, the models, surfaces, the lifts, level validation
    physics/  the AABB solver and its broadphase
    player.ts the state machine's inputs; pose.ts what the body is doing
  render/     the scene builder, the view, the player rig
  ui/         screens, the HUD, the settings panel
tools/        the texture generator
tests/        unit, integration, and the invariants
```

## Version history

| | |
| --- | --- |
| V0.0–V0.2 | A rooftop, then a district, then movement worth feeling |
| V0.3–V0.4 | Verticality, interiors and doors |
| V0.5 | Lifts, pickups, a finish line |
| V0.6–V0.6.1 | A body, settings, five kinds of neon sign |
| V0.7 | The city: a kilometre generated around the district |
| V0.7.1 | Merged geometry, a collision grid, and a gate that was drawn twice |
| V0.7.2–V0.7.3 | The gaps between buildings, the lifts put inside them, the city moved in |
| V0.7.4–V0.7.5 | The ground, glass, roofs worth crossing, the grid resized |
| V0.7.6–V0.7.9 | The district removed and the whole map gridded, then lit and furnished |
| V0.7.10–V0.7.11 | The volumes, the crane, and 545 lights down to 12 |
| V0.8–V0.8.1 | A night, a ground, and the first half of the quest |
| V1.0.0 | The quest, the trials, the phone, and the height rule |
| V1.0.1 | Three quest bugs, and the frame's last pass |
| V1.0.2 | More ways up from the street, and the ladder that let go of you |
| V1.0.3 | Momentum through the moves, a sprung eye, and the jank measured away |
| V1.0.4 | The light, bloom, a flash on a shard, and a playable game |
| V1.0.5 | A warm loading screen, a cheaper frame, and nothing popping |
| V1.0.6 | Down the ladder, a shadow map drawn on purpose, and distances in 3D |
| V1.0.7 | The frame first: cheaper presets, and a preset that measures itself |
| V1.0.8 | Graphics back to V1.0.3, features kept |
| V1.0.9 | The warm-up out, the measurements in |
| V1.0.10 | The frame measured instead of simulated |
| V1.0.11 | Fewer, fatter chunks: the draw calls named at last |
| V1.0.12 | Merged flat by material: 88 draw calls for a district |
| V1.0.13 | The merge reverted: 349k triangles beats 88 draw calls |
| V1.0.14 | No garbage per frame: pooled puffs, a ten-hertz HUD |
| V1.0.15 | The readout says which machine it is on |
| V1.0.16 | Eight lights, batched shutters, and a broadphase that reaches the ledges |
