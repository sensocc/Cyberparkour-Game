/**
 * Every ladder in the city, climbed.
 *
 * The movement suite proves the climbing *state machine* on a purpose-built ladder. This proves
 * the ladder the generator actually placed: that a player standing at its foot, holding forward,
 * reaches the top of it.
 *
 * **Why it exists.** Three separate faults made roughly two ladders in three unusable in V2.0.1,
 * and none of them was visible to a test that only knew about one idealized ladder:
 *
 *  - the hand-over to a mantle compared the head against the section's top exactly, and the
 *    collision skin keeps the head a millimetre below it, so the condition could never hold and
 *    the player stuck on the last rung with the climb still held;
 *  - a fire escape was built across the front ladder's climb column, so the body could not rise
 *    past it - and being blocked while climbing had no exit at all, so the player hung there;
 *  - construction-site ladders ended at a height with no surface beside them to stand on, so the
 *    hand-over had nothing to hand over *to*.
 *
 * The measurement is the move itself: forty feet on a fixed step, forward held, in the real
 * collision world. A ladder counts as climbed when the feet reach its top section's upper face.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, fixedStep } from '../../src/core/config.js';
import { buildCity } from '../../src/game/level/city.js';
import { buildLevel, climbableIds } from '../../src/game/level/level.js';
import { DEMO_DISTRICT } from '../fixtures/district.js';
import type { PropDefinition } from '../../src/game/level/levelData.js';
import { createPlayerState, stepPlayer, type PlayerState } from '../../src/game/player.js';

const STEP = fixedStep(DEFAULT_CONFIG);
const RADIUS = DEFAULT_CONFIG.player.radius;
const HEIGHT = DEFAULT_CONFIG.player.standHeight;

/**
 * One ladder stack, as the generator left it.
 *
 * A ladder is several colliders - one per section - sharing an id prefix and a vertical line, so
 * a "ladder" here is the set of props whose ids differ only in their trailing section number.
 */
interface LadderStack {
  readonly id: string;
  readonly sections: readonly PropDefinition[];
  /** Underside of the lowest section. */
  readonly footY: number;
  /** Upper face of the highest section. */
  readonly topY: number;
}

/** Groups the ladder props into stacks by their trailing `-<section>` number. */
function ladderStacks(props: readonly PropDefinition[]): LadderStack[] {
  const groups = new Map<string, PropDefinition[]>();
  for (const prop of props) {
    if (prop.model !== 'ladder') continue;
    const id = prop.id.replace(/-\d+$/, '');
    const existing = groups.get(id);
    if (existing) existing.push(prop);
    else groups.set(id, [prop]);
  }

  return [...groups.entries()].map(([id, sections]) => ({
    id,
    sections,
    footY: Math.min(...sections.map((prop) => prop.position.y - prop.size.y / 2)),
    topY: Math.max(...sections.map((prop) => prop.position.y + prop.size.y / 2)),
  }));
}

/** Yaw whose forward vector is `(x, z)` - see `intoYawBasis`. */
function yawFacing(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

/**
 * The highest surface under a point that is **not a ladder**.
 *
 * `groundHeightAt` answers for every prop, and a ladder is a prop: asking it where the ground is
 * beside a ladder returns the top of the ladder, which would spawn the player at the summit and
 * call the climb a success before it started.
 */
function standingHeight(
  city: typeof DEMO_DISTRICT,
  x: number,
  z: number,
  maxTop = Number.POSITIVE_INFINITY,
): number | null {
  let best: number | null = null;
  for (const prop of city.props) {
    if (prop.model === 'ladder') continue;
    const box = {
      minX: prop.position.x - prop.size.x / 2,
      maxX: prop.position.x + prop.size.x / 2,
      minZ: prop.position.z - prop.size.z / 2,
      maxZ: prop.position.z + prop.size.z / 2,
      top: prop.position.y + prop.size.y / 2,
    };
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
    if (box.top > maxTop) continue;
    if (best === null || box.top > best) best = box.top;
  }
  return best;
}

/**
 * The four sides a player can approach a ladder from.
 *
 * A ladder section is wider than it is deep (1.1 m by 0.35 m), so the two faces of the *long*
 * side are the intended ways on. Both are tried because neither the generator nor the model says
 * which way a given ladder faces, and either one working makes the ladder climbable.
 */
const APPROACHES: readonly { readonly x: number; readonly z: number }[] = [
  { x: 0, z: 1 },
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: -1, z: 0 },
];

