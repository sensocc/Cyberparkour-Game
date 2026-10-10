/**
 * The city: everything outside the hand-authored district.
 *
 * V0.7's headline is that the demo is no longer a district. The curated roofs of V0.3
 * to V0.6 are still there, in the middle, and this file builds a kilometre of city
 * around them - blocks, streets, towers, construction sites, billboards and lifts -
 * from a seed, so the whole thing is one number away from being a different city and
 * is exactly the same city every time it is built.
 *
 * The design rules that make it *playable* rather than merely large:
 *
 *  - **Roofs come in terraces.** A block's buildings are drawn from the same height
 *    band, so their roofs are 2-8 m apart: a gap you clear with a jump or a vault, not
 *    a wall. Neighbouring blocks are a band apart, and the bands step up towards the
 *    centre, so the skyline has a shape and every roof has somewhere to go.
 *  - **Every building is a route.** Each one has a ladder, a balcony, a setback or a
 *    neighbouring roof at a reachable height, so nothing in the city is decoration you
 *    can only look at.
 *  - **The lifts go where parkour cannot.** A tower's lift serves its street, its roof
 *    and a skydeck above it, so the top of the city is reached by using the city.
 *  - **Nothing is placed where the district already is.** The old town keeps its own
 *    ground, and the generator fills in around it.
 *
 * Everything here is *data*, like the rest of the level: it produces props, lights and
 * elevator definitions and hands them back for the level to validate.
 */

import { createRandom } from '../../core/random.js';

import { liftTower, type LevelDefinition, type PropDefinition } from './levelData.js';
import { crossingGap, crossingRise } from '../reach.js';
import { DEFAULT_CONFIG } from '../../core/config.js';

/** How the city is laid out. All of it is optional; the defaults are the demo's. */
export interface CityOptions {
  /** Seed for the layout. The same seed is the same city, for ever. */
  readonly seed?: number;
  /** Half-extent of the built city from the origin (m). */
  readonly radius?: number;
  /** Block pitch: building footprint plus street (m). */
  readonly pitch?: number;
  /** Street width between blocks (m). */
  readonly street?: number;
  /** Ground level, which is where the streets are (m). */
  readonly groundY?: number;
  /** Keep this rectangle clear for the hand-authored district, as `[x0, x1, z0, z1]`. */
  readonly keepClear?: readonly [number, number, number, number];
  /**
   * The level's own solid buildings, as the city needs to see them.
   *
   * Filled in by `buildCity`. They are two things at once: ground a city plot may not
   * build over, and - the point of this version - the things the city has to *attach* to.
   * A district standing alone in a cleared rectangle is a district nobody can walk out of.
   */
  readonly masses?: readonly Mass[];
}

interface Resolved {
  readonly seed: number;
  readonly radius: number;
  readonly pitch: number;
  readonly street: number;
  readonly groundY: number;
  readonly keepClear: readonly [number, number, number, number];
  readonly masses: readonly Mass[];
}

const DEFAULTS: Resolved = {
  seed: 20271010,
  // Half a kilometre each way: a kilometre of city, which is where a parkour run across
  // it becomes an expedition rather than a lap.
  radius: 500,
  pitch: 62,
  street: 18,
  groundY: -34.8,
  // Overridden below, from the level itself. The literal is the fallback for a level with
  // nothing to measure.
  keepClear: [-16, 106, -12, 32],
  masses: [],
};

/**
 * How far the district's own ground is kept clear, from the district itself.
 *
 * V0.7 hard-coded a rectangle twice the district's size - 290 m by 220 m - and then filled
 * the rest of the kilometre with city. The effect was a district standing on its own with
 * sixty metres of nothing between it and the nearest generated building, which is exactly
 * what "the city is a decoration outside the playable map" means.
 *
 * So the clearance is measured instead: the footprint of the level's own walkable decks,
 * plus a street. The city then begins one street away from the district's edge, which is
 * the distance the infill pass knows how to bridge.
 */
function clearanceFor(base: LevelDefinition, street: number): readonly [number, number, number, number] {
  // Decks, not ground. The district has a 700 x 700 slab under everything (`city-ground`),
  // and measuring *that* as the district's footprint is how the first attempt at this
  // pushed the city back out to where it was: the clearance came out as the whole map.
  // A surface bigger than a building is ground, and ground is what the city is built on.
  const decks = base.props.filter(
    (prop) => prop.kind === 'floor' && prop.size.x * prop.size.z < 5000,
  );
  if (decks.length === 0) return DEFAULTS.keepClear;

  const minX = Math.min(...decks.map((prop) => prop.position.x - prop.size.x / 2));
  const maxX = Math.max(...decks.map((prop) => prop.position.x + prop.size.x / 2));
  const minZ = Math.min(...decks.map((prop) => prop.position.z - prop.size.z / 2));
  const maxZ = Math.max(...decks.map((prop) => prop.position.z + prop.size.z / 2));
  // Two metres of street, not one: the point is that the city's first rooftops are a jump
  // from the district's edge, and every metre added here is a metre of air between the
  // player's feet and the rest of the map.
  const margin = Math.max(2, street * 0.12);
  return [minX - margin, maxX + margin, minZ - margin, maxZ + margin];
}

/** Everything the generator hands back to the level. */
export interface CityParts {
  readonly props: readonly PropDefinition[];
  readonly lights: LevelDefinition['lights'];
  readonly elevators: LevelDefinition['elevators'];
  /** How many of each thing was built, for the log and the README. */
  readonly report: Readonly<Record<string, number>>;
}

/** Where a building stands, and how tall the band it belongs to is. */
interface Band {
  /** Roof heights in this band, low to high. */
  readonly roofs: readonly number[];
  /** How likely a block in this band is to hold a construction site. */
  readonly construction: number;
  /** How likely it is to hold a hall - a building you can walk into. */
  readonly hall: number;
}

/**
 * The city in rings, from the old town outwards.
 *
 * Heights *rise* towards the centre, which is the opposite of most cities and the right
 * way round for this one: the tallest roofs are the ones a player can see from the
 * district and wants to get to, and the tall buildings near the middle are what make
 * the skyline read as a city rather than as a field.
 */
/**
 * Side of a height cell, in metres: one terrace step per cell across the whole city.
 *
 * Larger than a plot and smaller than the city, so a building's four neighbours share its
 * step or differ by one - which is the whole reason a roof has anywhere to go.
 */
const CELL_STEP = 74;

/**
 * The street a building leaves, in metres.
 *
 * Low enough that two buildings are still two buildings and a player fits between them (the
 * player is 0.7 m across), high enough not to be a seam; and the ceiling is a hair under
 * what a running jump crosses, so every neighbour in the grid is reachable from every other
 * by construction rather than by repair. `reach.test.ts` measures the real jump against the
 * movement config; this is that number with a margin.
 */
const MIN_GAP = 1.6;
const MAX_GAP = 5.2;

function bandFor(distance: number): Band {
  // The innermost ring is level with the district's own roofs - its decks sit at 0 to 1.2,
  // and its buildings' roofs between -0.8 and 2.8 - so the city's first ring of roofs is
  // one pull-up from the district's edge rather than twenty-eight metres above it.
  //
  // That is the whole of V0.7.3. V0.7 put the inner city at 22-34 m, over a district
  // standing at nothing, with the nearest building sixty metres away: a playable map
  // 120 m long, and a kilometre of city visible from it and impossible to enter.
  if (distance < 130) {
    return { roofs: [1.2, 3.4, 5.6, 7.8, 10], construction: 0.1, hall: 0.12 };
  }
  if (distance < 200) {
    return { roofs: [10, 12.2, 14.4, 16.6, 18.8, 21], construction: 0.14, hall: 0.16 };
  }
  if (distance < 290) {
    return { roofs: [21, 23.2, 25.4, 27.6, 29.8, 32], construction: 0.18, hall: 0.12 };
  }
  if (distance < 390) {
    return { roofs: [32, 34.2, 36.4, 38.6, 40.8, 43], construction: 0.16, hall: 0.1 };
  }
  return { roofs: [43, 45.2, 47.4, 49.6, 51.8, 54], construction: 0.12, hall: 0.08 };
}

/**
 * Builds the city around a level, and returns the level with it in.
 *
 * The district is untouched: its props, doors, checkpoints, pickups and lifts all come
 * through as they are, and everything this adds is appended.
 */
export function buildCity(base: LevelDefinition, options: CityOptions = {}): LevelDefinition {
  const parts = generateCity({
    keepClear: clearanceFor(base, options.street ?? DEFAULTS.street),
    masses: massesFor(base),
    ...options,
  });

  return {
    ...base,
    props: [...base.props, ...parts.props],
    ...(parts.lights && parts.lights.length > 0 ? { lights: [...(base.lights ?? []), ...parts.lights] } : {}),
    ...(parts.elevators && parts.elevators.length > 0
      ? { elevators: [...(base.elevators ?? []), ...parts.elevators] }
      : {}),
    // **The streets are above the kill plane, and they have to be.** The district's own
    // plane is 12 m below the roofs, which is right when the lowest thing you can stand
    // on is the works level at -5. The city has a street at -34.8, so that plane would
    // make every street in the city instantly fatal - and a fall from a roof is already
    // fatal on its own, because 35 m of it is well past the 26 m/s that kills.
    killPlaneY: Math.min(base.killPlaneY, DEFAULTS.groundY - 9),
    // The city stretches the fog out with it: at 120 m the far blocks would be a wall of
    // grey rather than a skyline.
    environment: {
      ...base.environment,
      fogNear: 260,
      fogFar: 1150,
      backdrop: { ...base.environment.backdrop, radius: 780 },
    },
  };
}

