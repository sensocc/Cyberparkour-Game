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

import {
  liftTower,
  type CheckpointDefinition,
  type CollectibleDefinition,
  type GoalDefinition,
  type LevelDefinition,
  type PropDefinition,
  type SpawnPoint,
} from './levelData.js';


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
  /**
   * A rectangle to keep clear, if a level wants one.
   *
   * Optional and unused by default, because V0.7.7 grids the *whole* map: the hand-authored
   * district that used to stand in the middle of it is gone, so there is nothing to keep the
   * city out of and every cell gets a building. It stays as an option for a level that wants
   * a courtyard.
   */
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
  readonly keepClear?: readonly [number, number, number, number];
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
  masses: [],
};

/**
 * The heights a cell's buildings may be drawn from.
 *
 * One terrace and the two steps above it, so everything on a cell is within three metres of
 * everything else on it.
 */
interface Band {
  readonly roofs: readonly number[];
  readonly construction: number;
  readonly hall: number;
}

/** The whole map: one kilometre square, gridded. */
const GRID_SPAN = 1000;

/** The street every building leaves. The same number everywhere, which is the point. */
const STREET = 4.5;

/** Cells to a terrace tile, and the step between one tile and the next. */
const TILE = 4;
const TILE_STEP = 4;

/**
 * The terrace a cell stands on.
 *
 * A ramp across the tiles rather than a roll of the dice: a cell and the four around it are
 * in the same tile or one over, so the worst height difference between neighbours is one
 * step plus the three metres of variation inside a cell - under eight metres, where a free
 * roll put forty between two buildings on the same street.
 */
function blockTop(ix: number, iz: number): number {
  const tile = Math.floor(ix / TILE) + Math.floor(iz / TILE);
  const steps = ((tile % 7) + 7) % 7;
  return 10 + steps * TILE_STEP;
}

/**
 * Builds the city around a level, and returns the level with it in.
 *
 * The district is untouched: its props, doors, checkpoints, pickups and lifts all come
 * through as they are, and everything this adds is appended.
 */
export function buildCity(base: LevelDefinition, options: CityOptions = {}): LevelDefinition {
  const parts = generateCity(options);

  // **The level is the city now.** V0.7 kept a hand-authored district at the centre and built
  // around it, which left the one part of the map the player actually runs around in as the
  // one part that was not a grid. The district's props, doors, lifts and lights are gone with
  // it, and the spawn, the checkpoints, the pickups and the finish are placed on the grid.
  //
  // What the level still lends the city is what a level is *for* here: its identity, its sky,
  // and its sun.
  return {
    ...base,
    props: parts.props,
    checkpoints: parts.checkpoints,
    collectibles: parts.collectibles,
    goal: parts.goal,
    spawn: parts.spawn,
    lights: parts.lights,
    elevators: parts.elevators,
    doors: undefined,
    smoke: undefined,
    // The streets are the world's floor, so the plane sits below them and a fall to the
    // pavement is survivable while a fall from a roof is not.
    killPlaneY: DEFAULTS.groundY - 9,
    environment: {
      ...base.environment,
      fogNear: 260,
      fogFar: 1150,
      backdrop: { ...base.environment.backdrop, radius: 780 },
    },
  };
}

/**
 * A solid building the level brought with it, as the city generator sees it.
 *
 * Only the cell-skip uses these now - the city grids the whole map - and a level with no
 * masses of its own needs none.
 */
export interface Mass {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly top: number;
}

/** The whole level, generated: the city, and the run across it. */
export interface CityParts {
  readonly props: PropDefinition[];
  readonly lights?: NonNullable<LevelDefinition['lights']>;
  readonly elevators?: NonNullable<LevelDefinition['elevators']>;
  /**
   * Where the run starts, and the checkpoints it passes through.
   *
   * V0.7.7 places these rather than inheriting them: the hand-authored district was the run,
   * and with it gone the spawn, the checkpoints, the pickups and the finish live on grid
   * rooftops, spread across the kilometre. A map four times the size needs the run to be four
   * times as long, and the order still matters - the checkpoints are what arm the finish.
   */
  readonly spawn: SpawnPoint;
  readonly checkpoints: readonly CheckpointDefinition[];
  readonly collectibles: readonly CollectibleDefinition[];
  readonly goal: GoalDefinition;
  readonly report: Record<string, number>;
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

