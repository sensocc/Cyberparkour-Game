/**
 * Player state and movement.
 *
 * V0.1 had one movement mode and V0.2 six. V0.3 added wall running and the
 * scripted traversal moves - the landing roll, the vault and the Kong vault -
 * and V0.4 adds pipe climbing, the one ability that works both ways. Rather than
 * a formal state machine they are resolved by a priority chain at the top of
 * `stepPlayer`:
 *
 *   dead -> scripted move -> hanging -> climbing -> piping -> locomotion
 *
 * A scripted move owns the body outright; wall running, sliding and the ordinary
 * gaits are all decided inside the locomotion step. *Which* mode is current is
 * not decided here at all - that is `movement.ts`, which owns the state machine
 * and the table of legal transitions.
 *
 * A manoeuvre in progress owns the player completely - input is ignored while
 * mantling, because the body is mid-move and being able to steer out of it would
 * let the player end up inside geometry. Manoeuvres therefore report when they
 * *start* and *end* through the step outcome, which is what the audio and the HUD
 * key off.
 *
 * Everything here is deterministic and free of the browser, so the whole
 * locomotion model is testable headlessly.
 */

import type { GameConfig, PlayerConfig, RollConfig, SlideConfig } from '../core/config.js';
import { clamp, damp } from '../core/math.js';
import { deriveMotionState, type MotionState } from './movement.js';
import {
  applySafetyFloor,
  clampSpeed,
  COLLISION_SKIN,
  createMoveResult,
  playerBox,
  type CollisionWorld,
  type MoveResult,
} from './physics/collision.js';
import { aabbFromCenterSize } from './physics/aabb.js';
import {
  findClimbable,
  findLedge,
  findVaultObstacle,
  findWallRunSurface,
  landingFeet,
} from './physics/ledges.js';
import {
  copyVec3,
  lerpVec3,
  lengthXZ,
  vec3,
  yawBasis,
  type ReadonlyVec3,
  type Vec3,
} from '../core/vec3.js';
import type { CheckpointDefinition, SpawnPoint } from './level/levelData.js';

/** Movement intent for one step. */
export interface MoveInput {
  /** +1 forward, -1 backward. */
  readonly forward: number;
  /** +1 right, -1 left. */
  readonly right: number;
  /** Hold to run. Ignored while crouched or sliding. */
  readonly sprint: boolean;
  /** Hold to jump; only takes effect from the ground, or as a pull-up while hanging. */
  readonly jump: boolean;
  /** Hold to crouch; releasing only stands up if there is headroom. */
  readonly crouch: boolean;
}

export const NO_INPUT: MoveInput = {
  forward: 0,
  right: 0,
  sprint: false,
  jump: false,
  crouch: false,
};

/**
 * What the player is doing, for the HUD and for tests.
 *
 * V0.4 moved this to the movement state machine; it is re-exported here because
 * that is where callers have always found it.
 */
export type Locomotion = MotionState;

export type Stance = 'standing' | 'crouched' | 'rolling';

/** Why the player died. */
export type DeathCause = 'fell' | 'impact';

/** One of the discrete moves, as reported to the audio director. */
export type ManeuverKind =
  | 'mantle'
  | 'pull-up'
  | 'climb'
  | 'slide'
  | 'hang'
  | 'roll'
  | 'vault'
  | 'kong-vault'
  | 'wall-run'
  | 'wall-jump'
  | 'pipe-grab';

/** The moves that are scripted paths rather than simulated motion. */
export type ScriptedMove = 'mantle' | 'pull-up' | 'roll' | 'vault' | 'kong-vault';

/** A scripted move from one position to another. */
export interface ManeuverMove {
  elapsed: number;
  readonly durationSeconds: number;
  readonly from: Vec3;
  readonly to: Vec3;
  /**
   * How far the path arches above the straight line between its ends.
   *
   * Zero for a roll, small for a mantle, and - for a vault - whatever it takes to
   * clear the obstacle, worked out when the move starts.
   */
  readonly arcHeight: number;
  readonly kind: ScriptedMove;
  /** Speed to leave with when the move finishes (m/s, 0 to stop dead). */
  readonly exitSpeed: number;
  /** Direction to leave in. Only read when `exitSpeed` is above zero. */
  readonly exitDirection: Vec3;
  /** True when the body must stay low for the whole move, as in a roll. */
  readonly lowProfile: boolean;
}

export interface PlayerState {
  /** Centre of the bottom face of the player box (their feet). */
  position: Vec3;
  /** Feet position at the start of the latest simulation step (for interpolation). */
  previousPosition: Vec3;
  velocity: Vec3;
  /** Facing, in radians. */
  yaw: number;
  /** Camera pitch, in radians. */
  pitch: number;
  grounded: boolean;
  /** Id of the collider the player is standing on, if any. */
  groundId: string | null;
  /** Acoustic material underfoot, for surface-aware footsteps. */
  groundSurface: string | null;
  /** True while the player is crouched. */
  crouching: boolean;
  alive: boolean;
  /** Seconds since the player died; drives the respawn delay. */
  deadFor: number;
  deaths: number;
  deathCause: DeathCause | null;
  health: number;
  sliding: boolean;
  /** Seconds spent sliding, so a slide cannot last forever. */
  slideElapsed: number;
  /** Collider the player is hanging from, if any. */
  hangId: string | null;
  /** Direction the player faced when they grabbed. */
  hangDirection: Vec3;
  /** Seconds until the same ledge can be grabbed again. */
  grabCooldown: number;
  /**
   * Whether the jump key was already down when the player grabbed a ledge.
   *
   * Without this, the jump press that got you to the ledge would also trigger the
   * pull-up on the very next step and the hang would never be visible: you would
   * have to release and press again, which is what makes grabbing feel like
   * grabbing.
   */
  jumpLatch: boolean;
  /** Collider being climbed, if any. */
  climbId: string | null;
  /** Pipe being climbed, if any. */
  pipeId: string | null;
  /** Vertical direction the player is working the pipe: +1 up, -1 down. */
  pipeDirection: number;
  /** Horizontal unit vector from the player towards the pipe. */
  pipeNormal: Vec3;
  /** Seconds until the same pipe can be grabbed again. */
  pipeCooldown: number;
  /** In-progress scripted move, if any. */
  maneuver: ManeuverMove | null;
  /** Deepest downward speed since leaving the ground, for fall damage. */
  peakFallSpeed: number;
  /** Head-bob phase in radians, advanced by distance travelled. */
  bobPhase: number;
  /** Head-bob amplitude multiplier, 0..1, faded in and out. */
  bobAmount: number;
  /**
   * Seconds since the player was last on the ground, for coyote time.
   *
   * `Infinity` closes the window, and is what a jump sets: see `updateJumpWindows`.
   */
  coyote: number;
  /** Seconds a jump press stays remembered, counting down, for the jump buffer. */
  jumpBuffer: number;
  /** The level's own spawn point, which never changes. */
  readonly spawn: { position: Vec3; yaw: number; pitch: number };
  /**
   * Where `respawnPlayer` actually sends the player: the spawn until a checkpoint
   * is reached, then that checkpoint.
   */
  readonly respawn: { position: Vec3; yaw: number; pitch: number };
  /** Index of the last checkpoint reached, or -1 for none. */
  checkpoint: number;
  /** Collider the player is running along, if any. */
  wallId: string | null;
  /** Horizontal unit vector from the player towards that wall. */
  wallNormal: Vec3;
  /** Seconds spent on the current wall run, so it cannot last forever. */
  wallRunElapsed: number;
  /** Wall that may not be used again until the cooldown expires. */
  wallJumpId: string | null;
  /** Seconds left on that lockout. */
  wallCooldown: number;
}