/** A solid building of the level's own, as the city generator sees it. */
export interface Mass {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** The height of its roof, which is what a city building has to meet. */
  readonly top: number;
}

/**
 * The level's own buildings, by their footprint and their roof.
 *
 * Floors are not masses: a deck is a surface to stand on, and the city is *about* standing
 * on surfaces. This is the walls and bodies - the things a generated plot may not be built
 * through, and the things the infill pass attaches the city to.
 */
function massesFor(base: LevelDefinition): readonly Mass[] {
  return base.props
    .filter((prop) => {
      const area = prop.size.x * prop.size.z;
      const top = prop.position.y + prop.size.y / 2;
      // A surface bigger than a building is ground, and ground is what the city is built
      // on rather than something to attach to.
      if (area < 16 || area > 5000) return false;
      // The level's own roofs - its decks - are attach targets in their own right, because
      // they are where the player's feet are. Attaching the city to the *buildings* and not
      // to the roofs above them leaves a bridge from a wall to a city that the player
      // standing on the old town's roof still cannot reach.
      if (prop.kind === 'floor') return prop.size.x > 6 && prop.size.z > 6;
      return top > DEFAULTS.groundY + 3;
    })
    .map((prop) => ({
      id: prop.id,
      minX: prop.position.x - prop.size.x / 2,
      maxX: prop.position.x + prop.size.x / 2,
      minZ: prop.position.z - prop.size.z / 2,
      maxZ: prop.position.z + prop.size.z / 2,
      top: prop.position.y + prop.size.y / 2,
    }));
}

