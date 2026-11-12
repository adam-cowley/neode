// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import { Builder } from '../../src/query'

describe('Query builder predicates (live engine)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    // Adam KNOWS Ada; only Adam has a deletion stamp and the admin tag
    await backend.connection.run(
      'CREATE (:Person { name: "Adam", deletedAt: "2026-01-01", tags: ["admin", "dev"] })' +
        '-[:KNOWS]->(:Person { name: "Ada", tags: ["dev"] })',
    )
  })

  afterAll(async () => {
    await backend.clearGraph()
    await backend.close()
  })

  const run = async (configure: (builder: Builder) => Builder): Promise<string[]> => {
    const builder = configure(new Builder().match('n', 'Person'))

    const { query, params } = builder.return('n.name AS name').build()
    const result = await backend.neode.readCypher(query, params)

    return result.records.map((record) => record.get('name')).sort()
  }

  it('whereIn filters on list membership', async () => {
    expect(await run((b) => b.whereIn('n.name', ['Adam', 'Ada']))).toEqual(['Ada', 'Adam'])
    expect(await run((b) => b.whereIn('n.name', ['Adam']))).toEqual(['Adam'])
  })

  it('whereContains, whereStartsWith and whereEndsWith filter strings', async () => {
    expect(await run((b) => b.whereContains('n.name', 'da'))).toEqual(['Ada', 'Adam'])
    expect(await run((b) => b.whereStartsWith('n.name', 'Ad'))).toEqual(['Ada', 'Adam'])
    expect(await run((b) => b.whereEndsWith('n.name', 'am'))).toEqual(['Adam'])
  })

  it('whereNull and whereNotNull filter on missing properties', async () => {
    expect(await run((b) => b.whereNull('n.deletedAt'))).toEqual(['Ada'])
    expect(await run((b) => b.whereNotNull('n.deletedAt'))).toEqual(['Adam'])
  })

  it('whereExists filters on a relationship pattern', async () => {
    expect(await run((b) => b.whereExists('(n)-[:KNOWS]->(:Person)'))).toEqual(['Adam'])
  })

  it('whereNotPattern keeps only nodes with no matching relationship (NTS-657)', async () => {
    // Adam KNOWS Ada: the negative pattern reads the edge as absent from
    // each side — the orphan-detection semantic of the data-quality checks
    expect(await run((b) => b.whereNotPattern('n', 'KNOWS', 'out'))).toEqual(['Ada'])
    expect(await run((b) => b.whereNotPattern('n', 'KNOWS', 'in'))).toEqual(['Adam'])
  })

  it('whereAny filters over a list property', async () => {
    expect(await run((b) => b.whereAny('t', 'n.tags', "t = 'admin'"))).toEqual(['Adam'])
  })

  it('whereLabel filters on a label predicate', async () => {
    await backend.connection.run('MATCH (p:Person { name: "Ada" }) SET p:Completed')

    expect(await run((b) => b.whereLabel('n', 'Completed'))).toEqual(['Ada'])
    expect(await run((b) => b.whereLabel('n', 'Completed', true))).toEqual(['Adam'])
  })

  it('orderByLabel and orderBy expressions order the results', async () => {
    await backend.connection.run('MATCH (p:Person { name: "Ada" }) SET p:Completed')

    // Completed first (DESC), then by name
    const ordered = await run((b) => b.orderByLabel('n', 'Completed', 'DESC').orderBy('n.name'))

    expect(ordered).toEqual(['Ada', 'Adam'])
  })
})