export interface PlayerStepOptions {
  readonly world: CollisionWorld;
  readonly config: PlayerConfig;
  /** The manoeuvre, head-bob, fall-damage and checkpoint tuning. */
  readonly game: Pick<GameConfig, 'maneuver' | 'headBob' | 'fallDamage' | 'checkpoint' | 'feel'>;
  /** Checkpoints to watch for, in route order. */
  readonly checkpoints?: readonly CheckpointDefinition[];
  /** Ids of colliders that can be climbed. */
  readonly climbableIds?: ReadonlySet<string>;
  /** Ids of colliders that are climbable pipes. */
  readonly pipeIds?: ReadonlySet<string>;
  /** Fall detection: the Y at or below which the player dies. */
  readonly killPlaneY?: number;
  /** Seconds between death and the automatic respawn. */
  readonly respawnDelaySeconds?: number;
  /** Emergency anti-void floor. Set to `-Infinity` to disable. */
  readonly safetyFloorY?: number;
}

export interface Landing {
  /** Impact speed, in m/s. */
  readonly impact: number;
  /** Health lost. */
  readonly damage: number;
  /** True when the impact was rolled off instead of taken on the feet. */
  readonly rolled: boolean;
}

export interface PlayerStepOutcome {
  readonly move: MoveResult;
  readonly died: boolean;
  readonly respawned: boolean;
  /** Set on the step the player landed after being airborne. */
  readonly landing: Landing | null;
  /** Set on the step a manoeuvre began. */
  readonly started: ManeuverKind | null;
  /** Set on the step a manoeuvre finished. */
  readonly ended: ManeuverKind | null;
  /** Index of a checkpoint reached on this step. */
  readonly checkpoint: number | null;
}

function outcome(
  move: MoveResult,
  extra: {
    died?: boolean;
    respawned?: boolean;
    landing?: Landing | null;
    started?: ManeuverKind | null;
    ended?: ManeuverKind | null;
    checkpoint?: number | null;
  } = {},
): PlayerStepOutcome {
  return {
    move,
    died: extra.died ?? false,
    respawned: extra.respawned ?? false,
    landing: extra.landing ?? null,
    started: extra.started ?? null,
    ended: extra.ended ?? null,
    checkpoint: extra.checkpoint ?? null,
  };
}

export function createPlayerState(spawn: SpawnPoint, config: GameConfig): PlayerState {
  const spawnPosition = vec3(spawn.position.x, spawn.position.y, spawn.position.z);
  const state: PlayerState = {
    position: vec3(spawnPosition.x, spawnPosition.y, spawnPosition.z),
    previousPosition: vec3(spawnPosition.x, spawnPosition.y, spawnPosition.z),
    velocity: vec3(0, 0, 0),
    yaw: spawn.yaw,
    pitch: spawn.pitch,
    grounded: false,
    groundId: null,
    groundSurface: null,
    crouching: false,
    alive: true,
    deadFor: 0,
    deaths: 0,
    deathCause: null,
    health: config.fallDamage.maxHealth,
    sliding: false,
    slideElapsed: 0,
    hangId: null,
    hangDirection: vec3(0, 0, -1),
    grabCooldown: 0,
    jumpLatch: false,
    climbId: null,
    pipeId: null,
    pipeDirection: 0,
    pipeNormal: vec3(0, 0, 0),
    pipeCooldown: 0,
    maneuver: null,
    peakFallSpeed: 0,
    bobPhase: 0,
    bobAmount: 0,
    // Closed until the player has actually stood on something: a player who starts
    // in mid-air has not "just left the ground", and must not be given a jump for
    // it. The first step on a deck opens it.
    coyote: Number.POSITIVE_INFINITY,
    jumpBuffer: 0,
    spawn: { position: spawnPosition, yaw: spawn.yaw, pitch: spawn.pitch },
    respawn: {
      position: vec3(spawnPosition.x, spawnPosition.y, spawnPosition.z),
      yaw: spawn.yaw,
      pitch: spawn.pitch,
    },
    checkpoint: -1,
    wallId: null,
    wallNormal: vec3(0, 0, 0),
    wallRunElapsed: 0,
    wallJumpId: null,
    wallCooldown: 0,
  };
  return state;
}

// ------------------------------------------------------------------ queries

/**
 * True while the body has to stay low, whether from crouching or from a move
 * that is low by nature, such as a roll.
 *
 * One predicate rather than a flag per case, so the collision box and the eye
 * height can never disagree about how tall the player currently is.
 */
function isLowProfile(state: PlayerState): boolean {
  return state.crouching || state.maneuver?.lowProfile === true;
}

export function playerHeight(state: PlayerState, config: PlayerConfig): number {
  return isLowProfile(state) ? config.crouchHeight : config.standHeight;
}

export function eyeHeight(state: PlayerState, config: PlayerConfig): number {
  return isLowProfile(state) ? config.crouchEyeHeight : config.standEyeHeight;
}

export function stance(state: PlayerState): Stance {
  if (state.maneuver?.lowProfile === true) return 'rolling';
  return state.crouching ? 'crouched' : 'standing';
}

/**
 * What the player is doing right now.
 *
 * The decision itself lives in the movement state machine; this is the thin
 * adapter that hands it the player's flags.
 */
export function locomotion(state: PlayerState): Locomotion {
  return deriveMotionState(state);
}

/**
 * The player's largest footprint, for level validation.
 *
 * Validation needs a single height, so it uses the standing height and therefore
 * validates every spawn for the worst case.
 */
export function standingSize(config: PlayerConfig): { radius: number; height: number } {
  return { radius: config.radius, height: config.standHeight };
}

// ---------------------------------------------------------------- lifecycle

/**
 * Clears every manoeuvre and returns the player to a neutral, standing pose.
 *
 * The player goes back to their *respawn* point, which is the level spawn until a
 * checkpoint has been reached, and to the facing they had when they got there.
 * Progress is kept: a respawn is a setback, not a restart.
 */
export function respawnPlayer(state: PlayerState, config?: GameConfig): void {
  copyVec3(state.position, state.respawn.position);
  copyVec3(state.previousPosition, state.respawn.position);
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.yaw = state.respawn.yaw;
  state.pitch = state.respawn.pitch;
  state.grounded = false;
  state.groundId = null;
  state.groundSurface = null;
  state.crouching = false;
  state.alive = true;
  state.deadFor = 0;
  state.deathCause = null;
  state.sliding = false;
  state.slideElapsed = 0;
  state.hangId = null;
  state.grabCooldown = 0;
  state.jumpLatch = false;
  state.climbId = null;
  state.pipeId = null;
  state.pipeDirection = 0;
  state.pipeNormal.x = 0;
  state.pipeNormal.y = 0;
  state.pipeNormal.z = 0;
  state.pipeCooldown = 0;
  state.maneuver = null;
  state.peakFallSpeed = 0;
  state.bobPhase = 0;
  state.bobAmount = 0;
  state.coyote = Number.POSITIVE_INFINITY;
  state.jumpBuffer = 0;
  state.wallId = null;
  state.wallRunElapsed = 0;
  state.wallJumpId = null;
  state.wallCooldown = 0;
  if (config) state.health = config.fallDamage.maxHealth;
}

/**
 * Full session reset: as `respawnPlayer`, and the run goes back to the start.
 *
 * That means the death count and every checkpoint reached are forgotten too,
 * which is the difference between a respawn and starting over.
 */
export function resetPlayerState(state: PlayerState, config?: GameConfig): void {
  state.checkpoint = -1;
  copyVec3(state.respawn.position, state.spawn.position);
  state.respawn.yaw = state.spawn.yaw;
  state.respawn.pitch = state.spawn.pitch;
  respawnPlayer(state, config);
  state.deaths = 0;
}

// -------------------------------------------------------------------- step