/** Just the generated half, for tests and for anything that wants it on its own. */
export function generateCity(options: CityOptions = {}): CityParts {
  const config: Resolved = { ...DEFAULTS, ...options };
  const random = createRandom(config.seed);
  const props: PropDefinition[] = [];
  const lights: NonNullable<LevelDefinition['lights']>[number][] = [];
  const elevators: NonNullable<LevelDefinition['elevators']>[number][] = [];
  const report = new Map<string, number>();
  const count = (kind: string): void => {
    report.set(kind, (report.get(kind) ?? 0) + 1);
  };

  const [keepX0, keepX1, keepZ0, keepZ1] = config.keepClear;
  /**
   * The building on each plot, by plot.
   *
   * The infill pass walks this rather than the props: after the main loop there are
   * forty thousand props and no way to tell a wall from a walkway, and the one thing
   * that matters is which masses face which.
   */
  const plots = new Map<string, Building>();
  /**
   * Plots the level's own buildings pushed the city out of.
   *
   * Remembered rather than skipped: a plot left empty is a hole in the grid, and the rule is
   * that there is no empty space bigger than fifteen metres anywhere in the city - so these
   * are filled afterwards, around whatever it was that stood there.
   */
  const holes: { cx: number; cz: number }[] = [];
  /** Footprints already built, so nothing is built inside anything. */
  const placed: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  /**
   * What every building that fills a gap is built from, made once and shared.
   *
   * Declared here rather than where it is used, because the archetypes use it too - a tower
   * fills the gap beside itself as it is built - and a `const` is not hoisted.
   */
  let fillIds = 0;
  const nextId = (): number => (fillIds += 1);

  const filler = { props, lights, random, config, count, nextId, placed };

  for (let gx = -config.radius; gx <= config.radius; gx += config.pitch) {
    for (let gz = -config.radius; gz <= config.radius; gz += config.pitch) {
      // Jittered off the grid on purpose. A city laid out on exact graph paper reads as
      // graph paper from the air, however good each building is, so every plot is moved
      // a few metres and the street widths vary with it.
      // A street that varies in width is a city; a street that varies by sixteen metres is
      // a city with holes in it, and holes are what the jump graph cannot cross. Enough
      // jitter to break the graph paper, not enough to lose a neighbour.
      // Enough jitter to break the graph paper, and not enough to open a gap the grid
      // cannot close: at four per cent the widest street is seven metres.
      const cx = gx + config.pitch / 2 + (random() - 0.5) * config.pitch * 0.04;
      const cz = gz + config.pitch / 2 + (random() - 0.5) * config.pitch * 0.04;
      const distance = Math.hypot(cx, cz);
      if (distance > config.radius) continue;

      // What actually stands on a plot: the building, which is as wide as the pitch minus
      // a street - not the plot, which is much smaller than that. Checking the plot instead
      // is how a 58 m building came to be built through the old town's wall.
      const footprint = (config.pitch - MIN_GAP) / 2;
      if (
        cx + footprint > keepX0 &&
        cx - footprint < keepX1 &&
        cz + footprint > keepZ0 &&
        cz - footprint < keepZ1
      ) {
        continue;
      }
      // ...and so does every building of the level's own, wherever it stands: the city
      // grows around them rather than through them, and the gaps that leaves are filled
      // by the attachment pass below.
      if (
        config.masses?.some(
          (mass) =>
            cx + footprint > mass.minX &&
            cx - footprint < mass.maxX &&
            cz + footprint > mass.minZ &&
            cz - footprint < mass.maxZ,
        )
      ) {
        holes.push({ cx, cz });
        continue;
      }

      const band = bandFor(distance);
      const context = {
        props,
        lights,
        elevators,
        random,
        config,
        count,
        plots,
        gx,
        gz,
        nextId,
        placed: filler.placed,
      };

      const roll = random();
      if (roll < band.construction) {
        count('construction');
        constructionSite(context, cx, cz, footprint, band, distance);
      } else if (roll < band.construction + band.hall) {
        count('hall');
        hall(context, cx, cz, footprint);
      } else if (distance < 420 && random() < 0.22) {
        count('interior');
        interiorTower(context, cx, cz, footprint, random);
      } else if (distance < 260 && random() < 0.34) {
        // Towers: the ones with lifts in them. Only in the inner rings, so the lifts are
        // where a player actually is.
        count('tower');
        tower(context, cx, cz, footprint, band, random);
      } else {
        count('block');
        block(context, cx, cz, footprint, band);
      }

      // Street furniture that does not need a building: nothing yet - a lamp post on
      // every corner would be a thousand props for fifty pixels of light.
    }
  }

  // ------------------------------------------------------------- the in-between
  //
  // Buildings fill their plots now, which takes the gaps between them from forty metres
  // down to twenty - a real street, and still three times what a running jump crosses. So
  // every gap gets one more building in it, sized to leave a jump on either side.
  //
  // This is the difference between a city and a diorama. V0.7's blocks were an island
  // each: reachable by falling off, and by nothing else. With the streets filled, a roof
  // is a roof you can leave, in any direction, without going down to the pavement first.
  //
  // The height is the taller neighbour's minus most of a pull-up, so the two are one
  // move apart in both directions - and where a neighbour is too much lower to pull up
  // to it, that neighbour has a ladder of its own, which is the "other way" the rule
  // asks for. Nothing here invents a route: it makes the ones the buildings already have
  // meet.
  const jumpGap = crossingGap(DEFAULT_CONFIG);
  // Seeded with the buildings that are already there: an infill may not be built inside a
  // block any more than inside another infill.
  // ------------------------------------------------------------- the in-between
  //
  // Every building looks in its four directions and fills what it finds empty.
  //
  // The first version of this only filled the gap between two *adjacent plots*, which
  // misses every case where the gap is not the plot grid's: a plot the level's own
  // buildings pushed the city out of, a building on a big plot with a small neighbour, a
  // corner where two streets meet. Those are the holes, and a hole is a roof with nothing
  // within a jump of it - the map then reads as a cross of terraces running away from
  // wherever the player happens to be standing.
  //
  // Asked per building and per direction instead, the question is the one that matters:
  // what is the nearest thing that way, and is it close enough to reach?
  const all = [...plots.values()];
  const gaps: { near: Building; far: Building; axis: 'x' | 'z'; along: number; shared0: number; shared1: number }[] = [];
  for (const building of all) {
    for (const axis of ['x', 'z'] as const) {
      for (const sign of [1, -1] as const) {
        let best: Building | null = null;
        let bestGap = Number.POSITIVE_INFINITY;
        for (const other of all) {
          if (other === building) continue;
          const along =
            axis === 'x'
              ? sign > 0
                ? other.cx - other.halfX - (building.cx + building.halfX)
                : building.cx - building.halfX - (other.cx + other.halfX)
              : sign > 0
                ? other.cz - other.halfZ - (building.cz + building.halfZ)
                : building.cz - building.halfZ - (other.cz + other.halfZ);
          if (along < 0) continue;
          // Only things that way, and only the nearest of them.
          const across =
            axis === 'x' ? Math.abs(other.cz - building.cz) : Math.abs(other.cx - building.cx);
          if (across > Math.max(other.halfZ, other.halfX) + building.halfZ + building.halfX + 20) continue;
          if (along < bestGap) {
            bestGap = along;
            best = other;
          }
        }
        if (!best || bestGap <= jumpGap || bestGap > config.pitch * 2.2) continue;
        // The stretch of wall the two share, which is how wide the filler can be.
        const shared0 =
          axis === 'x'
            ? Math.max(building.cz - building.halfZ, best.cz - best.halfZ)
            : Math.max(building.cx - building.halfX, best.cx - best.halfX);
        const shared1 =
          axis === 'x'
            ? Math.min(building.cz + building.halfZ, best.cz + best.halfZ)
            : Math.min(building.cx + building.halfX, best.cx + best.halfX);
        if (shared1 - shared0 < 4) continue;
        gaps.push({ near: building, far: best, axis, along: bestGap, shared0, shared1 });
      }
    }
  }

  // The plots are seeded in here, not just the fillers: a filler's own footprint is added as
  // it is built, and a building that is already standing has to count too or the gap passes
  // will happily put a house through a tower's lift shaft.
  for (const building of all) {
    placed.push({
      minX: building.cx - building.halfX,
      maxX: building.cx + building.halfX,
      minZ: building.cz - building.halfZ,
      maxZ: building.cz + building.halfZ,
    });
  }

  for (const gap of gaps) {
    const from =
      gap.axis === 'x'
        ? Math.min(gap.near.cx + gap.near.halfX, gap.far.cx + gap.far.halfX)
        : Math.min(gap.near.cz + gap.near.halfZ, gap.far.cz + gap.far.halfZ);
    bridge(
      filler,
      gap.axis,
      from,
      gap.along,
      () => (gap.shared1 - gap.shared0) * 0.43,
      gap.near.roof,
      gap.far.roof,
      config.keepClear,
    );
  }

  // ------------------------------------------------------------- the attachment
  //
  // The city has to *meet* the district, and this is the pass that makes it.
  //
  // Everything above fills the gaps between two generated buildings. None of it knows
  // about the level the city was built around, and the level's own buildings stand where
  // they stand: five towers to the north and south of the old town, and the old town's own
  // roofs, which sit at nothing - which is where the player's feet are. So each city
  // building near one of them gets the same treatment: the gap is measured, and a building
  // goes in it, with its roof between the two so the step is one move rather than thirty
  // metres of air.
  //
  // V0.7 shipped without this pass and with a clearance rectangle twice the district's
  // size, so the nearest generated building was sixty metres from the old town's edge and
  // twenty-eight metres above it. The playable map was the district; the city was a
  // skyline, and a skyline is decoration.
  for (const building of plots.values()) {
    // The nearest building of the level's own, and only that one: every one of them is a
    // candidate for every plot, and filling the gap to all of them fills the same gap five
    // times over - which is how this pass turned a city into a traffic jam.
    let nearest: Mass | null = null;
    let nearestGap = Number.POSITIVE_INFINITY;
    for (const mass of config.masses) {
      const dx = Math.max(building.cx - building.halfX - mass.maxX, mass.minX - (building.cx + building.halfX));
      const dz = Math.max(building.cz - building.halfZ - mass.maxZ, mass.minZ - (building.cz + building.halfZ));
      const away = Math.max(dx, dz);
      if (away >= 0 && away < nearestGap) {
        nearestGap = away;
        nearest = mass;
      }
    }
    // Close enough to be the level's neighbour rather than a building on the far side of
    // the city that happens to point at it.
    if (!nearest || nearestGap > 150) continue;
    {
      const mass = nearest;
      // The facing gap on each axis, and how much of the wall they share.
      const gx = Math.max(building.cx - building.halfX - mass.maxX, mass.minX - (building.cx + building.halfX));
      const gz = Math.max(building.cz - building.halfZ - mass.maxZ, mass.minZ - (building.cz + building.halfZ));
      const alongX = gx > 0;
      const alongZ = gz > 0;

      // Diagonal neighbours have no gap to fill: what is between them is a corner, and
      // the corner of two buildings is not a street.
      if (alongX === alongZ) continue;
      const along = alongX ? gx : gz;
      // A long gap is not a reason to skip the join - it is the one place the *number* of
      // steps matters most. The steps stand shoulder to shoulder, so their length is what
      // varies; only the jump at each end has to fit.
      if (along <= jumpGap || along > config.pitch * 2.5) continue;

      const shared0 = alongX
        ? Math.max(building.cz - building.halfZ, mass.minZ)
        : Math.max(building.cx - building.halfX, mass.minX);
      const shared1 = alongX
        ? Math.min(building.cz + building.halfZ, mass.maxZ)
        : Math.min(building.cx + building.halfX, mass.maxX);
      if (shared1 - shared0 < 4) continue;

      const axis = alongX ? 'x' : 'z';
      const towards = alongX
        ? Math.sign(building.cx - mass.minX) // which side of the mass the building is on
        : Math.sign(building.cz - mass.minZ);
      const from = alongX
        ? (towards > 0 ? mass.maxX : mass.minX)
        : (towards > 0 ? mass.maxZ : mass.minZ);

      // No, so the gap gets a staircase: as many buildings as the change of height needs,
      // the first as close to the district's roof as the last is to the city's. This is the
      // join, and without it the district is an island with a city visible from it.
      const placed = bridge(
        filler,
        axis,
        from,
        along,
        () => Math.min((shared1 - shared0) * 0.43, 12),
        mass.top,
        building.roof,
        config.keepClear,
      );
      if (placed > 0) count('attachment');
    }
  }

  // ------------------------------------------------------------- the guarantee
  //
  // And then the rule the whole city is for, enforced rather than hoped for: **every roof
  // has at least two other roofs within a jump of it.**
  //
  // The passes above fill the gaps they can see, and they still leave roofs with nothing
  // within twenty-seven metres - a plot the level's own buildings pushed the city out of, a
  // small building on a wide plot, a corner. Rather than keep guessing at the layout, this
  // asks each roof the actual question and builds the answer next to it, which is the only
  // way to make a promise about every roof in a generated city.
  //
  // A roof with one neighbour is a dead end; a roof with none is a place you can only leave
  // by falling off. Two is the least that makes a route rather than a corridor.
  const roofs = [...plots.values()];
  const reach = crossingRise(DEFAULT_CONFIG);
  const jump = crossingGap(DEFAULT_CONFIG);
  /** Roofs this one can jump to, in either direction. */
  const neighbours = (roof: Building): number => {
    let count = 0;
    for (const other of roofs) {
      if (other === roof) continue;
      const dx = Math.max(0, Math.max(roof.cx - roof.halfX - (other.cx + other.halfX), other.cx - other.halfX - (roof.cx + roof.halfX)));
      const dz = Math.max(0, Math.max(roof.cz - roof.halfZ - (other.cz + other.halfZ), other.cz - other.halfZ - (roof.cz + roof.halfZ)));
      if (Math.hypot(dx, dz) <= jump && Math.abs(other.roof - roof.roof) <= reach) count += 1;
    }
    return count;
  };

  let repairs = 0;
  for (const roof of roofs) {
    for (let attempt = 0; attempt < 3 && neighbours(roof) < 2; attempt += 1) {
      // The side with the most room, so a repair lands in a street rather than in a wall.
      let best: { axis: 'x' | 'z'; sign: 1 | -1; room: number } | null = null;
      for (const axis of ['x', 'z'] as const) {
        for (const sign of [1, -1] as const) {
          const own = axis === 'x' ? roof.halfX : roof.halfZ;
          const centre = axis === 'x' ? roof.cx : roof.cz;
          const acrossHalf = axis === 'x' ? roof.halfZ : roof.halfX;
          let room = 40;
          for (const other of roofs) {
            if (other === roof) continue;
            // Buildings, and the things already built in the gaps between them: a repair
            // that lands on either is refused by the overlap guard, and a refused repair is
            // a roof that keeps its one neighbour.
            const otherCentre = axis === 'x' ? other.cx : other.cz;
            const otherHalf = axis === 'x' ? other.halfX : other.halfZ;
            const across = axis === 'x' ? Math.abs(other.cz - roof.cz) : Math.abs(other.cx - roof.cx);
            if (across > (axis === 'x' ? other.halfZ : other.halfX) + acrossHalf) continue;
            const away = (otherCentre - centre) * sign - own - otherHalf;
            if (away >= -0.5 && away < room) room = away;
          }
          for (const box of placed) {
            const boxCentre = axis === 'x' ? (box.minX + box.maxX) / 2 : (box.minZ + box.maxZ) / 2;
            const boxHalf = axis === 'x' ? (box.maxX - box.minX) / 2 : (box.maxZ - box.minZ) / 2;
            const across0 = axis === 'x' ? box.minZ : box.minX;
            const across1 = axis === 'x' ? box.maxZ : box.maxX;
            const own0 = (axis === 'x' ? roof.cz : roof.cx) - acrossHalf;
            const own1 = (axis === 'x' ? roof.cz : roof.cx) + acrossHalf;
            if (Math.min(across1, own1) - Math.max(across0, own0) <= 0) continue;
            const away = (boxCentre - centre) * sign - own - boxHalf;
            if (away >= -0.5 && away < room) room = away;
          }
          if (!best || room > best.room) best = { axis, sign, room };
        }
      }
      if (!best || best.room < 3) break;

      const own = best.axis === 'x' ? roof.halfX : roof.halfZ;
      const centre = best.axis === 'x' ? roof.cx : roof.cz;
      const width = 6 + random() * 5;
      const depth = 6 + random() * 5;
      const offset = Math.min(own + jump * 0.55, own + best.room * 0.5);
      const at = centre + best.sign * offset;
      if (best.axis === 'x') {
        infill(filler, at, roof.cz, width, depth, roof.roof + (random() - 0.5) * reach * 0.6);
      } else {
        infill(filler, roof.cx, at, depth, width, roof.roof + (random() - 0.5) * reach * 0.6);
      }
      repairs += 1;
    }
  }
  if (repairs > 0) {
    for (let index = 0; index < repairs; index += 1) count('repair');
  }

  // ------------------------------------------------------------------ no holes
  //
  // Every plot the level's own buildings pushed the city out of gets filled in around
  // whatever pushed it out. A gap left where a tower stands is a gap nobody can cross and
  // nothing can hide in: the rule is that the city has no empty space in it wider than
  // fifteen metres, and a plot is sixty-two.
  //
  // The size is measured from what is already there rather than assumed: the building takes
  // the largest room it can on each axis, minus the street it has to leave.
  let filled = 0;
  for (const hole of holes) {
    let roomX = MAX_GAP * 3;
    let roomZ = MAX_GAP * 3;
    for (const box of placed) {
      const centreX = (box.minX + box.maxX) / 2;
      const centreZ = (box.minZ + box.maxZ) / 2;
      const halfX = (box.maxX - box.minX) / 2;
      const halfZ = (box.maxZ - box.minZ) / 2;
      const dx = Math.abs(centreX - hole.cx);
      const dz = Math.abs(centreZ - hole.cz);
      if (dx < halfX || dz < halfZ) continue;
      roomX = Math.min(roomX, dx - halfX);
      roomZ = Math.min(roomZ, dz - halfZ);
    }
    const width = Math.min(roomX, MAX_GAP * 3) * 2 - MAX_GAP;
    const depth = Math.min(roomZ, MAX_GAP * 3) * 2 - MAX_GAP;
    if (width < 4 || depth < 4) continue;
    // Level with the band the hole is in, so the filler is one move from the ring around it.
    const band = bandFor(Math.hypot(hole.cx, hole.cz));
    const roof = band.roofs[Math.floor(random() * band.roofs.length)] ?? band.roofs[0]!;
    infill(filler, hole.cx, hole.cz, width, depth, roof);
    filled += 1;
  }
  if (filled > 0) {
    for (let index = 0; index < filled; index += 1) count('hole');
  }

  // Ground under the whole thing. The district's own slab is 700 m across, which is
  // short of a kilometre of city - and a city with a void under its outer ring reads as
  // floating rather than as built. Half a metre lower, so the two never share a plane.
  // Two centimetres low, and that is the whole fix for a flickering street.
  //
  // The district has its own ground slab - `city-ground`, 700 m across - whose top is at
  // exactly `groundY`, and this one covered the same square metre at exactly the same
  // height. Two surfaces at one depth is not a seam or a shadow: the depth test picks a
  // winner per pixel and the winner changes as the camera moves, which is the shimmer the
  // map's whole floor had. Two centimetres is under a pixel by the time you can see it.
  props.push(
    make('city-street-level', {
      at: [0, 0],
      bottom: config.groundY - 0.52,
      size: [config.radius * 2.4, 0.5, config.radius * 2.4],
      model: 'slab',
      kind: 'floor',
      tints: { concrete: '#2b3240', 'concrete-dark': '#232936' },
    }),
  );

  return {
    props,
    lights: lights.length > 0 ? lights : undefined,
    elevators: elevators.length > 0 ? elevators : undefined,
    report: Object.fromEntries(report),
  };
}

