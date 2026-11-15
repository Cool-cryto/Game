/**
 * Seeded random number generator (mulberry32).
 * The simulation must never use Math.random(): the same seed and the same
 * player commands must always produce the same game. That keeps bugs
 * reproducible and lets multiplayer clients and the server agree.
 */
export interface RngState {
  seed: number;
}

/** Returns a number in [0, 1) and advances the state in place. */
export function nextRandom(rng: RngState): number {
  let t = (rng.seed = (rng.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
