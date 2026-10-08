/**
 * The audio director.
 *
 * This is the part of the audio system worth testing exactly: a walking cadence
 * that tracks distance rather than time, a wind level that follows falling speed,
 * and the discrete events. The engine only turns its cues into sound.
 */

import { describe, expect, it } from 'vitest';

import { AudioDirector, type AudioCue, type Gait } from '../../src/audio/director.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { vec3 } from '../../src/core/vec3.js';
import { createPlayerState, stepPlayer, type PlayerState } from '../../src/game/player.js';
import { CONFIG, FLOOR, input, ON_DECK, optionsFor, world } from '../helpers/player.js';

const STEP = 1 / DEFAULT_CONFIG.world.tickRate;

const kinds = (cues: readonly AudioCue[]): string[] => cues.map((cue) => cue.kind);

const footstepGaits = (cues: readonly AudioCue[]): Gait[] =>
  cues.flatMap((cue) => (cue.kind === 'footstep' ? [cue.gait] : []));

describe('discrete events', () => {
  it('queues a pushed cue for the next frame, then clears it', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    director.push({ kind: 'grab' });

    const state = createPlayerState(ON_DECK, CONFIG);
    expect(kinds(director.update(state, STEP).cues)).toEqual(['grab']);
    expect(director.update(state, STEP).cues).toEqual([]);
  });

  it('reports a manoeuvre start and end', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    director.maneuverStart('slide');
    const state = createPlayerState(ON_DECK, CONFIG);
    expect(kinds(director.update(state, STEP).cues)).toEqual(['slide-start']);

    director.maneuverEnd('slide');
    expect(kinds(director.update(state, STEP).cues)).toEqual(['slide-stop']);
  });

  it('maps each manoeuvre to the right cue', () => {
    for (const [kind, expected] of [
      ['hang', 'grab'],
      ['pull-up', 'pull-up'],
      ['mantle', 'mantle'],
      ['slide', 'slide-start'],
    ] as const) {
      const director = new AudioDirector(DEFAULT_CONFIG);
      director.maneuverStart(kind);
      const state = createPlayerState(ON_DECK, CONFIG);
      expect(kinds(director.update(state, STEP).cues)).toEqual([expected]);
    }
  });

  it('gives a hard landing a heavier sample and a hurt cue', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);

    director.landing(DEFAULT_CONFIG.fallDamage.safeImpactSpeed + 1, 0);
    expect(director.update(state, STEP).cues).toEqual([{ kind: 'land', intensity: 0 }]);

    director.landing(DEFAULT_CONFIG.fallDamage.fatalImpactSpeed, 40);
    const cues = director.update(state, STEP).cues;
    expect(cues[0]).toEqual({ kind: 'land', intensity: 2 });
    expect(cues[1]).toEqual({ kind: 'hurt', damage: 40 });
  });

  it('gives an easy landing the plainest sample', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    // A hop off a kerb: well under the safe impact speed.
    director.landing(4, 0);
    const state = createPlayerState(ON_DECK, CONFIG);
    expect(director.update(state, STEP).cues).toEqual([{ kind: 'land', intensity: 0 }]);
  });
});

