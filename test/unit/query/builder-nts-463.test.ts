import { describe, expect, it } from 'vitest'
import { Builder } from '../../../src/query'

describe('Builder return-based helpers on a fresh builder (NTS-463)', () => {
  it('countSubquery opens a standalone RETURN statement when no segment is open', () => {
    const { query } = new Builder()
      .countSubquery('found', (sub) => sub.match('e', ['Event']).return('e'))
      .build()

    expect(query).toBe('RETURN COUNT { MATCH (e:Event)\nRETURN e } AS found')
  })

  it('collectSubquery opens a standalone RETURN statement when no segment is open', () => {
    const { query } = new Builder()
      .collectSubquery('tags', (sub) => sub.match('t', ['Tag']).return('t'))
      .build()

    expect(query).toBe('RETURN COLLECT { MATCH (t:Tag)\nRETURN t } AS tags')
  })

  it('composes several subqueries on a fresh builder into one RETURN (diagnosis query)', () => {
    const { query } = new Builder()
      .countSubquery('a', (sub) => sub.match('n', ['Person']).return('n'))
      .countSubquery('b', (sub) => sub.match('m', ['Movie']).return('m'))
      .build()

    expect(query).toBe(
      'RETURN COUNT { MATCH (n:Person)\nRETURN n } AS a, COUNT { MATCH (m:Movie)\nRETURN m } AS b',
    )
  })

  it('return() itself starts an implicit statement on a fresh builder', () => {
    const { query } = new Builder().return('1 AS x').build()

    expect(query).toBe('RETURN 1 AS x')
  })
})
