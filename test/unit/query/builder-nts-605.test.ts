import { Builder } from '../../../src/query'

// NTS-605 — inline pattern property keys are identifiers in the pattern:
// hostile schema/map keys (`x}) RETURN n //`) must not break out of the
// `{ … }` map, and non-identifier keys (`first-name`) must stay valid
// Cypher. Keys are backtick-quoted; values stay bound as parameters.
describe('NTS-605 — non-identifier property keys in patterns and SETs', () => {
  it('backtick-quotes hostile and hyphenated keys in an inline CREATE pattern, values as parameters', () => {
    const builder = new Builder()
    const { query, params } = builder
      .create('n', 'Person', { 'x}) RETURN n //': 'pwned', 'first-name': 'Adam' })
      .return('n')
      .build()

    expect(query).toBe(
      'CREATE (n:Person { `x}) RETURN n //`: $n_x_RETURN_n_, `first-name`: $n_first_name })\nRETURN n',
    )
    expect(params).toEqual({ n_x_RETURN_n_: 'pwned', n_first_name: 'Adam' })
  })

  it('backtick-quotes non-identifier keys in an inline MATCH pattern', () => {
    const builder = new Builder()
    const { query, params } = builder
      .match('n', 'Person', { 'first-name': 'Adam' })
      .return('n')
      .build()

    expect(query).toBe('MATCH (n:Person { `first-name`: $n_first_name })\nRETURN n')
    expect(params).toEqual({ n_first_name: 'Adam' })
  })

  it('quotes the property-key segment of a SET reference, leaving pre-quoted segments alone', () => {
    const builder = new Builder()
    const { query, params } = builder
      .create('n', 'Person')
      .set('n.x}) RETURN n //', 1)
      .set('rel.`some key`', 2)
      .set('this', { amount: 3 }, '+=')
      .return('n')
      .build()

    expect(query).toBe(
      'CREATE (n:Person)\nSET n.`x}) RETURN n //` = $set_0, rel.`some key` = $set_1, this += $set_2\nRETURN n',
    )
    expect(params).toEqual({ set_0: 1, set_1: 2, set_2: { amount: 3 } })
  })
})