/**
 * A building the generator put down, as the street sees it.
 *
 * The widest mass at any height, its roof, and where it is - which is everything the
 * infill pass needs to close the gap to whatever is next to it. Recorded as buildings are
 * placed rather than worked out afterwards, because afterwards is forty thousand props
 * and no way to tell a wall from a walkway.
 */
interface Building {
  /** The plot it stands on, so its neighbours can be found. */
  readonly gx: number;
  readonly gz: number;
  readonly id: string;
  readonly cx: number;
  readonly cz: number;
  readonly halfX: number;
  readonly halfZ: number;
  /** The roof a player standing beside this building can reach. */
  readonly roof: number;
}

interface Context {
  readonly props: PropDefinition[];
  /** A counter for the buildings that fill gaps, so two of them cannot share an id. */
  readonly nextId: () => number;
  /** Footprints already built, so nothing is built inside anything. See `InfillContext`. */
  readonly placed: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  /** The plot this building stands on. */
  readonly gx: number;
  readonly gz: number;
  /** The building on each plot, so the infill pass can find neighbours. */
  readonly plots: Map<string, Building>;
  readonly lights: NonNullable<LevelDefinition['lights']>[number][];
  readonly elevators: NonNullable<LevelDefinition['elevators']>[number][];
  readonly random: () => number;
  readonly config: Resolved;
  readonly count: (kind: string) => void;
}

/**
 * Files a building under its plot.
 *
 * Called by each archetype once it knows what it built. Only the *outermost* mass is
 * recorded - a tower's inset upper stages are inside the base's footprint and a block's
 * roof storey is inside its own - because the infill pass only cares about the wall a
 * neighbour's gap runs up against.
 */
function record(context: Context, building: Building): void {
  context.plots.set(`${building.gx}|${building.gz}`, building);
}

/**
 * How many buildings it takes to get from one roof to another.
 *
 * A gap between a roof at 1 m and a roof at 11 m is not one step with a hole under it: it
 * is ten metres of height, and the player has two and a half. Filling it with a single
 * building in the middle leaves a six-metre wall on the low side and a four-metre drop on
 * the high side, which is a gap with extra geometry in it. The gap gets as many buildings
 * as the change of height needs, and they stand shoulder to shoulder - a staircase, which
 * is the one shape that is climbable and descendable in both directions.
 */
function stepsFor(drop: number, rise: number): number {
  return Math.max(1, Math.min(8, Math.ceil(Math.abs(drop) / rise)));
}

/**
 * Fills the space between two roofs with a staircase of buildings.
 *
 * `from` is where the near building's wall is and `span` is how much room there is before
 * the far one's, so a jump is left at each end and the steps between are adjacent.
 */
function bridge(
  context: InfillContext,
  axis: 'x' | 'z',
  from: number,
  span: number,
  shared: (t: number) => number,
  fromRoof: number,
  toRoof: number,
  /** Where the level's own ground is, so nothing is built on top of it. */
  clear?: readonly [number, number, number, number],
): number {
  const rise = crossingRise(DEFAULT_CONFIG);
  const margin = Math.min(crossingGap(DEFAULT_CONFIG) * 0.8, span / 3);
  const room = span - margin * 2;
  if (room < 3) return 0;

  // As many buildings as the height needs, and as many as the length holds: a gap wide
  // enough for three houses gets three, so nothing is left empty and every roof in it has
  // neighbours on both sides rather than one.
  const byHeight = stepsFor(toRoof - fromRoof, rise * 0.8);
  const byLength = Math.ceil(room / 13);
  const steps = Math.max(byHeight, byLength);
  const each = room / steps;
  let placed = 0;
  for (let step = 0; step < steps; step += 1) {
    const t = (step + 0.5) / steps;
    const roof = fromRoof + (toRoof - fromRoof) * t;
    const centre = from + margin + each * (step + 0.5);
    const half = shared(t);
    // A street's worth taken off each step, so a run of fillers is a row of buildings with
    // gaps in the jumpable band rather than one long terrace.
    const street = Math.max(1, Math.min(each * 0.25, 4));
    const width = axis === 'x' ? each - street : half * 2;
    const depth = axis === 'x' ? half * 2 : each - street;
    if (Math.min(width, depth) < 3) continue;
    const atX = axis === 'x' ? centre : shared(0.5);
    const atZ = axis === 'x' ? shared(0.5) : centre;
    // A staircase runs *away* from the thing it is attached to, so the far steps of one
    // attached to the old town's edge can land on the old town. There is no gap to fill
    // inside the level's own ground.
    if (clear && atX > clear[0] && atX < clear[1] && atZ > clear[2] && atZ < clear[3]) continue;
    infill(context, atX, atZ, width, depth, roof);
    placed += 1;
  }
  return placed;
}

/**
 * The rooftop kit an infill building gets, which is what makes it *its own* building.
 *
 * "Add more buildings between them, and these in-between buildings need to be uniquely
 * decorated too" is a request for filler that is not filler. A street of identical
 * blocks reads as one texture however many of them there are, so each infill draws three
 * to five features from a dozen - arrays, tanks, a mast, a crane, a sign, a hut, a pipe
 * run, a billboard, a balcony - and the combination is what it *is*. The signature goes
 * into the report, so "how many of these look the same" is a number rather than an
 * opinion, and a test holds it to it.
 */
const INFILL_KIT = [
  'solar',
  'tank',
  'ac',
  'mast',
  'duct',
  'sign',
  'crane',
  'hut',
  'pipes',
  'balcony',
  'billboard',
  'scaffold',
] as const;

type InfillKit = (typeof INFILL_KIT)[number];

/** What an infill needs from the generator: somewhere to put things, and the dice. */
/**
 * What the rooftop helpers need from the generator.
 *
 * A counter is part of it, because a staircase puts several buildings in one gap and the
 * id used to be the rounded position and roof: unique for one building per gap, and
 * colliding the moment two stand next to each other at the same height.
 */
type InfillContext = Pick<Context, 'props' | 'lights' | 'random' | 'config' | 'count' | 'nextId'> & {
  /**
   * Footprints already built, so a new one cannot stand inside an old one.
   *
   * Two buildings overlapping is not a terrace, it is two buildings in one place: the
   * walls run through each other, the shadow of one falls inside the other, and from any
   * angle at all it looks like a mistake - which it is. The passes are geometric and
   * geometric passes overlap; this is the rule that stops them.
   */
  placed: { minX: number; maxX: number; minZ: number; maxZ: number }[];
};

/** Picks what this one is made of, and counts the answer. */
function infillKit(context: InfillContext): readonly InfillKit[] {
  const wanted = 3 + Math.floor(context.random() * 2);
  const pool = [...INFILL_KIT];
  const picked: InfillKit[] = [];
  for (let index = 0; index < wanted && pool.length > 0; index += 1) {
    picked.push(...pool.splice(Math.floor(context.random() * pool.length), 1));
  }
  context.count(`infill-kit:${[...picked].sort().join('+')}`);
  return picked;
}

/**
 * A building in the gap between two others: narrow, tall, and dressed.
 *
 * Its roof is a landing from either neighbour and its own ladder is the way back down,
 * so it is not a stepping stone on the way past - it is somewhere to stand.
 */
