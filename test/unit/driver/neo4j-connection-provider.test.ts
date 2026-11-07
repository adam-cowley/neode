import neo4j from 'neo4j-driver'
import { normalizeDriverValue } from '../../../src/driver/neo4j-connection-provider'

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
  it('passes driver temporal and spatial values through untouched (same realm)', () => {
    const values = [
      new neo4j.DateTime(2020, 1, 2, 3, 4, 5, neo4j.int(6), neo4j.int(0), 'UTC'),
      new neo4j.Date(2020, 1, 2),
      new neo4j.Time(3, 4, 5, neo4j.int(6), neo4j.int(0)),
      new neo4j.LocalTime(3, 4, 5, neo4j.int(6)),
      new neo4j.LocalDateTime(2020, 1, 2, 3, 4, 5, neo4j.int(6)),
      new neo4j.Duration(1, 2, 3, neo4j.int(4)),
      new neo4j.Point(7203, 1, 2),
    ]

    for (const value of values) {
      expect(normalizeDriverValue(value)).toBe(value)
    }
  })

  it('passes foreign-realm temporal and spatial values through untouched', () => {
    // Real driver instances copy their identifier properties off, but are not
    // instanceof the classes this library imports — the mangled shapes a
    // duplicated neo4j-driver install used to spread into plain objects.
    const values = [
      foreignRealmCopy(new neo4j.DateTime(2020, 1, 2, 3, 4, 5, neo4j.int(6), neo4j.int(0), 'UTC')),
      foreignRealmCopy(new neo4j.Date(2020, 1, 2)),
      foreignRealmCopy(new neo4j.Time(3, 4, 5, neo4j.int(6), neo4j.int(0))),
      foreignRealmCopy(new neo4j.LocalTime(3, 4, 5, neo4j.int(6))),
      foreignRealmCopy(new neo4j.LocalDateTime(2020, 1, 2, 3, 4, 5, neo4j.int(6))),
      foreignRealmCopy(new neo4j.Duration(1, 2, 3, neo4j.int(4))),
      foreignRealmCopy(new neo4j.Point(7203, 1, 2)),
    ]

    for (const value of values) {
      expect(normalizeDriverValue(value)).toBe(value)
    }
  })

  it('normalises driver integers and recurses into arrays and plain objects', () => {
    expect(normalizeDriverValue(neo4j.int(5))).toBe(5)
    expect(normalizeDriverValue([neo4j.int(1)])).toEqual([1])
    expect(normalizeDriverValue({ createdAt: neo4j.int(1) })).toEqual({ createdAt: 1 })
  })
})