describe('the footstep cadence', () => {
  it('fires on distance travelled, so a faster gait steps faster', () => {
    const slow = new AudioDirector(DEFAULT_CONFIG);
    const fast = new AudioDirector(DEFAULT_CONFIG);

    const slowState = createPlayerState(ON_DECK, CONFIG);
    const fastState = createPlayerState(ON_DECK, CONFIG);

    let slowSteps = 0;
    let fastSteps = 0;
    for (let step = 0; step < 240; step += 1) {
      slowState.velocity = vec3(0, 0, -DEFAULT_CONFIG.player.walkSpeed);
      slowState.grounded = true;
      slowState.crouching = false;
      slowSteps += kinds(slow.update(slowState, STEP).cues).filter((kind) => kind === 'footstep').length;

      fastState.velocity = vec3(0, 0, -DEFAULT_CONFIG.player.sprintSpeed);
      fastState.grounded = true;
      fastSteps += kinds(fast.update(fastState, STEP).cues).filter((kind) => kind === 'footstep').length;
    }

    expect(slowSteps).toBeGreaterThan(1);
    expect(fastSteps).toBeGreaterThan(slowSteps);
  });

  it('names the gait of each step', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    const cues: AudioCue[] = [];

    for (const [gait, speed] of [
      ['walk', DEFAULT_CONFIG.player.walkSpeed],
      ['sprint', DEFAULT_CONFIG.player.sprintSpeed],
      ['crouch', DEFAULT_CONFIG.player.crouchSpeed],
    ] as const) {
      state.velocity = vec3(0, 0, -speed);
      state.grounded = true;
      state.crouching = gait === 'crouch';
      for (let step = 0; step < 40; step += 1) cues.push(...director.update(state, STEP).cues);
      expect(footstepGaits(cues), gait).toContain(gait);
    }
  });

  it('names the surface underfoot, so a deck and a roof do not sound alike', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    const seen = new Set<string>();

    for (const surface of ['metal', 'concrete', 'grate', 'glass'] as const) {
      state.groundSurface = surface;
      state.velocity = vec3(0, 0, -DEFAULT_CONFIG.player.walkSpeed);
      state.grounded = true;
      state.crouching = false;
      for (let step = 0; step < 40; step += 1) {
        for (const cue of director.update(state, STEP).cues) {
          if (cue.kind === 'footstep') seen.add(cue.surface);
        }
      }
      expect(seen, surface).toContain(surface);
    }
  });

  it('falls back to concrete when the surface is missing or nonsense', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    const surfaces = (): string[] => {
      const found: string[] = [];
      state.velocity = vec3(0, 0, -DEFAULT_CONFIG.player.walkSpeed);
      state.grounded = true;
      for (let step = 0; step < 40; step += 1) {
        for (const cue of director.update(state, STEP).cues) {
          if (cue.kind === 'footstep') found.push(cue.surface);
        }
      }
      return found;
    };

    state.groundSurface = null;
    expect(new Set(surfaces())).toEqual(new Set(['concrete']));

    // A collider carries a plain string, so the director validates it rather than
    // trusting it.
    state.groundSurface = 'cheese';
    expect(new Set(surfaces())).toEqual(new Set(['concrete']));
  });

  it('scrapes while sliding down a pipe and ticks while climbing one', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    const count = (kind: string, pipes: number, steps: number): number => {
      state.pipeId = 'pipe';
      state.pipeDirection = pipes;
      let total = 0;
      for (let step = 0; step < steps; step += 1) {
        total += kinds(director.update(state, STEP).cues).filter((entry) => entry === kind).length;
      }
      return total;
    };

    expect(count('climb-tick', 1, 60)).toBeGreaterThan(0);
    expect(count('scrape', -1, 60)).toBeGreaterThan(0);
  });

  it('steps immediately after landing rather than waiting for a whole stride', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);

    // Airborne, accumulating no steps.
    state.grounded = false;
    for (let step = 0; step < 30; step += 1) director.update(state, STEP);

    state.grounded = true;
    state.velocity = vec3(0, 0, -DEFAULT_CONFIG.player.walkSpeed);
    expect(kinds(director.update(state, STEP).cues)).toContain('footstep');
  });

  it('does not step while airborne, hanging or mantling', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    state.velocity = vec3(0, 0, -DEFAULT_CONFIG.player.walkSpeed);

    for (const setup of [
      () => {
        state.grounded = false;
      },
      () => {
        state.grounded = true;
        state.hangId = 'ledge';
      },
      () => {
        state.hangId = null;
        state.maneuver = {
          elapsed: 0,
          durationSeconds: 1,
          from: vec3(),
          to: vec3(),
          arcHeight: 0,
          kind: 'mantle',
          exitSpeed: 0,
          exitDirection: vec3(),
          lowProfile: false,
        };
      },
    ]) {
      director.reset();
      setup();
      let steps = 0;
      for (let step = 0; step < 40; step += 1) {
        steps += kinds(director.update(state, STEP).cues).filter((kind) => kind === 'footstep').length;
      }
      expect(steps).toBe(0);
    }
  });
});