export function stepPlayer(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  if (!Number.isFinite(dt) || dt <= 0) return outcome(createMoveResult());

  if (state.grabCooldown > 0) state.grabCooldown = Math.max(0, state.grabCooldown - dt);
  if (state.wallCooldown > 0) state.wallCooldown = Math.max(0, state.wallCooldown - dt);
  if (state.pipeCooldown > 0) state.pipeCooldown = Math.max(0, state.pipeCooldown - dt);

  // While dead the player keeps falling - so the death reads as a fall rather
  // than a freeze - but no input is accepted and the death cannot re-trigger.
  if (!state.alive) {
    state.deadFor += dt;
    if (state.deadFor >= (options.respawnDelaySeconds ?? Number.POSITIVE_INFINITY)) {
      respawnPlayer(state);
      state.health = options.game.fallDamage.maxHealth;
      advanceHeadBob(state, options, dt, 0);
      return outcome(createMoveResult(), { respawned: true });
    }
    const move = stepDeadPlayer(state, dt, options);
    advanceHeadBob(state, options, dt, 0);
    return outcome(move);
  }

  // A scripted move in progress owns the body until it finishes.
  let result: PlayerStepOutcome;
  if (state.maneuver) result = stepManeuver(state, dt, options);
  else if (state.hangId) result = stepHanging(state, input, dt, options);
  else if (state.climbId) result = stepClimbing(state, input, dt, options);
  else if (state.pipeId) result = stepPiping(state, input, dt, options);
  else result = stepLocomotion(state, input, dt, options);

  // Checkpoints are watched in every mode, so passing one mid-vault counts.
  if (!state.alive) return result;
  const reached = updateCheckpoints(state, options);
  return reached === null ? result : { ...result, checkpoint: reached };
}

/**
 * Advances the respawn point when the player passes a checkpoint they have not
 * reached before.
 *
 * Only ever forwards: walking back over an earlier checkpoint does not undo it,
 * and skipping one is allowed - reaching a later roof on foot is still progress,
 * and refusing to record it would strand the player.
 */
function updateCheckpoints(state: PlayerState, options: PlayerStepOptions): number | null {
  const list = options.checkpoints;
  if (!list || list.length === 0) return null;
  const { radius, heightTolerance } = options.game.checkpoint;
  const radiusSquared = radius * radius;

  for (let index = state.checkpoint + 1; index < list.length; index += 1) {
    const point = list[index];
    if (!point) continue;
    const dx = state.position.x - point.position.x;
    const dz = state.position.z - point.position.z;
    if (dx * dx + dz * dz > radiusSquared) continue;
    if (Math.abs(state.position.y - point.position.y) > heightTolerance) continue;

    state.checkpoint = index;
    copyVec3(state.respawn.position, point.position);
    state.respawn.yaw = point.yaw ?? state.spawn.yaw;
    state.respawn.pitch = 0;
    return index;
  }
  return null;
}

// ------------------------------------------------------------- dead / manoeuvre

function stepDeadPlayer(state: PlayerState, dt: number, options: PlayerStepOptions): MoveResult {
  const { config, world } = options;
  copyVec3(state.previousPosition, state.position);

  state.velocity.x = 0;
  state.velocity.z = 0;
  state.velocity.y -= config.gravity * dt;
  if (state.velocity.y < -config.maxFallSpeed) state.velocity.y = -config.maxFallSpeed;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(box, { x: 0, y: state.velocity.y * dt, z: 0 }, state.velocity);
  adoptBox(state, box, config, move);

  if (options.safetyFloorY !== undefined && Number.isFinite(options.safetyFloorY)) {
    applySafetyFloor(state.position, state.velocity, options.safetyFloorY, state.spawn.position);
  }
  return move;
}

/**
 * Advances a mantle or a pull-up.
 *
 * The path is a straight horizontal lerp plus a vertical arc that rises above the
 * destination and settles onto it, which reads as a haul-up rather than as a
 * teleport. Collision is deliberately not applied mid-move: the destination was
 * checked for headroom before the move started, and letting the solver interfere
 * could leave the player wedged halfway up a wall.
 */
function stepManeuver(state: PlayerState, dt: number, options: PlayerStepOptions): PlayerStepOutcome {
  const maneuver = state.maneuver;
  if (!maneuver) return outcome(createMoveResult());

  copyVec3(state.previousPosition, state.position);
  maneuver.elapsed += dt;

  const raw = clamp(maneuver.elapsed / maneuver.durationSeconds, 0, 1);
  const eased = raw * raw * (3 - 2 * raw);
  lerpVec3(state.position, maneuver.from, maneuver.to, eased);
  // A single sine arch: zero at both ends, `arcHeight` at the apex.
  state.position.y += Math.sin(eased * Math.PI) * maneuver.arcHeight;

  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  state.groundId = null;
  state.groundSurface = null;

  if (raw < 1) {
    advanceHeadBob(state, options, dt, 0);
    return outcome(createMoveResult());
  }

  copyVec3(state.position, maneuver.to);
  copyVec3(state.previousPosition, maneuver.to);
  state.maneuver = null;
  state.crouching = false;
  state.grounded = true;
  state.peakFallSpeed = 0;
  // A vault carries the speed it entered with - that is the whole point of it -
  // so a move can hand momentum back rather than always ending dead.
  state.velocity.x = maneuver.exitDirection.x * maneuver.exitSpeed;
  state.velocity.z = maneuver.exitDirection.z * maneuver.exitSpeed;
  state.velocity.y = 0;

  advanceHeadBob(state, options, dt, 0);
  return outcome(createMoveResult(), { ended: maneuver.kind });
}

/** Hauling up from a hang, or letting go. */
function stepHanging(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  copyVec3(state.previousPosition, state.position);
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  advanceHeadBob(state, options, dt, 0);

  if (input.jump && !state.jumpLatch) {
    const target = climbTargetFromHang(state, options);
    if (target) {
      startLadderManeuver(state, target, 'pull-up', options);
      return outcome(createMoveResult(), { started: 'pull-up' });
    }
  }
  state.jumpLatch = input.jump;

  // Letting go drops the player clear of the face so they do not re-grab it.
  // Only an explicit drop intent counts: holding the direction that got you here
  // (which is what a player is doing) must not peel you off the wall.
  if (input.crouch || input.forward < 0) {
    state.hangId = null;
    state.grabCooldown = options.game.maneuver.pullUp.releaseCooldownSeconds;
    state.velocity.x = state.hangDirection.x * -1.2;
    state.velocity.z = state.hangDirection.z * -1.2;
    return outcome(createMoveResult(), { ended: 'hang' });
  }

  return outcome(createMoveResult());
}

/** Ascending a climbable face. */
function stepClimbing(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  const { config, world } = options;
  const climbableIds = options.climbableIds ?? new Set<string>();
  copyVec3(state.previousPosition, state.position);

  const body = playerBox(state.position, config.radius, playerHeight(state, config));
  const facing = yawBasis(state.yaw).forward;
  const surface = findClimbable({
    world,
    box: body,
    direction: facing,
    reach: options.game.maneuver.climb.reach,
    minTopY: 0,
    maxTopY: Number.POSITIVE_INFINITY,
    radius: config.radius,
    standHeight: config.standHeight,
    climbableIds,
  });

  // Lost the face - or let go - and gravity takes over.
  if (!surface || surface.id !== state.climbId || input.forward <= 0) {
    state.climbId = null;
    state.velocity.y = 0;
    return outcome(createMoveResult(), { ended: 'climb' });
  }

  const climb = options.game.maneuver.climb;
  const feetY = state.position.y;
  // Reaching the top hands over to a mantle, so climbing a riser gets you onto
  // whatever it was carrying rather than leaving you pinned to its edge.
  if (feetY + config.standHeight >= surface.box.max.y) {
    const to = landingFeet(
      {
        world,
        box: body,
        direction: facing,
        reach: climb.reach,
        minTopY: 0,
        maxTopY: Number.POSITIVE_INFINITY,
        radius: config.radius,
        standHeight: config.standHeight,
      },
      facing,
      surface.box.max.y,
    );
    state.climbId = null;
    startLadderManeuver(state, to, 'mantle', options);
    return outcome(createMoveResult(), { ended: 'climb', started: 'mantle' });
  }

  state.velocity.x = 0;
  state.velocity.z = 0;
  state.velocity.y = climb.speed;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(box, { x: 0, y: climb.speed * dt, z: 0 }, state.velocity);
  adoptBox(state, box, config, move);
  // Climbing is a controlled ascent, not a fall.
  state.peakFallSpeed = 0;
  advanceHeadBob(state, options, dt, 0);

  return outcome(move);
}

// ------------------------------------------------------------------- pipes

