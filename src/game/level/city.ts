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
}

interface Resolved {
  readonly seed: number;
  readonly radius: number;
  readonly pitch: number;
  readonly street: number;
  readonly groundY: number;
  readonly keepClear: readonly [number, number, number, number];
}

const DEFAULTS: Resolved = {
  seed: 20271010,
  // Half a kilometre each way: a kilometre of city, which is where a parkour run across
  // it becomes an expedition rather than a lap.
  radius: 500,
  pitch: 62,
  street: 18,
  groundY: -34.8,
  // The district's own bounds, plus its street.
  keepClear: [-120, 170, -110, 110],
};

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
function bandFor(distance: number): Band {
  if (distance < 190) {
    return { roofs: [22, 26, 30, 34], construction: 0.14, hall: 0.16 };
  }
  if (distance < 320) {
    return { roofs: [14, 18, 22, 26], construction: 0.18, hall: 0.12 };
  }
  return { roofs: [8, 12, 16, 20], construction: 0.12, hall: 0.08 };
}

/**
 * Builds the city around a level, and returns the level with it in.
 *
 * The district is untouched: its props, doors, checkpoints, pickups and lifts all come
 * through as they are, and everything this adds is appended.
 */
export function buildCity(base: LevelDefinition, options: CityOptions = {}): LevelDefinition {
  const parts = generateCity(options);

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
  const half = config.pitch / 2;

  for (let gx = -config.radius; gx <= config.radius; gx += config.pitch) {
    for (let gz = -config.radius; gz <= config.radius; gz += config.pitch) {
      // Jittered off the grid on purpose. A city laid out on exact graph paper reads as
      // graph paper from the air, however good each building is, so every plot is moved
      // a few metres and the street widths vary with it.
      const cx = gx + config.pitch / 2 + (random() - 0.5) * config.pitch * 0.26;
      const cz = gz + config.pitch / 2 + (random() - 0.5) * config.pitch * 0.26;
      const distance = Math.hypot(cx, cz);
      if (distance > config.radius) continue;

      // The old town keeps its own ground, and a street around it.
      const footprint = half - config.street / 2;
      if (
        cx + footprint > keepX0 &&
        cx - footprint < keepX1 &&
        cz + footprint > keepZ0 &&
        cz - footprint < keepZ1
      ) {
        continue;
      }

      const band = bandFor(distance);
      const context = { props, lights, elevators, random, config, count };

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
        block(context, cx, cz, footprint, band, random);
      }

      // Street furniture that does not need a building: nothing yet - a lamp post on
      // every corner would be a thousand props for fifty pixels of light.
    }
  }

  // Ground under the whole thing. The district's own slab is 700 m across, which is
  // short of a kilometre of city - and a city with a void under its outer ring reads as
  // floating rather than as built. Half a metre lower, so the two never share a plane.
  props.push(
    make('city-street-level', {
      at: [0, 0],
      bottom: config.groundY - 0.5,
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

interface Context {
  readonly props: PropDefinition[];
  readonly lights: NonNullable<LevelDefinition['lights']>[number][];
  readonly elevators: NonNullable<LevelDefinition['elevators']>[number][];
  readonly random: () => number;
  readonly config: Resolved;
  readonly count: (kind: string) => void;
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
  if (random() < 0.3) {
    props.push(
      make(`${id}-duct`, { at: [at[0] + width / 2 - 2.5, at[1] - depth / 2 + 2.5], bottom: top, size: [1.4, 1.2, Math.min(depth - 6, 9)], model: 'duct' }),
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
  random: () => number,
): void {
  const width = footprint * (0.66 + random() * 0.3);
  const depth = footprint * (0.6 + random() * 0.34);
  const top = band.roofs[Math.floor(random() * band.roofs.length)] ?? band.roofs[0]!;
  const id = `city-${Math.round(cx)}-${Math.round(cz)}`;

  roofKit(context, id, [cx, cz], width, depth, top);

  // A third of the blocks carry a smaller storey on the roof: the roof of one is the
  // landing for the other, which is what turns a block into a route - and it is the
  // cheapest verticality in the whole city.
  if (random() < 0.34 && width > 18) {
    const upper = top + 4 + Math.round(random() * 5);
    roofKit(context, `${id}-upper`, [cx + 1, cz - 1], width * 0.52, depth * 0.5, upper, { solar: false });
  }

  ladderUp(context, `${id}-ladder`, cx - width / 2 - 0.3, cz, top);
  balcony(context, `${id}-balcony`, cx, cz - depth / 2 - 0.9, width * 0.6, top);
}

/**
 * A tower: two or three setbacks, each a roof in its own right, and a lift.
 *
 * The setbacks are what turn a tall box into somewhere worth climbing: the roof of one
 * stage is the landing for the next, which is how a player gets up a 90 m building
 * without the lift - and the lift is there for the ones who want the top.
 */
function tower(
  context: Context,
  cx: number,
  cz: number,
  footprint: number,
  band: Band,
  random: () => number,
): void {
  const floor = context.config.groundY;
  const roof = (band.roofs[band.roofs.length - 1] ?? 30) + Math.round(random() * 26);
  const stages = 2 + Math.floor(random() * 2);
  const id = `city-${Math.round(cx)}-${Math.round(cz)}-tower`;
  /** Half the widest stage's width, which is what the shaft has to clear. */
  const footprintRate = (footprint * 0.8) / 2;

  let width = footprint * 0.8;
  let depth = footprint * 0.8;
  let top = floor;

  for (let stage = 0; stage < stages; stage += 1) {
    const stageTop = floor + (roof - floor) * ((stage + 1) / stages);
    roofKit(context, `${id}-${stage}`, [cx, cz], width, depth, stageTop, {
      solar: stage === stages - 1,
    });
    top = stageTop;
    width *= 0.78;
    depth *= 0.78;
  }
  void top;

  // Billboards on the tall ones, facing the old town, because the point of a billboard
  // is to be seen from somewhere.
  if (roof > 34 && context.random() < 0.8) {
    const facing = cz > 0 ? -1 : 1;
    const z = cz + facing * (footprint * 0.42);
    const wall = z + facing * 0.2;
    context.props.push(
      make(`${id}-billboard`, {
        at: [cx, wall],
        bottom: floor + 18,
        size: [Math.min(width * 1.2, 30), 12, 0.5],
        model: 'billboard',
        tints: { neon: BILLBOARD_COLOURS[Math.floor(context.random() * BILLBOARD_COLOURS.length)] as string },
      }),
    );
    context.count('billboard');
    context.lights.push({
      id: `${id}-glow`,
      position: { x: cx, y: floor + 24, z: wall + facing * 1.6 },
      color: '#8fd7ff',
      intensity: 14,
      distance: 26,
    });
  }

  // Balconies up one face: ledges a player can land on and use as a route.
  for (let index = 0; index < 3; index += 1) {
    balcony(context, `${id}-balcony-${index}`, cx - width - 0.4, cz, depth * 0.7, floor + 12 + index * 11);
  }

  // The lift, serving the street, two of the stage roofs and a skydeck on top.
  //
  // It stands *beside* the building rather than in it. `width` is the last stage's, which
  // is a fraction of the first, so a shaft placed off that number ends up inside the
  // building it serves - which the physics resolves by pushing whoever is in it out of a
  // solid, some fifty metres straight up.
  const liftX = cx + footprintRate + 3.2;
  const liftFloors = [floor, floor + (roof - floor) * 0.5, roof, roof + 7];
  const liftId = `${id}-lift`;
  const towerParts = liftTower({
    id: liftId,
    at: [liftX, cz],
    size: [3.4, 3.4],
    floors: liftFloors,
    names: ['Street', 'Mid', 'Roof', 'Skydeck'],
    facing: cz > 0 ? 'z-' : 'z+',
    base: floor - 6,
    tint: '#3f4a5c',
    tintDark: '#333c4a',
  });
  context.props.push(...towerParts.props);
  context.elevators.push(towerParts.elevator);
  context.count('lift');

  // ...and the skydeck it opens onto, standing *beside* the shaft rather than round it.
  //
  // A deck centred on the lift puts its own body - thirty metres of it, up from the
  // street - through every floor the car serves, and the physics then resolves a rider
  // standing inside a solid by pushing them out of it. It is a building next door, at the
  // same height, and the two roofs are one surface to walk across.
  const deckX = liftX + 10;
  context.props.push(
    make(`${liftId}-deck`, {
      at: [deckX, cz],
      bottom: roof + 7 - 0.8,
      size: [17, 0.8, 15],
      model: 'deck',
      kind: 'floor',
    }),
  );
  context.props.push(
    make(`${liftId}-deck-body`, {
      at: [deckX, cz],
      bottom: roof,
      size: [15.5, 7 - 0.8, 13.5],
      model: 'slab',
      tints: tintSet(context),
    }),
  );
  // The kit that makes a roof somewhere: arrays, a tank, an aerial.
  context.props.push(
    make(`${liftId}-deck-solar-0`, { at: [deckX - 4, cz - 4], bottom: roof + 7, size: [6.5, 1.3, 3.4], model: 'solar-panel' }),
    make(`${liftId}-deck-solar-1`, { at: [deckX + 3, cz - 4], bottom: roof + 7, size: [6.5, 1.3, 3.4], model: 'solar-panel' }),
    make(`${liftId}-deck-tank`, { at: [deckX + 5, cz + 4], bottom: roof + 7, size: [3.2, 3.4, 3.2], model: 'water-tank' }),
    make(`${liftId}-deck-mast`, { at: [deckX - 6, cz + 4], bottom: roof + 7, size: [1, 10, 1], model: 'antenna-mast' }),
  );
  context.lights.push({
    id: `${liftId}-deck-lamp`,
    position: { x: deckX, y: roof + 12, z: cz },
    color: '#9fe8ff',
    intensity: 9,
    distance: 24,
  });
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
  const width = footprint * 0.8;
  const depth = footprint * 0.8;
  const top = (band.roofs[band.roofs.length - 1] ?? 24) + 10 + Math.round(random() * 18);
  const id = `site-${Math.round(cx)}-${Math.round(cz)}`;
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
  const width = footprint * 0.86;
  const depth = footprint * 0.8;
  const wall = 0.6;
  const height = 12 + Math.round(random() * 6);
  const floor = config.groundY;
  const id = `hall-${Math.round(cx)}-${Math.round(cz)}`;
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
function laddersUp(context: Context, id: string, x: number, z: number, top: number, from: number): void {
  const span = top - from;
  if (span < 3) return;
  const length = 5;
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
}
