# The city map: why it reads as a grid, and how to make it a city

**Status: analysis and plan only. Nothing here is implemented or committed.**

Every number below was measured by running the real generator
(`generateCity()` with the default seed) and inspecting the props it produces, not
read off the source. The probe scripts live in the session scratch directory and are
not part of the repository.

---

## 1. What the map is now

| | |
|---|---|
| Grid | 16 × 16 cells, 62 m pitch, ~1 km square |
| Props | 11,796 |
| Lights | 591 |
| Lifts | 76 |
| Buildings | 218 (block 84, interior 48, hall 31, tower 28, construction 27) |
| Courtyards | 38 (14.8 % of cells) |
| Building footprint coverage | 37.8 % of the map |
| Roof heights | 11.4 – 51.8 m above the street, median 28 m |
| Distinct roof heights | 125 of 152 main bodies |
| Adjacent roof height step | median 6.6 m, p90 19.0 m, max 31.9 m |
| Street width | 4.5 – 5.0 m (road marking 3.87 – 4.29 m) |
| Main body widths | 28 m (40), 50 m (28), 56 m (84) — **55 % are ~56 m** |
| Distinct aspect ratios | 3 |
| Concrete tints | 9 |
| Neon tints | 9 |
| Signs placed | 240 (43 dropped as "sign-nowhere") |
| Signs below 6 m | **0** |
| Sign height | min 9.5 m, median 25.5 m |
| Balcony decks | 68, **0 with a railing** |
| Street-level model types | 14 |
| Collidable street-level props | 1,899 (816 slab, 255 ladder, 206 lamp) |

The generator is genuinely well engineered. It is deterministic, it validates, it
guarantees jumpability, it has no floating props, every ladder climbs, every lift
serves its floors. The problem is not correctness. It is that the *composition* is
uniform in exactly the dimensions the eye uses to recognise a city.

---

## 2. The six reasons it reads as a grid

### 2.1 There is no skyline — the height is flat everywhere

Mean roof height by distance from the centre:

| Radius | Mean height |
|---|---|
| 0–100 m | 24.6 m |
| 100–200 m | 25.3 m |
| 200–300 m | 27.8 m |
| 300–400 m | 25.9 m |
| 400–500 m | 28.5 m |
| 500–700 m | 24.6 m |

A real city has a core. This one is a uniform plate with random noise on it. The
height *variety* is fine (125 distinct heights, only 4.7 % of neighbours identical),
but there is no *structure* — no downtown, no mid-ring, no low outskirts. From a
rooftop the skyline is a hedge, not a skyline.

### 2.2 The footprints are a monoculture

84 of 152 main bodies are ~56 m square. There are three aspect ratios in the whole
city, and every body is an axis-aligned box. The grid is not merely *on* a grid; each
building is the same box on the same pitch. This is the single most visible cause of
"building grid".

### 2.3 The streets are one width

Streets vary 4.5–5.0 m — a 0.5 m spread across a kilometre. There are no avenues, no
alleys, no squares. Every gap is the same gap, which is what graph paper looks like.

### 2.4 There is nothing at street level

This is the biggest miss for *cyberpunk* specifically. Measured:

- **0 signs below 6 m.** Every one of the 240 signs hangs at a median of 25.5 m.
- Only **14 model types** appear within 8 m of the street, and 816 of the 1,899
  collidable street props are bare `slab`.
- No shopfronts, no awnings, no stalls, no street-level neon, no cables, no grime.

Cyberpunk is a *street-level* aesthetic — the canyon of neon at eye height. This city
has its neon on the roof, where the player only sees it from a distance.

### 2.5 There is no vertical layering

Everything is either on the ground or on a roof. There are 59 roof gangways, but no
skybridges over streets at mid-height, no arcades, no overhangs, no balconies with
railings. The space *between* the ground and the roof is empty.

### 2.6 The courtyards are isolated

38 courtyards exist, but each is a walled yard with a scaffold — not part of a
walkable alley network. There is no way to move through the city at ground level
except along the uniform streets.

---

## 3. The plan