/**
 * How far from the section's centre line a player stands to face it.
 *
 * **Measured from the face, not from the centre.** A ladder section is 1.1 m wide and 0.35 m deep,
 * so the distance a body has to stand back differs by a factor of three between the two pairs of
 * faces - and a fixed offset either overlaps the wide face or leaves a gap on the narrow one. The
 * probe stands where a player would stand: clear of the face by the body's own radius.
 */
function standOffFor(stack: LadderStack, approach: { readonly x: number; readonly z: number }): number {
  const first = stack.sections[0] as PropDefinition;
  const halfDepth = approach.x === 0 ? first.size.z / 2 : first.size.x / 2;
  return halfDepth + RADIUS + 0.05;
}

interface ClimbResult {
  /** Highest feet position reached. */
  readonly highest: number;
  /** Whether the climb state was ever entered. */
  readonly grabbed: boolean;
}

/**
 * Climbs one ladder from one side, holding forward until the feet reach the top.
 *
 * The player starts on whatever surface is actually under them, rather than at the ladder's own
 * foot: a ladder on a construction site begins forty metres below the street it stands over, and
 * spawning at the foot of it would test a fall rather than a climb.
 */
function climb(
  stack: LadderStack,
  approach: { readonly x: number; readonly z: number },
  options: Parameters<typeof stepPlayer>[3],
  definition: typeof DEMO_DISTRICT,
): ClimbResult | null {
  const first = stack.sections[0] as PropDefinition;
  const standOff = standOffFor(stack, approach);
  const x = first.position.x - approach.x * standOff;
  const z = first.position.z - approach.z * standOff;

  // The bottom of the ladder, plus a couple of metres: whatever the player would walk up to.
  const ground = standingHeight(definition, x, z, stack.footY + 0.05);
  if (ground === null) return null;

  const spawn = { position: { x, y: ground + 0.02, z }, yaw: yawFacing(approach.x, approach.z), pitch: 0 };
  const state: PlayerState = createPlayerState(spawn, DEFAULT_CONFIG);

  // A player cannot stand where the geometry already is. Asking before spawning keeps the test
  // about the ladder rather than about a body wedged in a wall.
  if (
    !options.world.isFree({
      min: { x: x - RADIUS, y: spawn.position.y + 0.05, z: z - RADIUS },
      max: { x: x + RADIUS, y: spawn.position.y + HEIGHT - 0.05, z: z + RADIUS },
    })
  ) {
    return null;
  }

  const input = { forward: 1, right: 0, sprint: false, jump: false, crouch: false };
  let highest = state.position.y;
  let grabbed = false;

  // Climb speed is 2.4 m/s, so a forty-metre ladder is a thousand steps. The ceiling here is the
  // longest ladder in the city plus room to overshoot; the loop leaves as soon as the top is met.
  for (let step = 0; step < 1600; step += 1) {
    stepPlayer(state, input, STEP, options);
    highest = Math.max(highest, state.position.y);
    if (state.climbId !== null) grabbed = true;
    if (highest >= stack.topY - 0.05) break;
  }

  return { highest, grabbed };
}

