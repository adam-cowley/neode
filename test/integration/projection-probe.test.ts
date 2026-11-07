import { openBackend, TestBackend } from './support/backend'

/**
 * Capability probe (NTS-136/137/138): assert the embedded Relate engine
 * supports the Cypher subquery / comprehension forms the projection
 * decorators compile down to. Everything else in the projection suite is
 * built on these forms.
 */
describe('Relate Cypher probe: projection subquery forms', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('COUNT { } with a pattern-only subquery', async () => {
    await backend.connection.run(
      'CREATE (:ProjectionProbe { name: "root" })-[:PROBE_REL]->(:ProjectionProbe { name: "child" })',
    )

    const res = await backend.connection.run(
      'MATCH (n:ProjectionProbe { name: "root" }) RETURN COUNT { (n)-[:PROBE_REL]->(node) } AS count',
    )

    expect(res.records[0].get('count')).toBe(1)
  })

  it('COUNT { } with multi-type, variable-length pattern and WHERE', async () => {
    const res = await backend.connection.run(
      'MATCH (n:ProjectionProbe { name: "root" }) ' +
        'RETURN COUNT { (n)-[:PROBE_REL|PROBE_OTHER*1..2]->(node) WHERE NOT node:ProjectionSkip } AS count',
    )

    expect(Number(res.records[0].get('count'))).toBeGreaterThanOrEqual(0)
  })

  it('EXISTS { } with a WHERE clause', async () => {
    const res = await backend.connection.run(
      'MATCH (n:ProjectionProbe { name: "root" }) ' +
        'RETURN EXISTS { (n)-[:PROBE_REL]->(node) WHERE node.name = "child" } AS present',
    )

    expect(res.records[0].get('present')).toBe(true)
  })

  it('pattern comprehension: map projection and scalar projection', async () => {
    const res = await backend.connection.run(
      'MATCH (n:ProjectionProbe { name: "root" }) ' +
        'RETURN [ (n)-[:PROBE_REL]->(node) | node { .name } ][0] AS first, ' +
        '[ (n)-[:PROBE_REL]->(node) | node.name ] AS names',
    )

    expect(res.records[0].get('first')).toEqual({ name: 'child' })
    expect(res.records[0].get('names')).toEqual(['child'])
  })

  it('label predicate', async () => {
    const res = await backend.connection.run(
      'MATCH (n:ProjectionProbe { name: "root" }) RETURN n:ProjectionProbe AS present, n:ProjectionSkip AS absent',
    )

    expect(res.records[0].get('present')).toBe(true)
    expect(res.records[0].get('absent')).toBe(false)
  })
})
