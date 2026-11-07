/**
 * Builder API parity checklist vs neode behaviour (NTS-17 / P2.2).
 *
 * Behavioural expectations ported from neode's test/Query/Builder.spec.js,
 * adapted for the deliberate differences of the in-tree builder:
 *
 *  - `whereId` targets `elementId()` (modern servers) instead of `id()`,
 *    and params hold native values (no `neo4j.Integer`).
 *  - A statement's prefix (MATCH / CREATE / ...) renders on the same line
 *    as its pattern, and neode's empty separator lines are dropped.
 *  - `or()` does not open a separate `OR (...)` segment (neode's version
 *    renders an invalid leading `OR (` when called before any condition);
 *    it switches the connector used inside the single WHERE group.
 *  - Multiple return / order / delete values join with `, ` (neode uses `,`).
 *
 * Where neode's tests use internal classes (Model / RelationshipType
 * instances), plain labels and strings are used instead.
 */
import { Builder, Direction, Where, WhereStatement } from '../../../src/query'

describe('QueryBuilder parity with neode (NTS-17 / P2.2)', () => {
  const label = 'Person'

  describe('MATCH basics', () => {
    it('builds a match with a where clause from a plain label string', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label)
        .where('this.property', 'that')
        .return('this')
        .build()

      expect(query).toBe(
        ['MATCH (this:Person)', 'WHERE (this.property = $where_this_property)', 'RETURN this'].join(
          '\n',
        ),
      )
      expect(params).toEqual({ where_this_property: 'that' })
    })

    it('builds a double match query on element ids', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label)
        .whereId('this', '4:uuid:aaa')
        .match('that', label)
        .whereId('that', '4:uuid:bbb')
        .return('this', 'that')
        .build()

      expect(query).toBe(
        [
          'MATCH (this:Person)',
          'WHERE (elementId(this) = $where_this_id)',
          'MATCH (that:Person)',
          'WHERE (elementId(that) = $where_that_id)',
          'RETURN this, that',
        ].join('\n'),
      )
      expect(params).toEqual({ where_this_id: '4:uuid:aaa', where_that_id: '4:uuid:bbb' })
    })

    it('accepts an object in the where clause', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label)
        .where({ 'this.property': 'that' })
        .return('this')
        .build()

      expect(query).toBe(
        ['MATCH (this:Person)', 'WHERE (this.property = $where_this_property)', 'RETURN this'].join(
          '\n',
        ),
      )
      expect(params).toEqual({ where_this_property: 'that' })
    })

    it('accepts an array of where clauses', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label)
        .where([
          ['this.property', 'that'],
          ['this.other_property', 'not that'],
        ])
        .return('this')
        .build()

      expect(query).toBe(
        [
          'MATCH (this:Person)',
          'WHERE (this.property = $where_this_property AND this.other_property = $where_this_other_property)',
          'RETURN this',
        ].join('\n'),
      )
      expect(params).toEqual({
        where_this_property: 'that',
        where_this_other_property: 'not that',
      })
    })

    it('accepts a raw where clause', () => {
      const builder = new Builder()
      const { query } = builder
        .match('this', label)
        .where('this.property = "that"')
        .return('this')
        .build()

      expect(query).toBe(
        ['MATCH (this:Person)', 'WHERE (this.property = "that")', 'RETURN this'].join('\n'),
      )
    })

    it('builds a query with skip and limit', () => {
      const builder = new Builder()
      const { query } = builder.match('this', label).return('this').skip(1).limit(1).build()

      expect(query).toBe(['MATCH (this:Person)', 'RETURN this', 'SKIP 1', 'LIMIT 1'].join('\n'))
    })

    it('builds a query with multiple inline properties', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label, { id: 1, name: 'name' })
        .return('this')
        .build()

      expect(query).toBe(
        ['MATCH (this:Person { id: $this_id, name: $this_name })', 'RETURN this'].join('\n'),
      )
      expect(params).toEqual({ this_id: 1, this_name: 'name' })
    })

    it('builds an optional match with a relationship chain', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .optionalMatch('n')
        .relationship('KNOWS', 'out')
        .to('m', label)
        .return('n', 'm')
        .build()

      expect(query).toBe(
        ['MATCH (n:Person)', 'OPTIONAL MATCH (n)-[:`KNOWS`]->(m:Person)', 'RETURN n, m'].join('\n'),
      )
    })
  })

  describe('orderBy', () => {
    it('supports a single field without a direction', () => {
      const builder = new Builder()
      const { query } = builder.match('n', label).orderBy('n.name').return('n').build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name')
    })

    it('supports (field, direction) with skip and limit ordering', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .return('n')
        .orderBy('n.name', 'ASC')
        .skip(20)
        .limit(10)
        .build()

      expect(query).toBe(
        ['MATCH (n:Person)', 'RETURN n', 'ORDER BY n.name ASC', 'SKIP 20', 'LIMIT 10'].join('\n'),
      )
    })

    it('supports multiple orderBy calls', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .return('n')
        .orderBy('n.name', 'ASC')
        .orderBy('n.other', 'DESC')
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name ASC, n.other DESC')
    })

    it('supports an array of fields', () => {
      const builder = new Builder()
      const { query } = builder.match('n', label).return('n').orderBy(['n.name', 'n.other']).build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name, n.other')
    })

    it('supports an order object', () => {
      const builder = new Builder()
      const { query } = builder.match('n', label).return('n').orderBy({ 'n.name': 'DESC' }).build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name DESC')
    })

    it('supports a single { field, order } descriptor object', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .return('n')
        .orderBy({ field: 'n.name', order: 'DESC' })
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name DESC')
    })

    it('supports an array of { field, order } descriptor objects', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .return('n')
        .orderBy([
          { field: 'n.name', order: 'ASC' },
          { field: 'n.other', order: 'DESC' },
        ])
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name ASC, n.other DESC')
    })

    it('supports a mixed array of fields and descriptor objects', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .return('n')
        .orderBy(['n.name', { field: 'n.other', order: 'DESC' }])
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name, n.other DESC')
    })
  })

  describe('relationships', () => {
    it('supports numeric degrees of 1', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship('KNOWS', 'out', 'r', 1)
        .to('m', label)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`*1]->(m:Person)\nRETURN n')
    })

    it('supports degrees of "1..2"', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship('KNOWS', 'out', 'r', '1..2')
        .to('m', label)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`*1..2]->(m:Person)\nRETURN n')
    })

    it('supports degrees of "0..2" without an alias', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship('KNOWS', 'out', undefined, '0..2')
        .to('m', label)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[:`KNOWS`*0..2]->(m:Person)\nRETURN n')
    })

    it('supports degrees of "..3"', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship('KNOWS', 'out', 'r', '..3')
        .to('m', label)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`*..3]->(m:Person)\nRETURN n')
    })

    it('supports open-ended degrees of ".."', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship('KNOWS', 'out', 'r', '..')
        .to('m', label)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`*..]->(m:Person)\nRETURN n')
    })

    it('supports no degrees', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship('KNOWS', 'out', 'r')
        .to('m', label)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`]->(m:Person)\nRETURN n')
    })

    it('supports an alias without a type', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship(undefined, 'out', 'rel')
        .to('m', label)
        .return('n', 'rel', 'm')
        .build()

      expect(query).toBe('MATCH (n:Person)-[rel]->(m:Person)\nRETURN n, rel, m')
    })

    it('supports a type without an alias', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship('KNOWS', 'out')
        .to('m', label)
        .return('n', 'm')
        .build()

      expect(query).toBe('MATCH (n:Person)-[:`KNOWS`]->(m:Person)\nRETURN n, m')
    })

    it('supports multiple relationship types', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', label)
        .relationship(['REL_1_TO', 'REL_2_TO'], 'out', 'rel')
        .to('m', label)
        .return('n', 'rel', 'm')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)-[rel:`REL_1_TO`|`REL_2_TO`]->(m:Person)\nRETURN n, rel, m',
      )
    })

    it('supports an alias with traversal degrees and target properties', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .relationship('REL_TO', 'out', 'rel', '1..3')
        .to('that', label, { name: 'name' })
        .return('n', 'rel', 'that')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)-[rel:`REL_TO`*1..3]->(that:Person { name: $that_name })\nRETURN n, rel, that',
      )
      expect(params).toEqual({ that_name: 'name' })
    })
  })

  describe('where operators', () => {
    it.each(['=', '<>', '<', '>', '<=', '>='])(
      'supports the %s comparison operator',
      (operator) => {
        const builder = new Builder()
        const { query, params } = builder
          .match('n', label)
          .where('n.age', operator, 30)
          .return('n')
          .build()

        expect(query).toBe(`MATCH (n:Person)\nWHERE (n.age ${operator} $where_n_age)\nRETURN n`)
        expect(params).toEqual({ where_n_age: 30 })
      },
    )

    it('supports the IN operator', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .where('n.tags', 'IN', ['a', 'b'])
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.tags IN $where_n_tags)\nRETURN n')
      expect(params).toEqual({ where_n_tags: ['a', 'b'] })
    })

    it('supports the =~ operator', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .where('n.name', '=~', '.*Adam.*')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.name =~ $where_n_name)\nRETURN n')
      expect(params).toEqual({ where_n_name: '.*Adam.*' })
    })

    it('supports null comparisons', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .where('n.avatar', null)
        .whereNot('n.deprecated', null)
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.avatar = $where_n_avatar AND NOT n.deprecated = $where_n_deprecated)\nRETURN n',
      )
      expect(params).toEqual({ where_n_avatar: null, where_n_deprecated: null })
    })

    it('chains whereNot on the same property with param dedupe', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .whereNot('n.name', 'Adam')
        .whereNot('n.name', 'Lauren')
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (NOT n.name = $where_n_name AND NOT n.name = $where_n_name_2)\nRETURN n',
      )
      expect(params).toEqual({ where_n_name: 'Adam', where_n_name_2: 'Lauren' })
    })

    it('combines whereId, where and or in one group', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .whereId('n', '4:uuid:aaa')
        .where('n.name', 'Adam')
        .or('n.age', '>', 30)
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (elementId(n) = $where_n_id AND n.name = $where_n_name OR n.age > $where_n_age)\nRETURN n',
      )
      expect(params).toEqual({
        where_n_id: '4:uuid:aaa',
        where_n_name: 'Adam',
        where_n_age: 30,
      })
    })
  })

  describe('or/and grouping across multiple where() calls', () => {
    // P2.2 parity (neode Builder#or): neode groups conditions into
    // segments, e.g. `WHERE (a AND b)  OR (c)`. The in-tree builder keeps
    // a single WHERE group; the connector applies per clause, so Cypher's
    // operator precedence (AND binds tighter than OR) keeps the semantics
    // identical to neode's grouped output.
    it('keeps AND for earlier where() calls and switches to OR at the or() call', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .where('n.a', 1)
        .where('n.b', 2)
        .or('n.c', 3)
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.a = $where_n_a AND n.b = $where_n_b OR n.c = $where_n_c)\nRETURN n',
      )
      expect(params).toEqual({ where_n_a: 1, where_n_b: 2, where_n_c: 3 })
    })

    it('returns to AND for where() calls following an or() call', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .where('n.a', 1)
        .or('n.b', 2)
        .where('n.c', 3)
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.a = $where_n_a OR n.b = $where_n_b AND n.c = $where_n_c)\nRETURN n',
      )
      expect(params).toEqual({ where_n_a: 1, where_n_b: 2, where_n_c: 3 })
    })

    it('or() before any where() still renders a valid WHERE group', () => {
      // neode renders `OR (..)` with no leading WHERE here; the port
      // deliberately prefixes the group with WHERE instead.
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .or('n.a', 1)
        .or('n.b', 2)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.a = $where_n_a OR n.b = $where_n_b)\nRETURN n')
      expect(params).toEqual({ where_n_a: 1, where_n_b: 2 })
    })

    it('uses a specific connector (ported from the neode WhereStatement spec)', () => {
      const statement = new WhereStatement('WHERE')
      statement.append(new Where('a', '=', '1'))
      statement.setConnector('OR')
      statement.append(new Where('b', '=', '2'))

      expect(statement.toString()).toBe('WHERE (a = 1 OR b = 2)')
    })
  })

  describe('delete / detachDelete / remove', () => {
    it('builds a delete query', () => {
      const builder = new Builder()
      const { query } = builder.match('this', label).delete('this').return('this').build()

      expect(query).toBe('MATCH (this:Person)\nDELETE this\nRETURN this')
    })

    it('builds a detach delete query', () => {
      const builder = new Builder()
      const { query } = builder.match('this', label).detachDelete('this').build()

      expect(query).toBe('MATCH (this:Person)\nDETACH DELETE this')
    })

    it('deletes multiple aliases across statements', () => {
      const builder = new Builder()
      const { query } = builder.match('a', label).match('b', label).delete('a', 'b').build()

      expect(query).toBe('MATCH (a:Person)\nMATCH (b:Person)\nDELETE a, b')
    })

    it('detach deletes multiple aliases across statements', () => {
      const builder = new Builder()
      const { query } = builder.match('a', label).match('b', label).detachDelete('a', 'b').build()

      expect(query).toBe('MATCH (a:Person)\nMATCH (b:Person)\nDETACH DELETE a, b')
    })

    it('removes properties and labels across aliases', () => {
      const builder = new Builder()
      const { query } = builder
        .match('a', label)
        .match('b', label)
        .remove('a.name', 'a:Temporary', 'b:OldLabel')
        .return('a', 'b')
        .build()

      expect(query).toBe(
        'MATCH (a:Person)\nMATCH (b:Person)\nREMOVE a.name, a:Temporary, b:OldLabel\nRETURN a, b',
      )
    })
  })

  describe('with / withDistinct', () => {
    it('passes multiple variables to with()', () => {
      const builder = new Builder()
      const { query } = builder
        .match('a', label)
        .match('b', label)
        .with('a', 'b')
        .match('c')
        .return('a', 'b', 'c')
        .build()

      expect(query).toBe(
        ['MATCH (a:Person)', 'MATCH (b:Person)', 'WITH a, b', 'MATCH (c)', 'RETURN a, b, c'].join(
          '\n',
        ),
      )
    })

    it('passes multiple variables to withDistinct()', () => {
      const builder = new Builder()
      const { query } = builder
        .match('a', label)
        .match('b', label)
        .withDistinct('a', 'b')
        .return('a', 'b')
        .build()

      expect(query).toBe('MATCH (a:Person)\nMATCH (b:Person)\nWITH DISTINCT a, b\nRETURN a, b')
    })

    it('carries where clauses on both sides of a with()', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('a', label)
        .where('a.name', 'Adam')
        .with('a')
        .match('b', label)
        .where('b.name', 'Lauren')
        .return('a', 'b')
        .build()

      expect(query).toBe(
        [
          'MATCH (a:Person)',
          'WHERE (a.name = $where_a_name)',
          'WITH a',
          'MATCH (b:Person)',
          'WHERE (b.name = $where_b_name)',
          'RETURN a, b',
        ].join('\n'),
      )
      expect(params).toEqual({ where_a_name: 'Adam', where_b_name: 'Lauren' })
    })
  })

  describe('pattern() composition', () => {
    it('composes a multi-hop path on one line without a keyword prefix', () => {
      const builder = new Builder()
      const pattern = builder
        .match('a', label)
        .relationship('KNOWS', Direction.OUTGOING, 'r')
        .to('b', label)
        .relationship('LIKES', Direction.OUTGOING)
        .to('c', label)
        .pattern()

      expect(pattern).toBe('(a:Person)-[r:`KNOWS`]->(b:Person)-[:`LIKES`]->(c:Person)')
    })

    it('renders the same pattern inside a MATCH statement via build()', () => {
      const builder = new Builder()
      const { query } = builder
        .match('a', label)
        .relationship('KNOWS', Direction.OUTGOING, 'r')
        .to('b', label)
        .relationship('LIKES', Direction.OUTGOING)
        .to('c', label)
        .return('a', 'b', 'c')
        .build()

      expect(query).toBe(
        'MATCH (a:Person)-[r:`KNOWS`]->(b:Person)-[:`LIKES`]->(c:Person)\nRETURN a, b, c',
      )
    })
  })

  describe('set variants', () => {
    it('builds a create query with two sets', () => {
      const builder = new Builder()
      const { query, params } = builder
        .create('this', label)
        .set('this.prop1', 'value1')
        .set('this.prop2', 'value2')
        .build()

      expect(query).toBe('CREATE (this:Person)\nSET this.prop1 = $set_0, this.prop2 = $set_1')
      expect(params).toEqual({ set_0: 'value1', set_1: 'value2' })
    })

    it('builds a create query with a relationship and sets', () => {
      const builder = new Builder()
      const { query, params } = builder
        .create('this', label)
        .relationship('REL_TO', 'out')
        .to('that', label)
        .set('this.prop1', 'value1')
        .set('this.prop2', 'value2')
        .return('this', 'rel', 'that')
        .build()

      expect(query).toBe(
        [
          'CREATE (this:Person)-[:`REL_TO`]->(that:Person)',
          'SET this.prop1 = $set_0, this.prop2 = $set_1',
          'RETURN this, rel, that',
        ].join('\n'),
      )
      expect(params).toEqual({ set_0: 'value1', set_1: 'value2' })
    })

    it('accepts an explicit = operator', () => {
      const builder = new Builder()
      const { query } = builder.match('n', label).set('n.name', 'Adam', '=').return('n').build()

      expect(query).toBe('MATCH (n:Person)\nSET n.name = $set_0\nRETURN n')
    })

    it('accepts a += mutation for set with a map value', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label, { id: 1 })
        .set('this', { foo: 'bar' }, '+=')
        .return('this')
        .build()

      expect(query).toBe('MATCH (this:Person { id: $this_id })\nSET this += $set_0\nRETURN this')
      expect(params).toEqual({ this_id: 1, set_0: { foo: 'bar' } })
    })

    it('accepts raw values for set (labels)', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label, { id: 1 })
        .match('that', label, { id: 2 })
        .set('this:Label, that:OtherLabel', undefined)
        .return('this', 'that')
        .build()

      expect(query).toBe(
        [
          'MATCH (this:Person { id: $this_id })',
          'MATCH (that:Person { id: $that_id })',
          'SET this:Label, that:OtherLabel',
          'RETURN this, that',
        ].join('\n'),
      )
      expect(params).toEqual({ this_id: 1, that_id: 2 })
    })

    it('builds a merge query with sets', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('this', label)
        .set('this.prop1', 'value1')
        .set('this.prop2', 'value2')
        .build()

      expect(query).toBe('MERGE (this:Person)\nSET this.prop1 = $set_0, this.prop2 = $set_1')
      expect(params).toEqual({ set_0: 'value1', set_1: 'value2' })
    })

    it('merges with inline properties', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('this', label, { id: 1, name: 'name' })
        .return('this')
        .build()

      expect(query).toBe('MERGE (this:Person { id: $this_id, name: $this_name })\nRETURN this')
      expect(params).toEqual({ this_id: 1, this_name: 'name' })
    })

    it('combines match and merge', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label, { id: 1 })
        .match('that', label, { id: 2 })
        .merge('this')
        .relationship('TO', 'out', 'r')
        .to('that')
        .set('r.value', 'something')
        .return('this', 'r', 'that')
        .build()

      expect(query).toBe(
        [
          'MATCH (this:Person { id: $this_id })',
          'MATCH (that:Person { id: $that_id })',
          'MERGE (this)-[r:`TO`]->(that)',
          'SET r.value = $set_0',
          'RETURN this, r, that',
        ].join('\n'),
      )
      expect(params).toEqual({ this_id: 1, that_id: 2, set_0: 'something' })
    })

    it('combines match, merge, remove, set, onCreateSet and onMatchSet', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('this', label, { id: 1 })
        .match('that', label, { id: 2 })
        .merge('this')
        .relationship('TO', 'out', 'r')
        .to('that')
        .set('r.value', 'something')
        .onCreateSet('r.another', 'something else')
        .onMatchSet('r.number', 10)
        .onMatchSet('r.boolean', true)
        .remove('this:Label', 'that:Label')
        .return('this', 'r', 'that')
        .build()

      expect(query).toBe(
        [
          'MATCH (this:Person { id: $this_id })',
          'MATCH (that:Person { id: $that_id })',
          'MERGE (this)-[r:`TO`]->(that)',
          'REMOVE this:Label, that:Label',
          'ON CREATE SET r.another = $set_1',
          'ON MATCH SET r.number = $set_2, r.boolean = $set_3',
          'SET r.value = $set_0',
          'RETURN this, r, that',
        ].join('\n'),
      )
      expect(params).toEqual({
        this_id: 1,
        that_id: 2,
        set_0: 'something',
        set_1: 'something else',
        set_2: 10,
        set_3: true,
      })
    })

    it('accepts object maps for set, onCreateSet and onMatchSet', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('n', label, { id: 1 })
        .set({ 'r.value': 'something' })
        .onCreateSet({ 'r.another': 'something else' })
        .onMatchSet({ 'r.number': 10 })
        .onMatchSet({ 'r.boolean': true })
        .return('n')
        .build()

      expect(query).toBe(
        [
          'MERGE (n:Person { id: $n_id })',
          'ON CREATE SET r.another = $set_1',
          'ON MATCH SET r.number = $set_2, r.boolean = $set_3',
          'SET r.value = $set_0',
          'RETURN n',
        ].join('\n'),
      )
      expect(params).toEqual({
        n_id: 1,
        set_0: 'something',
        set_1: 'something else',
        set_2: 10,
        set_3: true,
      })
    })

    it('accepts += mutations for onCreateSet and onMatchSet', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('n', label, { id: 1 })
        .onCreateSet('n', { foo: 'bar' }, '+=')
        .onMatchSet('n', { foo: 'baz' }, '+=')
        .return('n')
        .build()

      expect(query).toBe(
        [
          'MERGE (n:Person { id: $n_id })',
          'ON CREATE SET n += $set_0',
          'ON MATCH SET n += $set_1',
          'RETURN n',
        ].join('\n'),
      )
      expect(params).toEqual({ n_id: 1, set_0: { foo: 'bar' }, set_1: { foo: 'baz' } })
    })
  })

  describe('build() param isolation', () => {
    it('namespaces inline property params by alias across statements', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label, { id: 1 })
        .match('m', label, { id: 1 })
        .return('n', 'm')
        .build()

      expect(query).toBe(
        'MATCH (n:Person { id: $n_id })\nMATCH (m:Person { id: $m_id })\nRETURN n, m',
      )
      expect(params).toEqual({ n_id: 1, m_id: 1 })
    })

    it('dedupes where params with the same property across statements', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', label)
        .where('n.name', 'Adam')
        .with('n')
        .match('m')
        .where('n.name', 'Lauren')
        .return('n', 'm')
        .build()

      expect(query).toBe(
        [
          'MATCH (n:Person)',
          'WHERE (n.name = $where_n_name)',
          'WITH n',
          'MATCH (m)',
          'WHERE (n.name = $where_n_name_2)',
          'RETURN n, m',
        ].join('\n'),
      )
      expect(params).toEqual({ where_n_name: 'Adam', where_n_name_2: 'Lauren' })
    })

    it('shares one set param counter across set, onCreateSet and onMatchSet', () => {
      const builder = new Builder()
      const { params } = builder
        .merge('n', label)
        .set('n.a', 1)
        .onCreateSet('n.b', 2)
        .onMatchSet('n.c', 3)
        .set('n.d', 4)
        .build()

      expect(params).toEqual({ set_0: 1, set_1: 2, set_2: 3, set_3: 4 })
    })

    it('does not leak params between separate builder instances', () => {
      const first = new Builder().match('n', label).where('n.name', 'Adam').return('n').build()
      const second = new Builder().match('n', label).where('n.name', 'Lauren').return('n').build()

      expect(first.params).toEqual({ where_n_name: 'Adam' })
      expect(second.params).toEqual({ where_n_name: 'Lauren' })
    })
  })
})
