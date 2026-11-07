import { NeodeError } from '../errors/index.js'

/**
Weyl constant and period of the 32-bit generator
(mulberry32's 0x6D2B79F5, in decimal — the linters disagree on hex casing)
*/
const WEYL = 1_831_565_813
const MODULUS = 4_294_967_296

/**
A deterministic PRNG (mulberry32) for reproducible fixtures (NTS-167):
seed it once and use it inside property `fake` generators — the same
seed produces the same sequence, so seeded fixtures stay stable across
runs.

	const random = seededRandom(42)
	@Property({ type: 'string', fake: () => cities[Math.floor(random() * cities.length)] })
*/
export function seededRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed)) {
    throw new NeodeError('seededRandom() requires a safe integer seed')
  }

  // State normalised into [0, 2^32) so the Weyl step wraps by modulo —
  // bit-identical to the canonical int32-wraparound formulation
  let state = ((seed % MODULUS) + MODULUS) % MODULUS

  return () => {
    state = (state + WEYL) % MODULUS

    let t = state

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / MODULUS
  }
}