/** Lets go of a pipe, with the cooldown that stops an instant re-grab. */
function releasePipe(state: PlayerState, cooldownSeconds: number): void {
  state.pipeId = null;
  state.pipeDirection = 0;
  state.pipeCooldown = cooldownSeconds;
}

/**
 * Climbing a pipe.
 *
 * The one ability that works both ways: forward climbs, back or crouch works the
 * player *down* - fast, because descending a pipe is a slide - and jump kicks off
 * it. That two-way travel is the whole reason a pipe is a separate ability from a
 * climbable face, which can only ever be ascended.
 */
function stepPiping(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  const { config, world } = options;
  const pipe = options.game.maneuver.pipe;
  copyVec3(state.previousPosition, state.position);

  const id = state.pipeId;
  const collider = id === null ? undefined : world.colliders.find((entry) => entry.id === id);
  if (!collider) {
    releasePipe(state, pipe.releaseCooldownSeconds);
    return outcome(createMoveResult(), { ended: 'climb' });
  }

  // Jump kicks off the pipe: out and up, so leaving it keeps the height gained.
  if (input.jump) {
    releasePipe(state, pipe.releaseCooldownSeconds);
    state.velocity.x = -state.pipeNormal.x * pipe.kickSpeed;
    state.velocity.z = -state.pipeNormal.z * pipe.kickSpeed;
    state.velocity.y = pipe.kickUpSpeed;
    return outcome(createMoveResult(), { ended: 'climb' });
  }

  // Forward climbs, back or crouch slides down, neither holds position.
  const direction = input.crouch || input.forward < 0 ? -1 : input.forward > 0 ? 1 : 0;
  state.pipeDirection = direction;

  if (direction > 0 && state.position.y + config.standHeight >= collider.box.max.y) {
    const to = landingFeet(
      {
        world,
        box: playerBox(state.position, config.radius, playerHeight(state, config)),
        direction: state.pipeNormal,
        reach: pipe.reach,
        minTopY: 0,
        maxTopY: Number.POSITIVE_INFINITY,
        radius: config.radius,
        standHeight: config.standHeight,
      },
      state.pipeNormal,
      collider.box.max.y,
    );
    const standBox = aabbFromCenterSize(
      { x: to.x, y: to.y + config.standHeight / 2, z: to.z },
      { x: config.radius * 2, y: config.standHeight, z: config.radius * 2 },
    );
    if (world.isFree(standBox)) {
      state.pipeId = null;
      startLadderManeuver(state, to, 'mantle', options);
      return outcome(createMoveResult(), { ended: 'climb', started: 'mantle' });
    }

    // Nothing to stand on up there. Hold, so a pipe is not a way into a wall.
    state.velocity.x = 0;
    state.velocity.y = 0;
    state.velocity.z = 0;
    advanceHeadBob(state, options, dt, 0);
    return outcome(createMoveResult());
  }

  const speed = direction > 0 ? pipe.climbSpeed : direction < 0 ? -pipe.slideSpeed : 0;
  state.velocity.x = 0;
  state.velocity.z = 0;
  state.velocity.y = speed;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(box, { x: 0, y: speed * dt, z: 0 }, state.velocity);
  adoptBox(state, box, config, move);
  // Working a pipe is a controlled climb, not a fall.
  state.peakFallSpeed = 0;

  // Sliding down onto the floor lets go into ordinary locomotion.
  if (direction < 0 && move.grounded) {
    releasePipe(state, pipe.releaseCooldownSeconds);
    advanceHeadBob(state, options, dt, 0);
    return outcome(move, { ended: 'climb' });
  }

  advanceHeadBob(state, options, dt, 0);
  return outcome(move);
}

/**
 * Latches onto a pipe the player is pushing into.
 *
 * Unlike a climbable face, a pipe can be taken from the air as well as the
 * ground: the whole point of a pipe is that you can jump onto it.
 */
function tryPipe(state: PlayerState, input: MoveInput, options: PlayerStepOptions): boolean {
  const pipeIds = options.pipeIds;
  if (!pipeIds || pipeIds.size === 0) return false;
  if (state.pipeCooldown > 0) return false;

  const { config, world } = options;
  const pipe = options.game.maneuver.pipe;

  const wish = wishDirection(state, input);
  if (!wish) return false;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const surface = findClimbable({
    world,
    box,
    direction: wish,
    reach: pipe.reach,
    minTopY: pipe.minHeight,
    maxTopY: Number.POSITIVE_INFINITY,
    radius: config.radius,
    standHeight: config.standHeight,
    ignoreId: state.groundId,
    climbableIds: pipeIds,
  });
  if (!surface) return false;

  state.pipeId = surface.id;
  state.pipeDirection = 0;
  // Flush against the face that was pushed into - and only the dominant axis, so
  // a diagonal push cannot snap the player to the pipe's corner. A collision skin
  // is left on purpose: landing *exactly* on the face leaves the box overlapping
  // by a rounding error, and the solver's response to an overlap is to push the
  // player out of it - which, on the wrong axis, is straight down.
  if (Math.abs(wish.x) >= Math.abs(wish.z)) {
    state.position.x =
      flushAgainst(state.position.x, surface.box.min.x, surface.box.max.x, wish.x, config.radius) -
      wish.x * COLLISION_SKIN;
  } else {
    state.position.z =
      flushAgainst(state.position.z, surface.box.min.z, surface.box.max.z, wish.z, config.radius) -
      wish.z * COLLISION_SKIN;
  }
  copyVec3(state.pipeNormal, wish);
  copyVec3(state.previousPosition, state.position);

  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.crouching = false;
  state.sliding = false;
  state.maneuver = null;
  state.hangId = null;
  state.climbId = null;
  state.peakFallSpeed = 0;
  return true;
}

// ---------------------------------------------------------------- locomotion

/**
 * Advances the coyote and jump-buffer windows.
 *
 * One rule, two directions: the buffer is *set* by a press and counts down, and the
 * coyote window is *cleared* by the ground and counts up. A jump is allowed when
 * both are open, which is what makes "pressed just before landing" and "pressed
 * just after walking off" both work - and what makes them stop working the moment
 * the player has clearly missed their chance.
 */
function updateJumpWindows(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  feel: { coyoteSeconds: number; jumpBufferSeconds: number },
): void {
  if (state.grounded) state.coyote = 0;
  // `Infinity` is the closed window: a player who left the ground by *jumping* has
  // spent their jump, and must not be handed a second one by the same forgiveness
  // that covers stepping off a ledge. (Doubling the apex of every jump is exactly
  // what that mistake looks like.)
  else state.coyote += dt;

  // A held key keeps the buffer open, which is what makes holding jump hop on
  // every landing rather than only on the first.
  if (input.jump) state.jumpBuffer = feel.jumpBufferSeconds;
  else state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);
}

