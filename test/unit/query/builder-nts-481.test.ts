import { describe, expect, it } from 'vitest'
import { Builder } from '../../../src/query'

describe('Builder aggregate subqueries in WITH position (NTS-481)', () => {
  it('feeds a WITH-position count into a later RETURN projection (progressPct)', () => {
    const { query, params } = new Builder()
      .match('u', ['User'])
      .withCountSubquery('total', (sub) => sub.match('l', ['Lesson']).where('l.depth', 1))
      .withCountSubquery('completed', (sub) => sub.match('c', ['Completion']).where('c.done', true))
      .return('u', 'round(100.0 * completed / total) AS progressPct')
      .build()

    expect(query).toBe(
      'MATCH (u:User)\n' +
        'WITH COUNT { MATCH (l:Lesson)\nWHERE (l.depth = $sub0_where_l_depth) } AS total, COUNT { MATCH (c:Completion)\nWHERE (c.done = $sub1_where_c_done) } AS completed\n' +
        'RETURN u, round(100.0 * completed / total) AS progressPct',
    )
    expect(params).toEqual({ sub0_where_l_depth: 1, sub1_where_c_done: true })
  })

  it('collects in WITH position with imported variables', () => {
    const { query, params } = new Builder()
      .match('u', ['User'])
      .withCollectSubquery('tags', (sub) => sub.match('t', ['Tag']).where('t.hot', true), ['u'])
      .return('u', 'tags')
      .build()

    expect(query).toBe(
      'MATCH (u:User)\n' +
        'WITH COLLECT { WITH u MATCH (t:Tag)\nWHERE (t.hot = $sub0_where_t_hot) } AS tags\n' +
        'RETURN u, tags',
    )
    expect(Object.keys(params).some((k) => k.startsWith('sub0_'))).toBe(true)
  })

  it('keeps RETURN-position subqueries unchanged', () => {
    const { query } = new Builder()
      .match('u', ['User'])
      .countSubquery('total', (sub) => sub.match('e', ['E']), ['u'])
      .collectSubquery('tags', (sub) => sub.match('t', ['T']))
      .return('u')
      .build()

    expect(query).toBe(
      'MATCH (u:User)\n' +
        'RETURN COUNT { WITH u MATCH (e:E) } AS total, COLLECT { MATCH (t:T) } AS tags, u',
    )
  })

  it('accepts raw WITH expressions as the escape hatch for other projections', () => {
    const { query } = new Builder()
      .match('u', ['User'])
      .withCountSubquery('total', (sub) => sub.match('l', ['Lesson']))
      .withCountSubquery('completed', (sub) => sub.match('c', ['Completion']))
      .with('100 * completed / total AS pct')
      .return('u', 'pct')
      .build()

    expect(query).toContain('WITH 100 * completed / total AS pct')
    expect(query).toContain('RETURN u, pct')
  })
})
