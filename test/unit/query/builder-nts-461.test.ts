import { describe, expect, it } from 'vitest'
import { Builder } from '../../../src/query'

describe('Builder aggregate subqueries joining a WITH clause (NTS-461)', () => {
  it('joins carried variables and two counts in one WITH, filterable afterwards', () => {
    const { query, params } = new Builder()
      .match('u', ['User'])
      .match('e', ['Enrolment'])
      .match('c', ['Course'])
      .with('u', 'e', 'c')
      .withCountSubquery('completedCount', (sub) =>
        sub.match('l', ['Lesson']).where('l.done', true),
      )
      .withCountSubquery('totalCount', (sub) => sub.match('l', ['Lesson']).where('l.depth', 2))
      .whereRaw('completedCount < totalCount')
      .return('u', 'e', 'c', 'completedCount', 'totalCount')
      .build()

    expect(query).toBe(
      'MATCH (u:User)\n' +
        'MATCH (e:Enrolment)\n' +
        'MATCH (c:Course)\n' +
        'WITH u, e, c, COUNT { MATCH (l:Lesson)\nWHERE (l.done = $sub0_where_l_done) } AS completedCount, COUNT { MATCH (l:Lesson)\nWHERE (l.depth = $sub1_where_l_depth) } AS totalCount\n' +
        'WHERE (completedCount < totalCount)\n' +
        'RETURN u, e, c, completedCount, totalCount',
    )
    // the namespacing proof: parameterised sub-builders bind as $subN_…,
    // never leaking a bare $name into the parent query
    expect(params).toEqual({ sub0_where_l_done: true, sub1_where_l_depth: 2 })
  })

  it('joins a collect subquery to carried variables in WITH position', () => {
    const { query, params } = new Builder()
      .match('u', ['User'])
      .with('u')
      .withCollectSubquery('tags', (sub) => sub.match('t', ['Tag']).where('t.hot', true), ['u'])
      .return('u', 'tags')
      .build()

    expect(query).toBe(
      'MATCH (u:User)\n' +
        'WITH u, COLLECT { WITH u MATCH (t:Tag)\nWHERE (t.hot = $sub0_where_t_hot) } AS tags\n' +
        'RETURN u, tags',
    )
    expect(params['sub0_where_t_hot']).toBe(true)
  })

  it('opens its own WITH clause when there is nothing to join', () => {
    const { query } = new Builder()
      .match('u', ['User'])
      .withCountSubquery('total', (sub) => sub.match('l', ['Lesson']))
      .return('total')
      .build()

    expect(query).toBe('MATCH (u:User)\nWITH COUNT { MATCH (l:Lesson) } AS total\nRETURN total')
  })

  it('keeps withOrder()/withLimit() working after a merged WITH clause', () => {
    const { query } = new Builder()
      .match('u', ['User'])
      .with('u')
      .withCountSubquery('total', (sub) => sub.match('l', ['Lesson']))
      .withOrder('total', 'DESC')
      .withLimit(5)
      .return('u', 'total')
      .build()

    expect(query).toBe(
      'MATCH (u:User)\nWITH u, COUNT { MATCH (l:Lesson) } AS total\nORDER BY total DESC\nLIMIT 5\nRETURN u, total',
    )
  })
})
