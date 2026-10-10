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
    return { roofs: [22, 24.2, 26.4, 28.6, 30.8, 33], construction: 0.14, hall: 0.16 };
  }
  if (distance < 320) {
    return { roofs: [14, 16.2, 18.4, 20.6, 22.8, 25], construction: 0.18, hall: 0.12 };
  }
  return { roofs: [8, 10.2, 12.4, 14.6, 16.8, 19], construction: 0.12, hall: 0.08 };
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
  /** Every building placed, in the order it was placed. */
  const buildings: Building[] = [];
  const report = new Map<string, number>();
  const count = (kind: string): void => {
    report.set(kind, (report.get(kind) ?? 0) + 1);
  };

  const [keepX0, keepX1, keepZ0, keepZ1] = config.keepClear;
  const half = config.pitch / 2;
  /**
   * The building on each plot, by plot.
   *
   * The infill pass walks this rather than the props: after the main loop there are
   * forty thousand props and no way to tell a wall from a walkway, and the one thing
   * that matters is which masses face which.
   */
  const plots = new Map<string, Building>();
  const plotKey = (gx: number, gz: number): string => `${gx}|${gz}`;

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
      const context = { props, lights, elevators, buildings, random, config, count, plots, gx, gz };

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
  const reachUp = crossingRise(DEFAULT_CONFIG);
  const filler = { props, lights, random, config, count };
  for (const building of [...plots.values()]) {
    for (const [dx, dz] of [
      [config.pitch, 0],
      [0, config.pitch],
    ] as const) {
      const other = plots.get(plotKey(building.gx + dx, building.gz + dz));
      if (!other) continue;

      // The gap between the two masses, and the stretch of wall they share. A pair that
      // does not overlap on the other axis is not a gap between buildings - it is a
      // corner, and there is nothing to fill.
      const [near, far] = dx !== 0 ? [building, other] : [building, other];
      const along = dx !== 0
        ? far.cx - far.halfX - (near.cx + near.halfX)
        : far.cz - far.halfZ - (near.cz + near.halfZ);
      if (along <= jumpGap) continue;

      const overlap0 = dx !== 0
        ? Math.max(near.cz - near.halfZ, far.cz - far.halfZ)
        : Math.max(near.cx - near.halfX, far.cx - far.halfX);
      const overlap1 = dx !== 0
        ? Math.min(near.cz + near.halfZ, far.cz + far.halfZ)
        : Math.min(near.cx + near.halfX, far.cx + far.halfX);
      if (overlap1 - overlap0 < 4) continue;

      // Inside the gap, with a jump's width left over at each end.
      const margin = Math.min(jumpGap * 0.8, along / 3);
      const span = along - margin * 2;
      const centre = (dx !== 0 ? near.cx + near.halfX : near.cz + near.halfZ) + margin + span / 2;
      const cx = dx !== 0 ? centre : (near.cx + far.cx) / 2;
      const cz = dx !== 0 ? (overlap0 + overlap1) / 2 : centre;
      const width = dx !== 0 ? span : (overlap1 - overlap0) * 0.86;
      const depth = dx !== 0 ? (overlap1 - overlap0) * 0.86 : span;
      if (Math.min(width, depth) < 3.5) continue;

      const roof = Math.max(near.roof, far.roof) - reachUp * 0.7;
      infill(filler, cx, cz, width, depth, roof);
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
type InfillContext = Pick<Context, 'props' | 'lights' | 'random' | 'config' | 'count'>;

/** Picks what this one is made of, and counts the answer. */
function infillKit(context: InfillContext): readonly InfillKit[] {
  const wanted = 3 + Math.floor(context.random() * 3);
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
  const id = `fill-${Math.round(cx)}-${Math.round(cz)}-${Math.round(roof)}`;
  const kit = infillKit(context);

  roofKit(context, id, [cx, cz], width, depth, roof, { solar: false });
  ladderUp(context, `${id}-ladder`, cx - width / 2 - 0.3, cz, roof);
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
  random: () => number,
): void {
  // A block fills its plot. It used to take two thirds of it, which left forty metres of
  // nothing between one building and the next - wide enough to read as a city from the
  // air and far too wide to cross on foot, and the reason V0.7's streets were a place you
  // looked at rather than a route.
  const width = footprint * (1.62 + random() * 0.2);
  const depth = footprint * (1.58 + random() * 0.24);
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
): void {
  const span = top - from;
  if (span < 3) return;
  // Seven metres rather than five: the rungs are part of the model, so a longer section
  // spaces them further apart - 70 cm instead of 50, which still reads as a ladder - and
  // every section is a prop. V0.7.2's buildings are twice as tall and there are twice as
  // many of them, and this is a third of the city's props.
  const length = 7;
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
