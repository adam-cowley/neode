import neo4j from 'neo4j-driver'
import { jsonSafe, jsonSafeRecord } from '../../../src/driver/json-safe'
import { QueryRecord } from '../../../src/driver/types'

const NODE = { elementId: '4:unit:1', labels: ['Person'], properties: { name: 'Adam' } }

const RELATIONSHIP = {
  elementId: '5:unit:1',
  type: 'LIKES',
  startElementId: '4:unit:1',
  endElementId: '4:unit:2',
  properties: { since: '2020' },
}

describe('jsonSafe', () => {
  it('passes JSON-safe values through unchanged', () => {
    expect(jsonSafe(null)).toBeNull()
    expect(jsonSafe(undefined)).toBeUndefined()
    expect(jsonSafe(1)).toBe(1)
    expect(jsonSafe('x')).toBe('x')
    expect(jsonSafe(true)).toBe(true)
    expect(jsonSafe(NODE)).toEqual(NODE)
    expect(jsonSafe(RELATIONSHIP)).toEqual(RELATIONSHIP)
  })

  it('recurses into arrays and plain objects', () => {
    expect(jsonSafe([1, 'x', { a: NODE }])).toEqual([1, 'x', { a: NODE }])
  })

  it('converts driver Integer values to numbers', () => {
    expect(jsonSafe(neo4j.int(5))).toBe(5)
  })

  it('converts driver temporal values to strings', () => {
    const date = neo4j.Date.fromStandardDate(new Date(2020, 0, 2))

    expect(jsonSafe(date)).toBe('2020-01-02')

    const duration = new neo4j.Duration(1, 2, 3, 0)

    expect(jsonSafe(duration)).toBe('P1M2DT3S')
  })

  it('converts driver Point values to coordinate objects', () => {
    expect(jsonSafe(new neo4j.Point(7203, 1, 2))).toEqual({ srid: 7203, x: 1, y: 2 })
    expect(jsonSafe(new neo4j.Point(4979, 1, 2, 3))).toEqual({ srid: 4979, x: 1, y: 2, z: 3 })
  })

  it('converts driver Path values to a structured object', () => {
    const start = new neo4j.Node(neo4j.int(1), ['Person'], { name: 'Adam' }, '4:unit:1')
    const end = new neo4j.Node(neo4j.int(3), ['Pet'], {}, '4:unit:2')
    const relationship = new neo4j.Relationship(
      neo4j.int(2),
      '4:unit:1',
      '4:unit:2',
      'LIKES',
      { since: '2020' },
      '5:unit:1',
    )
    const segment = new neo4j.types.PathSegment(start, relationship, end)
    const path = new neo4j.types.Path(start, end, [segment])

    expect(jsonSafe(path)).toEqual({
      start: NODE,
      end: { elementId: '4:unit:2', labels: ['Pet'], properties: {} },
      length: 1,
      segments: [
        {
          start: NODE,
          relationship: RELATIONSHIP,
          end: { elementId: '4:unit:2', labels: ['Pet'], properties: {} },
        },
      ],
    })
  })

  it('converts bigints to strings so rows survive JSON.stringify', () => {
    expect(jsonSafe(BigInt('9007199254740993'))).toBe('9007199254740993')
  })
})

describe('jsonSafeRecord', () => {
  it('wraps a QueryRecord with JSON-safe values', () => {
    const record: QueryRecord = {
      get: (key: string) => (key === 'p' ? new neo4j.Point(7203, 1, 2) : undefined),
      has: (key: string) => key === 'p',
      keys: ['p'],
    }

    const safe = jsonSafeRecord(record)

    expect(safe.keys).toEqual(['p'])
    expect(safe.has('p')).toBe(true)
    expect(safe.get('p')).toEqual({ srid: 7203, x: 1, y: 2 })
    expect(() => JSON.stringify({ p: safe.get('p') })).not.toThrow()
  })
})
