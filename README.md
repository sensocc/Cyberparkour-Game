# Cyberparkour — Technical Demo

[![CI](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml/badge.svg)](https://github.com/sensocc/Cyberparkour-Game/actions/workflows/ci.yml)

A low-poly, Quake-styled **first-person parkour game** set in a cyberpunk city,
in the spirit of *Mirror's Edge*.

This repository currently contains **V0.7.2**. V0.3 made the roof a route, V0.4 took the
route indoors, V0.5 made it a level, and V0.6 gave the player a body and a settings
screen. **V0.7 made it a city, V0.7.1 made the city run, and V0.7.2 made it somewhere you
can get to.**

The hand-authored district is still there, in the middle, exactly as it was — and around
it is a kilometre of generated city: **5,233 props**, 5,264 colliders, streets 18 m wide
between blocks, towers with setbacks, 30 construction sites with carcasses and cranes,
181 ladders up the walls, 125 balconies to land on, halls you can walk into, 21 interiors
with *floors* in them, solar arrays and billboards on the roofs, and **29 elevators** that
go where parkour cannot — up the inside of a building, out onto a roof 59 m above the
street that nothing else reaches.

The old platform lifts are gone. A lift is now a thing you *call*, walk into, send to a
floor, and ride: the gate shuts, the car climbs, the gate opens, and you step out onto a
roof.

**V0.7.2 is the city joined up.** V0.7 generated a skyline and never asked whether you
could cross it: a block filled two thirds of its plot, so the buildings stood forty metres
apart with the street between them, and a jump reaches six. The streets are full now -
331 in-between buildings, nearly all of them decorated differently - and every one of the city's 707 rooftops has
another within a jump of it. The lifts moved too: a tower's shaft used to stand in the
street with a second building next door to receive it at the top, and it is now a core in
the corner of the building it serves, reachable from the lobby and from the roof.

**V0.7.1 is the cost of all that, paid down.** A city is not a district that happens to be
bigger: 41,915 model parts was 41,915 draw calls a frame, and five thousand colliders was
five thousand collision tests per sub-step. Both are now proportional to what is on screen
and what is underfoot rather than to how much city exists, and neither change alters a
single pixel or millimetre of how the game plays.

---

## Table of contents

1. [Status](#status)
2. [What V0.7.7 does: the whole map, not the gaps around it](#what-v077-does-the-whole-map-not-the-gaps-around-it)
3. [What V0.7.6 does: a grid, and the end of patching](#what-v076-does-a-grid-and-the-end-of-patching)
4. [What V0.7.5 fixes: the grid is the route](#what-v075-fixes-the-grid-is-the-route)
5. [What V0.7.4 fixes: the grid, the ground, and glass](#what-v074-fixes-the-grid-the-ground-and-glass)
6. [What V0.7.3 fixes: the city was in the wrong place](#what-v073-fixes-the-city-was-in-the-wrong-place)
7. [What V0.7.2 fixes](#what-v072-fixes)
8. [What V0.7.1 optimises](#what-v071-optimises)
9. [What V0.7 delivers](#what-v07-delivers)
10. [What V0.6.1 fixes](#what-v061-fixes)
11. [What V0.6 delivers](#what-v06-delivers)
12. [What V0.5 delivered](#what-v05-delivered)
13. [Quick start](#quick-start)
14. [Controls](#controls)
15. [What you should see](#what-you-should-see)
16. [Settings](#settings)
17. [Camera effects](#camera-effects)
18. [Feel](#feel)
19. [Your body](#your-body)
20. [Optimisation](#optimisation)
21. [Locomotion](#locomotion)
22. [The movement state machine](#the-movement-state-machine)
23. [The manoeuvre bands](#the-manoeuvre-bands)
24. [Wall running](#wall-running)
25. [Wall jumping](#wall-jumping)
26. [Vaulting and the Kong vault](#vaulting-and-the-kong-vault)
27. [The landing roll](#the-landing-roll)
28. [Pipe climbing](#pipe-climbing)
29. [Interiors and doors](#interiors-and-doors)
30. [Lifts](#lifts)
31. [Pickups, the finish and the clock](#pickups-the-finish-and-the-clock)
32. [Checkpoints and respawn](#checkpoints-and-respawn)
33. [The district](#the-district)
34. [Fog, smoke and the sky](#fog-smoke-and-the-sky)
35. [Neon](#neon)
36. [Fall damage and health](#fall-damage-and-health)
37. [Models and surfaces](#models-and-surfaces)
38. [Sound](#sound)
39. [How the textures are made](#how-the-textures-are-made)
40. [Architecture](#architecture)
41. [How a frame works](#how-a-frame-works)
42. [Collision](#collision)
43. [Crash reporting](#crash-reporting)
44. [The HUDs](#the-huds)
45. [Testing](#testing)
46. [Continuous integration](#continuous-integration)
47. [Project layout](#project-layout)
48. [Deliberate decisions and limitations](#deliberate-decisions-and-limitations)
49. [Out of scope for V0.7](#out-of-scope-for-v07)
50. [Roadmap](#roadmap)

---

## Status

| | |
| --- | --- |
| Version | `0.7.7` |
| Stage | Pre-alpha, playable demo |
| Stack | TypeScript · three.js · Vite · Vitest |
| Runs in | Any modern desktop browser with WebGL 2 and Web Audio |
| Tests | 1116 across 42 files |
| Coverage | ~93% of statements (of the unit-testable surface) |
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

V0.7.7 is finished and frozen: the whole map is the grid. The district is gone, and the run -
spawn, checkpoints, pickups, finish - is generated across the kilometre.

**The version on the title screen is read from `package.json` at runtime**, and that
is one of the V0.6 fixes: Vite's `define` is expanded when the dev server *starts*, so
a server left running since V0.1 served `v0.1.0` for ever, however many versions were
released under it. Importing the file instead puts it in the module graph, where
changing it is something the server notices.

---

## What V0.7.7 does: the whole map, not the gaps around it

V0.7.6 gridded everything *except* the hand-authored district, which meant the one part of the
map the player actually runs around in was the one part that was not a grid. That was the
mistake, stated plainly, and it came from reading V0.7's brief ("keep the district as the
centre") as "the district is sacred and the city is the surround".

**The district is gone.** Its props, doors, lifts, lights and smoke are not merged into the city
any more - they are replaced by it. `buildCity` no longer appends a city to a level; it *builds*
the level. What a level still lends the city is what a level is for here: its identity, its sky
and its sun.

**The run is generated, across the kilometre.** The district *was* the run - the spawn, the five
checkpoints, the eight pickups and the finish all lived on it - so with it gone they have to come
from somewhere, and they come from the grid: the spawn in the middle, five checkpoints strung out
ahead of it, ten pickups between them, and the finish on the far corner. All of them on the
ground, in the streets between buildings, because that is the one surface in a generated city
that is always where it says it is.

That last sentence is a retreat rather than a design. Placing the run on *rooftops* was the first
attempt and it failed twice - a cell's centre is inside the building that stands on it, and a
tower's registered roof is its shell rather than its roof, so route points ended up inside
buildings and twelve metres above surfaces. Siting it on roofs needs a placement measured
against the physics rather than assumed from the generator's own bookkeeping, and that is not
done.

**And where the district used to be, buildings now stand.** `keepClear` and `masses` are
opt-in options that nothing passes, so every cell of the grid gets a building - the map is
1 km x 1 km of them, uniformly spaced, with nothing carved out of the middle.

---

## What V0.7.6 does: a grid, and the end of patching

Three versions tried to *emerge* a playable city - generate freely, measure what came out, and
patch the gaps - and every patch was a new way to fuse two buildings together or leave a roof
with nothing beside it. V0.7.5's report said 2,723 overlapping pairs, then 159, then 55, and the
number never went to zero because a repaired grid has gaps of every width and overlaps that the
repairs themselves created.

This version does not patch anything. **It is a grid.**

- **One kilometre square.** Sixteen cells of 62.5 m, which is a kilometre exactly, over
  x and z from -500 to 500.
- **One size.** Every building is the pitch less the street: 58 m on each side.
- **One distance.** The street is 4.5 m everywhere, which is inside the 5.7 m a running jump
  crosses, so every neighbour is reachable by construction rather than by repair.
- **One building per cell.** Two buildings cannot be in one place because there is exactly one
  per cell, and a cell that the old town or one of its towers stands on is skipped.
- **Height by tile.** Seven terrace steps of four metres, a tile of four cells sharing a height,
  and never more than three metres of variation inside a cell: neighbouring buildings differ by
  seven metres at most, where V0.7.5 had towers forty metres over the blocks beside them - and
  the old town's five towers are outside the city's ground entirely.

Everything that existed to patch the gaps is **deleted**: the infill pass, the attachment pass,
the repair pass, the hole-filling pass, their ledger of footprints, and the tests written for
them. That is most of the diff, and it is the point of the version.

### What went wrong with the patching, briefly

Each version's fillers were placed by geometry rather than by a grid, and geometry does not know
what is already there: a filler sized from the room it measured would be measured before the
building beside it was built. The ledger that refused overlapping placements made it worse in the
direction that matters least and better in the direction that matters most, and the repairs that
were refused were the roofs that kept one neighbour. A grid has none of these problems because it
has no decisions in it.

### What this costs

The city is about 220 buildings rather than 8,500 props of patchwork, so the frame is *cheaper*
than V0.7.5's and the skyline is flatter. The terraces step by four metres across seven tiles -
a twenty-four metre skyline - where V0.7.4's spiked. That is the trade the brief asked for: a
grid, with every building the same distance from the buildings around it.

### The geometry of the buildings

Asked to look at how city games do it: the shapes are a body with a roof of plant - arrays, a
tank, an aerial, a duct - a low parapet around the edge so a roof reads as a roof, two bands of
window per building so the glass has sky to reflect, ladders up the flank, and balconies for the
faces a street can see. The archetypes are a mid-rise block, a set-back tower with a lift inside
it, a construction carcass with a crane that stays over its own plot, a hall you can walk into,
and an interior tower with floors and a shaft.

---

## What V0.7.5 fixes: the grid is the route

### Sized from the street, not the other way round

V0.7.4 filled the plots and left four to eight metre streets. A running jump crosses 5.7, so
*half of every building's neighbours were out of reach* - and the number said it: 31% of roofs
had two jumpable neighbours, 123 had none at all.

The building is what is left of the pitch after the street now. Every building leaves a street
of 1.6 to 5.2 metres, and the difference between one building's street and the next's is the
variety the rule asks for. Nothing is repaired afterwards, because nothing needs to be: the
grid is inside the jumpable band by construction.

| | V0.7.4 | V0.7.5 |
| --- | --- | --- |
| Roofs with two jumpable neighbours | 31% | **85%** |
| Roofs with none | 123 | **7** (0.9%) |
| Overlapping building pairs | 2,723 | **55** |
| Props | 16,690 | **8,516** |
| Triangles in the city | 1,322k | **790k** |
| Visible triangles, street view | 598k | **384k** |

The props, the triangles and the draw calls all went *down* while the city got denser, because
a building that fills its plot is one box where the old grid needed three small fillers in the
street between two of them. The distance cull came down to 420 m at the same time - by then the
fog is a fifth of the way to opaque and the difference is a silhouette of a silhouette.

### The height half of the rule, which is not met by jumping

**48% of roofs have two neighbours within a pull-up as well as a jump.** The city is terraced and
a terrace twelve metres up is not a jump. What the rule allows instead is *a way across*, and the
way across is the ladder every building has had since V0.7.2 - which is asserted, and is true.
So the honest statement of the rule is: the distance half holds for 85% of roofs, and the height
half is covered by ladders rather than by jumping.

### No empty space

Every plot the level's own buildings push the city out of is remembered and filled afterwards,
sized from the room that is actually there. That is the implementation of "no free space bigger
than 15 by 15"; it is **not** independently measured, and a lattice scan over the building bodies
still finds pockets of thirty-odd metres - inside construction carcasses and hall interiors,
which are open by design, but I have not separated the two cases and so cannot claim the rule is
met.

### Glass in the skyline

V0.7.4 taught surfaces to reflect the sky and then had almost nothing for the sky to land on:
the only glass in the city was a solar panel's face and a crane's cab, so a density of towers
read as a density of concrete. Every building of any size now wears two bands of window - one per
face a street can see - lit or dark by a roll of the dice, with mullions in the model so one prop
is one band. Two thousand of them, for the price of two props per building.

---

## What V0.7.4 fixes: the grid, the ground, and glass

### The ground flickered

Two slabs, both with their top at exactly -34.8: the district's own `city-ground`, 700 m
across, and the city's `city-street-level`, 1200 m across, covering the same square metre.
Two surfaces at one depth is not a seam or a shadow - the depth test picks a winner per
pixel and the winner changes as the camera moves. The city's slab is two centimetres low
now, and that is under a pixel by the time you can see it.

### The city was a cross, not a grid

At a 62 m pitch a 40 m building leaves a 22 m street: four times a running jump. No two
neighbours could reach each other, so the *only* connected roofs were the ones a filler
building happened to bridge - and a filler is one line of connection. The map read as a
cross of terraces running away from wherever the player was standing, with everything else
a wall.

The blocks fill their plots now - 54 to 58 m in a 62 m pitch, so the streets are four to
eight metres and the grid itself is the route - and the jitter is 4% instead of 26%, so a
street is a street rather than a hole where a neighbour should be.

### Buildings were fused into each other

The gap-filling passes are geometric, and geometric passes overlap: 2,723 pairs of building
bodies ran through each other. There is a footprint ledger now - every building already
standing, and every filler as it is built - and a new building that would overlap one is
refused. Two thousand seven hundred overlapping pairs became **159**, and almost all of the
159 are a building and its own roof storey, which are meant to be nested.

### Glass reflects the sky

A `glass` surface painted a pale blue and lit by a lambert term looks like paper, and a city
at night is mostly the second-hand light of its own gleaming. Surfaces can declare a
`reflectivity` now; they get a specular highlight and the skybox as an environment map, so a
canopy changes as you walk past it and a hundred solar panels read as one gleaming surface.
Two more window surfaces came with it - a lit one and a dark one.

### And the frame got cheaper

| | V0.7.3 | V0.7.4 |
| --- | --- | --- |
| Triangles in the city | 1,322k | **742k** |
| Roofs | 689 | 745 |
| Overlapping building pairs | 2,723 | **159** |
| Ground surfaces sharing a plane | 2 | **0** |

A block that fills its plot is one big box where the old grid needed three small filler
buildings in the street between two of them, so the city is denser *and* 43% cheaper to
draw. On top of that, a chunk is now only drawn within 620 m: the fog is opaque long before
that, so nothing was visible to lose, and the rest of the kilometre stops being submitted.

### What is still missing

**The two-jumpable-neighbours rule is not met.** It is 31% of roofs, not 100%. The density
work moved it in the right direction and the fillers fix the exceptions they can reach, but
the count says what it says, and a version that claims the grid is finished would be wrong.
The measurement is in `tests/game/city.test.ts` and the honest number is 31%.

---

## What V0.7.3 fixes: the city was in the wrong place

The complaint was exact, and it was measurable. The map the player can run around was the
hand-made district - about 120 m by 62 m - and the kilometre of city was *outside* it.

Two numbers were wrong, and they compounded:

- **The clearance.** V0.7 hard-coded a rectangle 290 m by 220 m to keep the city off the
  district - twice the district's size in each direction. The nearest generated building
  stood **64 m** from the old town's edge. It is measured from the district's own decks now,
  plus two metres of street, so the city starts at the district.
- **The height.** The innermost roofs were **22 to 34 m**, over a district standing at
  nothing. Even a city at the district's edge would have been a wall: the player's feet are
  at 0, the nearest roof was twenty-two metres up, and the streets were thirty-five metres
  down. The bands start at **1.2 m** - level with the district's own decks - and climb
  outward from there.

A third thing was missing entirely: **nothing attached the two**. The city has filled the
gaps between its own buildings since V0.7.2, which says nothing about the level it was built
around. There is an attachment pass now: every city building near one of the level's own
masses gets the same treatment as any other gap - measured, and filled with a staircase of
buildings whose roofs walk from the district's height to the city's. It is also what fills
the space around the district's five outlying towers, which had sixty metres of nothing
between them and the city in both previous versions.

What it is not, yet: **verified end to end in play**. The structural claims above are
measured - the nearest generated geometry is 3 m from the district's deck box, the inner
roof band starts at 1.2 m, the city's rooftops are within a jump of each other in 1,315 of
1,319 cases - and the district-to-city jump has not been walked in a browser. That is the
first thing V0.7.4 should do, and if it does not hold, the attachment staircase is where to
look.

The cost is real: filling the streets three deep took the city from 10,557 props to 16,690,
and the frame from 471 draw calls and ~400k visible triangles to 706 and ~790k.

---

## What V0.7.2 fixes

Two things V0.7 got wrong, both of them the same mistake: a city that looked right from a
distance and did not work when you were standing in it.

### The gaps between the buildings

V0.7's blocks were sized at 66-96% of a 44 m plot. On a 62 m grid, that left **forty
metres between one building and the next** - and a running jump, worked out from the
movement code, crosses **six and a half**. The city was a diorama: every roof reachable by
falling off it and by nothing else.

Three changes, in order of how much they matter:

- **Buildings fill their plots.** A block is 87-97% of its plot now, which takes the
  street from forty metres to about twenty. That is a street; it is still three times a
  jump.
- **Every gap gets a building in it.** The infill pass walks the plots, measures the gap
  between each pair of neighbours, and drops one narrow building in the middle, sized so
  that what is left over at each end is a jump. Its roof is the taller neighbour's minus
  most of a pull-up, so it is one move from either side.
- **The roof bands step by 2.2 m, not 4.** V0.7's README claimed a block's roofs were "a
  jump or a vault apart". They were four metres apart, and a jump gets one - so the
  sentence was false, and this is the version where it is true.

`src/game/reach.ts` is where the numbers come from, and it derives them from the movement
config rather than naming them: the gap is the airtime of a jump times the speed a run
carries into it, the rise is the ceiling of a pull-up. It is checked against the
*simulation* - `reach.test.ts` runs the player off a ledge and measures what they actually
cross - and the generator builds to nine tenths of it, because a gap built exactly to the
limit is a gap a player lands one centimetre short of.

The result, measured over the whole city by `city.test.ts`:

| | |
| --- | --- |
| Walkable roofs in the city | 707 |
| Farther from their nearest neighbour than a jump | **0** |
| Reachable upward as well as across | 685 (97%) |
| Infill buildings | 331 |
| Distinct decoration signatures among them | 289 |

The 22 roofs that are within a jump but only *downward* are the honest remainder: a
terrace two and a half metres up is a pull-up and ten metres up is a climb, and every roof
in the city has a ladder for the ones a jump cannot make. That is what "and if it is, there
has to be other way" asks for, and the ladders have done it since V0.3 - they only had
nowhere to be used.

### The elevators were outside

A V0.7 tower's shaft stood in the street beside the building, with the car riding up the
outside of somebody's wall, and a *second* building next door whose only purpose was to
receive it at the top. That was a fix for a real bug - a shaft placed inside the footprint
ended up inside the building's own mass, and the physics resolved a rider standing in a
solid by pushing them fifty metres straight up - but it solved it by moving the lift out
of the building instead of into it.

A tower's lift is a core in the corner of its own footprint now, and where the doors are
is the whole design:

```
     +----------------------+   the shell, full height of the inside
     |  sheds   |  setback  |   the setback rises out of the shell's roof
     |          |           |   on the far side of the shaft
     |  [LIFT]  |           |
     +----------------------+
```

- **Every doorway between the street and the roof faces into the building.** You go in
  through the front door, across the ground floor, into the lift. There is no door onto
  the pavement, so there is no way to board it from outside - not a wall around a shaft,
  but a shaft nobody can get to.
- **The top doorway opens onto the building's own roof**, where the car arrives level with
  the setback's roof and stepping out is stepping onto the building. `city.test.ts` holds
  both ends to it: the shaft strictly inside the shell with room to stand in front of the
  doors, and the lift's top floor *equal* to the deck of the building it is inside.
- **The setback is on the far side of the shaft**, which is why the shaft is in a corner:
  a setback centred over it puts thirty metres of solid through every floor the car
  serves, and a merged city is no place to be re-learning that.

The district's own two lift towers are unchanged. They are freestanding because they were
built that way in V0.6.1 - they *are* the route from the works level to the roof - and
"inside the building it is assigned to" does not apply to a building that is a lift.

### What it cost

Filling the streets is 5,233 props to 10,557, and 111,123 model parts against 42,000. The
frame budget is held to what is in front of you rather than to what exists, so:

| | V0.7.1 | V0.7.2 |
| --- | --- | --- |
| Props | 5,233 | 10,557 |
| Draw calls from a street | 471 | **633** |
| Visible triangles, same view | ~400k | **~598k** |
| Chunks casting into the shadow map | 193 | **~200** |

Half again as much frame for two and a half times the city, which is what "preferably
without damaging the FPS" can honestly be. One free win came out of measuring it: a third
of the props were ladder *sections* - 5 m each so the rungs stayed rungs - and at 7 m a
building needs a third fewer of them and still reads as a ladder.

---

## What V0.7.1 optimises

The city was built to be looked at and then asked to be played. This version is the
difference, measured rather than argued about:

| | Before | After |
| --- | --- | --- |
| Meshes in the city scene | 41,915 | **2,313** |
| Draw calls, standing on a street | ~40,000 | **471** |
| Chunks casting into the shadow map | 1,091 | **193** |
| A falling step, worst case | ~0.5 ms | **~0.001 ms** |
| Building the city scene | 328 ms | **259 ms** |
| Triangles | 502,980 | 476,196 (the same parts, minus 101 double-drawn gates) |

**Static parts are merged into chunks.** A part is a box that never moves, and forty
thousand boxes that never move can share a vertex buffer. Props are now written into one
buffer per (chunk, material, shadow flags) - a chunk being 128 m, about two blocks of the
city - and each chunk becomes one mesh. The bargain is deliberate: bigger chunks would
mean fewer draw calls but cull less, smaller ones the reverse, and 128 m puts a chunk
either mostly in view or mostly not.

What the merge does *not* do is change what is drawn. The buffer is the box the shared
cache already built - same vertices, same normals, same pre-scaled UVs - copied to its
world position inside the chunk rather than rewritten. Chunk-local coordinates matter at
this size: a metre-wide box a kilometre from the origin has no precision left in a float.

**A chunk casts a shadow only while the shadow map can see it.** A shadow pass draws every
caster in the scene and *clips* the rest; vertices outside the shadow camera are clipped,
not culled. With one mesh per prop that cost nothing worth counting. With the city merged
it was a second full pass over half a million triangles for a map 220 m across, so casting
is now switched by distance from the player - and since everything switched off was
outside the map anyway, no shadow changed.

**The collision solver stops testing the whole city to answer a question about one
street.** Every sub-step of every axis used to walk all 5,264 colliders; a falling step at
terminal velocity did that twenty times over. Colliders are now filed into a 16 m grid and
a query visits the handful of cells the player's box overlaps. The solver itself is
untouched - same arithmetic, same decisions, better index:

- **The grid must answer exactly what the scan answered**, and it is held to that: 1,200
  pseudo-random moves through the whole city, comparing `grounded`, `hitWall`,
  `hitCeiling`, `groundId`, `groundSurface` and the final box, corner for corner.
- The one query where the *choice* of collider matters is `findGround`, which returns the
  first supporting collider in the level's order. "First in order" is "lowest index", which
  is a property of the candidate set rather than of the order it was walked in - so the
  grid answers with the same collider cell by cell. Two things supporting the player at
  once is a real case: the lip of a roof and the roof.

The `scan` path is still there, behind an option, because two implementations that must
agree are worth more than one that must be believed. It is what the equivalence test
compares against.

### A gate drawn twice

Optimising the props pass surfaced a bug V0.7 introduced: **every elevator gate was drawn
twice.** Gates are props *and* groups that slide, and V0.7 added the groups without
removing them from the props pass - so 101 shutters existed in two places, and the copy
that never moved stood shut in front of openings the lift had already left. A merged gate
can only be in one place, which is how it became impossible to miss. The merge now skips
them, and a test asserts no gate is both.

### What is not here

No frames-per-second number. The machine this was built on has no GPU worth the name, and
a software rasteriser's frame rate says more about the rasteriser than about the game. The
numbers above are the ones that transfer - the draw calls a frame asks for, the casters a
shadow pass takes, the milliseconds the physics spends between frames - and they are what
a machine with a real GPU will feel. They are pinned by `tests/render/performance.test.ts`
and `tests/game/physics/collision.test.ts`.

---

## What V0.7 delivers

| Feature | Where |
| --- | --- |
| A city, ~1 km across | `game/level/city.ts` — a seeded generator, 5,049 props on top of the district's 184 |
| Verticality, per building and in the skyline | Setbacks, two-storey blocks, terraced roof heights that rise towards the centre |
| Ladders | A `ladder` model on a `climbable` face — the V0.3 climb ability already did the rest |
| Balconies | Lips of deck on a bracket, at heights a player can use as a route |
| Construction sites | `construction-slab` and `construction-column` carcasses, scaffold towers, and a tower crane over each |
| Halls | Single volumes the size of a block, with columns, a mezzanine and a lit interior |
| Interiors with corridors | 21 buildings with three or four storeys inside, a corridor on each, and an atrium |
| Indoor elevators | `game/level/elevators.ts` — call, enter, choose a floor, gates shut, ride |
| Solar, billboards, megastructure | `solar-panel`, `billboard`, `crown` models, on roofs and on the tallest facades |
| Smoother animation | The gait phase is extrapolated to the moment being drawn, and the joints have weight |

### The city

It is generated, and it is *the same city every time*: the layout comes from one seed, so
a bug found in it can be reproduced and a screenshot from last week still matches. What
the generator produces:

| | |
| --- | --- |
| Blocks | 107 mid-rise, 6 towers, 30 construction sites, 23 halls, 21 interiors |
| Roofs | Terraced in bands of 22-34 m near the old town, 8-20 m at the edge |
| Ladders | 181, stacked 5 m at a time so the rungs stay rungs |
| Balconies | 125 |
| Cranes | 30, each over a site with four poured floors and columns that stop dead |
| Billboards | On the tallest facades, facing the old town |
| Lifts | 6 city towers and 21 interiors, serving street, each floor, and a roof or skydeck |

Four rules are what make it *playable* rather than merely large, and each has a test:

- **Roofs come in terraces.** A block's buildings are drawn from the same height band, so
  their roofs are a jump or a vault apart. Neighbouring bands step up towards the centre,
  which gives the skyline a shape and every roof somewhere to go.
- **Every building is a route.** A ladder, a balcony, a setback or a neighbour at a
  reachable height — nothing in the city is decoration you can only look at.
- **The lifts go where parkour cannot.** The top of a tower is 59 m above its street, and
  the only way up is to use the city.
- **Indoors is not one room.** A hall is one volume the size of a block. An *interior* is
  a building with three or four storeys inside it, a corridor down each with partitions
  and ways past them, a lit ceiling on every floor, a lift on one side of a central atrium
  and a ladderwell on the other. Every floor is a **ring** of four slabs round the well
  rather than a plate, which is what lets the lift pass *through* every floor instead of
  into it, and lets the well run from the street to the sky.
- **The streets are a place.** They are at -34.8 m, which is why V0.7 lowered the kill
  plane: with the district's plane 12 m below the roofs, every street in the city would
  have been instantly fatal. A fall from a roof is still fatal on its own — 35 m of it is
  well past the 26 m/s that kills.

### Elevators

V0.5's lift was a slab that cycled up and down on a timer, and you rode it if you happened
to be standing on it. V0.7's is a building: a shaft with **a doorway at every floor**, a
shutter on each doorway, a car, and a state machine — `idle → closing → moving → opening`
— that nothing outside can shortcut.

What that buys, and what each part is for:

- **A gate is a collider that slides.** It is solid unless the car is docked at *that*
  floor. Lifting every gate together is the bug that makes a shaft a hole, and it is the
  first thing the tests caught.
- **A rider is anyone in the car's footprint, on its roof.** Not `groundId === car`: a car
  docked at a floor is flush with the floor it serves, so on a city street the physics
  picks the street. The system owns that rule, and the game asks it.
- **The top floor has no gate.** The shaft's walls stop below the roof, so the car arrives
  in the open air and stepping out is stepping onto the roof.
- **The roof is a ring** round the shaft, because a deck across the whole tower would bury
  the car in itself on the last half-metre of its travel.

In the old town the two towers connect the works level, the home roof and a new skydeck 30 m
up; their shafts have **doors on two sides**, because the floors they serve are on opposite
sides of them — which is the sort of thing you only find by standing in the lift and
pressing the button.

### Smoother walking

V0.6.1 eased the joints, and the walk was still not right, because the *phase* was the
problem rather than the angles: a pose is derived once per simulation step, so on a display
faster than the tick rate the legs — and the camera's bob — advance in 60 Hz jumps. The gait
is a function of distance travelled, so the phase between steps is already known: the
fraction `alpha` of the next step has happened, and the phase has moved that fraction of
`bobPhaseStep`. Both the body and the camera now use the phase *at the moment being drawn*.

The cycle itself got three things that a pair of sine waves does not have: the shoulders
swing against the hips, the foot rolls rather than pointing the same way all cycle, and the
hip bob is a raised cosine whose bottom is round rather than kinked.

**And the joins.** V0.6.1's joints eased towards their target and were capped at a top
speed, and checking that properly in V0.7 showed why the walk was still wrong. A cap is a
kink: a joint that accelerates to a ceiling, holds it and drops back to easing has a
*discontinuous velocity* at both ends of the ceiling, and it is the discontinuity — far
more than the size of a movement — that an eye reads as a jerk. Measured at 240 Hz on a leg
whipping from a standing pose into a vault's tuck it was a change of **0.032 rad per frame
of velocity, inside one frame**.

The joints are critically damped springs now. No ceiling, no overshoot, no corner:
acceleration is a continuous function of position and velocity, so a limb starts from rest,
arrives without a bounce, and never has a kink. The same measurement is **0.0072** — a 4.5x
reduction in that one-frame spike, with the limb still reaching the same speed. Both halves
of it are tests: the spike has a ceiling, and the spring has to arrive, from one side,
without bouncing.

---

## What V0.6.1 fixes

**The body moved like a slideshow.** Every angle in `render/playerModel.ts` was set
outright each frame, so a change of pose was a cut: an arm snapped from a walk swing
to a vault reach in one frame, and the hip bob rode `|sin|`, whose kink at the bottom
of every step is a jolt through the whole body. Angles are now *targets* that each
joint travels towards — eased, and capped at a top speed — which makes a change of
mode continuous and gives the limbs weight. The ceilings are ordered the way a body
is: hips settle fastest, then the torso, then the limbs out to the hands.

The stride was slowed by about a fifth at the same time (6.4 m at a walk rather than
5, 8.6 at a sprint), which is a leg cycle of 1.2 Hz rather than 1.5 — the difference
between a run and a scuttle at the speed this game moves. The camera's bob rides the
same stride, so that calmed with it.

**Surfaces were drawn on each other's planes.** Two faces at the same depth, covering
the same pixels, are the one arrangement a depth buffer cannot resolve: the test ties,
rounding decides, and the pair shimmers whenever the camera moves. The district had
**thirty** of them, in four families, and each is fixed where it was authored rather
than by nudging the result:

| Where | What it was | The fix |
| --- | --- | --- |
| The machine rooms | The back wall spanned the room's whole outside, so its outer face was on exactly the same plane as each side wall's — a flickering seam down both outer corners | The back wall now fits *between* the side walls. The room is identical; the corner is formed by the side walls |
| Every doorway | The jambs were the same thickness as the wall, so the two front faces shared a plane along the whole reveal | The jambs are 6 cm thinner, which is both what a doorway does and 3 cm a side of clearance |
| The stacked crates | Two crates of exactly the same footprint put all four side faces on each other's planes | The upper one is 6 cm smaller, as a crate on top of a crate is |
| The works level | Duct supports that were the same width as the duct, two pipe runs ending exactly on a deck edge, and the climbable pipe finishing exactly level with the machine room's roof | Supports are 4 cm narrower and tucked in past the duct's ends; the pipe run stops short of the deck edge; the pipe's head stands 4 cm *proud* of the roof rather than level with it |

That last one had a false start worth recording: shortening the pipe by 4 cm fixes the
flicker and *breaks the climb*, because the top-out step has to land on a surface at
the pipe's own head — with the head below the roof there is nothing to stand on up
there and the climber is left hanging. Proud rather than short, and the note is in the
level data so the next person does not shorten it again.

The test that guards all this is `surfaces that share a plane`, and it is general: no
two faces anywhere in the district may be within the depth buffer's resolution at the
level's far corner. It is what found the thirty, and it will find the thirty-first.

**Every sign was the same sign.** Six panels in three colours at three sizes, and the
district read as though everything had been bought in one order. There are now five
shapes — the original panel, a wide fascia **bar**, a projecting **blade**, a tube
**frame** that lets the wall show through, and a small **badge** — hung at ten
positions in six colours and seven size combinations. The lit part of each is
emissive in its own tint, which a test now checks per sign rather than per model, so
a new sign whose glowing face is not actually glowing fails rather than shipping.

---

## What V0.6 delivers

Every item from the V0.6 section of the project roadmap, and where it lives:

| Feature | Where |
| --- | --- |
| Feel | `core/config.ts` (`feel`), `game/player.ts` (`updateJumpWindows`) — coyote time and a jump buffer |
| Camera effects | `game/camera.ts` (`CameraEffects`), `game/game.ts` (`updateEffects`, the render path) — speed FOV, lean, landing dip and shake |
| Animations | `render/playerModel.ts` (`posePlayerBody`), `game/pose.ts` (the pose the body is given) |
| Lighting | `render/view.ts` (`PCFShadowMap`, shadow map sized by the graphics preset) |
| Audio | `audio/synth.ts` (a checkpoint chime, a menu click), `audio/engine.ts` (one gain per bus, three volumes) |
| Models | `render/playerModel.ts` — a body rather than a capsule, built from the same parts-and-surfaces system as the district |
| UI | `ui/settingsScreen.ts`, `ui/screens.ts` (Settings on the title and pause menus), `ui/hud.ts` (hidden by default) |
| Optimisation | `render/sceneBuilder.ts` (`geometryCache`), `render/view.ts` (`setQuality`) |
| Settings | `core/settings.ts` — sensitivity, FOV, graphics, volumes, camera motion and keybinds, all persisted |
| Player model | `render/playerModel.ts` — visible from the chest down, and casting a shadow |

### And what running it turned up

The roadmap item that is not on any list is "play the thing". V0.6 was built with a
real browser pointed at the dev server throughout, and these all came out of that
rather than out of a plan:

**The star field looked like a shower of dashes.** Each star was two or three texels
across, and a radial falloff quantised onto a texel grid makes a plus sign, which the
face projection then stretched. Stars are now smaller than a texel, so the sampler
rounds them into points, with the brightness skewed so most are faint and a few are
bright. The committed texture set fell from 383 KiB to 321 KiB in the process.

**Shadows were not the shadows the demo asked for.** `THREE.PCFSoftShadowMap` was
removed in three.js r186: setting it logs a warning and silently falls back to hard
PCF. The demo had been asking for soft shadows it had never been getting. It now uses
`PCFShadowMap` deliberately, at a resolution the graphics preset controls — which is
better than a filter that quietly means something else.

**The debug overlay was on by default.** Developer information, in front of every
frame of a technical demo, until F3 was pressed. It is off by default now, and the
controls screen says so.

**The menus were silent.** Every button, every slider, no feedback. There is a click
now, and the click is also what resumes the audio context, which is why the first
press of a session is what starts the sound.

**And the two hardest bugs of the version were both physics:**

- Coyote time doubled the height of every jump, because the forgiveness window it
  opened was still open in the instant *after* a jump — so a held jump fired twice.
  A jump taken from the ground now closes the window behind it, and there is a
  regression test named after exactly that.
- The coyote branch skipped gravity for its twelve hundredths of a second, which let
  a player float off the roof and *clear a canyon they should have fallen into*. The
  integration test that walks off every edge of the deck caught it, which is what
  that test is for.

---

## What V0.5 delivered

V0.5 made the district a level: nine roofs on two levels joined by two lifts into a
loop, eight pickups, a finish line that has to be earned, and a clock that is kept
between sessions. V0.5.1 then fixed what V0.5 got wrong — including the first red CI
run on `main`, which was a texture test that regenerated several million pixels
twice and ran out of Vitest's five-second budget on a slower runner.

Everything V0.1-V0.5 built is still here, and V0.6 builds *with* it rather than beside
it: the settings drive the camera and the audio the game already had, the body is
posed from the state machine the movement already uses, and the quality presets turn
knobs the renderer already owned.

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

## Settings

Everything the player can change lives in one file, `core/settings.ts`, and it is
data: the input layer, the camera, the renderer and the mixer are all handed their
numbers from it rather than reading `DEFAULT_CONFIG`.

| Setting | Range | Applies |
| --- | --- | --- |
| Mouse sensitivity | 0.25× – 3× the tuned base | The next mouse movement |
| Invert vertical look | on/off | The next mouse movement |
| Field of view | 65° – 110° | The frame it is set |
| Camera motion | Full · Reduced · Off | The next frame |
| Graphics | Low · Medium · High | Immediately, mid-run |
| Master / Music / Effects volume | 0 – 1 | Immediately |
| 12 key bindings | any key | Immediately, including rebinding mid-run |

Two things about it are worth more than the list.

**Normalise, never trust.** What comes back from storage is a JSON blob that a
different version — or a curious player — wrote. Every value is clamped into range,
every enum checked against its list, a missing binding falls back to its default
rather than leaving an action unreachable, and anything unusable falls back to the
whole defaults. A corrupt settings file cannot stop the game from starting, and there
is a test per way that could go wrong.

**One patch, applied everywhere.** `Game.updateSettings` is the only way settings
change. It merges the patch over what is in force, normalises the result, pushes it to
the input layer, the camera, the renderer and the audio, saves it, and reports back
what it settled on. The settings screen draws *the answer* rather than the patch, so a
slider that asked for an impossible value shows the value it got.

### Graphics presets

A preset is a table of numbers, not a chain of `if (quality === 'low')` in the
renderer:

| | Low | Medium | High |
| --- | --- | --- | --- |
| Drawing buffer | 1× | 1.5× | up to 2× |
| Shadows | off | on | on |
| Shadow map | — | 2048² | 4096² |
| Anisotropic filtering | 2× | 8× | 16× |
| Smoke plumes | 35% | 70% | all |
| Lamps | 40% | 75% | all |

Two of those need care, and both are in `view.ts` with a comment saying why. Toggling
`renderer.shadowMap.enabled` changes which shader a material compiles to, and three.js
recompiles nothing by itself, so every material has to be marked dirty. And setting a
shadow map's size on a light whose map already exists does nothing at all — the render
target has to be thrown away so it is rebuilt.

The thinning of smoke and lamps strides through the list rather than taking a prefix,
so a low preset thins every plume in the district instead of erasing whichever ones
happened to be declared last, and applying the same setting twice leaves the same
things lit.

### Key bindings

Codes are `KeyboardEvent.code` values, so the layout stays physical: WASD is under the
same fingers on an AZERTY or Dvorak keyboard. The settings screen shows them as a
player would say them — `Space`, `Left Ctrl + C`, `↑` — and rebinding *takes the key
off whatever else had it*, so one key cannot quietly end up doing two jobs. (Sharing
is possible and reported rather than prevented: taking both of a two-key binding would
leave that action unreachable, so in that case the key is shared and the screen says
so.)

---

## Camera effects

The camera does four things because of what the body is doing, and all four live in
`game/camera.ts` as data:

- **Speed opens the field of view** by up to 4.5°, and crouching closes it by 3°.
  Both are *approached* rather than set, so running and stopping is a swell.
- **A landing dips the camera** and rings it: the dip is proportional to the same
  impact the health bar measures, so a landing that hurts is a landing that shows.
- **A slide leans, and a wall run leans into the wall** — which side the wall is on
  is worked out in the player's own frame, so running the same wall the other way
  leans the other way, as it should.
- **Everything decays.** No effect is left at a value somebody has to remember to
  clear; a respawn, a pause and turning the setting off all leave the view level.

The Camera motion setting multiplies the lot — and it is a real reduction rather than
a token one, because a bob the eye has to *track* is the difference, for some players,
between playing and not playing. `Off` is zero: the head bob, the FOV kick, the dip,
the shake and the lean all stop, and the camera is exactly where the player put it.

---

## Feel

Two windows of forgiveness, both in `core/config.ts`, both about the gap between what
the player pressed and what the simulation could know.

**Coyote time (0.12 s).** Walk off an edge and jump a tenth of a second later and it
still counts. Long enough to cover a player who was watching their feet rather than
the edge; short enough that it never reads as flight.

**Jump buffering (0.15 s).** Press jump just before landing and the game holds it
until there is something to jump from. Holding the key keeps the buffer open, which is
what makes holding jump hop on every landing rather than only on the first.

Both are counted in seconds and both are closed by the thing they forgive: the coyote
window opens when the ground is left, and a buffered press is spent when it is used.

The subtlety that cost a day is that a jump taken *from* the ground is not a coyote
jump. Leaving the window open behind a jump meant a held key fired again in the same
instant the ground was left, which doubled the apex of every jump in the game — a
bug that no unit test noticed because every test pressed jump once. There is one now.

---

## Your body

The player has a body. You see it when you look down — chest, arms, legs, feet — and
it casts a shadow on the roof, so the district has a person in it rather than a
floating camera.

It is built the same way the district is: a handful of boxes, the same surface
materials, no skeleton, no animation file, no artist. `game/pose.ts` derives a *pose*
from the player state each frame — a gait phase, how much stride to apply, which way
the arms should be reaching, a lean — and `render/playerModel.ts` turns that into
angles. The split is what makes the animation testable in Node: the decisions are
pure, and the renderer only has to know what "reach" looks like.

Every angle is a *target* that the joint travels towards, eased and capped at a top
speed, so a change of pose is a movement rather than a cut and the limbs carry weight.
The caps are ordered the way a body is: hips fastest, then the torso, then the legs and
out to the hands.

The pose is derived, not keyframed, which has two consequences worth having:

- **The walk is a function of distance travelled**, because the gait phase is. The
  legs therefore cannot slide against the ground at any speed or frame rate.
- **The special cases are answers, not animations.** A vault reaches forward with
  both hands; a wall run drives the leg on the wall's side into it; a body that has
  stopped being alive is limp. Each is one line in the pose, and each has a test.

The proportions are chosen against the camera rather than against a photograph: the
eye is at 1.65 m and the shoulders at 1.40, which leaves the chest 25 cm below the
camera — close enough that looking down finds it immediately, far enough that it does
not fill the screen the way a chest does when the camera is inside it. The lit patch
on the chest is deliberately small, because it is the nearest thing to the camera when
the player looks down, and anything larger turns the whole view cyan.

---

## Optimisation

V0.7.1's work has a section of its own, above. What follows is V0.6's, which it replaces
and builds on - and which is still true, still measured, and still the reason the merge
had a cache of identical boxes to copy from.

V0.6's optimisation work started from a measurement rather than an assumption.

**Geometry is shared exactly when it is identical.** The district is 637 meshes built
from parts, and parts repeat: every trim on a 0.6 m slab is the same box with the same
texture scale on every prop that has one. Each part used to get its own vertex buffer —
637 geometries for 637 meshes. The scene builder now keys a cache on the exact tuple
that determines a box (size, tile size, UV scale), which merges **637 meshes onto 476
geometries** — a quarter of the vertex buffers, for geometry that renders identically
by construction. The materials were already shared, at 57 for the whole district.

**The shadow map is sized by the graphics preset.** It was a fixed 2048² over a 220 m
shadow volume: 10.7 cm per texel, which is the difference between a chunky shadow edge
and a clean one. A preset can now spend 4096² on it, or nothing at all.

**And the frame path still allocates nothing.** The camera effects own one frame object
and rewrite it; the pose is written into a scratch object; the eye and the feet are
reused vectors. The one thing that does allocate per frame is nothing, which is worth
saying out loud because it is easy to lose.

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
tracks speed and is identical at any frame rate. Deliberately quiet, and softened
again in V0.5.1 to roughly half what V0.3 settled on: 1.7 cm vertical, 0.8 cm
lateral, a slow fade, and an amplitude that falls off with speed.

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
- **Signs on the towers north of the district**, in five shapes: a lit panel, a wide
  fascia bar with capped ends, a tall projecting blade on a bracket, a tube frame round
  a dark backing, and a small badge with a lit rim. One constraint governs them all,
  and it is worth knowing before adding another: a sign glows out of its front face, so
  only a facade facing back towards the roofs will read.
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

Every prop is an instance of a model from `src/game/level/models.ts` — thirty-eight of
them now, from a five-part `crate` to a ten-part `pipe-vertical`: the V0.5 `neon-strip`,
`lift-platform` and `data-shard`, the four sign silhouettes V0.6.1 added, and V0.7's ten -
`ladder`, `solar-panel`, `billboard`, `crane`, `scaffold`, `construction-slab`,
`construction-column`, `crown`, `elevator-cab` and `elevator-gate`. A model can also declare
itself `mounted` rather than stacked, which is how the level's "nothing floats" rule knows
that a sign hangs on a wall instead of standing on something.

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

V0.6 adds two more, and gives the mixer three volumes. A **checkpoint** is two notes
rising — the most important event in a run had been silent, which is a thing to read
rather than a thing to hear. A **menu click** is deliberately the quietest cue in the
game: it is feedback that the press landed, and it plays on every button.

The mixer is now one gain per bus — master, effects, music — and *one* method writes
any of them. Mute used to be re-applied by hand in three places, which is how a muted
game ended up with the wind still audible after a volume change.

V0.5 added two sounds to the bank. A **pickup** is a short bell that rises two
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
        ├─ derive the body's pose, and advance the camera effects
        ├─ render: interpolated eye + stance height + head bob + effect offsets,
        │          with the field of view the effects ask for and the roll they
        │          want, and the body placed at the interpolated feet
        └─ update the HUDs (the play HUD every frame, the debug overlay at 10 Hz)
```

Two details worth knowing:

- **Simulation is fixed-step, rendering is not.** Physics always advances in exact
  1/60 s steps, so behaviour is identical on a 60 Hz and a 240 Hz display. The
  leftover fraction of a step interpolates the camera, which removes judder.
- **The loop keeps running while paused**, and a finished run is paused in the same
  sense: the results screen is up, the world is frozen behind it, and the loop is
  still there to be restarted.
- **The play HUD is updated every frame and the debug overlay ten times a second.**
  The clock has to move every frame — a timer showing hundredths that is only decided
  ten times a second reads as broken — and the overlay is a dozen rows of measured
  text, which does not. The HUD writes each text node only when its value changed.

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

**The debug overlay starts hidden.** It was on by default until V0.6, which made a
technical demo look like a development build; F3 (or the backtick) brings it back, and
the controls screen says so. A hidden overlay is not updated at all — that is the point
of hiding it — so the numbers resume from the truth whenever it is shown.


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

1047 tests in 39 files, in five layers:

- **Unit tests** — maths, the delta-time system, the game loop, the input state, the
  AABB helpers, the collision solver, every movement mode and their transitions, the
  movement state machine and its transition graph, ledge, wall and vault probing,
  pipe climbing, the door system, the lift travel and its rider carry, the run
  clock, the splits, the record and its storage, the effect poses, models, level
  validation, the crash reporter/sinks/report builder, the audio synthesiser and
  director, the play HUD, the debug HUD and every screen — and, from V0.6, the
  settings model and its normalisation, the camera effects, the body's pose and the
  angles it turns into, and the graphics presets.
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
  UV scaling, disposal) and the committed textures against their generators. Those
  last ones are the only tests in the suite that are *expensive*: the committed
  set is several million pixels, so the file caches each generated image rather
  than building it once per test, and the two tests that genuinely are made of
  pixel work are given a 30-second budget rather than Vitest's five-second default.

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

And in V0.5.1, from the first red CI run on `main` and from re-reading V0.5 with
fresh eyes:

- The committed-texture test regenerated the whole texture set twice and blew
  Vitest's five-second timeout on CI's slower runners — the bug the release exists
  for. It never failed locally, which is the whole reason it is worth a *budget*
  rather than a faster machine next time.
- The run clock only reached the screen ten times a second, so a timer showing
  hundredths advanced in visible tenths.
- A dead player falling through the finish line completed the run.
- A run finished with no time on the clock stored a best of `0.000`, which nothing
  could ever beat again.
- The splits array was indexed by checkpoint, so skipping one shifted every label
  after it.
- `E` outside a run could still open a door.
- The recovered-report banner on the title screen was styled as an error.
- The pickup sample cache was keyed by index rather than by pitch step, so it grew
  a duplicate buffer for every pickup past the tenth.

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
build — which is what V0.5 was merged on the strength of, and what V0.5.1 exists to
make true again.

The one wrinkle worth knowing about: the texture tests generate megabytes of pixels,
and they are the only tests here whose runtime is bounded by how fast the runner is
rather than by what they assert. They carry an explicit 30-second budget so that a
slow runner proves the images *match*, not that the machine is quick.

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
    │   ├── settings.ts         what the player chose, and how it is trusted
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
    │   ├── camera.ts           camera effects: FOV, lean, landing dip, shake
    │   ├── pose.ts             what the player's body is doing, as data
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
    │   ├── bindings.ts         the key map, and how a key is described
    │   ├── inputState.ts       pure input state (keys, motion, actions)
    │   └── domInput.ts         keyboard listeners + pointer lock
    ├── render
    │   ├── types.ts            GameViewLike + SceneAssets: the renderer contract
    │   ├── assets.ts           texture loading (non-fatal, injectable loaders)
    │   ├── effects.ts          the pure poses of smoke and pickups
    │   ├── view.ts             WebGLRenderer, camera, doors, lifts, animation
    │   ├── playerModel.ts      the player's body, and its procedural animation
    │   └── sceneBuilder.ts     level geometry, lights, signs, lifts, skyline
    └── ui
        ├── dom.ts              small element helpers
        ├── gameHud.ts          the play HUD: health, checkpoints, the clock
        ├── hud.ts              the debug overlay
        ├── settingsScreen.ts   sliders, presets, volumes and key capture
        ├── screens.ts          title / controls / about / settings / pause / results / ended / crash
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

**The player's body is posed, not animated.** There is no skeleton and no animation
file: the limbs are groups, and their angles come from the pose the game derives each
frame. That is why the walk cannot slide against the ground at any speed or frame rate,
and why a vault reaches forward with both hands without anybody having authored a vault.

**Camera effects are a *view* offset.** They move the camera and never the player, so a
landing shake cannot be mistaken for the body moving — and turning the setting off is
zero rather than "less".

**A jump from the ground closes the coyote window.** Otherwise the forgiveness that
covers stepping off a ledge also covers the instant after a jump, and a held key
doubles the apex. The window is `Infinity` when closed, which is a strange-looking
value and exactly why the comment next to it is three sentences long.

**Low quality is a real reduction.** No shadows at all, a fifth of the lamps, a third
of the smoke. A preset that only lowered the resolution would be a preset nobody could
see the point of.

**The crash reporter is local-only.** Nothing is uploaded.

**The texture tests are the slow ones.** Not a limitation of the demo, but of the
suite: they generate the committed image set from scratch to prove it has not gone
stale, which is seconds of work on any machine rather than milliseconds. They carry a
30-second budget for exactly that reason, and the rest of the suite is a second and a
half.

**No `LICENSE` file yet.** Without one, the default is "all rights reserved".

---

## Out of scope for V0.7

The roadmap continues past this demo. Nothing below is implemented, and none of it is
stubbed:

**V0.7** polish, and labelling the district as Level 1.

---

## Roadmap

V0.0 built the engine skeleton, V0.1 made it a place, V0.2 made it a place you can
move through, V0.3 turned it into a route, and V0.4 opened the route up — indoors,
onto the signage, and into a movement state machine.

V0.5 made it a **level**: nine roofs on two levels joined by two lifts into a loop,
eight pickups along the way, a finish that has to be earned, and a clock that is kept
between sessions. The air has fog and smoke in it, the sky has stars, and the neon is
on the buildings.

V0.5.1 was the bugfix release for V0.5: the CI timeout, the ten-Hertz clock, finishing
while dead, the unbreakable zero-second record, and a softer head bob. It is the
release that made the green badge true again.

V0.6, this version, is the polish pass: settings that are remembered, a camera that
answers the running, two windows of forgiveness around the jump, a body of your own
with a shadow under it, a graphics preset that means something, three volume buses,
and a measured quarter off the district's vertex buffers. It is the release that comes
from *playing* the game — every one of its sharpest bugs was found with a browser
pointed at the dev server rather than from a plan.

V0.6.1 fixed the three things playing V0.6 turned up: a body that moved in cuts, a
district whose surfaces shared planes and shimmered for it, and six signs that were
one sign.

V0.7, this version, is the largest change the project has had: the district became a city
of four and a half thousand props, the platform lifts became buildings you call, and the
walk got the one fix that a smooth set of joints was never going to provide.

V0.7.1 optimised the city the way an engine is optimised: by measuring what a frame asks
for, removing what it asks for and does not need, and proving the result is the same game.
Both halves were checked against the old behaviour rather than against a feeling - the
merge against the polygons it has to reproduce, and the physics against the solver it
replaced.

V0.7.2 joined the city up: it took the generator's own claims - a jump between roofs, a
lift you have to go inside to use - and turned them into measurements with tests behind
them, which is the only way either claim was worth making.

V0.7.3 moved the city to where the player is, which is a thing a generator cannot be trusted
to have done because it looks right from the air. It was found by walking the player west
from the spawn and watching them fall thirty-five metres and die - the shortest measurement
in the project so far, and the one that mattered most.

V0.7.4 was the version about the *floor* of a city rather than its skyline: the seam between
two ground slabs, the width of a street, whether two buildings are one building, and whether
a window looks like glass.

V0.7.5 is the version where the city stopped being painted and started being measured: 85% of
roofs within two jumps of two neighbours, and a paragraph above saying plainly which parts of the
rule are not met.

V0.7.6 removed more code than it added, and the city got better: the grid is the route, the
overlaps are gone by construction, and there is nothing left in the generator that can put two
buildings in one place.

V0.7.7 finished the job V0.7.6 started: the grid is the map, and the map is the grid.

The next milestone is V0.8: siting the run on rooftops, polish, and the graphics pass.