function stepLocomotion(
  state: PlayerState,
  input: MoveInput,
  dt: number,
  options: PlayerStepOptions,
): PlayerStepOutcome {
  const { config, world } = options;
  const wasGrounded = state.grounded;
  copyVec3(state.previousPosition, state.position);

  updateStance(state, input.crouch, world, config);
  const slideEvent = updateSlide(
    state,
    input,
    config,
    options.game.maneuver.slide,
    wasGrounded,
    dt,
  );
  const wallEvent = updateWallRun(state, input, options, wasGrounded, dt);
  let started: ManeuverKind | null = slideEvent.started ?? wallEvent.started;
  let ended: ManeuverKind | null = slideEvent.ended ?? wallEvent.ended;

  const basis = yawBasis(state.yaw);
  let wishX = basis.forward.x * input.forward + basis.right.x * input.right;
  let wishZ = basis.forward.z * input.forward + basis.right.z * input.right;
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength > 1e-6) {
    wishX /= wishLength;
    wishZ /= wishLength;
  } else {
    wishX = 0;
    wishZ = 0;
  }

  const inputMagnitude = Math.min(1, Math.hypot(input.forward, input.right));
  const wishSpeed = targetSpeed(state, input, config) * inputMagnitude;

  if (state.grounded) {
    const friction = state.sliding ? options.game.maneuver.slide.friction : config.groundFriction;
    applyGroundFriction(state.velocity, friction, config, dt);
  }

  if (state.sliding) {
    applySteering(state, input, config, options, dt);
  } else if (wishSpeed > 0) {
    const acceleration = state.grounded ? config.groundAcceleration : config.airAcceleration;
    const currentSpeed = state.velocity.x * wishX + state.velocity.z * wishZ;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed > 0) {
      const accelSpeed = Math.min(acceleration * wishSpeed * dt, addSpeed);
      state.velocity.x += wishX * accelSpeed;
      state.velocity.z += wishZ * accelSpeed;
    }
  }

  // The two forgiveness windows. Both are seconds, and both are reset by the thing
  // they forgive: the coyote window opens when the ground is left, and a buffered
  // press is remembered until it is spent.
  updateJumpWindows(state, input, dt, options.game.feel);

  if (state.grounded && !state.sliding && state.velocity.y < 0) state.velocity.y = 0;

  const jumpWanted = state.jumpBuffer > 0 && !state.sliding;
  const jumpAllowed = state.grounded || state.coyote <= options.game.feel.coyoteSeconds;

  if (!state.grounded && state.alive && tryWallJump(state, input, options)) {
    // A wall kick wins over a coyote jump: the player is holding a wall, and that
    // is the more specific thing they can possibly mean by pressing jump.
    started = 'wall-jump';
  } else if (jumpWanted && jumpAllowed) {
    state.velocity.y = config.jumpSpeed;
    state.jumpBuffer = 0;
    state.coyote = Number.POSITIVE_INFINITY;
  } else if (state.grounded) {
    // Standing on something and not jumping: the ground holds them up. This branch
    // has to exist even though it does nothing, because falling into the gravity
    // case below would push a standing player down through the floor every step.
  } else if (state.wallId !== null) {
    // Running a wall is still a fall, just a slow one: gravity at a fraction of
    // its strength, so a wall run carries you across a gap rather than holding
    // you up.
    state.velocity.y -= config.gravity * options.game.maneuver.wallRun.gravityScale * dt;
    if (state.velocity.y < -config.maxFallSpeed) state.velocity.y = -config.maxFallSpeed;
  } else {
    state.velocity.y -= config.gravity * dt;
    if (state.velocity.y < -config.maxFallSpeed) state.velocity.y = -config.maxFallSpeed;
  }

  clampSpeed(state.velocity, config.maxSpeed);

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const move = world.move(
    box,
    { x: state.velocity.x * dt, y: state.velocity.y * dt, z: state.velocity.z * dt },
    state.velocity,
  );
  adoptBox(state, box, config, move);

  if (options.safetyFloorY !== undefined && Number.isFinite(options.safetyFloorY)) {
    applySafetyFloor(state.position, state.velocity, options.safetyFloorY, state.spawn.position);
  }

  let landing: Landing | null = null;
  let died = false;

  if (!state.grounded) {
    state.peakFallSpeed = Math.max(state.peakFallSpeed, -state.velocity.y);
  } else if (!wasGrounded) {
    landing = applyLanding(state, input, options);
    // A hard landing can kill outright, and that death has to reach the game the
    // same way a fall off the level does. A rolled landing is still a landing, so
    // the sound and the camera feedback happen either way.
    if (!state.alive) died = true;
    if (landing.rolled) started = 'roll';
  }

  if (state.alive && !state.grounded && !state.maneuver) {
    if (tryGrab(state, input, options)) started = 'hang';
  }

  if (state.alive && state.grounded && !state.maneuver) {
    // A vault is checked first: an obstacle you can cross is one you should cross
    // rather than climb onto, and the two bands overlap by design.
    const vaulted = tryVault(state, input, options);
    if (vaulted) started = vaulted;
    else if (tryMantle(state, input, options)) started = 'mantle';
    else if (tryClimb(state, input, options)) started = 'climb';
  }

  // A pipe can be taken from the ground or the air, and is checked after the
  // ledge and wall moves so catching a ledge still wins when both are in reach.
  if (state.alive && started === null && !state.maneuver && tryPipe(state, input, options)) {
    started = 'pipe-grab';
  }

  advanceHeadBob(state, options, dt, state.grounded ? lengthXZ(state.velocity) : 0);

  if (options.killPlaneY !== undefined && state.alive && state.position.y <= options.killPlaneY) {
    killPlayer(state, 'fell');
    died = true;
  }

  return outcome(move, { landing, started, ended, died });
}

function adoptBox(
  state: PlayerState,
  box: { min: Vec3 },
  config: PlayerConfig,
  move: MoveResult,
): void {
  state.position.x = box.min.x + config.radius;
  state.position.y = box.min.y;
  state.position.z = box.min.z + config.radius;
  state.grounded = move.grounded;
  state.groundId = move.groundId;
  state.groundSurface = move.groundSurface;
}

function targetSpeed(state: PlayerState, input: MoveInput, config: PlayerConfig): number {
  if (state.crouching) return config.crouchSpeed;
  return input.sprint ? config.sprintSpeed : config.walkSpeed;
}

/**
 * Crouching is instant; standing back up requires headroom.
 *
 * Without that check the player would grow into a ceiling and end up embedded in
 * the geometry, which the solver would then have to unpick.
 */
function updateStance(
  state: PlayerState,
  wantsCrouch: boolean,
  world: CollisionWorld,
  config: PlayerConfig,
): void {
  if (wantsCrouch) {
    state.crouching = true;
    return;
  }
  if (!state.crouching) return;

  const standing = playerBox(state.position, config.radius, config.standHeight);
  if (world.isFree(standing)) state.crouching = false;
}

/**
 * Sliding: crouching at speed, on the ground, with its own low friction.
 *
 * The entry condition is a run-up, so a slide is something you commit to rather
 * than something that happens whenever you crouch. It ends on its own once the
 * friction has bled the speed off, which is what stops it needing a duration.
 */
function updateSlide(
  state: PlayerState,
  input: MoveInput,
  config: PlayerConfig,
  slide: SlideConfig,
  wasGrounded: boolean,
  dt: number,
): { started: ManeuverKind | null; ended: ManeuverKind | null } {
  const none = { started: null, ended: null };

  if (state.sliding) {
    state.slideElapsed += dt;
    const speed = lengthXZ(state.velocity);
    const stillSliding =
      state.grounded &&
      input.crouch &&
      speed >= slide.endSpeed &&
      state.slideElapsed <= slide.maxSeconds;

    if (stillSliding) return none;
    state.sliding = false;
    return { started: null, ended: 'slide' };
  }

  if (!wasGrounded || !input.crouch) return none;

  const speed = lengthXZ(state.velocity);
  if (speed < slide.minSpeed) return none;

  state.sliding = true;
  state.slideElapsed = 0;
  state.crouching = true;

  // The boost is what makes a slide worth doing; it is capped so it cannot be
  // used to exceed the sprint ceiling.
  const boosted = Math.min(speed * slide.boost, config.maxSpeed);
  const scale = boosted / speed;
  state.velocity.x *= scale;
  state.velocity.z *= scale;
  return { started: 'slide', ended: null };
}

/**
 * Steering during a slide.
 *
 * The speed is deliberately preserved: a slide is a committed direction that can
 * be bent, not a way to accelerate.
 */
function applySteering(
  state: PlayerState,
  input: MoveInput,
  config: PlayerConfig,
  options: PlayerStepOptions,
  dt: number,
): void {
  const speed = lengthXZ(state.velocity);
  if (speed <= 1e-6) return;

  if (input.right !== 0) {
    const basis = yawBasis(state.yaw);
    state.velocity.x += basis.right.x * options.game.maneuver.slide.steerAcceleration * input.right * dt;
    state.velocity.z += basis.right.z * options.game.maneuver.slide.steerAcceleration * input.right * dt;
  }

  const steerSpeed = lengthXZ(state.velocity);
  if (steerSpeed > 1e-6) {
    const target = speed;
    const scale = Math.min(1, target / steerSpeed);
    state.velocity.x *= scale;
    state.velocity.z *= scale;
  }
  void config;
}

