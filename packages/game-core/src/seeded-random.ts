/**
 * Mulberry32 pseudo-random number generator.
 * Returns a stateful function that produces uniformly distributed floats in [0, 1).
 * Fast and sufficient for shuffling — NOT cryptographically secure.
 */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Fisher-Yates shuffle using a seeded deterministic RNG.
 * Returns a new array and does not mutate the input.
 * Identical seeds produce identical orderings — useful for reproducible tests.
 */
export function seededShuffle<T>(array: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