function infill(
  context: InfillContext,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  roof: number,
): void {
  const { props, random, config, lights } = context;
  const box = {
    minX: cx - width / 2,
    maxX: cx + width / 2,
    minZ: cz - depth / 2,
    maxZ: cz + depth / 2,
  };
  for (const other of context.placed) {
    const overlapX = Math.min(box.maxX, other.maxX) - Math.max(box.minX, other.minX);
    const overlapZ = Math.min(box.maxZ, other.maxZ) - Math.max(box.minZ, other.minZ);
    // A third of a metre of tolerance: two buildings *touching* is a terrace, and that is
    // what the staircase is made of.
    if (overlapX > 0.3 && overlapZ > 0.3) return;
  }
  context.placed.push(box);

  const id = `fill-${context.nextId()}-${Math.round(cx)}-${Math.round(cz)}-${Math.round(roof)}`;
  const kit = infillKit(context);

  roofKit(context, id, [cx, cz], width, depth, roof, { solar: false });
  // Coarse sections: ladder rungs are a third of the city's props, and an infill is a
  // stepping stone - its roof is one move from its neighbours', and its ladder is the way
  // down to the street rather than the way up onto a roof.
  laddersUp(context, `${id}-ladder`, cx - width / 2 - 0.3, cz, roof, config.groundY, 14);
  context.count('infill');

  const halfX = width / 2;
  const halfZ = depth / 2;
  /** Room for a feature, kept off the parapet-less edge. */
  const inset = 1.6;

  for (const [index, feature] of kit.entries()) {
    const at: readonly [number, number] = [
      cx + (random() - 0.5) * Math.max(1, width - inset * 4),
      cz + (random() - 0.5) * Math.max(1, depth - inset * 4),
    ];
    switch (feature) {
      case 'solar':
        for (let panel = 0; panel < 2; panel += 1) {
          props.push(
            make(`${id}-solar-${index}-${panel}`, {
              at: [at[0], at[1] + panel * 4],
              bottom: roof,
              size: [6.5, 1.3, 3.4],
              model: 'solar-panel',
            }),
          );
        }
        break;
      case 'tank':
        props.push(make(`${id}-tank-${index}`, { at, bottom: roof, size: [3, 3.2, 3], model: 'water-tank' }));
        break;
      case 'ac':
        props.push(make(`${id}-ac-${index}`, { at, bottom: roof, size: [3, 1.6, 2.2], model: 'ac-unit' }));
        break;
      case 'mast':
        props.push(make(`${id}-mast-${index}`, { at, bottom: roof, size: [1, 9 + random() * 8, 1], model: 'antenna-mast' }));
        break;
      case 'duct':
        props.push(make(`${id}-duct-${index}`, { at, bottom: roof, size: [1.4, 1.2, Math.max(2, Math.min(depth - 3, 8))], model: 'duct' }));
        break;
      case 'hut':
        props.push(make(`${id}-hut-${index}`, { at, bottom: roof, size: [4.2, 3.4, 3.6], model: 'slab', tints: tintSet(context) }));
        break;
      case 'pipes':
        props.push(
          make(`${id}-pipe-${index}`, { at, bottom: roof, size: [1, 8 + random() * 6, 1], model: 'pipe-vertical' }),
          make(`${id}-pipe-run-${index}`, { at: [at[0], at[1]], bottom: roof + 0.4, size: [1, 1, Math.max(2, Math.min(depth - 3, 7))], model: 'pipe-run' }),
        );
        break;
      case 'crane': {
        const crane = 24 + Math.round(random() * 16);
        props.push(
          make(`${id}-crane-mast-${index}`, { at, bottom: roof, size: [1.6, crane, 1.6], model: 'construction-column' }),
          make(`${id}-crane-jib-${index}`, { at: [at[0], at[1]], bottom: roof + crane, size: [crane * 0.8, 1.4, 1.4], model: 'construction-slab' }),
        );
        break;
      }
      case 'scaffold':
        props.push(make(`${id}-scaffold-${index}`, { at, bottom: roof, size: [7, 9, 2.6], model: 'scaffold' }));
        break;
      case 'balcony':
        balcony(context, `${id}-balcony-${index}`, cx + halfX + 0.4, cz, depth * 0.5, config.groundY + 6 + random() * 12);
        break;
      case 'billboard':
        props.push(
          make(`${id}-billboard-${index}`, {
            at: [cx, cz - halfZ - 0.3],
            bottom: roof + 2,
            size: [Math.min(width * 0.6, 8), 6, 0.5],
            model: 'billboard',
            tints: { neon: BILLBOARD_COLOURS[Math.floor(random() * BILLBOARD_COLOURS.length)] as string },
          }),
        );
        break;
      case 'sign': {
        // Hung on a face rather than stood on the roof, because a sign on a wall is what
        // a city at night is made of.
        const lit = BILLBOARD_COLOURS[Math.floor(random() * BILLBOARD_COLOURS.length)] as string;
        props.push(
          make(`${id}-sign-${index}`, {
            at: [cx - halfX - 0.24, cz],
            bottom: roof + 3,
            size: [0.4, 4.5, 1.6],
            model: 'neon-blade',
            tints: { neon: lit },
          }),
        );
        lights.push({
          id: `${id}-sign-lamp-${index}`,
          position: { x: cx - halfX - 1.4, y: roof + 5, z: cz },
          color: lit,
          intensity: 9,
          distance: 20,
        });
        break;
      }
    }
  }
}

/** A prop with the city's own defaults filled in. */
function make(
  id: string,
  spec: {
    readonly at: readonly [number, number];
    readonly bottom: number;
    readonly size: readonly [number, number, number];
    readonly model: string;
    readonly kind?: PropDefinition['kind'];
    readonly tints?: Record<string, string>;
    readonly climbable?: boolean;
  },
): PropDefinition {
  return {
    id,
    model: spec.model,
    kind: spec.kind ?? 'prop',
    position: { x: spec.at[0], y: spec.bottom + spec.size[1] / 2, z: spec.at[1] },
    size: { x: spec.size[0], y: spec.size[1], z: spec.size[2] },
    ...(spec.tints ? { tints: spec.tints } : {}),
    ...(spec.climbable ? { climbable: true } : {}),
  };
}

/** A concrete-ish palette, picked per block so a street reads as a street. */
const BODY_TINTS: readonly { concrete: string; 'concrete-dark': string }[] = [
  { concrete: '#414d63', 'concrete-dark': '#333d4e' },
  { concrete: '#4a5361', 'concrete-dark': '#3d4550' },
  { concrete: '#55606e', 'concrete-dark': '#454f5c' },
  { concrete: '#5c5563', 'concrete-dark': '#4a4450' },
  { concrete: '#4d5a55', 'concrete-dark': '#3f4a46' },
];

function tintSet(context: InfillContext): Record<string, string> {
  const pick = BODY_TINTS[Math.floor(context.random() * BODY_TINTS.length)] ?? BODY_TINTS[0];
  return { ...pick };
}

/** A roof deck over a body, with the kit a city roof has. */
function roofKit(
  context: InfillContext,
  id: string,
  at: readonly [number, number],
  width: number,
  depth: number,
  top: number,
  opts: { readonly solar?: boolean } = { solar: true },
): void {
  const { props, random, config } = context;

  // A deck, with its body inset so neighbouring buildings read as separate blocks.
  props.push(
    make(id, { at, bottom: top - 0.8, size: [width, 0.8, depth], model: 'deck', kind: 'floor' }),
  );
  props.push(
    make(`${id}-body`, {
      at,
      bottom: config.groundY,
      size: [width - 1.4, top - 0.8 - config.groundY, depth - 1.4],
      model: 'slab',
      tints: tintSet(context),
    }),
  );

  // Rooftop kit. Solar arrays on most roofs, and a tank on some.
  if (opts.solar !== false && width > 12 && depth > 10) {
    const panels = Math.max(1, Math.floor(width / 9));
    for (let index = 0; index < panels; index += 1) {
      const px = at[0] - width / 2 + 4.5 + index * 9;
      const pz = at[1] - depth / 2 + 3.2;
      props.push(
        make(`${id}-solar-${index}`, {
          at: [px, pz],
          bottom: top,
          size: [7, 1.3, 3.6],
          model: 'solar-panel',
        }),
      );
    }
  }
  if (random() < 0.34 && width > 12) {
    props.push(make(`${id}-tank`, { at: [at[0] + width / 2 - 3, at[1] + depth / 2 - 3], bottom: top, size: [3.2, 3.4, 3.2], model: 'water-tank' }));
  }
  if (random() < 0.4) {
    props.push(make(`${id}-ac`, { at: [at[0] - width / 2 + 3, at[1] + depth / 2 - 3], bottom: top, size: [3, 1.6, 2.2], model: 'ac-unit' }));
  }
  if (random() < 0.45) {
    props.push(
      make(`${id}-mast`, { at: [at[0], at[1] - depth / 2 + 2], bottom: top, size: [1, 11, 1], model: 'antenna-mast' }),
    );
  }
  // Windows, and this is the graphics pass as much as the glazing: a surface that reflects
  // the sky needs sky to land on, and until now the only glass in the city was a solar
  // panel's face. Two bands - one on each face a street can see - so a dense grid of
  // buildings gleams the way a dense grid of buildings does, without a prop per window.
  if (width > 22 && top - config.groundY > 10) {
    const lit = random() < 0.4;
    const tint = lit ? '#e9f6cf' : random() < 0.5 ? '#8fb4c8' : '#5f7c92';
    const lowest = config.groundY + 6;
    const room = top - 2 - lowest;
    for (let band = 0; band < 2; band += 1) {
      const bottom = lowest + room * (0.28 + 0.44 * band);
      props.push(
        make(`${id}-windows-z-${band}`, {
          at: [at[0], at[1] + depth / 2 - 0.16],
          bottom,
          size: [width - 2, 2.2, 0.34],
          model: 'window-band',
          tints: { glass: tint },
        }),
        make(`${id}-windows-x-${band}`, {
          at: [at[0] + width / 2 - 0.16, at[1]],
          bottom,
          size: [0.34, 2.2, depth - 2],
          model: 'window-band',
          tints: { glass: tint },
        }),
      );
    }
  }

  if (random() < 0.3) {
    props.push(
      make(`${id}-duct`, {
        at: [at[0] + width / 2 - 2.5, at[1] - depth / 2 + 2.5],
        bottom: top,
        // Clamped: a duct is longer than it is wide, and an infill can be narrower than
        // the duct wants to be. A negative size is not a short duct.
        size: [1.4, 1.2, Math.max(2, Math.min(depth - 6, 9))],
        model: 'duct',
      }),
    );
  }
}

