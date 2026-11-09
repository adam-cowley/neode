import { describe, expect, it, vi } from 'vitest'
import { Builder, expr, caseExpr } from '../../../src/query'
import { ConstraintType } from '../../../src/services/schema/schema.service'

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

  it('composes COLLECT { … } as an expression for WITH-carried sort keys (NTS-565)', () => {
    const builder = new Builder().match('u', ['User'])

    builder.with(
      'u',
      `${builder.collectExpr(
        (sub) => {
          sub.match('u')
          sub.relationship('REL', 'out', 'r').to('m', ['Other'])
          sub.return('m.score')
          sub.orderBy('m.score')

          return sub
        },
        ['u'],
      )} AS k`,
    )
    builder.withOrder({ field: 'k[0]', order: '' })

    const { query } = builder.build()

    // The sub body's clauses join with newlines — compare whitespace-free
    expect(query.replace(/\s+/g, ' ')).toContain(
      'WITH u, COLLECT { WITH u MATCH (u)-[r:`REL`]->(m:Other) RETURN m.score ORDER BY m.score } AS k ORDER BY k[0]',
    )
  })
})

describe('WHERE after raw segments (NTS-475)', () => {
  it('emits WHERE for a where chained after callProcedure', () => {
    const { query, params } = new Builder()
      .param('courseIndex', 'courseSearch')
      .param('courseQuery', 'text')
      .callProcedure(
        'db.index.fulltext.queryNodes',
        ['$courseIndex', '$courseQuery'],
        ['node', 'score'],
      )
      .whereIn('c.status', ['active', 'draft'])
      .return('count(c) AS total')
      .build()

    expect(query).toBe(
      'CALL db.index.fulltext.queryNodes($courseIndex, $courseQuery) YIELD node, score\n' +
        'WHERE (c.status IN $where_c_status)\n' +
        'RETURN count(c) AS total',
    )
    expect(params).toEqual({
      courseIndex: 'courseSearch',
      courseQuery: 'text',
      where_c_status: ['active', 'draft'],
    })
  })

  it('emits a WHERE-prefixed segment for a where chained after unwind', () => {
    const { query } = new Builder()
      .unwind('$rows', 'row')
      .where('row.active', true)
      .return('row')
      .build()

    expect(query).toBe('UNWIND $rows AS row\nWHERE (row.active = $where_row_active)\nRETURN row')
  })

  it('keeps where after match and with-then-where rendering as before', () => {
    const afterMatch = new Builder()
      .match('n', 'Person')
      .where('n.name', 'Adam')
      .return('n')
      .build().query

    expect(afterMatch).toBe('MATCH (n:Person)\nWHERE (n.name = $where_n_name)\nRETURN n')

    const afterWith = new Builder()
      .match('n', 'Person')
      .with('n')
      .where('n.age', '>', 30)
      .return('n')
      .build().query

    expect(afterWith).toBe('MATCH (n:Person)\nWITH n\nWHERE (n.age > $where_n_age)\nRETURN n')
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

  it('composes fulltext index DDL', () => {
    const create = new Builder().createFulltextIndex('Movie', ['title', 'plot']).build().query
    const drop = new Builder().dropFulltextIndex('Movie', ['title', 'plot']).build().query

    expect(create).toBe(
      'CREATE FULLTEXT INDEX movie_title_plot_fulltext IF NOT EXISTS FOR (n:Movie) ' +
        'ON EACH [n.`title`, n.`plot`]',
    )
    expect(drop).toBe('DROP FULLTEXT INDEX movie_title_plot_fulltext IF EXISTS')
  })

  it('drops constraint and index DDL by type', () => {
    const unique = new Builder().dropConstraint('User', 'sub').build().query
    const index = new Builder()
      .dropConstraint('Post', 'createdAt', ConstraintType.INDEX)
      .build().query
    const exists = new Builder()
      .dropConstraint('User', 'email', ConstraintType.EXISTS)
      .build().query
    const typed = new Builder()
      .dropConstraint('User', 'email', ConstraintType.PROPERTY_TYPE)
      .build().query

    expect(unique).toBe('DROP CONSTRAINT user_sub_unique IF EXISTS')
    expect(index).toBe('DROP INDEX post_createdAt_index IF EXISTS')
    expect(exists).toBe('DROP CONSTRAINT user_email_exists IF EXISTS')
    expect(typed).toBe('DROP CONSTRAINT user_email_property_type IF EXISTS')
  })

  it('composes DDL segments alongside query segments', () => {
    const { query } = new Builder()
      .createUniqueConstraint('User', 'sub')
      .createFulltextIndex('Movie', ['title'])
      .build()

    expect(query).toBe(
      [
        'CREATE CONSTRAINT user_sub_unique IF NOT EXISTS FOR (n:User) REQUIRE n.`sub` IS UNIQUE',
        'CREATE FULLTEXT INDEX movie_title_fulltext IF NOT EXISTS FOR (n:Movie) ON EACH [n.`title`]',
      ].join('\n'),
    )
  })
})

describe('Builder#existsExpr — expression-level EXISTS (NTS-465)', () => {
  it('composes an EXISTS subquery inside an or() chain', () => {
    const builder = new Builder()
    const { query, params } = builder
      .match('c', 'Course')
      .where("c.status <> 'draft'")
      .param('includeDrafts', false)
      .or('$includeDrafts')
      .or(builder.existsExpr((sub) => sub.match('a', 'Account').where('a.sub', 'viewer-sub')))
      .return('c')
      .build()

    expect(query).toBe(
      [
        'MATCH (c:Course)',
        "WHERE (c.status <> 'draft' OR $includeDrafts OR EXISTS { MATCH (a:Account)\nWHERE (a.sub = $sub0_where_a_sub) })",
        'RETURN c',
      ].join('\n'),
    )
    expect(params).toEqual({ includeDrafts: false, sub0_where_a_sub: 'viewer-sub' })
  })

  it('negates to NOT EXISTS', () => {
    const builder = new Builder()
    const { query, params } = builder
      .match('c', 'Course')
      .where(`NOT ${builder.existsExpr((sub) => sub.match('e', 'Enrolment').where('e.sub', 'x'))}`)
      .return('c')
      .build()

    expect(query).toBe(
      [
        'MATCH (c:Course)',
        'WHERE (NOT EXISTS { MATCH (e:Enrolment)\nWHERE (e.sub = $sub0_where_e_sub) })',
        'RETURN c',
      ].join('\n'),
    )
    expect(params).toEqual({ sub0_where_e_sub: 'x' })
  })

  it('projects an EXISTS expression in a RETURN position', () => {
    const builder = new Builder().match('c', 'Course')
    const { query } = builder
      .return('c.slug', `${builder.existsExpr((sub) => sub.match('e', 'Enrolment'))} AS hasOne`)
      .build()

    expect(query).toBe('MATCH (c:Course)\nRETURN c.slug, EXISTS { MATCH (e:Enrolment) } AS hasOne')
  })

  it('fails fast on unbound sub-query parameters', () => {
    const builder = new Builder().match('c', 'Course')

    expect(() =>
      builder.existsExpr((sub) => sub.match('e', 'Enrolment').whereRaw('e.slug = $slug')),
    ).toThrow(/Unbound parameter \$slug/)
  })
})