describe('continuous sound', () => {
  it('reports no wind while grounded', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    state.grounded = true;
    expect(director.update(state, STEP).windIntensity).toBe(0);
  });

  it('scales the wind with falling speed', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);

    state.grounded = false;
    state.velocity = vec3(0, -12, 0);
    const slow = director.update(state, STEP).windIntensity;

    state.velocity = vec3(0, -50, 0);
    const fast = director.update(state, STEP).windIntensity;

    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThanOrEqual(1);
  });

  it('drops the wind when the fall is caught', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    state.grounded = false;
    state.velocity = vec3(0, -50, 0);
    expect(director.update(state, STEP).windIntensity).toBeGreaterThan(0.5);

    // Hauling onto a ledge stops the noise immediately.
    state.hangId = 'ledge';
    expect(director.update(state, STEP).windIntensity).toBe(0);
  });

  it('gusts only once the fall is real', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    state.grounded = false;

    state.velocity = vec3(0, -10, 0);
    let gentle = 0;
    for (let step = 0; step < 60; step += 1) {
      gentle += kinds(director.update(state, STEP).cues).filter((kind) => kind === 'gust').length;
    }

    director.reset();
    state.velocity = vec3(0, -55, 0);
    let fast = 0;
    for (let step = 0; step < 60; step += 1) {
      fast += kinds(director.update(state, STEP).cues).filter((kind) => kind === 'gust').length;
    }

    expect(gentle).toBe(0);
    expect(fast).toBeGreaterThan(0);
  });

  it('scrapes while sliding and ticks while climbing', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    state.grounded = true;

    state.sliding = true;
    let scrapes = 0;
    for (let step = 0; step < 120; step += 1) {
      scrapes += kinds(director.update(state, STEP).cues).filter((kind) => kind === 'scrape').length;
    }
    expect(scrapes).toBeGreaterThan(1);

    director.reset();
    state.sliding = false;
    state.climbId = 'pipe';
    let ticks = 0;
    for (let step = 0; step < 120; step += 1) {
      ticks += kinds(director.update(state, STEP).cues).filter((kind) => kind === 'climb-tick').length;
    }
    expect(ticks).toBeGreaterThan(1);
  });
});

describe('death', () => {
  it('plays the death sound once, not once per frame of the fall', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    state.alive = false;

    let deaths = 0;
    for (let step = 0; step < 100; step += 1) {
      deaths += kinds(director.update(state, STEP).cues).filter((kind) => kind === 'death').length;
    }
    expect(deaths).toBe(1);

    // ...and again for a second death.
    director.reset();
    expect(kinds(director.update(state, STEP).cues)).toEqual(['death']);
  });

  it('silences the wind while dead', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const state = createPlayerState(ON_DECK, CONFIG);
    state.alive = false;
    state.velocity = vec3(0, -50, 0);
    expect(director.update(state, STEP).windIntensity).toBe(0);
  });
});

describe('wired to the real simulation', () => {
  it('steps at a plausible cadence while running across the roof', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const collisionWorld = world(FLOOR);
    const state = createPlayerState(ON_DECK, CONFIG);

    let footsteps = 0;
    for (let step = 0; step < 240; step += 1) {
      stepPlayer(state, input({ forward: 1 }), STEP, optionsFor(collisionWorld));
      footsteps += kinds(director.update(state, STEP).cues).filter(
        (kind) => kind === 'footstep',
      ).length;
    }

    // Four seconds of walking at 7.5 m/s with a 2.1 m step is about fourteen
    // steps, i.e. a shade over three per second.
    expect(footsteps).toBeGreaterThanOrEqual(8);
    expect(footsteps).toBeLessThanOrEqual(20);
  });

  it('announces a real jump and landing through the step outcome', () => {
    const director = new AudioDirector(DEFAULT_CONFIG);
    const collisionWorld = world(FLOOR);
    const state: PlayerState = createPlayerState(ON_DECK, CONFIG);
    const options = optionsFor(collisionWorld);

    const heard: string[] = [];
    for (let step = 0; step < 200; step += 1) {
      const outcome = stepPlayer(state, input({ jump: step < 2 }), STEP, options);
      if (outcome.landing) director.landing(outcome.landing.impact, outcome.landing.damage);
      heard.push(...kinds(director.update(state, STEP).cues));
    }

    expect(heard).toContain('land');
  });
});