/** A mid-rise block: one roof, a ladder up the side, and maybe a balcony. */
function block(
  context: Context,
  cx: number,
  cz: number,
  footprint: number,
  band: Band,
): void {
  const { random } = context;
  // A block fills its plot. It used to take two thirds of it, which left forty metres of
  // nothing between one building and the next - wide enough to read as a city from the
  // air and far too wide to cross on foot, and the reason V0.7's streets were a place you
  // looked at rather than a route.
  // **The gap is what a building is sized from, not the other way round.**
  //
  // At a 62 m pitch a 54 to 58 m building leaves a four to eight metre street - and a jump
  // crosses 5.7, so *half* of those neighbours are unreachable and the roof next door might
  // as well be a wall. Sizing from the gap instead puts every neighbour inside the jumpable
  // band by construction: the building takes whatever is left of the pitch after a street
  // of one and a half to five and a half metres, and the difference between one building's
  // street and the next's is the variety.
  const span = Math.max(footprint * 2, context.config.pitch - MIN_GAP);
  const width = span - (MIN_GAP + random() * (MAX_GAP - MIN_GAP));
  const depth = span - (MIN_GAP + random() * (MAX_GAP - MIN_GAP));

  // Which roof it gets is a function of *where it is*, not a free roll.
  //
  // A free roll is how V0.7.2 did it, and it put a 21 m roof next to a 10 m one: the two
  // are eleven metres apart, which is neither a jump nor a drop worth taking, and the city
  // then needed four buildings in the gap to make it a route. Graded, the terraces still
  // climb across the city - which is what they are for - but neighbours disagree by one
  // step instead of five, and one building in the gap is enough.
  // Which roof it gets is a function of *where it is*, and that is the difference between a
  // city you can cross and a city you can only cross one way.
  //
  // A free roll leaves neighbours that disagree by five steps, so the only roofs within a
  // jump of each other are the ones that happened to land alike: the map reads as a cross
  // of terraces running away from wherever the player is standing, with everything else a
  // wall. The index ramps with the grid instead, one step per cell, so a building and all
  // four of its neighbours are two metres apart by construction - and the bands are
  // contiguous, so the ramp does not break at a ring boundary either.
  const cell = Math.floor(cx / CELL_STEP) + Math.floor(cz / CELL_STEP);
  const graded = ((cell % band.roofs.length) + band.roofs.length) % band.roofs.length;
  const top = band.roofs[graded] ?? band.roofs[0]!;
  const id = `city-${Math.round(cx)}-${Math.round(cz)}`;

  roofKit(context, id, [cx, cz], width, depth, top);
  record(context, { gx: context.gx, gz: context.gz, id, cx, cz, halfX: width / 2, halfZ: depth / 2, roof: top });

  // A third of the blocks carry a smaller storey on the roof: the roof of one is the
  // landing for the other, which is what turns a block into a route - and it is the
  // cheapest verticality in the whole city. It was four to nine metres up when V0.7 wrote
  // that sentence, which is not a landing: a jump gets a metre and a pull-up two and a
  // half, so this is two.
  if (random() < 0.4 && width > 18) {
    const upper = top + 1.7 + random() * 0.7;
    roofKit(context, `${id}-upper`, [cx + 1, cz - 1], width * 0.52, depth * 0.5, upper, { solar: false });
  }

  ladderUp(context, `${id}-ladder`, cx - width / 2 - 0.3, cz, top);
  balcony(context, `${id}-balcony`, cx, cz - depth / 2 - 0.9, width * 0.6, top);
}

/**
 * A tower with its lift *inside* it.
 *
 * V0.7 put the shaft in the street beside the building and built a second building next
 * door to receive it at the top: an elevator you got into from the pavement and out of
 * onto somebody else's roof. This is the same tower with the shaft standing in the corner
 * of its own footprint - a core, the way a real building has one.
 *
 * Where the doors are is the whole design:
 *
 * ```
 *        +----------------------+   the shell, full height of the inside
 *        |  sheds   |  setback  |   the setback rises out of the shell's roof,
 *        |          |           |   on the far side of the shaft
 *        |  [LIFT]  |           |
 *        +----------------------+
 * ```
 *
 * The shaft's doorways face into the building, so every floor between the street and the
 * roof is reached from inside the building and nowhere else: in through the front door,
 * across the ground floor, into the lift. The one door that opens to the sky is the top
 * one, where the car arrives level with the setback's roof and stepping out is stepping
 * onto the building. That is what "inside" means here - not a shaft with a wall around
 * it, but a shaft nobody can board from the street.
 */
function tower(
  context: InfillContext & Pick<Context, 'plots' | 'gx' | 'gz' | 'elevators'>,
  cx: number,
  cz: number,
  footprint: number,
  band: Band,
  random: () => number,
): void {
  const { props, config, lights } = context;
  const floor = config.groundY;
  const id = `city-${Math.round(cx)}-${Math.round(cz)}-tower`;
  const wall = 0.6;
  const shaftOuter = 4.2;
  const storey = 4.8;
  const storeys = 2 + Math.floor(random() * 2);
  const halfW = (footprint * (1.72 + random() * 0.16)) / 2;
  const halfD = (footprint * (1.66 + random() * 0.2)) / 2;
  const insideTop = floor + storeys * storey;
  const roof = (band.roofs[band.roofs.length - 1] ?? 30) + 20 + Math.round(random() * 26);
  const tints = tintSet(context);

  const panel = (
    suffix: string,
    x: number,
    z: number,
    size: readonly [number, number, number],
    bottom: number,
    kind: PropDefinition['kind'] = 'wall',
  ): void => {
    props.push(make(`${id}-${suffix}`, { at: [x, z], bottom, size, kind, model: 'slab', tints }));
  };

  record(context, { gx: context.gx, gz: context.gz, id, cx, cz, halfX: halfW, halfZ: halfD, roof: insideTop });

  // ---- the shell, with the front door on the +Z side
  const door = 5;
  const side = (halfW * 2 - door) / 2 - wall;
  panel('wall-w', cx - halfW + wall / 2, cz, [wall, insideTop - floor, halfD * 2], floor);
  panel('wall-e', cx + halfW - wall / 2, cz, [wall, insideTop - floor, halfD * 2], floor);
  panel('wall-n', cx, cz - halfD + wall / 2, [halfW * 2 - wall * 2, insideTop - floor, wall], floor);
  panel('wall-s-l', cx - door / 2 - side / 2, cz + halfD - wall / 2, [side, insideTop - floor, wall], floor);
  panel('wall-s-r', cx + door / 2 + side / 2, cz + halfD - wall / 2, [side, insideTop - floor, wall], floor);
  panel('lintel', cx, cz + halfD - wall / 2, [door, insideTop - floor - 3.6, wall], floor + 3.6);

  // ---- the floors: rings round an atrium, lit, with a ladderwell through them
  const atriumX = Math.min(5, halfW / 3);
  const atriumZ = Math.min(6, halfD / 3);
  const innerW = halfW * 2 - wall * 2;
  const innerD = halfD * 2 - wall * 2;
  const bandX = (innerW / 2 - atriumX) / 2;
  const bandZ = (innerD / 2 - atriumZ) / 2;
  const infill = innerW - 2 * (innerW / 2 - atriumX);
  for (let level = 1; level <= storeys; level += 1) {
    const y = level === storeys ? insideTop : floor + storey * level - 0.6;
    panel(`slab-${level}-w`, cx - atriumX - bandX, cz, [innerW / 2 - atriumX, 0.6, atriumZ * 2], y, 'floor');
    panel(`slab-${level}-e`, cx + atriumX + bandX, cz, [innerW / 2 - atriumX, 0.6, atriumZ * 2], y, 'floor');
    panel(`slab-${level}-n`, cx, cz - atriumZ - bandZ, [infill, 0.6, innerD / 2 - atriumZ], y, 'floor');
    panel(`slab-${level}-s`, cx, cz + atriumZ + bandZ, [infill, 0.6, innerD / 2 - atriumZ], y, 'floor');
    if (level === storeys) break;
    lights.push({
      id: `${id}-lamp-${level}`,
      position: { x: cx, y: floor + storey * level - 1.3, z: cz },
      color: '#cfe4ff',
      intensity: 9,
      distance: 26,
    });
    context.count('tower-floor');
  }
  laddersUp(context, `${id}-stairs`, cx + atriumX - 1, cz + atriumZ - 1, insideTop, floor);

  // ---- the shaft, standing in the −X corner of the shell
  //
  // In the corner because the setback has to rise on the far side of it: a setback
  // centred over the shaft puts thirty metres of solid through every floor the car
  // serves, and the physics resolves a rider inside a solid by pushing them out of it.
  const shaftX = cx - halfW + shaftOuter / 2 + wall;
  const shaftZ = cz - halfD + shaftOuter / 2 + wall;
  const liftFloors: number[] = [];
  const names: string[] = ['Street'];
  for (let level = 1; level < storeys; level += 1) {
    liftFloors.push(floor + storey * level);
    names.push(`Floor ${level + 1}`);
  }
  liftFloors.push(insideTop, roof);
  names.push('Roof level', 'Roof');
  const liftId = `${id}-lift`;
  const shaft = liftTower({
    id: liftId,
    at: [shaftX, shaftZ],
    size: [3.4, 3.4],
    floors: [floor, ...liftFloors],
    names,
    // Into the building at every floor, and onto its roof at the top: one direction
    // serves both because the setback is on the +X side too.
    facing: 'x+',
    base: floor - 6,
    tint: '#3f4a5c',
    tintDark: '#333c4a',
  });
  props.push(...shaft.props);
  context.elevators.push(shaft.elevator);
  context.count('lift');

  // ---- the setback above the shell, on the far side of the shaft
  const shedX0 = shaftX + shaftOuter / 2 + wall;
  const shedHalf = (cx + halfW - shedX0) / 2;
  const shedX = shedX0 + shedHalf;
  if (shedHalf > 4) {
    roofKit(context, `${id}-setback`, [shedX, cz], shedHalf * 2, halfD * 2 - 0.4, roof, { solar: false });
    // Solar and a tank on the setback's own roof, which is the building's roof.
    props.push(
      make(`${id}-roof-solar`, { at: [shedX, cz - halfD / 2], bottom: roof, size: [7, 1.3, 3.6], model: 'solar-panel' }),
      make(`${id}-roof-tank`, { at: [shedX, cz + halfD / 2 - 3], bottom: roof, size: [3.2, 3.4, 3.2], model: 'water-tank' }),
    );
    if (random() < 0.5) {
      props.push(make(`${id}-roof-mast`, { at: [shedX, cz], bottom: roof, size: [1, 12, 1], model: 'antenna-mast' }));
    }
    // Up the setback's face from the shell's roof, so the top is a route rather than a
    // place the lift happens to stop.
    ladderUp(context, `${id}-setback-ladder`, shedX0 + 0.4, cz - halfD + 2, roof);

    // Billboards on the tall ones, facing the old town, because the point of a billboard
    // is to be seen from somewhere.
    if (roof > 44 && random() < 0.8) {
      const facing = cz > 0 ? -1 : 1;
      const z = cz + facing * (halfD - 0.3);
      props.push(
        make(`${id}-billboard`, {
          at: [shedX, z],
          bottom: floor + 20,
          size: [Math.min(shedHalf * 2 * 0.9, 30), 12, 0.5],
          model: 'billboard',
          tints: { neon: BILLBOARD_COLOURS[Math.floor(random() * BILLBOARD_COLOURS.length)] as string },
        }),
      );
      context.count('billboard');
      lights.push({
        id: `${id}-glow`,
        position: { x: shedX, y: floor + 26, z: z + facing * 1.6 },
        color: '#8fd7ff',
        intensity: 14,
        distance: 26,
      });
    }

    // Balconies up the outside, ledges to land on and use as a route.
    for (let index = 0; index < 3; index += 1) {
      balcony(context, `${id}-balcony-${index}`, shedX, cz - halfD - 0.4, shedHalf * 1.2, insideTop + 6 + index * 8);
    }
  }
  void storeys;
}

