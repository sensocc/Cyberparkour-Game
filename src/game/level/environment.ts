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
  // **The sky is a gradient the eye can read, not a flat blue.** A night sky that is one colour
  // reads as a backdrop; one that is deeper overhead and warmer at the horizon reads as air with a
  // city under it, which is what makes the neon land. The two sky colours are the zenith and the
  // horizon, and the haze below is picked to match the horizon rather than to be a neutral grey.
  skyColor: '#0e1c3c',
  // The fog colour is picked to match the sky's horizon glow rather than to be a neutral grey:
  // the skyline is painted on a cylinder out, and it has to dissolve into the haze rather than
  // into a line. V2.0 lifts the whole night a step: the sky, the haze and the sun all brighten
  // together, so the city reads before it strains.
  fogColor: '#4a4368',
  // Both are overridden by `buildCity` to finish at the draw distance; they are the level's own
  // defaults for a level that is played as authored.
  fogNear: 90,
  fogFar: 480,
  // **Cool from above, warm from below.** The hemisphere's sky colour is the moonlit blue the city
  // sits under; its ground colour is the sodium bounce coming back off the streets. That vertical
  // split is the single cheapest thing that makes a flat-lit scene look lit rather than filled,
  // and it is why the underside of a fire escape reads warmer than its top.
  ambientSkyColor: '#8fa8dc',
  ambientGroundColor: '#3a2a2a',
  // Lowered from 1.35 as the sun and the shafts came up: ambient that is too strong flattens
  // everything it touches, and contrast is what "cinematic" actually means.
  ambientIntensity: 1.05,
  // A slightly cooler sun against a warmer ground bounce, so the two lights separate on a surface.
  sunColor: '#e6eeff',
  // Raised from 3.8 for a harder key: longer shadows, brighter tops of towers, a skyline that reads
  // in silhouette rather than as a field of mid-greys.
  sunIntensity: 4.6,
  // Lowered from 0.9: a lower sun rakes across the city instead of sitting on top of it, which is
  // what gives the towers sides and the streets long shadows.
  sunDirection: { x: 0.62, y: 0.68, z: 0.4 },
  backdrop: {
    radius: 240,
    height: 190,
    baseY: -34.8,
    repeat: 2,
  },
};