Seven phases, ordered by visual return per unit of risk. Each states a measurable
target so the change can be checked rather than argued about, in the spirit of the
rest of this repository.

### Phase 1 — A skyline (the highest-value change)

**What.** Add a radial height gradient to `roofTargets`: a tall core, a mid-ring, a
low edge. Keep the existing random component and the neighbour-lead cap on top.

**Why.** This is the single change that most makes a grid read as a city. It is also
cheap: one function, no new geometry.

**How.** `target = groundY + coreHeight(radius) + random() * spread`, where
`coreHeight` falls from ~50 m at the centre to ~16 m at the edge. The existing cap
(`min(mine, avg(neighbours) + HEIGHT_LEAD)`) still applies and still trims random
spikes; because the gradient is smooth (≈4 m per cell at 62 m pitch) it survives the
cap untouched.

**Target.** Mean height by radius becomes monotonic: core ≥ 40 m, edge ≤ 22 m, with
the 0–100 m ring at least 15 m above the 400–500 m ring.

**Risk.** Low. The cap is the safety net; the "varies its heights" test (spread > 20 m)
still passes because the random component remains.

### Phase 2 — Footprint variety

**What.** Draw width and depth independently per cell, and compose some buildings
from more than one box: L-shapes, setbacks, chamfered corners.

**Why.** Breaks the 56 m monoculture and the three-aspect-ratio limit.

**How.** `width = pitch - streetX`, `depth = pitch - streetZ`, with `streetX` and
`streetZ` drawn separately. For L-shapes, build the body as two overlapping boxes
whose union is the footprint; the collision is already AABB-per-prop, so two boxes is
two colliders and needs no new physics. Setbacks are a smaller box stacked on a
larger one — the tower archetype already does this.

**Target.** At least 8 distinct aspect ratios; no single footprint size above 35 % of
buildings; at least 20 % of buildings composed of two or more masses.

**Risk.** Medium. The street-width test measures the gap between bodies, so
independent width/depth must keep both gaps inside the jumpable band (see §4).

### Phase 3 — Street hierarchy without breaking parkour

**What.** Widen the *ground* while keeping the *roof gap* jumpable, by insetting the
ground floor and overhanging the upper floors (an arcade). Add a few genuine wide
avenues, compensated by skybridges and ladders.

**Why.** Real cities have boulevards and alleys. The current 0.5 m spread is the
graph-paper tell.

**How.** Two boxes per building: a ground-floor mass inset 2–3 m on one or two sides,
and the full-width upper mass above it. The roof-to-roof gap is unchanged, so
jumpability is preserved by construction; the street *feels* wider and gains an
overhang. For true avenues, see the open decision in §5.

**Target.** At least three street-width classes (alley < 4 m, street 4–6 m, avenue
> 8 m) with a visible distribution; at least 25 % of buildings with a ground-floor
inset.

**Risk.** Medium. The arcade approach is safe; true avenues require relaxing a test
(§5).

### Phase 4 — Street-level life (the cyberpunk phase)

**What.** Put the city at eye level: shopfronts, awnings, street-level neon, market
stalls, overhead cables, grime and puddles.

**Why.** This is what "cyberpunk" actually means, and the map currently has none of
it. 0 signs below 6 m is the headline number.

**How.** A new street-dressing pass, separate from the roof pass, that walks the
street edges and places:
- **Shopfronts** — a lit panel inset into the ground floor, one per building face.
- **Awnings** — a thin slab projecting 1.5 m over the pavement.
- **Street-level neon** — signs at 2.5–5 m, the height a person reads them at.
- **Clutter** — crates, bins, stalls, barriers, in rows along the kerb.
- **Overhead cables** — thin spans between buildings at 6–9 m.

New models are needed for shopfront, awning, stall and cable; the existing
`neon-bar`/`neon-frame`/`neon-blade` can be reused at low height immediately.

**Target.** At least 150 signs below 6 m; at least 20 distinct model types within 8 m
of the street; every building face on a street gets a shopfront or an awning.

**Risk.** Medium. New models must be measured (`tools/models/bounds.ts`) and the
attachment invariant must hold — an awning needs a bracket, a cable needs two anchors.

