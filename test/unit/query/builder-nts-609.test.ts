import { describe, expect, it } from 'vitest'
import { Builder } from '../../../src/query'

describe('Builder pattern parameter names are sanitised and de-duplicated (NTS-609)', () => {
  it('gives two segments with the same alias and key their own parameter', () => {
    const { query, params } = new Builder()
      .create('n', 'User', { name: 'a' })
      .merge('n', 'X', { name: 'b' })
      .build()

    expect(query).toContain('CREATE (n:User { name: $n_name })')
    expect(query).toContain('MERGE (n:X { name: $n_name_2 })')
    expect(params['n_name']).toBe('a')
    expect(params['n_name_2']).toBe('b')
  })

  it('sanitises property keys with non-identifier characters into valid parameter names', () => {
    const { query, params } = new Builder().create('n', 'User', { 'first name': 'Adam' }).build()

    // the rendered parameter reference is a valid identifier — no raw
    // space inside the $name (the property key itself is a separate
    // quoting concern)
    expect(query).toContain('$n_first_name')
    expect(query).not.toContain('$n_first name')
    expect(params['n_first_name']).toBe('Adam')
  })

  it('never reuses a parameter slot that holds undefined', () => {
    const { query, params } = new Builder()
      .match('n', 'Person')
      .where('n.x', undefined)
      .where('n.x', 5)
      .build()

    expect(query).toContain('WHERE (n.x = $where_n_x AND n.x = $where_n_x_2)')
    expect(params['where_n_x']).toBeUndefined()
    expect(params['where_n_x_2']).toBe(5)
  })
})
