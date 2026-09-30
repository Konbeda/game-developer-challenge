/** Seeded pseudo-random generator (mulberry32). The only source of randomness in the simulation. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number
  /** Uniform float in [min, max). */
  range(min: number, max: number): number
  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): void
}

const UINT32_RANGE = 4_294_967_296
const MULBERRY_INCREMENT = 0x6d2b79f5

/** mulberry32: 32-bit state, good enough statistically and identical on every JS engine. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + MULBERRY_INCREMENT) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE
  }

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive)

  return {
    next,
    int,
    range: (min, max) => min + next() * (max - min),
    shuffle: <T>(items: T[]): void => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = int(i + 1)
        const a = items[i] as T
        items[i] = items[j] as T
        items[j] = a
      }
    },
  }
}