  const keep = config.keepClear;
  const [keepX0, keepX1, keepZ0, keepZ1] = keep ?? [1, -1, 1, -1];
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
  let fillIds = 0;
  const nextId = (): number => (fillIds += 1);


  // ------------------------------------------------------------------ the grid
  //
  // **A square grid, one kilometre on a side, uniform in every direction.** Every building
  // is the same size, on the same pitch, with the same street around it, because "the same
  // distance from the surrounding buildings" is not a property to generate - it is a
  // property to *not* break. Nothing here jitters, repairs, fills or attaches: the gaps are
  // what is left of the pitch after a building and a street, so they cannot be anything
  // else, and two buildings cannot be in one place because there is exactly one per cell.
  //
  // The three versions before this one tried to *emerge* a playable city - generate freely,
  // then measure the gaps and patch them - and every patch was a new way to fuse two
  // buildings together or to leave a roof with nothing beside it. This does not patch
  // anything. It is a grid, and a grid is what was asked for.
  const cells = Math.max(2, Math.round(GRID_SPAN / config.pitch));
  const half = (config.pitch - STREET) / 2;

  for (let ix = 0; ix < cells; ix += 1) {
    for (let iz = 0; iz < cells; iz += 1) {
      const cx = -GRID_SPAN / 2 + config.pitch * (ix + 0.5);
      const cz = -GRID_SPAN / 2 + config.pitch * (iz + 0.5);

      // The old town keeps its own ground, and a street around it.
      if (
        keep &&
        cx + half > keepX0 &&
        cx - half < keepX1 &&
        cz + half > keepZ0 &&
        cz - half < keepZ1
      ) {
        continue;
      }
      // ...and so does every building the level brought with it, wherever it stands. The old
      // town has five towers off to the sides, outside the rectangle the city is kept out of,
      // and without this a cell lands on top of one - which is an overlapping building, and
      // the reason the last two versions had hundreds of them.
      if (
        config.masses?.some(
          (mass) =>
            cx + half > mass.minX &&
            cx - half < mass.maxX &&
            cz + half > mass.minZ &&
            cz - half < mass.maxZ,
        )
      ) {
        continue;
      }

      // The whole cell shares one terrace, so a building and all four of its neighbours are
      // within a step of each other and the skyline steps across the city instead of
      // spiking. Blocks of four cells step by six metres, which is the "no more than ten to
      // twenty metres taller than the building next door" rule with room to spare.
      const top = blockTop(ix, iz);
      // Never more than three metres of variation within a cell: a building and the one
      // beside it are the same building at a different height, which is what a city grid is.
      const band: Band = { roofs: [top, top + 1.5, top + 3], construction: 0.1, hall: 0.12 };
      const context = {
        props,
        lights,
        elevators,
        random,
        config,
        count,
        plots,
        gx: cx,
        gz: cz,
        nextId,
      };

      const roll = random();
      if (roll < band.construction) {
        count('construction');
        constructionSite(context, cx, cz, half, band);
      } else if (roll < band.construction + band.hall) {
        count('hall');
        hall(context, cx, cz, half, band);
      } else if (roll < 0.45) {
        count('interior');
        interiorTower(context, cx, cz, half, band);
      } else if (roll < 0.6) {
        count('tower');
        tower(context, cx, cz, half, band);
      } else {
        count('block');
        block(context, cx, cz, half, band);
      }
    }
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

  // ------------------------------------------------------------------ the run
  //
  // **On the roofs, and on roofs that are actually there.** The first attempt placed the run
  // from the register - the height each archetype said its building was - and a register is
  // bookkeeping, not geometry: a cell's centre is inside the building that stands on it, and a
  // tower's registered roof is the top of its shell, forty metres under its actual roof. Route
  // points landed inside bodies and twelve metres above surfaces, so the run went down to the
  // street and stayed there.
  //
  // A roof deck is the surface itself, so a point at a deck's centre is a point *on* it - and
  // the one thing a deck cannot tell you is whether something is standing on top of it, which
  // is what the clearance check is for.
  const roofDecks = props
    .filter(
      (prop) =>
        prop.kind === 'floor' &&
        prop.model === 'deck' &&
        prop.size.x > 14 &&
        prop.size.z > 14 &&
        prop.position.y + prop.size.y / 2 > config.groundY + 8,
    )
    .map((prop) => ({
      id: prop.id,
      x: prop.position.x,
      z: prop.position.z,
      y: prop.position.y + prop.size.y / 2,
    }));

  /** True when nobody is already standing there: a foot of headroom, and no prop in it. */
  const clearOf = (x: number, z: number, y: number): boolean =>
    !props.some(
      (prop) =>
        Math.abs(prop.position.x - x) < prop.size.x / 2 + 0.5 &&
        Math.abs(prop.position.z - z) < prop.size.z / 2 + 0.5 &&
        prop.position.y + prop.size.y / 2 > y + 0.15 &&
        prop.position.y - prop.size.y / 2 < y + 1.8,
    );

  /** A spot on that roof, as close to its centre as the rooftop kit allows. */
  const spotOn = (deck: (typeof roofDecks)[number]): { x: number; y: number; z: number } | null => {
    for (const [dx, dz] of [
      [0, 0],
      [2.6, 0],
      [-2.6, 0],
      [0, 2.6],
      [0, -2.6],
      [2.6, 2.6],
      [-2.6, -2.6],
      [2.6, -2.6],
      [-2.6, 2.6],
    ] as const) {
      if (clearOf(deck.x + dx, deck.z + dz, deck.y)) {
        return { x: deck.x + dx, y: deck.y, z: deck.z + dz };
      }
    }
    return null;
  };

  const roofs = roofDecks
    .map((deck) => ({ deck, spot: spotOn(deck) }))
    .filter((entry): entry is { deck: (typeof roofDecks)[number]; spot: { x: number; y: number; z: number } } =>
      entry.spot !== null,
    )
    .sort((a, b) => a.deck.x + a.deck.z - (b.deck.x + b.deck.z));

  const on = (fraction: number, id: string): { id: string; position: { x: number; y: number; z: number } } => {
    const entry = roofs[Math.min(roofs.length - 1, Math.max(0, Math.round(fraction * (roofs.length - 1))))]!;
    return { id, position: { x: entry.spot.x, y: entry.spot.y + 0.02, z: entry.spot.z } };
  };
  const origin = roofs[Math.min(roofs.length - 1, Math.round(roofs.length / 2))]!;

  return {
    props,
    lights: lights.length > 0 ? lights : undefined,
    elevators: elevators.length > 0 ? elevators : undefined,
    spawn: {
      position: { x: origin.spot.x, y: origin.spot.y + 0.02, z: origin.spot.z },
      yaw: 0,
      pitch: 0,
    },
    checkpoints: [0.62, 0.7, 0.78, 0.86, 0.94].map((fraction, index) =>
      on(fraction, `checkpoint-${index + 1}`),
    ),
    collectibles: [0.08, 0.18, 0.3, 0.4, 0.48, 0.56, 0.66, 0.76, 0.88, 0.97].map((fraction, index) =>
      on(fraction, `shard-${index + 1}`),
    ),
    goal: on(1, 'goal'),
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

function tintSet(context: Context): Record<string, string> {
  const pick = BODY_TINTS[Math.floor(context.random() * BODY_TINTS.length)] ?? BODY_TINTS[0];
  return { ...pick };
}

/** A roof deck over a body, with the kit a city roof has. */
function roofKit(
  context: Context,
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

  // ------------------------------------------------------------------ the roof
  //
  // **What is up there.** A city's roofs are its third dimension, and the grid gives every one
  // of them the same footprint - which is exactly why they need dressing: forty identical slabs
  // read as a car park. Fourteen kinds of thing, four to eight of them per roof, chosen by the
  // building's own dice: an access hut, a vent, a dish, a junction box, a spool of cable, a
  // skylight, a barrier, a water tower on its legs, a bank of chillers, an aerial farm, a
  // helipad, a greenhouse, a crown, and a gangway to the building next door.
  //
  // The gangway is the one that changes the map rather than the view: a catwalk over the street
  // is a second way between two roofs, so a player who cannot make the jump has a bridge.
  // Only a whole building's roof. A setback, a roof storey and an upper stage all go through
  // `roofKit` too, and dressing every one of them puts a water tower on a penthouse.
  const dressed = width > 30 && depth > 30;
  const decor: string[] = [];
  const place = (
    suffix: string,
    x: number,
    z: number,
    bottom: number,
    size: readonly [number, number, number],
    model: string,
    tints?: Readonly<Record<string, string>>,
  ): void => {
    props.push(make(`${id}-${suffix}`, { at: [x, z], bottom, size, model, ...(tints ? { tints } : {}) }));
  };

  /** A spot on the roof, off the parapet and away from the middle. */
  const spot = (): readonly [number, number] => [
    at[0] + (random() - 0.5) * Math.max(2, width * 0.66),
    at[1] + (random() - 0.5) * Math.max(2, depth * 0.66),
  ];

  const wanted = dressed ? 4 + Math.floor(random() * 5) : 0;
  const pool = [
    'hut',
    'vent',
    'dish',
    'junction',
    'spool',
    'skylight',
    'barrier',
    'tower',
    'chillers',
    'aerials',
    'helipad',
    'greenhouse',
    'crown',
    'gangway',
  ];
  for (let index = 0; index < wanted && pool.length > 0; index += 1) {
    const pick = pool.splice(Math.floor(random() * pool.length), 1)[0]!;
    const [px, pz] = spot();
    decor.push(pick);

    switch (pick) {
      case 'hut':
        place(`roof-hut-${index}`, px, pz, top, [4.4, 3.4, 3.8], 'stair-bulkhead');
        break;
      case 'vent':
        place(`roof-vent-${index}`, px, pz, top, [1.6, 5, 1.6], 'vent-stack');
        break;
      case 'dish':
        place(`roof-dish-${index}`, px, pz, top, [3.4, 3.4, 3.4], 'antenna-mast');
        place(`roof-dish-face-${index}`, px + 1.4, pz, top + 3.2, [2, 2, 0.4], 'satellite-dish');
        break;
      case 'junction':
        place(`roof-junction-${index}`, px, pz, top, [2.2, 1.8, 1.4], 'junction-box');
        break;
      case 'spool':
        place(`roof-spool-${index}`, px, pz, top, [2.4, 2.4, 1.8], 'cable-spool');
        break;
      case 'skylight':
        place(`roof-skylight-${index}`, px, pz, top, [3.6, 1.2, 3.6], 'skylight');
        break;
      case 'barrier':
        place(`roof-barrier-${index}`, px, pz, top, [Math.min(width - 6, 8), 1.1, 0.6], 'barrier');
        break;
      case 'tower': {
        // A water tower: the tank on four legs, which is the one silhouette a skyline needs.
        const legTop = top + 5;
        for (const [lx, lz] of [
          [-1.4, -1.4],
          [1.4, -1.4],
          [-1.4, 1.4],
          [1.4, 1.4],
        ] as const) {
          place(`roof-tower-leg-${index}-${lx}${lz}`, px + lx, pz + lz, top, [1, 5, 1], 'construction-column');
        }
        place(`roof-tower-tank-${index}`, px, pz, legTop, [4.4, 4, 4.4], 'water-tank', tintSet(context));
        break;
      }
      case 'chillers': {
        const bank = 2 + Math.floor(random() * 3);
        for (let unit = 0; unit < bank; unit += 1) {
          place(`roof-chiller-${index}-${unit}`, px + unit * 3.4, pz, top, [3, 1.7, 2.4], 'ac-unit');
        }
        break;
      }
      case 'aerials': {
        const masts = 2 + Math.floor(random() * 2);
        for (let mast = 0; mast < masts; mast += 1) {
          place(`roof-aerial-${index}-${mast}`, px + mast * 3, pz + mast, top, [1, 9 + random() * 9, 1], 'antenna-mast');
        }
        break;
      }
      case 'helipad':
        place(`roof-pad-${index}`, px, pz, top, [Math.min(width - 8, 20), 0.3, Math.min(depth - 8, 20)], 'construction-slab', {
          hazard: '#d8cfa8',
        });
        place(`roof-pad-mark-${index}`, px, pz, top + 0.3, [Math.min(width - 12, 12), 0.3, 2], 'neon-strip');
        break;
      case 'greenhouse':
        place(`roof-greenhouse-${index}`, px, pz, top, [Math.min(width - 8, 14), 3.2, Math.min(depth - 8, 8)], 'block', {
          glass: '#cfe6ee',
        });
        break;
      case 'crown':
        place(`roof-crown-${index}`, px, pz, top, [6, 5.6, 6], 'crown', tintSet(context));
        break;
      case 'gangway': {
        // Over the street to the building next door: a walkway, not a bridge in the structural
        // sense - two posts and a deck 4.5 m long, which is exactly the street.
        const along = random() < 0.5 ? 'x' : 'z';
        const length = STREET + 2.4;
        const x = along === 'x' ? at[0] + width / 2 + length / 2 - 1 : at[0];
        const z = along === 'z' ? at[1] + depth / 2 + length / 2 - 1 : at[1];
        place(
          `roof-gangway-${index}`,
          x,
          z,
          top - 0.4,
          along === 'x' ? [length, 0.5, 2.6] : [2.6, 0.5, length],
          'deck',
        );
        props.push(
          make(`${id}-roof-gangway-rail-${index}`, {
            at: along === 'x' ? [x, z + 1.2] : [x + 1.2, z],
            bottom: top + 0.1,
            size: along === 'x' ? [length, 1, 0.3] : [0.3, 1, length],
            model: 'barrier',
          }),
        );
        break;
      }
    }
  }
  for (const kind of decor) {
    context.count(`roof-${kind}`);
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
  // The uniform building: the pitch less the street, on both axes, everywhere in the city.
  const width = footprint * 2;
  const depth = footprint * 2;

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
  const top = band.roofs[Math.floor(random() * band.roofs.length)] ?? band.roofs[0]!;
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
  context: Context,
  cx: number,
  cz: number,
  footprint: number,
  band: Band,
): void {
  const { props, config, lights } = context;
  const { random } = context;
  const floor = config.groundY;
  const id = `city-${Math.round(cx)}-${Math.round(cz)}-tower`;
  const wall = 0.6;
  const shaftOuter = 4.2;
  const storey = 4.8;
  const storeys = 2 + Math.floor(random() * 2);
  const halfW = footprint;
  const halfD = footprint;
  const insideTop = floor + storeys * storey;
  // Ten to eighteen metres over its cell: enough to be a tower, inside the twenty the rule
  // allows, and reachable by the lift the tower exists to carry.
  const roof = (band.roofs[band.roofs.length - 1] ?? 30) + 10 + Math.round(random() * 8);
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
): void {
  const { props, random, config } = context;
  const width = footprint * 2;
  const depth = footprint * 2;
  // A carcass is a storey or two of its neighbours' height, not a spire.
  const top = (band.roofs[0] ?? 20) + 4 + Math.round(random() * 8);
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
      // Inside its own plot: a crane hung off the corner of the building it is building.
      at: [cx + width / 6, cz + depth / 6],
      bottom: floor,
      // As wide as the building under it, no wider: a jib that reaches over the street is
      // an overlapping building with a hook on it.
      size: [footprint * 2, craneHeight - floor, 4],
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
}

/**
 * A hall: a building you can walk into, with a floor you can cross.
 *
 * The interiors in the old town are machine rooms - 7 by 5 m, and a door. A hall is the
 * other end of that: a single volume the size of a block, with columns, a mezzanine and
 * a lift, so the city has an inside as well as a skyline.
 */
function hall(context: Context, cx: number, cz: number, footprint: number, band: Band): void {
  const { props, config, random } = context;
  const width = footprint * 2;
  const depth = footprint * 2;
  const wall = 0.6;
  const floor = config.groundY;
  void random;
  // A hall is one storey, so its roof is its cell's terrace less a little - and a hall next
  // to a tower is the difference the rule allows rather than a canyon.
  // A *height*, not a level: the hall's roof lands on its cell's terrace, which is where its
  // neighbours' roofs are. (Getting the two confused is how a hall came out thirty metres
  // over the block beside it.)
  const height = Math.max(6, (band.roofs[0] ?? 16) - floor);
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
function ladderUp(context: Context, id: string, x: number, z: number, top: number): void {
  laddersUp(context, id, x, z, top, context.config.groundY);
}

/**
 * Ladders filling a height, in readable lengths.
 *
 * A ladder's rungs are part of its model, so a model stretched over 40 m would have
 * rungs two metres apart. Stacking 5 m ladders up the same wall keeps them rungs.
 */
function laddersUp(
  context: Context,
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
function balcony(context: Context, id: string, x: number, z: number, width: number, top: number): void {
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
  band: Band,
): void {
  const { props, config, count, lights } = context;
  const width = footprint * 2;
  const depth = footprint * 2;
  const wall = 0.6;
  const floor = config.groundY;
  const storey = 5.4;
  // As many floors as its terrace holds, so an interior is a building like any other from
  // the outside and its roof is at the height its neighbours are.
  const levels = Math.min(8, Math.max(3, Math.round(((band.roofs[0] ?? 20) - floor) / storey)));
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