/** A building under construction: a carcass, scaffolding, and a crane over it. */
function constructionSite(
  context: Context,
  cx: number,
  cz: number,
  footprint: number,
  band: Band,
  distance: number,
): void {
  const { props, random, config } = context;
  const width = footprint * 1.72;
  const depth = footprint * 1.64;
  const top = (band.roofs[band.roofs.length - 1] ?? 24) + 10 + Math.round(random() * 18);
  const id = `site-${Math.round(cx)}-${Math.round(cz)}`;
  // The carcass as the street sees it. Its floors are inset as they rise, so the widest
  // mass - and the one a neighbour's gap runs into - is the lowest slab.
  record(context, {
    gx: context.gx,
    gz: context.gz,
    id,
    cx,
    cz,
    halfX: width / 2,
    halfZ: depth / 2,
    roof: top,
  });
  const floor = config.groundY;
  const stages = 3 + Math.floor(random() * 3);
  const stage = (top - floor) / stages;

  for (let index = 0; index < stages; index += 1) {
    const y = floor + index * stage;
    // A poured floor, with columns poking up out of it: a carcass, not a building.
    props.push(make(`${id}-slab-${index}`, { at: [cx, cz], bottom: y, size: [width, 0.7, depth], model: 'construction-slab', kind: 'floor' }));
    // The four corners keep going up, past the top slab, the way a frame does.
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      props.push(
        make(`${id}-col-${index}-${sx}${sz}`, {
          at: [cx + sx * (width / 2 - 0.8), cz + sz * (depth / 2 - 0.8)],
          bottom: y,
          size: [1.3, stage, 1.3],
          model: 'construction-column',
        }),
      );
    }
  }

  // Scaffolding on one side, and a ladder up the scaffolding.
  const side = cz + depth / 2 + 1.1;
  for (let index = 0; index < stages; index += 1) {
    props.push(
      make(`${id}-stack-${index}`, {
        at: [cx - width / 2 + 3, side],
        bottom: floor + index * stage,
        size: [6, stage, 2],
        model: 'scaffold',
      }),
    );
  }
  laddersUp(context, `${id}-ladder`, cx - width / 2 + 3, side - 1.1, top, floor);

  // ...and a tower crane, because a site without one is a car park.
  const craneHeight = top + 22;
  context.props.push(
    make(`${id}-crane`, {
      at: [cx + width / 2 + 7, cz + depth / 2 + 7],
      bottom: floor,
      size: [46, craneHeight - floor, 4],
      model: 'crane',
      tints: { hazard: '#e8b23c' },
    }),
  );
  context.count('crane');

  // Rubble and pallets at street level, so the site has a floor you can cross.
  for (let index = 0; index < 4; index += 1) {
    props.push(
      make(`${id}-rubble-${index}`, {
        at: [cx - width / 2 + 4 + index * 6, cz - depth / 2 - 2],
        bottom: floor,
        size: [2.4, 1.2 + random() * 1.6, 2.4],
        model: 'crate',
        tints: { rust: '#6b5a44' },
      }),
    );
  }
  void distance;
}

/**
 * A hall: a building you can walk into, with a floor you can cross.
 *
 * The interiors in the old town are machine rooms - 7 by 5 m, and a door. A hall is the
 * other end of that: a single volume the size of a block, with columns, a mezzanine and
 * a lift, so the city has an inside as well as a skyline.
 */
function hall(context: Context, cx: number, cz: number, footprint: number): void {
  const { props, config, random } = context;
  const width = footprint * 1.74;
  const depth = footprint * 1.66;
  const wall = 0.6;
  const height = 12 + Math.round(random() * 6);
  const floor = config.groundY;
  const id = `hall-${Math.round(cx)}-${Math.round(cz)}`;
  record(context, {
    gx: context.gx,
    gz: context.gz,
    id,
    cx,
    cz,
    halfX: width / 2,
    halfZ: depth / 2,
    roof: floor + height,
  });
  const doorWidth = 4.5;
  const doorHeight = 4.2;
  const tints = tintSet(context);

  const panel = (
    suffix: string,
    x: number,
    z: number,
    size: readonly [number, number, number],
    bottom: number,
  ): void => {
    props.push(make(`${id}-${suffix}`, { at: [x, z], bottom, size, kind: 'wall', model: 'slab', tints }));
  };

  // Four walls, with a doorway cut into the +Z side.
  panel('wall-w', cx - width / 2 + wall / 2, cz, [wall, height, depth], floor);
  panel('wall-e', cx + width / 2 - wall / 2, cz, [wall, height, depth], floor);
  panel('wall-n', cx, cz - depth / 2 + wall / 2, [width - wall * 2, height, wall], floor);
  const sideWidth = (width - doorWidth - wall * 2) / 2;
  panel('wall-s-l', cx - doorWidth / 2 - sideWidth / 2, cz + depth / 2 - wall / 2, [sideWidth, height, wall], floor);
  panel('wall-s-r', cx + doorWidth / 2 + sideWidth / 2, cz + depth / 2 - wall / 2, [sideWidth, height, wall], floor);
  // The lintel over the door: the wall above it, so the opening is a doorway.
  panel('lintel', cx, cz + depth / 2 - wall / 2, [doorWidth, height - doorHeight, wall], floor + doorHeight);

  // The floor, and columns down the middle, which is what makes a hall a hall.
  props.push(make(`${id}-floor`, { at: [cx, cz], bottom: floor - 0.8, size: [width, 0.8, depth], model: 'deck', kind: 'floor' }));
  for (let index = 0; index < 4; index += 1) {
    const px = cx - width / 2 + ((index + 1) * width) / 5;
    for (const z of [cz - depth / 3, cz + depth / 3]) {
      props.push(make(`${id}-col-${index}-${z > cz ? 's' : 'n'}`, { at: [px, z], bottom: floor, size: [1.2, height, 1.2], model: 'construction-column' }));
    }
  }

  // A mezzanine over the far half, reached by a ladder.
  const mezz = floor + height * 0.55;
  props.push(make(`${id}-mezz`, { at: [cx - width / 4, cz], bottom: mezz, size: [width / 2, 0.7, depth - wall * 2], model: 'deck', kind: 'floor' }));
  laddersUp(context, `${id}-ladder`, cx - width / 2 + 1.4, cz - depth / 4, mezz, floor);

  // The roof: the hall is also just another building from above.
  roofKit(context, `${id}-roof`, [cx, cz], width, depth, floor + height + 0.7, { solar: true });

  // An interior light, so the volume reads.
  context.lights.push(
    { id: `${id}-lamp-a`, position: { x: cx, y: floor + height - 2, z: cz - depth / 4 }, color: '#ffd9a8', intensity: 9, distance: 26 },
  );
  context.lights.push(
    { id: `${id}-lamp-b`, position: { x: cx, y: floor + height - 2, z: cz + depth / 4 }, color: '#ffd9a8', intensity: 9, distance: 26 },
  );
  context.count('hall-lamp');
}

