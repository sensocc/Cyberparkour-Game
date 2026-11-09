/**
 * The city's sky, haze and sun.
 *
 * **Its own module because it is all the city keeps from a level.** `buildCity` replaces a
 * level's props, spawn, checkpoints, pickups, finish, lifts, doors, smoke and kill plane with
 * what the generator places - what survives is the level's *identity*: the sky it is set under,
 * the colour of its haze, and the direction and warmth of its sun. Those are what this is.
 *
 * V2.0.3 split it out of `levelData.ts`, where it lived inside `DEMO_DISTRICT` - a hand-authored
 * district whose 184 props, two walk-in rooms and two lifts had not been used by the game since
 * the city became the whole map in V0.7, but were still compiled into the bundle for the sake of
 * these twelve numbers. `DEMO_DISTRICT` is now a test fixture; this is the production half.
 *
 * The numbers themselves are unchanged from V2.0.0: the night is deliberately bright, the fog
 * completes at the draw distance (see `buildCity`), and the skyline is a painted cylinder that is
 * *not* fogged, so the backdrop survives where the drawn city fades out.
 */

import type { EnvironmentDefinition } from './levelData.js';

export const CITY_ENVIRONMENT: EnvironmentDefinition = {
  skyColor: '#172a52',
  // The fog colour is picked to match the sky's horizon glow rather than to be a neutral grey:
  // the skyline is painted on a cylinder out, and it has to dissolve into the haze rather than
  // into a line. V2.0 lifts the whole night a step: the sky, the haze and the sun all brighten
  // together, so the city reads before it strains.
  fogColor: '#524a73',
  // Both are overridden by `buildCity` to finish at the draw distance; they are the level's own
  // defaults for a level that is played as authored.
  fogNear: 90,
  fogFar: 480,
  ambientSkyColor: '#9fb3e0',
  ambientGroundColor: '#222c3e',
  ambientIntensity: 1.35,
  sunColor: '#eef4ff',
  sunIntensity: 3.8,
  sunDirection: { x: 0.55, y: 0.9, z: 0.35 },
  backdrop: {
    radius: 240,
    height: 190,
    baseY: -34.8,
    repeat: 2,
  },
};
