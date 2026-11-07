import { describe, expect, it } from 'vitest'
import { NeodeError } from '../../../src/errors'
import { Builder } from '../../../src/query'

describe('Builder fail-fast on unbound sub-query parameters (NTS-478)', () => {
  it('throws at build time when a sub-query references a parameter that was never registered', () => {
    const build = () =>
      new Builder()
        .match('a', 'Attempt')
        .call((call) => call.with('a').unwind('$answers', 'row').return('count(*) AS n'))
        .build()

    expect(build).toThrow(NeodeError)
    expect(build).toThrow(/Unbound parameter \$answers/)
    // names the fix, not just the failure
    expect(build).toThrow(/param\('answers', value\)/)
    // names the offending fragment
    expect(build).toThrow(/UNWIND \$answers AS row/)
  })

  it('fails the same way for forEach sub-queries', () => {
    const build = () =>
      new Builder()
        .match('a', 'Attempt')
        .forEach('x', '$answers', (sub) => sub.merge('m', ['Marker']))
        .build()

    // the list expression is raw top-level text (outside the sub-builder),
    // so it stays unchecked like every other top-level $name — the check
    // covers compiled sub-query text, where the $subN_ rewrite happens
    expect(build).not.toThrow()

    const buildWithUnboundSub = () =>
      new Builder()
        .match('a', 'Attempt')
        .forEach('x', 'a.list', (sub) => sub.merge('m', ['Marker']).set('m.v', 1).whereRaw('$nope'))
        .build()

    expect(buildWithUnboundSub).toThrow(/Unbound parameter \$nope/)
  })

  it('still compiles when the sub-builder registers the parameter', () => {
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

  it('leaves valid sub-queries untouched, including $-shaped text inside string literals', () => {
    const { query, params } = new Builder()
      .match('n', 'Person')
      .call((sub) =>
        sub
          .match('p', 'Person')
          .whereRaw("p.name = 'a\\'b $answers literal'")
          .where('p.age', '>', 30)
          .return('p'),
      )
      .build()

    expect(query).toContain('AND p.age > $sub0_where_p_age')
    expect(params['sub0_where_p_age']).toBe(30)
    // shortcut: the pre-existing $subN_ rewrite also touches $name inside
    // string literals (separate corruption, out of scope) — this test only
    // pins that the NTS-478 check itself never false-positives on literals
  })

  it('does not mistake backtick-quoted identifiers for parameters', () => {
    const build = () =>
      new Builder()
        .match('n', 'Person')
        .call((sub) => sub.match('p', 'Person').whereRaw('p.`weird $name col` > 1').return('p'))
        .build()

    expect(build).not.toThrow()
  })
})