/** Fall damage: how hard the landing was, and what it cost. */
function applyLanding(state: PlayerState, input: MoveInput, options: PlayerStepOptions): Landing {
  const fall = options.game.fallDamage;
  const impact = state.peakFallSpeed;
  state.peakFallSpeed = 0;

  if (impact <= fall.safeImpactSpeed) return { impact, damage: 0, rolled: false };

  const span = Math.max(1e-6, fall.fatalImpactSpeed - fall.safeImpactSpeed);
  const fraction = clamp((impact - fall.safeImpactSpeed) / span, 0, 1);
  let damage = fall.maxHealth * fraction;

  // A roll is the reward for landing well: it carries the impact forward instead
  // of stopping it, and takes most of the sting out. Deliberately not immunity -
  // it turns a fatal drop into a survivable one, and a survivable one into a
  // scratch, which is what makes timing it worth doing.
  const rolled = tryRoll(state, input, impact, options);
  if (rolled) damage *= options.game.maneuver.roll.damageFraction;

  state.health = Math.max(0, state.health - damage);
  if (state.health <= 0) killPlayer(state, 'impact');
  return { impact, damage, rolled };
}

/**
 * Rolls off a hard landing, if the player asked for it and there is room.
 *
 * Triggered by the crouch key, the same one that slides: both are "get low and
 * keep going", and giving the roll its own key would have been a fifth movement
 * input for one move.
 */
function tryRoll(
  state: PlayerState,
  input: MoveInput,
  impact: number,
  options: PlayerStepOptions,
): boolean {
  const { config, world } = options;
  const roll = options.game.maneuver.roll;
  if (!input.crouch || impact < roll.minImpact) return false;

  const direction = travelDirection(state, input);
  if (!direction) return false;

  const distance = rollDistance(state, direction, world, config, roll);
  if (distance === null) return false;

  startManeuver(state, {
    to: vec3(
      state.position.x + direction.x * distance,
      state.position.y,
      state.position.z + direction.z * distance,
    ),
    kind: 'roll',
    arcHeight: 0,
    durationSeconds: roll.durationSeconds,
    exitSpeed: roll.exitSpeed,
    exitDirection: direction,
    lowProfile: true,
  });
  return true;
}

/**
 * How far a roll can actually go, or null if it cannot start.
 *
 * The full distance is tried first and shortened in steps, so landing in front of
 * a crate rolls a short way instead of refusing to roll at all - or worse, rolling
 * the player into the crate.
 */
function rollDistance(
  state: PlayerState,
  direction: ReadonlyVec3,
  world: CollisionWorld,
  config: PlayerConfig,
  roll: RollConfig,
): number | null {
  for (let distance = roll.distance; distance >= roll.minDistance - 1e-6; distance -= 0.25) {
    const feet = vec3(
      state.position.x + direction.x * distance,
      state.position.y,
      state.position.z + direction.z * distance,
    );
    const box = aabbFromCenterSize(
      { x: feet.x, y: feet.y + config.crouchHeight / 2, z: feet.z },
      { x: config.radius * 2, y: config.crouchHeight, z: config.radius * 2 },
    );
    if (world.isFree(box)) return distance;
  }
  return null;
}

/**
 * Vaults a waist-high obstacle.
 *
 * Two flavours, chosen by speed and nothing else: at any real running speed a thin
 * obstacle is crossed with a plain vault, and from a sprint the same obstacle
 * becomes a Kong vault - a dive that travels further, clears lower, and keeps
 * almost all of its speed. One obstacle, two moves, decided by how fast you hit
 * it, which is exactly the skill the move is supposed to reward.
 */
function tryVault(
  state: PlayerState,
  input: MoveInput,
  options: PlayerStepOptions,
): ManeuverKind | null {
  const { config, world } = options;
  const vault = options.game.maneuver.vault;
  const direction = wishDirection(state, input);
  if (!direction) return null;

  // The move is chosen by the speed the player is carrying, not by the input, so
  // gliding over a rail slowly is a vault and sprinting at it is a Kong.
  const speed = lengthXZ(state.velocity);
  const kong = speed >= vault.kong.minSpeed;
  if (!kong && speed < vault.vault.minSpeed) return null;

  const spec = kong ? vault.kong : vault.vault;
  const landingGap = vault.landingGap + (kong ? vault.kong.distanceBonus : 0);

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const hit = findVaultObstacle({
    world,
    box,
    direction,
    reach: vault.reach,
    minTopY: state.position.y + vault.minHeight,
    maxTopY: state.position.y + vault.maxHeight,
    maxDepth: vault.maxDepth,
    landingGap,
    supportDepth: vault.supportDepth,
    radius: config.radius,
    standHeight: config.standHeight,
    ignoreId: state.groundId,
  });
  if (!hit) return null;

  // Clear the obstacle by lifting the whole path until the apex is above it. The
  // arc is computed here because only the probe knows how tall the box was.
  const midY = (state.position.y + hit.landing.y) / 2;
  const arcHeight = Math.max(0, hit.topY + spec.clearance - midY);
  const travel = travelDirection(state, input) ?? direction;

  startManeuver(state, {
    to: hit.landing,
    kind: kong ? 'kong-vault' : 'vault',
    arcHeight,
    durationSeconds: spec.durationSeconds,
    exitSpeed: speed * spec.speedRetention,
    exitDirection: travel,
  });
  return kong ? 'kong-vault' : 'vault';
}

// -------------------------------------------------------------- wall running

/**
 * Attaches to, holds onto, and lets go of a wall.
 *
 * Attaching needs air, speed *along* a wall, and a wall tall enough to be worth
 * running: a hop next to a parapet should not turn into a wall run. While
 * attached, gravity is scaled down and the player is pushed gently into the
 * wall, which is what keeps the contact that the probe needs to find it again
 * next step - without that push, the wall would flicker in and out of reach and
 * the run would stutter.
 */
function updateWallRun(
  state: PlayerState,
  input: MoveInput,
  options: PlayerStepOptions,
  wasGrounded: boolean,
  dt: number,
): { started: ManeuverKind | null; ended: ManeuverKind | null } {
  const run = options.game.maneuver.wallRun;
  const none = { started: null, ended: null };

  if (state.wallId !== null) {
    state.wallRunElapsed += dt;
    const hit = probeWall(state, input, options);
    const stillAttached =
      !state.grounded &&
      state.wallRunElapsed <= run.maxSeconds &&
      lengthXZ(state.velocity) >= run.minSpeed &&
      hit !== null &&
      hit.collider.id === state.wallId;

    if (stillAttached) {
      state.velocity.x += state.wallNormal.x * run.stickAcceleration * dt;
      state.velocity.z += state.wallNormal.z * run.stickAcceleration * dt;
      const decay = Math.max(0, 1 - run.speedDecay * dt);
      state.velocity.x *= decay;
      state.velocity.z *= decay;
      // A wall run is a controlled descent, not a fall: without this, landing
      // after a long one would hurt as though it had been a drop.
      state.peakFallSpeed = 0;
      return none;
    }

    // Hand the wall a short lockout on the way out, so the run cannot simply
    // restart on the next step and become an indefinite hover.
    state.wallJumpId = state.wallId;
    state.wallCooldown = options.game.maneuver.wallRun.reattachCooldownSeconds;
    state.wallId = null;
    return { started: null, ended: 'wall-run' };
  }

  // Attaching only happens in the air: on the ground you are just next to a wall.
  if (wasGrounded || state.grounded) return none;
  if (state.hangId !== null || state.climbId !== null || state.maneuver !== null) return none;
  if (lengthXZ(state.velocity) < run.minSpeed) return none;

  const hit = probeWall(state, input, options);
  if (!hit) return none;

  state.wallId = hit.collider.id;
  copyVec3(state.wallNormal, hit.direction);
  state.wallRunElapsed = 0;
  return { started: 'wall-run', ended: null };
}

