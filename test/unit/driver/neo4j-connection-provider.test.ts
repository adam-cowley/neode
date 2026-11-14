import neo4j from 'neo4j-driver'
import { normalizeDriverValue } from '../../../src/driver/neo4j-connection-provider'
import { NeodeError } from '../../../src/errors'

/**
 A value from a "foreign realm": it carries the identifier properties the
 driver's duck-typed guards check, but its prototype chain is not the driver
 classes this library imports (what happens when the host app resolves a
 second copy of neo4j-driver, e.g. under pnpm/link setups).
 */
function foreignRealmCopy(value: object): object {
  const identifiers = Object.getOwnPropertyNames(Object.getPrototypeOf(value)).filter((key) =>
    key.startsWith('__is'),
  )

  return { ...value, ...Object.fromEntries(identifiers.map((key) => [key, true])) }
}

describe('normalizeDriverValue', () => {
  it('normalises the Integer fields of driver temporal and spatial values (same realm)', () => {
    // Values built with explicit neo4j.int() arguments (and points straight
    // off the server) carry Integer internals — normalised to plain numbers
    // on a same-prototype clone (NTS-547: bulk reads return the same shapes
    // the single-record path does)
    const dateTime = new neo4j.DateTime(2020, 1, 2, 3, 4, 5, neo4j.int(6), neo4j.int(0), 'UTC')
    const point = new neo4j.Point(neo4j.int(4326), 1.5, 2.5)

    const outDateTime = normalizeDriverValue(dateTime)
    expect(outDateTime).not.toBe(dateTime) // had Integer fields → normalised copy
    expect(outDateTime).toBeInstanceOf(neo4j.DateTime)
    expect(outDateTime.nanosecond).toBe(6)
    expect(outDateTime.timeZoneOffsetSeconds).toBe(0)

    const outPoint = normalizeDriverValue(point)
    expect(outPoint).not.toBe(point)
    expect(outPoint).toBeInstanceOf(neo4j.Point)
    expect(outPoint.srid).toBe(4326)
  })

  it('passes values with no Integer fields through untouched (same realm)', () => {
    // Driver 6 temporals built with native numbers carry no Integer
    // internals — identity is preserved
    const date = new neo4j.Date(2020, 1, 2)

    expect(normalizeDriverValue(date)).toBe(date)
  })

  it('normalises the Integer fields of foreign-realm temporal and spatial values', () => {
    // Real driver instances copy their identifier properties off, but are not
    // instanceof the classes this library imports — the mangled shapes a
    // duplicated neo4j-driver install used to spread into plain objects.
    // The duck-typed shape survives; Integer internals still normalise.
    const foreign = foreignRealmCopy(
      new neo4j.DateTime(2020, 1, 2, 3, 4, 5, neo4j.int(6), neo4j.int(0), 'UTC'),
    )

    const out = normalizeDriverValue(foreign) as Record<string, unknown>

    expect(out).not.toBe(foreign) // had Integer fields → normalised copy
    expect(out['__isDateTime__']).toBe(true)
    expect(out['nanosecond']).toBe(6)
    expect(out['timeZoneOffsetSeconds']).toBe(0)
  })

  it('normalises driver integers and recurses into arrays and plain objects', () => {
    expect(normalizeDriverValue(neo4j.int(5))).toBe(5)
    expect(normalizeDriverValue([neo4j.int(1)])).toEqual([1])
    expect(normalizeDriverValue({ createdAt: neo4j.int(1) })).toEqual({ createdAt: 1 })
  })

  it('throws on an Integer outside the safe range instead of losing precision (NTS-589 test gap)', () => {
    // 2^53 + 1 — safeToNumber must reject it rather than round silently
    // (NTS-582 behaviour, previously untested)
    const outOfRange = neo4j.int('9007199254740993')

    expect(() => normalizeDriverValue(outOfRange)).toThrow(NeodeError)
    expect(() => normalizeDriverValue(outOfRange)).toThrow(/safe integer range/)

    // Nested inside a record / temporal field too
    expect(() => normalizeDriverValue({ year: outOfRange })).toThrow(/safe integer range/)
  })
})