### Phase 5 — Vertical layering

**What.** Skybridges over streets at mid-height, arcades, and railings on every
balcony.

**Why.** Fills the empty space between ground and roof, and fixes a visible defect:
**0 of the 68 balcony decks have a railing**, which reads as unfinished.

**How.** Skybridges reuse the gangway logic but at mid-height between facing
buildings. Balcony rails are a `barrier` prop on the deck's outer edge, exactly as the
fire escape already does.

**Target.** At least 30 skybridges; 100 % of balconies with a rail; at least 20
overhangs.

**Risk.** Low for rails; medium for skybridges (they must not block a climb column or
a lift shaft — the ladder lesson from V2.0.2 applies).

### Phase 6 — An alley network

**What.** Connect the 38 courtyards into a walkable alley system rather than isolated
yards.

**Why.** Gives the ground level a topology, and makes the courtyards part of the city
rather than holes in it.

**How.** Carve a sparse network of narrow passages between selected cells, linking
courtyards to streets. This is the most invasive change and should come last.

**Target.** At least 60 % of courtyards reachable from a street without crossing a
building.

**Risk.** High. It changes the grid topology and will interact with every placement
pass.

### Phase 7 — Palette and neighbourhood identity

**What.** Expand the concrete and neon palettes, and give each quadrant or district
its own tint family.

**Why.** 9 concrete tints and 9 neon tints across a kilometre is why every block looks
like every other block. Distinct neighbourhoods are a city signature.

**How.** Per-district tint sets drawn from a larger palette; a district is a coarse
cell region (e.g. 4 × 4 blocks).

**Target.** At least 24 concrete tints and 20 neon tints in use; adjacent districts
visibly different.

**Risk.** Low. Pure data.

---

## 4. Constraints any change must hold

These are load-bearing and are enforced by tests today:

- **Every roof within a running jump of another** (`city.test.ts`).
- **Every neighbour's street between 3.5 m and the jump** (5.7 m + 0.2).
- **No building more than 15 m over its neighbours' average.**
- **No two buildings in one place.**
- **Nothing floats** — every prop reaches the ground through touching boxes
  (`attachment.test.ts`).
- **Every ladder climbs** — all 368 stacks, in the real collision world
  (`ladders.test.ts`).
- **Every lift car in open air at every floor it serves.**
- **Determinism** — same seed, same city.
- **Frame budget** — 300 collision moves under 400 ms.

Any phase that changes the street-width distribution must either stay inside the
jumpable band (the arcade approach in Phase 3 does) or update that test to the new
invariant and say why, per the repository's convention.

---

## 5. The one decision that is yours

**Do we keep "every neighbour is jumpable", or relax it to "every roof is
reachable"?**

- **Keep it (recommended for now).** Phases 1, 2, 4, 5, 7 are all compatible. Phase 3
  is limited to arcades and overhangs — real variety at eye level, but no true wide
  avenues. The parkour guarantee stays absolute.
- **Relax it.** True boulevards and plazas become possible, at the cost of replacing
  the street-width test with a reachability test (jump **or** bridge **or** ladder).
  This is a bigger, more interesting city, but it weakens a guarantee the game has
  held since V0.7.

My recommendation is to do Phases 1, 2, 4, 5 and 7 first — they deliver most of the
visual change with no change to the parkour contract — and treat Phase 3's avenues and
Phase 6's alleys as a later, explicitly-scoped version if the result still reads as a
grid.

---

## 6. Suggested sequencing

| Phase | Value | Risk | Depends on |
|---|---|---|---|
| 1 Skyline | Very high | Low | — |
| 4 Street-level life | Very high | Medium | new models |
| 2 Footprints | High | Medium | — |
| 5 Layering + rails | Medium | Low | — |
| 7 Palette | Medium | Low | — |
| 3 Street hierarchy | High | Medium | §5 decision |
| 6 Alley network | Medium | High | 2, 3 |

Phases 1, 2, 4, 5 and 7 are independent of each other and could ship as separate
versions, each with its own measured target and its own README update.