describe('the ladders the generator builds', () => {
  const city = buildCity(DEMO_DISTRICT);
  const built = buildLevel(city, {
    maxSubStep: DEFAULT_CONFIG.world.maxCollisionSubStep,
    player: { radius: RADIUS, height: HEIGHT },
  });
  const climbables = climbableIds(built.colliders);
  const options = {
    world: built.world,
    config: DEFAULT_CONFIG.player,
    game: DEFAULT_CONFIG,
    climbableIds: climbables,
    pipeIds: new Set<string>(),
    checkpoints: [],
    killPlaneY: Number.NEGATIVE_INFINITY,
    respawnDelaySeconds: DEFAULT_CONFIG.respawn.delaySeconds,
    safetyFloorY: Number.NEGATIVE_INFINITY,
  };
  const stacks = ladderStacks(city.props);

  /**
   * Every stack a player can actually stand at, and the best height reached on it.
   *
   * The best of the four sides is the number that matters: a ladder is climbable if *a* player in
   * front of it can climb it.
   */
  const results = stacks.map((stack) => {
    let best: ClimbResult | null = null;
    for (const approach of APPROACHES) {
      const result = climb(stack, approach, options, city);
      if (result === null) continue;
      if (best === null || result.highest > best.highest) best = result;
      if (best.highest >= stack.topY - 0.05) break;
    }
    return { stack, best };
  });

  /** Ladders with reachable standing room at the foot. */
  const reachable = results.filter((entry): entry is { stack: LadderStack; best: ClimbResult } => entry.best !== null);

  /**
   * A readable line per ladder that could not be climbed, short enough to fit in a failure.
   *
   * Names what happened rather than how far it got: "grabbed and stopped" and "never grabbed" are
   * different bugs, and a bare height does not say which.
   */
  const survivors = reachable
    .filter(({ stack, best }) => best.highest < stack.topY - 0.05)
    .map(
      ({ stack, best }) =>
        `${stack.id}: ${best.highest.toFixed(1)} of ${stack.topY.toFixed(1)} m` +
        (best.grabbed ? ' (grabbed, then stopped)' : ' (never grabbed)'),
    );

  it('finds a city full of them, so the checks below mean something', () => {
    expect(stacks.length).toBeGreaterThan(300);
    expect(reachable.length).toBeGreaterThan(300);
  });

  it('climbs every ladder that a player can stand in front of', () => {
    // **The regression.** Two thirds of the city's ladders failed this in V2.0.2's predecessor:
    // the top-of-ladder hand-over was unreachable by a millimetre, a fire escape crossed the
    // climb column, and a site ladder ended at a height with nothing beside it. This is the
    // measurement that says they climb, in the only terms that matter - feet on the top.
    expect(survivors).toEqual([]);
  });

  it('starts every ladder at the ground under it, not in the air', () => {
    // A ladder whose bottom section begins above the surface it is fixed to is a ladder with a
    // gap at the foot: the player walks into the wall underneath it and climbs nothing.
    const floats = stacks
      .filter((stack) => {
        const first = stack.sections[0] as PropDefinition;
        const ground = standingHeight(city, first.position.x, first.position.z);
        return ground !== null && stack.footY > ground + 1;
      })
      .map((stack) => `${stack.id}: foot at ${stack.footY.toFixed(1)}`);
    expect(floats).toEqual([]);
  });

  it('climbs the tallest ones, where the hand-over has the most to lose', () => {
    // **The shape of the failure, as a number.** Every fault V2.0.2 fixed got worse with height:
    // the one-millimetre shortfall stranded the player on the last rung of every long climb, and a
    // blocked column capped it wherever the obstruction happened to be. A short ladder could pass
    // by accident; a forty-metre one could not. So the tall half of the city is asserted on its
    // own - if the hand-over regresses, this is the test that says so first and says the height.
    const tallest = [...reachable]
      .sort((a, b) => b.stack.topY - b.stack.footY - (a.stack.topY - a.stack.footY))
      .slice(0, 40);
    const stranded = tallest
      .filter(({ stack, best }) => best.highest < stack.topY - 0.05)
      .map(({ stack, best }) => `${stack.id}: ${best.highest.toFixed(1)} of ${stack.topY.toFixed(1)} m`);
    expect(tallest.length).toBe(40);
    expect(stranded).toEqual([]);
  });
});
