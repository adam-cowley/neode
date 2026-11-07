import { describe, expect, it } from 'vitest'
import { Builder } from '../../../src/query'

// NTS-491: a statement mixing parameterised onCreateSet/onMatchSet items with
// expression items (onCreateSetExpr/onMatchSetExpr) must render ONE clause per
// kind — two separate `ON CREATE SET` clauses is invalid Cypher.

describe('Builder: coalesced ON CREATE/ON MATCH SET clauses (NTS-491)', () => {
  it('renders mixed parameterised and expression ON CREATE SET items as one clause', () => {
    const { query, params } = new Builder()
      .merge('u', ['User'], { sub: 'sub-1' })
      .onCreateSet('u.name', 'Adam')
      .onCreateSetExpr('u.createdAt', 'datetime()')
      .onCreateSet('u.email', 'adam@example.com')
      .build()

    expect(query).toContain(
      'ON CREATE SET u.name = $set_0, u.createdAt = datetime(), u.email = $set_1',
    )
    expect(query.match(/ON CREATE SET/g)).toHaveLength(1)
    expect(params).toEqual({ u_sub: 'sub-1', set_0: 'Adam', set_1: 'adam@example.com' })
  })

  it('renders mixed parameterised and expression ON MATCH SET items as one clause', () => {
    const { query, params } = new Builder()
      .merge('u', ['User'], { sub: 'sub-1' })
      .onMatchSetExpr('u.updatedAt', 'datetime()')
      .onMatchSet('u.views', 1, '+=')
      .build()

    expect(query).toContain('ON MATCH SET u.updatedAt = datetime(), u.views += $set_0')
    expect(query.match(/ON MATCH SET/g)).toHaveLength(1)
    expect(params).toEqual({ u_sub: 'sub-1', set_0: 1 })
  })

  it('coalesces both kinds in one statement — one clause each', () => {
    const { query, params } = new Builder()
      .merge('u', ['User'], { sub: 'sub-1' })
      .onCreateSet('u.name', 'Adam')
      .onCreateSetExpr('u.createdAt', 'datetime()')
      .onMatchSet('u.views', 1)
      .onMatchSetExpr('u.updatedAt', 'datetime()')
      .build()

    expect(query.match(/ON CREATE SET/g)).toHaveLength(1)
    expect(query.match(/ON MATCH SET/g)).toHaveLength(1)
    expect(query).toContain('ON CREATE SET u.name = $set_0, u.createdAt = datetime()')
    expect(query).toContain('ON MATCH SET u.views = $set_1, u.updatedAt = datetime()')
    expect(params).toEqual({ u_sub: 'sub-1', set_0: 'Adam', set_1: 1 })
  })

  it('keeps parameterised-only ON CREATE SET rendering unchanged', () => {
    const { query, params } = new Builder()
      .merge('u', ['User'], { sub: 'sub-1' })
      .onCreateSet('u.name', 'Adam')
      .onCreateSet('u.email', 'adam@example.com')
      .build()

    expect(query).toContain('ON CREATE SET u.name = $set_0, u.email = $set_1')
    expect(query.match(/ON CREATE SET/g)).toHaveLength(1)
    expect(query).not.toContain('ON MATCH SET')
    expect(params).toEqual({ u_sub: 'sub-1', set_0: 'Adam', set_1: 'adam@example.com' })
  })

  it('keeps expression-only ON MATCH SET rendering unchanged', () => {
    const { query, params } = new Builder()
      .merge('u', ['User'], { sub: 'sub-1' })
      .onMatchSetExpr('u.updatedAt', 'datetime()')
      .onMatchSetExpr('u.slug', 'u.sub')
      .build()

    expect(query).toContain('ON MATCH SET u.updatedAt = datetime(), u.slug = u.sub')
    expect(query.match(/ON MATCH SET/g)).toHaveLength(1)
    expect(query).not.toContain('ON CREATE SET')
    expect(params).toEqual({ u_sub: 'sub-1' })
  })
})
