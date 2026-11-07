import { describe, expect, it } from 'vitest'
import { Builder } from '../../../src/query'

describe('Builder keeps $-bearing text inside sub-query string literals intact (NTS-492)', () => {
  it('leaves quoted $-text unchanged while real parameters still rewrite', () => {
    const { query, params } = new Builder()
      .match('n', 'Person')
      .call((sub) =>
        sub
          .match('p', 'Person')
          .where('p.name', 'Adam')
          .whereRaw("apoc.text.format('%s is $label', p.name) = 'x $ignored'")
          .whereRaw('p.country = "United $kingdom"')
          .whereRaw('p.age > $threshold')
          .param('threshold', 30)
          .return('p'),
      )
      .build()

    // the literals survive verbatim — no phantom $sub0_label / $sub0_kingdom
    expect(query).toContain("'%s is $label'")
    expect(query).toContain("'x $ignored'")
    expect(query).toContain('"United $kingdom"')
    expect(query).not.toContain('$sub0_label')
    expect(query).not.toContain('$sub0_ignored')
    expect(query).not.toContain('$sub0_kingdom')
    // real parameters still get namespaced, bound and carried
    expect(query).toContain('p.age > $sub0_threshold')
    expect(query).toContain('p.name = $sub0_where_p_name')
    expect(params['sub0_threshold']).toBe(30)
    expect(params['sub0_where_p_name']).toBe('Adam')
  })

  it('honours backslash escapes when deciding what is inside a literal', () => {
    // renders in Cypher as a\'b $word c\ — the \' is an escaped quote and
    // the \\ an escaped backslash, so the literal only ends at the final '
    const literal = "a\\'b $word c\\\\"
    const { query } = new Builder()
      .match('n', 'Person')
      .call((sub) =>
        sub
          .match('p', 'Person')
          .whereRaw(`p.name = '${literal}'`)
          .whereRaw('p.age > $threshold')
          .param('threshold', 30)
          .return('p'),
      )
      .build()

    expect(query).toContain(`'${literal}'`)
    expect(query).not.toContain('$sub0_word')
    expect(query).toContain('p.age > $sub0_threshold')
  })

  it('rewrites bound sub-query parameters as before (regression guard)', () => {
    const { query, params } = new Builder()
      .match('a', 'Attempt')
      .call((call) =>
        call
          .with('a')
          .param('answers', [1, 2, 3])
          .unwind('$answers', 'row')
          .return('count(*) AS n'),
      )
      .build()

    expect(query).toContain('UNWIND $sub0_answers AS row')
    expect(params['sub0_answers']).toEqual([1, 2, 3])
  })
})
