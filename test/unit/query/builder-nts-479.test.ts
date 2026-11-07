import { describe, expect, it } from 'vitest'
import { Builder } from '../../../src/query'

describe('Builder.statement() flushes the open where clause (NTS-479)', () => {
  it('flushes the pending where into the previous segment before a prefixed statement', () => {
    const { query, params } = new Builder()
      .match('q', 'Question')
      .whereRaw('q.id = row.questionId')
      .statement('CREATE')
      .to('a', 'Attempt')
      .return('a')
      .build()

    expect(query).toBe(
      [
        'MATCH (q:Question)',
        'WHERE (q.id = row.questionId)',
        'CREATE (a:Attempt)',
        'RETURN a',
      ].join('\n'),
    )
    expect(params).toEqual({})
  })

  it('flushes the pending where into the previous segment before a prefixless statement', () => {
    const { query } = new Builder()
      .match('q', 'Question')
      .whereRaw('q.id = row.questionId')
      .statement()
      .to('a', 'Attempt')
      .return('a')
      .build()

    expect(query).toBe(
      ['MATCH (q:Question)', 'WHERE (q.id = row.questionId)', 'MATCH (a:Attempt)', 'RETURN a'].join(
        '\n',
      ),
    )
  })

  it('keeps match → where → return rendering unchanged', () => {
    const { query } = new Builder()
      .match('q', 'Question')
      .whereRaw('q.id = row.questionId')
      .return('q')
      .build()

    expect(query).toBe('MATCH (q:Question)\nWHERE (q.id = row.questionId)\nRETURN q')
  })

  it('keeps match → where → with → return rendering unchanged', () => {
    const { query } = new Builder()
      .match('q', 'Question')
      .whereRaw('q.id = row.questionId')
      .with('q')
      .return('q')
      .build()

    expect(query).toBe('MATCH (q:Question)\nWHERE (q.id = row.questionId)\nWITH q\nRETURN q')
  })
})
