import { describe, expect, it } from 'vitest'
import { Builder } from '../../../src/query'
import { NeodeError } from '../../../src/errors'

// NTS-687: UNION / UNION ALL between query branches. A branch is a scope
// boundary: parameters bind independently (collision-renamed), no WITH *
// write->read bridge crosses the boundary, and tail ORDER BY / LIMIT after
// the final branch apply to the union result.

describe('Builder: UNION (NTS-687)', () => {
  it('renders UNION between two branches, binding each branch independently', () => {
    const { query, params } = new Builder()
      .match('u', 'User', { sub: 'sub-1' })
      .return('u.name AS name')
      .union()
      .match('t', 'Team', { id: 'team-1' })
      .return('t.name AS name')
      .build()

    expect(query).toBe(
      [
        'MATCH (u:User { sub: $u_sub })',
        'RETURN u.name AS name',
        'UNION',
        'MATCH (t:Team { id: $t_id })',
        'RETURN t.name AS name',
      ].join('\n'),
    )
    expect(params).toEqual({ u_sub: 'sub-1', t_id: 'team-1' })
  })

  it('collision-renames parameters when branches share aliases (NTS-609 loop)', () => {
    const { params } = new Builder()
      .match('u', 'User', { sub: 'first' })
      .return('u.name AS name')
      .union()
      .match('u', 'User', { sub: 'second' })
      .return('u.name AS name')
      .build()

    expect(params).toEqual({ u_sub: 'first', u_sub_2: 'second' })
  })

  it('unionAll() renders UNION ALL', () => {
    const { query } = new Builder()
      .match('u', 'User')
      .return('u.name AS name')
      .unionAll()
      .match('t', 'Team')
      .return('t.name AS name')
      .build()

    expect(query).toContain('\nUNION ALL\n')
  })

  it('WHERE clauses stay inside their branch', () => {
    const { query } = new Builder()
      .match('u', 'User')
      .where('u.age', '>', 30)
      .return('u.name AS name')
      .union()
      .match('t', 'Team')
      .return('t.name AS name')
      .build()

    expect(query).toBe(
      [
        'MATCH (u:User)',
        'WHERE (u.age > $where_u_age)',
        'RETURN u.name AS name',
        'UNION',
        'MATCH (t:Team)',
        'RETURN t.name AS name',
      ].join('\n'),
    )
  })

  it('tail orderBy / limit after the final branch apply to the union result', () => {
    const { query } = new Builder()
      .match('u', 'User')
      .return('u.name AS name')
      .union()
      .match('t', 'Team')
      .return('t.name AS name')
      .orderBy('name')
      .limit(10)
      .build()

    expect(query).toBe(
      [
        'MATCH (u:User)',
        'RETURN u.name AS name',
        'UNION',
        'MATCH (t:Team)',
        'RETURN t.name AS name',
        'ORDER BY name',
        'LIMIT 10',
      ].join('\n'),
    )
  })

  it('injects no WITH * bridge into the next branch after a CREATE branch', () => {
    const { query } = new Builder()
      .create('u', 'User', { sub: 'sub-1' })
      .return('u.name AS name')
      .union()
      .match('t', 'Team')
      .return('t.name AS name')
      .build()

    expect(query).toBe(
      [
        'CREATE (u:User { sub: $u_sub })',
        'RETURN u.name AS name',
        'UNION',
        'MATCH (t:Team)',
        'RETURN t.name AS name',
      ].join('\n'),
    )
  })

  it('fails fast when union() follows a branch without a RETURN', () => {
    expect(() =>
      new Builder().match('u', 'User').union().match('t', 'Team').return('t.name AS name').build(),
    ).toThrow(NeodeError)
  })

  it('fails fast when the final branch is left without a RETURN', () => {
    expect(() =>
      new Builder().match('u', 'User').return('u.name AS name').union().match('t', 'Team').build(),
    ).toThrow(NeodeError)
  })
})
