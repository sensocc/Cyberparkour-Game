/**
 * A small deterministic PRNG (mulberry32).
 *
 * Shared by the audio synthesiser and the texture generator: both need numbers
 * that are reproducible on every machine, and neither should depend on
 * `Math.random`.
 */

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