/** A ladder flush against a wall, from the street to a roof. */
function ladderUp(context: InfillContext, id: string, x: number, z: number, top: number): void {
  laddersUp(context, id, x, z, top, context.config.groundY);
}

/**
 * Ladders filling a height, in readable lengths.
 *
 * A ladder's rungs are part of its model, so a model stretched over 40 m would have
 * rungs two metres apart. Stacking 5 m ladders up the same wall keeps them rungs.
 */
function laddersUp(
  context: InfillContext,
  id: string,
  x: number,
  z: number,
  top: number,
  from: number,
  /** Section length. Longer sections are fewer props and sparser rungs. */
  length_m = 7,
): void {
  const span = top - from;
  if (span < 3) return;
  // Seven metres rather than five: the rungs are part of the model, so a longer section
  // spaces them further apart - 70 cm instead of 50, which still reads as a ladder - and
  // every section is a prop. V0.7.2's buildings are twice as tall and there are twice as
  // many of them, and this is a third of the city's props.
  const length = length_m;
  const count = Math.max(1, Math.round(span / length));
  const each = span / count;
  for (let index = 0; index < count; index += 1) {
    context.props.push(
      make(`${id}-${index}`, {
        at: [x, z],
        bottom: from + index * each,
        size: [1.1, each, 0.35],
        model: 'ladder',
        kind: 'wall',
        climbable: true,
      }),
    );
  }
  context.count('ladder');
}

/** A balcony: a lip of deck out from a wall, at a height a player can use. */
function balcony(context: InfillContext, id: string, x: number, z: number, width: number, top: number): void {
  const depth = 1.8;
  context.props.push(
    make(id, {
      at: [x, z],
      bottom: top,
      size: [width, 0.5, depth],
      model: 'deck',
      kind: 'floor',
    }),
  );
  // ...and the bracket that holds it, so the level's nothing-floats rule is satisfied.
  context.props.push(
    make(`${id}-bracket`, {
      at: [x, z + depth / 2 + 0.2],
      bottom: top - 4,
      size: [1, 4.5, 0.4],
      model: 'support-post',
    }),
  );
  context.count('balcony');
}

const BILLBOARD_COLOURS: readonly string[] = ['#57e0ff', '#ff4fd8', '#ffc247', '#7dff9b', '#a06bff', '#eaf6ff'];

/**
 * A tower you can walk *into*: several floors, a corridor on each, and a way between them.
 *
 * The halls are one volume the size of a block, which is the "open planes" end of an
 * interior. This is the other end: three or four storeys inside a building, a corridor on
 * each with rooms off it, and an atrium in the middle with the lift on one side and the
 * ladderwell on the other. Indoors in a city is not one room, and a floor you can only
 * reach by lift is where a secret is.
 *
 * Every floor is a *ring* of four slabs round the atrium rather than a plate: the well
 * runs from the street to the sky, the lift and the ladder both pass through it, and no
 * slab has to be reasoned about in pieces. The ring mirrors the shell the way the shell's
 * own walls do - two slabs the full width, two *between* them - because slabs that all
 * spanned the footprint would share their outer faces, and a face drawn twice at one depth
 * is a seam that flickers.
 */
function interiorTower(
  context: Context,
  cx: number,
  cz: number,
  footprint: number,
  random: () => number,
): void {
  const { props, config, count, lights } = context;
  const width = footprint * 0.92;
  const depth = footprint * 0.8;
  const wall = 0.6;
  const floor = config.groundY;
  const storey = 5.4;
  const levels = 3 + Math.floor(random() * 2);
  const roof = floor + storey * levels;
  const id = `inside-${Math.round(cx)}-${Math.round(cz)}`;
  const tints = tintSet(context);
  const innerDepth = depth - wall * 2;
  const innerWidth = width - wall * 2;

  const panel = (
    suffix: string,
    x: number,
    z: number,
    size: readonly [number, number, number],
    bottom: number,
    kind: PropDefinition['kind'] = 'wall',
  ): void => {
    props.push(make(`${id}-${suffix}`, { at: [x, z], bottom, size, kind, model: 'slab', tints }));
  };

  // ---- the shell, with a doorway at street level on the +Z side
  panel('wall-w', cx - width / 2 + wall / 2, cz, [wall, storey * levels, depth], floor);
  panel('wall-e', cx + width / 2 - wall / 2, cz, [wall, storey * levels, depth], floor);
  panel('wall-n', cx, cz - depth / 2 + wall / 2, [innerWidth, storey * levels, wall], floor);
  const doorWidth = 5;
  const sideWidth = (innerWidth - doorWidth) / 2;
  panel('wall-s-l', cx - doorWidth / 2 - sideWidth / 2, cz + depth / 2 - wall / 2, [sideWidth, storey * levels, wall], floor);
  panel('wall-s-r', cx + doorWidth / 2 + sideWidth / 2, cz + depth / 2 - wall / 2, [sideWidth, storey * levels, wall], floor);
  panel('lintel', cx, cz + depth / 2 - wall / 2, [doorWidth, storey * levels - 3.6, wall], floor + 3.6);

  // ---- the atrium, and the ring of slabs round it
  const atriumHalfX = Math.min(5, innerWidth / 3);
  const atriumHalfZ = Math.min(6, innerDepth / 3);
  const bandX = (innerWidth / 2 - atriumHalfX) / 2;
  const bandZ = (innerDepth / 2 - atriumHalfZ) / 2;
  /** The slabs between the side ones, so the four do not share a plane. */
  const infillWidth = innerWidth - 2 * (innerWidth / 2 - atriumHalfX);

  for (let level = 1; level <= levels; level += 1) {
    // The top of the ring *is* the roof: the well goes all the way up.
    const y = level === levels ? roof : floor + storey * level - 0.6;
    panel(`slab-${level}-w`, cx - atriumHalfX - bandX, cz, [innerWidth / 2 - atriumHalfX, 0.6, atriumHalfZ * 2], y, 'floor');
    panel(`slab-${level}-e`, cx + atriumHalfX + bandX, cz, [innerWidth / 2 - atriumHalfX, 0.6, atriumHalfZ * 2], y, 'floor');
    panel(`slab-${level}-n`, cx, cz - atriumHalfZ - bandZ, [infillWidth, 0.6, innerDepth / 2 - atriumHalfZ], y, 'floor');
    panel(`slab-${level}-s`, cx, cz + atriumHalfZ + bandZ, [infillWidth, 0.6, innerDepth / 2 - atriumHalfZ], y, 'floor');

    if (level === levels) break;

    // A corridor is a room with a wall down it and gaps in the wall. Three partitions
    // across the north band leave two ways past them.
    for (let index = 0; index < 3; index += 1) {
      const x = cx - innerWidth / 2 + ((index + 0.5) * innerWidth) / 3;
      panel(
        `part-${level}-${index}`,
        x,
        cz - atriumHalfZ - bandZ,
        [(innerWidth / 3) * 0.62, storey - 1.4, 0.4],
        floor + storey * (level - 1),
      );
    }
    lights.push({
      id: `${id}-lamp-${level}`,
      position: { x: cx, y: floor + storey * level - 1.3, z: cz },
      color: '#cfe4ff',
      intensity: 8,
      distance: 24,
    });
    count('interior-floor');
  }

  // Rooftop kit on the ring. Not a `roofKit`: that builds its own building underneath,
  // and a body inside this shell is a building inside a building.
  props.push(make(`${id}-solar-a-panel`, { at: [cx - innerWidth / 4, cz - atriumHalfZ - bandZ], bottom: roof, size: [6, 1.2, 3], model: 'solar-panel' }));
  props.push(make(`${id}-solar-b-panel`, { at: [cx + innerWidth / 4, cz - atriumHalfZ - bandZ], bottom: roof, size: [6, 1.2, 3], model: 'solar-panel' }));
  props.push(make(`${id}-tank`, { at: [cx + innerWidth / 2 - 2.5, cz + atriumHalfZ + bandZ], bottom: roof, size: [3, 3.2, 3], model: 'water-tank' }));

  // ---- the ladderwell, on the east side of the atrium, street to roof
  laddersUp(context, `${id}-ladder`, cx + atriumHalfX - 1, cz + atriumHalfZ - 1, roof, floor);

  // ---- and the lift, on the west side, serving every floor and the roof
  const liftFloors: number[] = [];
  for (let level = 0; level <= levels; level += 1) {
    liftFloors.push(level === levels ? roof : floor + storey * level);
  }
  const liftId = `${id}-lift`;
  const parts = liftTower({
    id: liftId,
    at: [cx - atriumHalfX + 1.8, cz - atriumHalfZ + 2],
    size: [3.2, 3.2],
    floors: liftFloors,
    names: ['Street', ...liftFloors.slice(1, -1).map((_y, index) => `Floor ${index + 2}`), 'Roof'],
    facing: 'z+',
    base: floor - 6,
    tint: '#3c4658',
    tintDark: '#313a49',
  });
  props.push(...parts.props);
  context.elevators.push(parts.elevator);
  count('interior-lift');
  record(context, {
    gx: context.gx,
    gz: context.gz,
    id: `inside-${Math.round(cx)}-${Math.round(cz)}`,
    cx,
    cz,
    halfX: width / 2,
    halfZ: depth / 2,
    roof,
  });
}
