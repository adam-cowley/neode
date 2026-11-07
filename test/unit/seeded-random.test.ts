import { seededRandom } from '../../src/testing/random'
import { NeodeError } from '../../src/errors'

describe('seededRandom (NTS-167)', () => {
  it('produces the same sequence for the same seed', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)

    const sequence = (random: () => number) =>
      Array.from({ length: 5 }, () => {
        return random()
      })

    expect(sequence(a)).toEqual(sequence(b))
  })

  it('produces different sequences for different seeds', () => {
    const a = seededRandom(1)
    const b = seededRandom(2)

    expect(a()).not.toBe(b())
  })

  it('returns values in [0, 1)', () => {
    const random = seededRandom(7)

    for (let n = 0; n < 1000; n++) {
      const value = random()

      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('accepts a zero seed', () => {
    const a = seededRandom(0)
    const b = seededRandom(0)

    expect(a()).toBe(b())
  })

  it('rejects a non-integer seed', () => {
    expect(() => seededRandom(1.5)).toThrow(NeodeError)
    expect(() => seededRandom(Number.NaN)).toThrow(NeodeError)
  })
})