/** The wall beside the player, honouring the wall-jump lockout. */
function probeWall(state: PlayerState, input: MoveInput, options: PlayerStepOptions) {
  const run = options.game.maneuver.wallRun;
  const travel = travelDirection(state, input);
  if (!travel) return null;

  return findWallRunSurface({
    world: options.world,
    box: playerBox(state.position, options.config.radius, playerHeight(state, options.config)),
    travel,
    reach: run.reach,
    minHeight: run.minHeight,
    ignoreId: state.groundId,
    ignoreWallId: state.wallCooldown > 0 ? state.wallJumpId : null,
  });
}

/**
 * Kicks off a wall, or off nothing if there is no wall to kick.
 *
 * The along-wall speed is kept and the outward and upward speeds are set, so
 * chaining two facing walls carries momentum instead of resetting it. The wall
 * that was used is then locked out for longer than the jump's own airtime, which
 * is what stops a player from holding jump against one wall and climbing it,
 * while leaving a second wall available immediately.
 */
function tryWallJump(state: PlayerState, input: MoveInput, options: PlayerStepOptions): boolean {
  if (!input.jump) return false;
  if (state.grounded || state.maneuver !== null || state.hangId !== null) return false;
  if (state.climbId !== null) return false;

  let normal: ReadonlyVec3 | null = state.wallId !== null ? state.wallNormal : null;
  let wallId = state.wallId;
  if (normal === null) {
    const hit = probeWall(state, input, options);
    if (!hit) return false;
    normal = hit.direction;
    wallId = hit.collider.id;
  }

  const wallJump = options.game.maneuver.wallJump;
  const into = state.velocity.x * normal.x + state.velocity.z * normal.z;
  const alongX = state.velocity.x - normal.x * into;
  const alongZ = state.velocity.z - normal.z * into;

  state.velocity.x = alongX * wallJump.keepSpeed - normal.x * wallJump.outwardSpeed;
  state.velocity.z = alongZ * wallJump.keepSpeed - normal.z * wallJump.outwardSpeed;
  state.velocity.y = wallJump.upwardSpeed;
  state.crouching = false;
  state.sliding = false;
  state.wallId = null;
  state.wallJumpId = wallId;
  state.wallCooldown = wallJump.lockoutSeconds;
  return true;
}

// ----------------------------------------------------------------- direction

/**
 * The horizontal direction the player is asking to move in, or null.
 *
 * Shared by everything that needs "which way is the player pushing this step",
 * with one threshold: a direction under 0.4 of full deflection (a diagonal tap
 * pattern or a stick drifting) does not count as intent.
 */
function wishDirection(state: PlayerState, input: MoveInput): Vec3 | null {
  const basis = yawBasis(state.yaw);
  const x = basis.forward.x * input.forward + basis.right.x * input.right;
  const z = basis.forward.z * input.forward + basis.right.z * input.right;
  const length = Math.hypot(x, z);
  if (length < 0.4) return null;
  return vec3(x / length, 0, z / length);
}

/**
 * The direction the player is actually travelling in.
 *
 * Falling back to the wish direction matters for a roll: the whole point is to
 * carry a landing forward, but a player who lands with almost no speed should
 * still roll in the direction they are holding rather than not at all.
 */
function travelDirection(state: PlayerState, input: MoveInput): Vec3 | null {
  const speed = lengthXZ(state.velocity);
  if (speed > 1) return vec3(state.velocity.x / speed, 0, state.velocity.z / speed);
  return wishDirection(state, input);
}

/** Catches a ledge that is too high to step onto. */
function tryGrab(state: PlayerState, input: MoveInput, options: PlayerStepOptions): boolean {
  if (state.grabCooldown > 0) return false;

  const { config, world } = options;
  const pullUp = options.game.maneuver.pullUp;

  // Only reach for something the player is actually heading towards.
  const wish = wishDirection(state, input);
  if (!wish) return false;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const hit = findLedge({
    world,
    box,
    direction: wish,
    reach: pullUp.reach,
    minTopY: state.position.y + pullUp.minHeight,
    maxTopY: state.position.y + pullUp.maxHeight,
    radius: config.radius,
    standHeight: config.standHeight,
    ignoreId: state.groundId,
  });
  if (!hit) return false;

  state.hangId = hit.collider.id;
  state.jumpLatch = input.jump;
  copyVec3(state.hangDirection, hit.direction);
  // Flush against the face the player pushed into - and only along that axis.
  // Snapping both axes would slide the player to the collider's corner, which
  // for a 20 m terrace means being teleported 8 m sideways.
  state.position.x = flushAgainst(
    state.position.x,
    hit.collider.box.min.x,
    hit.collider.box.max.x,
    hit.direction.x,
    config.radius,
  );
  state.position.z = flushAgainst(
    state.position.z,
    hit.collider.box.min.z,
    hit.collider.box.max.z,
    hit.direction.z,
    config.radius,
  );
  state.position.y = hit.topY - pullUp.hangDepth;
  copyVec3(state.previousPosition, state.position);
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  state.groundId = null;
  state.groundSurface = null;
  state.crouching = false;
  state.sliding = false;
  state.peakFallSpeed = 0;
  return true;
}

/** Steps up onto a ledge that is low enough not to need a jump. */
function tryMantle(state: PlayerState, input: MoveInput, options: PlayerStepOptions): boolean {
  const { config, world } = options;
  const mantle = options.game.maneuver.mantle;

  const wish = wishDirection(state, input);
  if (!wish) return false;

  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const hit = findLedge({
    world,
    box,
    direction: wish,
    reach: mantle.reach,
    minTopY: state.position.y + mantle.minHeight,
    maxTopY: state.position.y + mantle.maxHeight,
    radius: config.radius,
    standHeight: config.standHeight,
    ignoreId: state.groundId,
  });
  if (!hit) return false;

  const to = landingFeet(
    {
      world,
      box,
      direction: hit.direction,
      reach: mantle.reach,
      minTopY: 0,
      maxTopY: Number.POSITIVE_INFINITY,
      radius: config.radius,
      standHeight: config.standHeight,
    },
    hit.direction,
    hit.topY,
  );
  startLadderManeuver(state, to, 'mantle', options);
  return true;
}

/** Starts climbing a tagged face the player is pushing into. */
function tryClimb(state: PlayerState, input: MoveInput, options: PlayerStepOptions): boolean {
  const climbableIds = options.climbableIds;
  if (!climbableIds || climbableIds.size === 0) return false;
  if (input.forward <= 0) return false;

  const { config, world } = options;
  const climb = options.game.maneuver.climb;
  const box = playerBox(state.position, config.radius, playerHeight(state, config));
  const facing = yawBasis(state.yaw).forward;

  const surface = findClimbable({
    world,
    box,
    direction: facing,
    reach: climb.reach,
    minTopY: climb.minHeight,
    maxTopY: Number.POSITIVE_INFINITY,
    radius: config.radius,
    standHeight: config.standHeight,
    climbableIds,
  });
  if (!surface) return false;

  state.climbId = surface.id;
  state.crouching = false;
  state.sliding = false;
  state.velocity.x = 0;
  state.velocity.z = 0;
  state.velocity.y = 0;
  return true;
}

/** What a scripted move needs beyond its own tuning. */
interface ManeuverSpec {
  readonly to: ReadonlyVec3;
  readonly kind: ScriptedMove;
  readonly arcHeight: number;
  readonly durationSeconds: number;
  /** Speed to leave with when the move finishes. Defaults to a dead stop. */
  readonly exitSpeed?: number;
  readonly exitDirection?: ReadonlyVec3;
  /** Set for moves that stay low to the ground. */
  readonly lowProfile?: boolean;
}

function startManeuver(state: PlayerState, spec: ManeuverSpec): void {
  state.maneuver = {
    elapsed: 0,
    durationSeconds: spec.durationSeconds,
    from: { ...state.position },
    to: vec3(spec.to.x, spec.to.y, spec.to.z),
    arcHeight: spec.arcHeight,
    kind: spec.kind,
    exitSpeed: spec.exitSpeed ?? 0,
    exitDirection: vec3(spec.exitDirection?.x ?? 0, 0, spec.exitDirection?.z ?? 0),
    lowProfile: spec.lowProfile ?? false,
  };
  state.hangId = null;
  state.climbId = null;
  state.pipeId = null;
  state.sliding = false;
  state.wallId = null;
  state.grounded = false;
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
}

