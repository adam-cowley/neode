import { Builder, Direction } from '../../../src/query'

describe('QueryBuilder', () => {
  describe('match', () => {
    it('builds a basic match and return', () => {
      const builder = new Builder()
      const { query, params } = builder.match('n', 'Person').return('n').build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n')
      expect(params).toEqual({})
    })

    it('supports multiple labels', () => {
      const builder = new Builder()
      const { query } = builder.match('n', ['Person', 'Employee']).return('n').build()

      expect(query).toBe('MATCH (n:Person:Employee)\nRETURN n')
    })

    it('supports match without a model', () => {
      const builder = new Builder()
      const { query } = builder.match('n').return('n').build()

      expect(query).toBe('MATCH (n)\nRETURN n')
    })

    it('converts properties into parameters', () => {
      const builder = new Builder()
      const { query, params } = builder.match('n', 'Person', { name: 'Adam' }).return('n').build()

      expect(query).toBe('MATCH (n:Person { name: $n_name })\nRETURN n')
      expect(params).toEqual({ n_name: 'Adam' })
    })

    it('supports optional match', () => {
      const builder = new Builder()
      const { query } = builder.optionalMatch('n').return('n').build()

      expect(query).toBe('OPTIONAL MATCH (n)\nRETURN n')
    })
  })

  describe('where', () => {
    it('supports two argument form', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where('n.name', 'Adam')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.name = $where_n_name)\nRETURN n')
      expect(params).toEqual({ where_n_name: 'Adam' })
    })

    it('supports operator form', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where('n.age', '>', 30)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.age > $where_n_age)\nRETURN n')
      expect(params).toEqual({ where_n_age: 30 })
    })

    it('supports object form', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where({ name: 'Adam', age: 30 })
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (name = $where_name AND age = $where_age)\nRETURN n',
      )
      expect(params).toEqual({ where_name: 'Adam', where_age: 30 })
    })

    it('supports array of where clauses', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where([
          ['name', 'Adam'],
          ['age', '>', 30],
        ])
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (name = $where_name AND age > $where_age)\nRETURN n',
      )
      expect(params).toEqual({ where_name: 'Adam', where_age: 30 })
    })

    it('supports raw string where', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereRaw('n.name =~ ".*Adam.*"')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.name =~ ".*Adam.*")\nRETURN n')
    })

    it('deduplicates parameter names', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where('n.name', 'Adam')
        .or('n.name', 'Ada')
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.name = $where_n_name OR n.name = $where_n_name_2)\nRETURN n',
      )
      expect(params).toEqual({ where_n_name: 'Adam', where_n_name_2: 'Ada' })
    })

    it('supports or', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .or('n.name', 'Adam')
        .or('n.name', 'Ada')
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.name = $where_n_name OR n.name = $where_n_name_2)\nRETURN n',
      )
      expect(params).toEqual({ where_n_name: 'Adam', where_n_name_2: 'Ada' })
    })

    it('supports parenthesised where groups', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where('n.age', '>', 30)
        .whereGroup((g) => g.where('n.name', 'Adam').or().where('n.name', 'Ada'))
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.age > $where_n_age AND (n.name = $where_n_name OR n.name = $where_n_name_2))\nRETURN n',
      )
      expect(params).toEqual({ where_n_age: 30, where_n_name: 'Adam', where_n_name_2: 'Ada' })
    })

    it('joins a where group with or', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where('n.name', 'Adam')
        .or()
        .whereGroup((g) => g.where('n.age', '>', 30).where('n.age', '<', 40))
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.name = $where_n_name OR (n.age > $where_n_age AND n.age < $where_n_age_2))\nRETURN n',
      )
      expect(params).toEqual({ where_n_name: 'Adam', where_n_age: 30, where_n_age_2: 40 })
    })

    it('supports nested groups', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereGroup((g) =>
          g
            .where('n.name', 'Adam')
            .whereGroup((h) => h.where('n.age', '>', 30).or().whereNull('n.age')),
        )
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE ((n.name = $where_n_name AND (n.age > $where_n_age OR n.age IS NULL)))\nRETURN n',
      )
    })

    it('ignores an empty group', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where('n.name', 'Adam')
        .whereGroup((g) => g)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.name = $where_n_name)\nRETURN n')
      expect(params).toEqual({ where_n_name: 'Adam' })
    })

    it('supports whereId with elementId', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .whereId('n', '4:uuid:abc123')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (elementId(n) = $where_n_id)\nRETURN n')
      expect(params).toEqual({ where_n_id: '4:uuid:abc123' })
    })

    it('supports whereNot', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').whereNot('n.name', 'Adam').return('n').build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (NOT n.name = $where_n_name)\nRETURN n')
    })

    it('renders where NOT IN as NOT <left> IN, the form Neo4j 2026.x+ accepts (NTS-476)', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .where('n.age', 'NOT IN', [30, 40])
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (NOT n.age IN $where_n_age)\nRETURN n')
      expect(params).toEqual({ where_n_age: [30, 40] })
    })

    it('cancels whereNot against the NOT IN operator instead of double-negating', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereNot('n.age', 'NOT IN', [30, 40])
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.age IN $where_n_age)\nRETURN n')
    })

    it('matches the NOT IN operator case-insensitively', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .where('n.age', 'not in', [30, 40])
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (NOT n.age IN $where_n_age)\nRETURN n')
    })

    it('supports whereBetween and whereNotBetween', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .whereBetween('n.age', 30, 40)
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE ($where_n_age_floor <= n.age <= $where_n_age_ceiling)\nRETURN n',
      )
      expect(params).toEqual({ where_n_age_floor: 30, where_n_age_ceiling: 40 })

      const builder2 = new Builder()
      const { query: query2 } = builder2
        .match('n', 'Person')
        .whereNotBetween('n.age', 30, 40)
        .return('n')
        .build()

      expect(query2).toBe(
        'MATCH (n:Person)\nWHERE (NOT $where_n_age_floor <= n.age <= $where_n_age_ceiling)\nRETURN n',
      )
    })
  })

  describe('with', () => {
    it('supports with', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').with('n').match('m').return('n', 'm').build()

      expect(query).toBe('MATCH (n:Person)\nWITH n\nMATCH (m)\nRETURN n, m')
    })

    it('supports with distinct', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').withDistinct('n').return('n').build()

      expect(query).toBe('MATCH (n:Person)\nWITH DISTINCT n\nRETURN n')
    })
  })

  describe('set', () => {
    it('supports set with parameters', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .set('n.name', 'Adam')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nSET n.name = $set_0\nRETURN n')
      expect(params).toEqual({ set_0: 'Adam' })
    })

    it('supports set with operator', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .set('n.tags', ['a'], '+=')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nSET n.tags += $set_0\nRETURN n')
      expect(params).toEqual({ set_0: ['a'] })
    })

    it('supports set with a map', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .set({ 'n.name': 'Adam', 'n.age': 30 })
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nSET n.name = $set_0, n.age = $set_1\nRETURN n')
      expect(params).toEqual({ set_0: 'Adam', set_1: 30 })
    })

    it('supports raw set when value is undefined', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .set('n.age = n.age + 1', undefined)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nSET n.age = n.age + 1\nRETURN n')
      expect(params).toEqual({})
    })

    it('supports onCreateSet and onMatchSet', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('n', 'Person', { name: 'Adam' })
        .onCreateSet('n.createdAt', 12345)
        .onMatchSet('n.updatedAt', 67890)
        .return('n')
        .build()

      expect(query).toBe(
        'MERGE (n:Person { name: $n_name })\nON CREATE SET n.createdAt = $set_0\nON MATCH SET n.updatedAt = $set_1\nRETURN n',
      )
      expect(params).toEqual({ n_name: 'Adam', set_0: 12345, set_1: 67890 })
    })

    it('supports remove', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .remove('n.name', 'n:Temporary')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nREMOVE n.name, n:Temporary\nRETURN n')
    })
  })

  describe('delete', () => {
    it('supports delete', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').delete('n').build()

      expect(query).toBe('MATCH (n:Person)\nDELETE n')
    })

    it('supports detach delete', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').detachDelete('n').build()

      expect(query).toBe('MATCH (n:Person)\nDETACH DELETE n')
    })
  })

  describe('merge', () => {
    it('matches on every label when given several', () => {
      const builder = new Builder()
      const { query, params } = builder
        .merge('n', ['Person', 'Admin'], { name: 'Adam' })
        .return('n')
        .build()

      expect(query).toBe('MERGE (n:Person:Admin { name: $n_name })\nRETURN n')
      expect(params).toEqual({ n_name: 'Adam' })
    })
  })

  describe('create', () => {
    it('builds a create statement', () => {
      const builder = new Builder()
      const { query, params } = builder.create('n', 'Person', { name: 'Adam' }).return('n').build()

      expect(query).toBe('CREATE (n:Person { name: $n_name })\nRETURN n')
      expect(params).toEqual({ n_name: 'Adam' })
    })

    it('writes every label when given several', () => {
      const builder = new Builder()
      const { query, params } = builder
        .create('n', ['Person', 'Admin'], { name: 'Adam' })
        .return('n')
        .build()

      expect(query).toBe('CREATE (n:Person:Admin { name: $n_name })\nRETURN n')
      expect(params).toEqual({ n_name: 'Adam' })
    })
  })

  describe('orderBy, skip and limit', () => {
    it('supports orderBy with field and direction', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').orderBy('n.name', 'DESC').return('n').build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name DESC')
    })

    it('supports orderBy with object', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .orderBy({ 'n.name': 'ASC' })
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name ASC')
    })

    it('supports skip and limit', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').return('n').skip(10).limit(5).build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nSKIP 10\nLIMIT 5')
    })
  })

  describe('relationships', () => {
    it('builds an outgoing relationship', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .relationship('KNOWS', Direction.OUTGOING, 'r')
        .to('m', 'Person')
        .return('n', 'm')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`]->(m:Person)\nRETURN n, m')
    })

    it('builds an incoming relationship', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .relationship('KNOWS', Direction.INCOMING, 'r')
        .to('m', 'Person')
        .return('n', 'm')
        .build()

      expect(query).toBe('MATCH (n:Person)<-[r:`KNOWS`]-(m:Person)\nRETURN n, m')
    })

    it('builds a bidirectional relationship', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .relationship('KNOWS', Direction.BOTH, 'r')
        .to('m', 'Person')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`]-(m:Person)\nRETURN n')
    })

    it('supports degrees of separation', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .relationship('KNOWS', Direction.OUTGOING, 'r', '1..3')
        .to('m', 'Person')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`*1..3]->(m:Person)\nRETURN n')
    })

    it('supports relationships without a type', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .relationship(undefined, Direction.OUTGOING)
        .toAnything()
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-->()\nRETURN n')
    })
    it('supports multiple relationship types', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .relationship(['KNOWS', 'LIKES'], Direction.OUTGOING, 'r')
        .to('m')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)-[r:`KNOWS`|`LIKES`]->(m)\nRETURN n')
    })
  })

  describe('pattern', () => {
    it('builds a pattern without keywords', () => {
      const builder = new Builder()
      const pattern = builder
        .match('n', 'Person')
        .relationship('KNOWS', Direction.OUTGOING, 'r')
        .to('m', 'Person')
        .pattern()

      expect(pattern.trim()).toBe('(n:Person)-[r:`KNOWS`]->(m:Person)')
    })
  })

  describe('chained statements', () => {
    it('inserts WITH * between a create and a chained match', () => {
      const builder = new Builder()
      const { query } = builder
        .create('n', 'Person', { name: 'Adam' })
        .match('m', 'Person')
        .return('n', 'm')
        .build()

      // Neo4j rejects "WITH is required between CREATE and MATCH"
      expect(query).toBe(
        'CREATE (n:Person { name: $n_name })\nWITH *\nMATCH (m:Person)\nRETURN n, m',
      )
    })

    it('inserts WITH * between a merge and a chained match', () => {
      const builder = new Builder()
      const { query } = builder.merge('n', 'Person').match('m', 'Person').return('n', 'm').build()

      expect(query).toBe('MERGE (n:Person)\nWITH *\nMATCH (m:Person)\nRETURN n, m')
    })

    it('chains create and merge without a WITH (updating clauses may follow each other)', () => {
      const builder = new Builder()
      const { query } = builder
        .create('a', 'Person', { name: 'Adam' })
        .merge('b', 'Person', { name: 'Ada' })
        .return('a', 'b')
        .build()

      expect(query).toBe(
        'CREATE (a:Person { name: $a_name })\nMERGE (b:Person { name: $b_name })\nRETURN a, b',
      )
    })

    it('does not add a WITH when the user already supplied one between create and match', () => {
      const builder = new Builder()
      const { query } = builder
        .create('n', 'Person')
        .with('n')
        .match('m', 'Person')
        .return('n', 'm')
        .build()

      expect(query).toBe('CREATE (n:Person)\nWITH n\nMATCH (m:Person)\nRETURN n, m')
    })

    it('inserts WITH * between a delete and a chained match', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .where('n.name', 'Adam')
        .delete('n')
        .match('m', 'Person')
        .return('m')
        .build()

      // Neo4j rejects "WITH is required between DELETE and MATCH" (42N24)
      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.name = $where_n_name)\nDELETE n\nWITH *\nMATCH (m:Person)\nRETURN m',
      )
    })

    it('inserts WITH * between a detach delete and a chained optional match', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .detachDelete('n')
        .optionalMatch('m', 'Person')
        .return('m')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nDETACH DELETE n\nWITH *\nOPTIONAL MATCH (m:Person)\nRETURN m',
      )
    })

    it('does not add a WITH when the user already supplied one between delete and match', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .delete('n')
        .with('n')
        .match('m', 'Person')
        .return('n', 'm')
        .build()

      expect(query).toBe('MATCH (n:Person)\nDELETE n\nWITH n\nMATCH (m:Person)\nRETURN n, m')
    })

    it('chains delete and create without a WITH (updating clauses may follow each other)', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .delete('n')
        .create('m', 'Person', { name: 'Ada' })
        .return('m')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nDELETE n\nCREATE (m:Person { name: $m_name })\nRETURN m',
      )
    })

    it('supports multiple create/match statements in sequence', () => {
      const builder = new Builder()
      const { query } = builder
        .match('a', 'Person')
        .where('a.name', 'Adam')
        .create('b', 'Person', { name: 'Ada' })
        .relationship('KNOWS', Direction.OUTGOING, 'r')
        .to('a')
        .return('b')
        .build()

      expect(query).toBe(
        'MATCH (a:Person)\nWHERE (a.name = $where_a_name)\nCREATE (b:Person { name: $b_name })-[r:`KNOWS`]->(a)\nRETURN b',
      )
    })
  })

  describe('list and string predicates', () => {
    it('supports whereIn', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .whereIn('n.name', ['Adam', 'Ada'])
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.name IN $where_n_name)\nRETURN n')
      expect(params).toEqual({ where_n_name: ['Adam', 'Ada'] })
    })

    it('supports whereContains, whereStartsWith and whereEndsWith', () => {
      const builder = new Builder()
      const { query, params } = builder
        .match('n', 'Person')
        .whereContains('n.name', 'Ada')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.name CONTAINS $where_n_name)\nRETURN n')
      expect(params).toEqual({ where_n_name: 'Ada' })

      const builder2 = new Builder()
      const { query: query2 } = builder2
        .match('n', 'Person')
        .whereStartsWith('n.name', 'Ada')
        .return('n')
        .build()

      expect(query2).toBe('MATCH (n:Person)\nWHERE (n.name STARTS WITH $where_n_name)\nRETURN n')

      const builder3 = new Builder()
      const { query: query3 } = builder3
        .match('n', 'Person')
        .whereEndsWith('n.name', 'am')
        .return('n')
        .build()

      expect(query3).toBe('MATCH (n:Person)\nWHERE (n.name ENDS WITH $where_n_name)\nRETURN n')
    })

    it('supports whereNot with the string predicates', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereNot('n.name', 'Ada')
        .whereContains('n.name', 'Ada')
        .return('n')
        .build()

      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (NOT n.name = $where_n_name AND n.name CONTAINS $where_n_name_2)\nRETURN n',
      )
    })

    it('joins whereIn with the clause before it using and', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .where('n.age', '>', 30)
        .or('n.name', 'Adam')
        .whereIn('n.name', ['Adam', 'Ada'])
        .return('n')
        .build()

      // Connectors are per clause: the or() applies to the clause
      // after it, the whereIn rejoins with AND (AND binds tighter)
      expect(query).toBe(
        'MATCH (n:Person)\nWHERE (n.age > $where_n_age OR n.name = $where_n_name AND n.name IN $where_n_name_2)\nRETURN n',
      )
    })
  })

  describe('null predicates', () => {
    it('supports whereNull and whereNotNull', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').whereNull('n.deletedAt').return('n').build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n.deletedAt IS NULL)\nRETURN n')

      const builder2 = new Builder()
      const { query: query2 } = builder2
        .match('n', 'Person')
        .whereNotNull('n.deletedAt')
        .return('n')
        .build()

      expect(query2).toBe('MATCH (n:Person)\nWHERE (n.deletedAt IS NOT NULL)\nRETURN n')
    })
  })

  describe('subquery predicates', () => {
    it('supports whereExists with a pattern fragment', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereExists('(n)-[:KNOWS]->(:Person)')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (EXISTS { (n)-[:KNOWS]->(:Person) })\nRETURN n')
    })

    it('supports whereAny over a list expression', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereAny('t', 'n.tags', "t = 'admin'")
        .return('n')
        .build()

      expect(query).toBe("MATCH (n:Person)\nWHERE (ANY(t IN n.tags WHERE t = 'admin'))\nRETURN n")
    })
  })

  describe('whereLabel', () => {
    it('adds a label predicate', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereLabel('n', 'Completed')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n:Completed)\nRETURN n')
    })

    it('supports multiple labels', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereLabel('n', ['Completed', 'Archived'])
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n:Completed:Archived)\nRETURN n')
    })

    it('supports negation', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereLabel('n', 'Completed', true)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (NOT n:Completed)\nRETURN n')
    })

    it('composes with other predicates through or', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .whereLabel('n', 'Completed')
        .or('n.age', '>', 30)
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nWHERE (n:Completed OR n.age > $where_n_age)\nRETURN n')
    })
  })

  describe('orderBy expressions and labels', () => {
    it('supports raw expression fragments', () => {
      const builder = new Builder()
      const { query } = builder.match('n', 'Person').orderBy('size(n.pets)').return('n').build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY size(n.pets)')
    })

    it('supports label predicates via orderByLabel', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .orderByLabel('n', 'Completed', 'DESC')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n:Completed DESC')
    })

    it('supports orderByLabel without a direction and with multiple labels', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .orderByLabel('n', ['A', 'B'])
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n:A:B')
    })

    it('accepts a label predicate directly through orderBy', () => {
      const builder = new Builder()
      const { query } = builder
        .match('n', 'Person')
        .orderBy('n:Completed', 'DESC')
        .return('n')
        .build()

      expect(query).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n:Completed DESC')
    })
  })
})
