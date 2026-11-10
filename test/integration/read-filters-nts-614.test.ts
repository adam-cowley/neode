import { openBackend, TestBackend } from './support/backend'
import { NodeEntity, Filter, Primary, Property } from '../../src/decorators'
import { clearFilterParams, setFilterParams } from '../../src/index'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class Nts614Article {
  @Primary()
  @Property({ type: 'string' })
  articleID: string

  @Property({ type: 'string' })
  tenant: string
}

describe('named filters compose into Builder chains (NTS-614)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  beforeEach(async () => {
    await backend.clearGraph()
    clearFilterParams()
    setFilterParams('tenant', 'acme')

    await backend.connection.run(`
      CREATE (:Nts614Article {articleID: 'a1', tenant: 'acme'})
      CREATE (:Nts614Article {articleID: 'a2', tenant: 'globex'})
    `)
  })

  afterEach(async () => {
    clearFilterParams()

    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  const readIds = async (withoutFilters?: string[]): Promise<string[]> => {
    const output = await backend.neode
      .query()
      .match('article', 'Nts614Article')
      .withFilters(Nts614Article, 'article', { withoutFilters })
      .return('article.articleID AS id')
      .read()

    return output.records
      .map((row) => row.get('id'))
      .map(String)
      .sort()
  }

  it('a hand-written Builder read only sees rows inside the filter', async () => {
    expect(await readIds()).toEqual(['a1'])
  })

  it('withoutFilters disables the named filter', async () => {
    expect(await readIds(['tenant'])).toEqual(['a1', 'a2'])
  })
})