/**
 * Starts a mantle or pull-up from the tuning tables, which is what all three of
 * the ladder-style moves do.
 */
function startLadderManeuver(
  state: PlayerState,
  to: Vec3,
  kind: 'mantle' | 'pull-up',
  options: PlayerStepOptions,
): void {
  const config = kind === 'pull-up' ? options.game.maneuver.pullUp : options.game.maneuver.mantle;
  startManeuver(state, { to, kind, arcHeight: config.arcHeight, durationSeconds: config.durationSeconds });
}

/**
 * Places the player flush against a face along the axis they are pushing.
 *
 * `component` is the approach direction's component on this axis: a ledge is
 * grabbed along a single axis, so the other axis must be left exactly where the
 * player already was.
 */
function flushAgainst(
  centre: number,
  min: number,
  max: number,
  component: number,
  radius: number,
): number {
  if (component > 0.5) return min - radius;
  if (component < -0.5) return max + radius;
  return centre;
}

/**
 * Where the player ends up after pulling up from a hang.
 *
 * `position.y + hangDepth` is the ledge top, so the target is one collision skin
 * above it - the same convention the mantle uses.
 */
function climbTargetFromHang(state: PlayerState, options: PlayerStepOptions): Vec3 | null {
  const pullUp = options.game.maneuver.pullUp;
  return vec3(
    state.position.x + state.hangDirection.x * (pullUp.reach + options.config.radius),
    state.position.y + pullUp.hangDepth + COLLISION_SKIN,
    state.position.z + state.hangDirection.z * (pullUp.reach + options.config.radius),
  );
}

// ---------------------------------------------------------------- head bob

/**
 * Advances the head bob.
 *
 * The phase is driven by *distance travelled*, not by time, so the cadence rises
 * with speed without needing a separate timer, and it stays identical at any
 * frame rate.
 */
export function advanceHeadBob(
  state: PlayerState,
  options: Pick<PlayerStepOptions, 'game' | 'config'>,
  dt: number,
  travelled: number,
): void {
  const bob = options.game.headBob;
  const moving = travelled > 0.001 && state.grounded && !state.sliding && state.maneuver === null;

  if (moving) {
    const stride = state.crouching ? bob.strideLength.crouch : bob.strideLength.walk;
    const speed = lengthXZ(state.velocity);
    const sprinting = speed > options.config.walkSpeed * 1.02;
    const length = sprinting ? bob.strideLength.sprint : stride;
    state.bobPhase = (state.bobPhase + (travelled / length) * Math.PI * 2) % (Math.PI * 2);
  }

  // `damp` takes a *fraction* of the remaining distance per second, while the
  // config states a rate constant in 1/s, so the rate is converted here. Passing
  // the rate constant straight through - which is what this did - clamps anything
  // above 1 to 1, and 1 means "arrive immediately": the bob was snapping on and
  // off at every start and stop rather than fading, which was most of what made
  // it feel like being jolted.
  state.bobAmount = damp(state.bobAmount, moving ? 1 : 0, 1 - Math.exp(-bob.settleRate), dt);
}

/**
 * How much of the head bob's full amplitude to apply at the current speed.
 *
 * The bob's frequency scales with speed but its amplitude should not: without
 * this, sprinting shakes the camera half again as fast at the same throw.
 */
export function headBobAmplitudeScale(state: PlayerState, config: GameConfig): number {
  const { walkSpeed, sprintSpeed } = config.player;
  const speed = lengthXZ(state.velocity);
  const span = Math.max(1e-6, sprintSpeed - walkSpeed);
  const t = clamp((speed - walkSpeed) / span, 0, 1);
  return 1 - (1 - config.headBob.speedFalloff) * t;
}

/**
 * The camera's world-space offset from the head bob.
 *
 * Two vertical bobs per stride (one per foot) and one lateral sway, which is what
 * makes a walk read as a walk rather than as a bounce. Both are scaled by how far
 * into the fade the bob is and by the speed falloff above.
 */
export function headBobOffset(
  state: PlayerState,
  config: GameConfig,
  out: Vec3 = vec3(),
): Vec3 {
  const bob = config.headBob;
  const amount = state.bobAmount * headBobAmplitudeScale(state, config);
  const basis = yawBasis(state.yaw);
  const lateral = Math.sin(state.bobPhase) * bob.lateralAmplitude * amount;

  out.x = basis.right.x * lateral;
  out.y = Math.sin(state.bobPhase * 2) * bob.verticalAmplitude * amount;
  out.z = basis.right.z * lateral;
  return out;
}

/** Eye (camera) position, including the head bob. */
export function eyePosition(
  state: PlayerState,
  config: GameConfig,
  out: Vec3 = vec3(),
  interpolatedFeet: ReadonlyVec3 = state.position,
): Vec3 {
  const offset = headBobOffset(state, config);
  out.x = interpolatedFeet.x + offset.x;
  out.y = interpolatedFeet.y + eyeHeight(state, config.player) + offset.y;
  out.z = interpolatedFeet.z + offset.z;
  return out;
}

/**
 * Interpolated feet position between the previous and current simulation step.
 *
 * `alpha` comes from the fixed-step accumulator; feeding it to the renderer keeps
 * motion smooth on displays whose refresh rate is not a multiple of the tick rate.
 */
export function interpolatePlayerPosition(
  state: PlayerState,
  alpha: number,
  out: Vec3 = vec3(),
): Vec3 {
  return lerpVec3(out, state.previousPosition, state.position, alpha);
}

export function horizontalSpeed(state: PlayerState): number {
  return lengthXZ(state.velocity);
}

export function speed(state: PlayerState): number {
  const { x, y, z } = state.velocity;
  return Math.hypot(x, y, z);
}

function killPlayer(state: PlayerState, cause: DeathCause): void {
  state.alive = false;
  state.deadFor = 0;
  state.deaths += 1;
  state.deathCause = cause;
  state.health = 0;
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  state.groundId = null;
  state.groundSurface = null;
  state.sliding = false;
  state.hangId = null;
  state.climbId = null;
  state.maneuver = null;
}

function applyGroundFriction(
  velocity: Vec3,
  friction: number,
  config: PlayerConfig,
  dt: number,
): void {
  const magnitude = Math.hypot(velocity.x, velocity.z);
  if (magnitude <= 1e-6) {
    velocity.x = 0;
    velocity.z = 0;
    return;
  }

  const control = Math.max(magnitude, config.stopSpeed);
  const drop = control * friction * dt;
  const scale = Math.max(magnitude - drop, 0) / magnitude;
  velocity.x *= scale;
  velocity.z *= scale;
}

export interface PlayerSnapshot {
  readonly position: ReadonlyVec3;
  readonly velocity: ReadonlyVec3;
  readonly speed: number;
  readonly horizontalSpeed: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly grounded: boolean;
  readonly groundId: string | null;
  /** Acoustic material underfoot, for surface-aware footsteps. */
  readonly groundSurface: string | null;
  readonly stance: Stance;
  readonly alive: boolean;
  readonly deaths: number;
  readonly deathCause: DeathCause | null;
  readonly health: number;
  readonly locomotion: Locomotion;
  /** Index of the last checkpoint reached, or -1 for none. */
  readonly checkpoint: number;
}

export function snapshotPlayer(state: PlayerState): PlayerSnapshot {
  return {
    position: { x: state.position.x, y: state.position.y, z: state.position.z },
    velocity: { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z },
    speed: speed(state),
    horizontalSpeed: horizontalSpeed(state),
    yaw: state.yaw,
    pitch: state.pitch,
    grounded: state.grounded,
    groundId: state.groundId,
    groundSurface: state.groundSurface,
    stance: stance(state),
    alive: state.alive,
    deaths: state.deaths,
    deathCause: state.deathCause,
    health: state.health,
    locomotion: locomotion(state),
    checkpoint: state.checkpoint,
  };
}
