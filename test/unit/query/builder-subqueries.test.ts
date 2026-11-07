import { describe, expect, it, vi } from 'vitest'
import { Builder, expr, caseExpr } from '../../../src/query'

describe('Builder subqueries (NTS: no hand-written Cypher in repositories)', () => {
  it('compiles a scoped CALL subquery with imported variables', () => {
    const builder = new Builder()
      .match('u', ['User'])
      .call((sub) => sub.match('e', ['Enrolment']).where('e.sub', 'x'), ['u'])

    const { query, params } = builder.build()

    expect(query).toContain('CALL (u) {')
    expect(query).toContain('MATCH (e:Enrolment)')
    expect(Object.keys(params).some((k) => k.startsWith('sub0_'))).toBe(true)
    expect(query).toContain('WHERE (e.sub = $sub0_')
  })

  it('namespaces parameters of nested subqueries to avoid collisions', () => {
    const builder = new Builder()
      .match('p', ['Post'])
      .countSubquery('claps', (sub) => sub.match('c', ['Clap']).where('c.count', 1))
      .collectSubquery('tags', (sub) => sub.match('t', ['Tag']).where('t.count', 2))
      .whereExistsSubquery((sub) => sub.match('x', ['X']).where('x.count', 3))

    const { query, params } = builder.build()

    expect(query).toContain('COUNT { MATCH (c:Clap)')
    expect(query).toContain('COLLECT { MATCH (t:Tag)')
    expect(query).toContain('EXISTS { MATCH (x:X)')
    expect(Object.keys(params).some((k) => k.startsWith('sub0_'))).toBe(true)
    expect(Object.keys(params).some((k) => k.startsWith('sub1_'))).toBe(true)
    expect(Object.keys(params).some((k) => k.startsWith('sub2_'))).toBe(true)
  })

  it('emits UNWIND and FOREACH segments', () => {
    const query = new Builder()
      .unwind('[1, 2, 3] AS x'.replace(' AS x', ''), 'x')
      .unwind('$slugs', 'slug')
      .forEach('slug', '$slugs', (sub) => sub.merge('s', ['ShortLink']))
      .build().query

    expect(query).toContain('UNWIND $slugs AS slug')
    expect(query).toContain('FOREACH (slug IN $slugs | MERGE (s:ShortLink))')
  })

  it('supports WITH-imported variables in COUNT subqueries', () => {
    const { query } = new Builder()
      .match('u', ['User'])
      .countSubquery('total', (sub) => sub.match('e', ['E']), ['u'])
      .build()

    expect(query).toContain('COUNT { WITH u MATCH (e:E) } AS total')
  })
})

describe('expr helpers', () => {
  it('composes leaf expressions without raw clause strings', () => {
    expect(expr.coalesce('n.reads', '0')).toBe('coalesce(n.reads, 0)')
    expect(expr.toString('n.createdAt')).toBe('toString(n.createdAt)')
    expect(expr.datetime()).toBe('datetime()')
    expect(expr.datetime('$at')).toBe('datetime($at)')
    expect(expr.randomUUID()).toBe('randomUUID()')
    expect(expr.countDistinct('u.sub')).toBe('count(DISTINCT u.sub)')
    expect(expr.any('r', 'reactions', 'r.emoji = $emoji')).toBe(
      'any(r IN reactions WHERE r.emoji = $emoji)',
    )
  })

  it('composes CASE expressions', () => {
    expect(
      caseExpr(
        [
          { when: 'n.a', then: '1' },
          { when: 'n.b', then: '2' },
        ],
        '0',
      ).startsWith('CASE WHEN n.a'),
    ).toBe(true)
  })
})

describe('Builder expression sets, procedure calls and constraints (NTS-195/462/464/474)', () => {
  it('binds ON CREATE/ON MATCH SET with expression values via named params', () => {
    const { query, params } = new Builder()
      .merge('u', ['User'], { sub: 'sub-1' })
      .onCreateSetExpr('u.createdAt', 'datetime()')
      .onCreateSetExpr('u.id', 'randomUUID()')
      .onMatchSetExpr('u.email', 'coalesce($email, u.email)', { email: 'a@b.c' })
      .build()

    expect(query).toContain('ON CREATE SET u.createdAt = datetime(), u.id = randomUUID()')
    expect(query).toContain('ON MATCH SET u.email = coalesce($email, u.email)')
    expect(params.email).toBe('a@b.c')
  })

  it('emits a procedure call with YIELD', () => {
    const { query, params } = new Builder()
      .param('index', 'post_title_body_fulltext')
      .param('q', 'cypher')
      .callProcedure('db.index.fulltext.queryNodes', ['$index', '$q'], ['node', 'score'])
      .return('node', 'score')
      .orderBy('score', 'DESC')
      .build()

    expect(query).toContain('CALL db.index.fulltext.queryNodes($index, $q) YIELD node, score')
    expect(query).toContain('RETURN node, score')
    expect(query).toContain('ORDER BY score DESC')
    expect(params.index).toBe('post_title_body_fulltext')
  })

  it('composes constraint DDL', () => {
    const unique = new Builder().createUniqueConstraint('User', 'sub').build().query
    const index = new Builder().createRangeIndex('Post', 'createdAt').build().query
    const composite = new Builder()
      .createCompositeUniqueConstraint('Enrolment', ['courseSlug', 'sub'])
      .build().query
    const typed = new Builder()
      .createPropertyTypeConstraint('User', 'email', 'STRING')
      .build().query
    const exists = new Builder().createExistenceConstraint('User', 'email').build().query

    expect(unique).toContain(
      'CREATE CONSTRAINT user_sub_unique IF NOT EXISTS FOR (n:User) REQUIRE n.`sub` IS UNIQUE',
    )
    expect(index).toContain('CREATE INDEX post_createdAt_index IF NOT EXISTS FOR (n:Post) ON (')
    expect(composite).toContain('IS UNIQUE')
    expect(composite).toContain('courseSlug')
    expect(typed).toContain('REQUIRE n.`email` IS :: STRING')
    expect(exists).toContain('IS NOT NULL')
  })
})
