import { describe, expect, it } from 'vitest'
import { rows } from '../../../src/index.js'
import type { QueryOutput, QueryRecord } from '../../../src/index.js'

/** A hand-built QueryRecord over a plain map — no database */
function recordOf(values: Record<string, unknown>): QueryRecord {
  return {
    get: (key) => values[key],
    has: (key) => key in values,
    keys: Object.keys(values),
  }
}

describe('rows() (NTS-632)', () => {
  it('maps a multi-column result to plain objects keyed by column, values JSON-safe', () => {
    const output: QueryOutput = {
      records: [
        recordOf({ name: 'Adam', age: 30, tags: ['a', 'b'], meta: { ok: true }, stamp: 1n }),
        recordOf({ name: 'Rex', age: 7, tags: [], meta: { ok: false }, stamp: 2n }),
      ],
    }

    expect(rows(output)).toEqual([
      { name: 'Adam', age: 30, tags: ['a', 'b'], meta: { ok: true }, stamp: '1' },
      { name: 'Rex', age: 7, tags: [], meta: { ok: false }, stamp: '2' },
    ])
  })

  it('supports the documented scalar pattern for single-row results', () => {
    const output: QueryOutput = { records: [recordOf({ n: 42 })] }

    expect(rows<{ n: number }>(output)[0]?.n).toBe(42)
    expect(rows<{ n: number }>({ records: [] })[0]?.n).toBeUndefined()
  })
})
