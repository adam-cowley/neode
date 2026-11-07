import { Builder, RawExpression } from '../../../src/query'

// NTS-460 — expression-valued ON CREATE / ON MATCH SET and inline pattern
// property maps (relationship properties, variable-valued MERGE props).
// Existing builder behaviour is pinned alongside the new channels so the
// raw-expression mechanism cannot silently drift.
describe('NTS-460 — pattern property maps and expression SETs', () => {
  describe('onCreateSetExpr / onMatchSetExpr (existing)', () => {
    it('renders an expression-valued ON CREATE SET without parameters', () => {
      const builder = new Builder()
      const { query, params } = builder
        .create('e', 'Enrolment')
        .onCreateSetExpr('e.createdAt', 'datetime()')
        .return('e')
        .build()

      expect(query).toBe('CREATE (e:Enrolment)\nON CREATE SET e.createdAt = datetime()\nRETURN e')
      expect(params).toEqual({})
    })

    it('binds expression parameters via the named parameter channel', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('e', 'Enrolment')
        .onMatchSetExpr('e.lastSeen', 'coalesce($now, e.lastSeen)', { now: '2026-01-01' })
        .return('e')
        .build()

      expect(query).toBe(
        'MERGE (e:Enrolment)\nON MATCH SET e.lastSeen = coalesce($now, e.lastSeen)\nRETURN e',
      )
      expect(params).toEqual({ now: '2026-01-01' })
    })

    it('renders ON CREATE SET and ON MATCH SET together', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('e', 'Enrolment')
        .onCreateSetExpr('e.createdAt', 'datetime()')
        .onMatchSetExpr('e.updatedAt', 'datetime()')
        .return('e')
        .build()

      expect(query).toBe(
        'MERGE (e:Enrolment)\nON CREATE SET e.createdAt = datetime()\nON MATCH SET e.updatedAt = datetime()\nRETURN e',
      )
      expect(params).toEqual({})
    })
  })

  describe('relationship pattern properties (new)', () => {
    it('parameterises plain property values inline in the relationship pattern', () => {
      const builder = new Builder()
      const { query, params } = builder
        .create('a', 'Attempt')
        .relationship('PROVIDED_ANSWER', 'out', 'pa', undefined, { correct: true, score: 2 })
        .to('q', 'Question')
        .return('pa')
        .build()

      expect(query).toBe(
        'CREATE (a:Attempt)-[pa:`PROVIDED_ANSWER` { correct: $pa_correct, score: $pa_score }]->(q:Question)\nRETURN pa',
      )
      expect(params).toEqual({ pa_correct: true, pa_score: 2 })
    })

    it('renders RawExpression values verbatim for variable-valued properties', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('row')
        .create('a')
        .relationship('PROVIDED_ANSWER', 'out', 'pa', undefined, {
          answers: new RawExpression('row.answers'),
          correct: new RawExpression('row.correct'),
        })
        .to('q')
        .build()

      expect(query).toBe(
        'MATCH (row)\nCREATE (a)-[pa:`PROVIDED_ANSWER` { answers: row.answers, correct: row.correct }]->(q)',
      )
      expect(params).toEqual({})
    })

    it('supports a relationship pattern with properties only', () => {
      const builder = new Builder()
      const { query } = builder
        .create('a')
        .relationship(undefined, 'out', undefined, undefined, {
          correct: new RawExpression('row.correct'),
        })
        .to('q')
        .build()

      expect(query).toBe('CREATE (a)-[ { correct: row.correct }]->(q)')
    })
  })

  describe('variable-valued MERGE properties (new)', () => {
    it('renders RawExpression property values verbatim in the merge pattern', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('cat', 'Category', { slug: new RawExpression('slug') })
        .return('cat')
        .build()

      expect(query).toBe('MERGE (cat:Category { slug: slug })\nRETURN cat')
      expect(params).toEqual({})
    })

    it('still parameterises plain values in merge patterns', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('cat', 'Category', { slug: 'graphs' })
        .return('cat')
        .build()

      expect(query).toBe('MERGE (cat:Category { slug: $cat_slug })\nRETURN cat')
      expect(params).toEqual({ cat_slug: 'graphs' })
    })

    it('merges on a FOREACH-bound variable', () => {
      const builder = new Builder()
      builder.merge('course', 'Course').with('course')
      builder.forEach('row', 'course.categories', (sub) =>
        sub.merge('cat', 'Category', { slug: new RawExpression('row.slug') }),
      )

      const { query, params } = builder.build()

      expect(query).toBe(
        'MERGE (course:Course)\nWITH course\nFOREACH (row IN course.categories | MERGE (cat:Category { slug: row.slug }))',
      )
      expect(params).toEqual({})
    })
  })

  describe('raw expression properties on node patterns (new mechanism)', () => {
    it('renders raw values in match, create and merge patterns alike', () => {
      const matched = new Builder().match('n', 'Person', {
        id: new RawExpression('coalesce($id, n.id)'),
      })
      matched.param('id', 'p-1')
      const created = new Builder().create('n', 'Log', { at: new RawExpression('datetime()') })

      expect(matched.build()).toEqual({
        query: 'MATCH (n:Person { id: coalesce($id, n.id) })',
        params: { id: 'p-1' },
      })
      expect(created.build()).toEqual({
        query: 'CREATE (n:Log { at: datetime() })',
        params: {},
      })
    })
  })

  describe('full port scenario', () => {
    it('expresses the GraphAcademy enrolment write without hand-written Cypher', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('u', 'User', { id: 'u1' })
        .match('q', 'Question', { id: 'q1' })
        .create('e', 'Enrolment')
        .relationship('PROVIDED_ANSWER', 'out', 'pa', undefined, {
          answers: new RawExpression('answers'),
          correct: new RawExpression('correct'),
        })
        .to('q')
        .onCreateSetExpr('e.createdAt', 'datetime()')
        .onCreateSetExpr('e.answers', 'coalesce($answers, [])', { answers: ['a'] })
        .return('e', 'pa')
        .build()

      expect(query).toBe(
        'MATCH (u:User { id: $u_id })\n' +
          'MATCH (q:Question { id: $q_id })\n' +
          'CREATE (e:Enrolment)-[pa:`PROVIDED_ANSWER` { answers: answers, correct: correct }]->(q)\n' +
          'ON CREATE SET e.createdAt = datetime(), e.answers = coalesce($answers, [])\n' +
          'RETURN e, pa',
      )
      expect(params).toEqual({ u_id: 'u1', q_id: 'q1', answers: ['a'] })
    })
  })
})
