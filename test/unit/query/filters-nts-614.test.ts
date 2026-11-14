import { NodeEntity, Property, Primary, Filter } from '../../../src/decorators'
import { Builder } from '../../../src/query'
import { NeodeError } from '../../../src/errors'
import { setFilterParams, clearFilterParams } from '../../../src/services/query/filters'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class Nts614Article {
  @Primary()
  @Property({ type: 'string' })
  articleID!: string

  @Property({ type: 'string' })
  tenant!: string
}

@NodeEntity()
class Nts614Plain {
  @Primary()
  @Property({ type: 'string' })
  id!: string
}

const normalise = (query: string): string => query.replaceAll(/\s+/g, ' ').trim()

describe('Builder#withFilters (NTS-614)', () => {
  beforeEach(() => {
    clearFilterParams()
  })

  it('renders the model filter as a WHERE over the matched alias and merges its params', () => {
    setFilterParams('tenant', 'acme')

    const { query, params } = new Builder()
      .match('article', 'Nts614Article')
      .withFilters(Nts614Article, 'article')
      .return('article')
      .build()

    const normalised = normalise(query)

    expect(normalised).toContain('MATCH (article:Nts614Article)')
    expect(normalised).toContain('WHERE ((article.tenant = $tenant))')
    expect(params['tenant']).toBe('acme')
  })

  it('defaults the alias to this — the read-root alias hydrate expects', () => {
    setFilterParams('tenant', 'acme')

    const { query, params } = new Builder()
      .match('this', 'Nts614Article')
      .withFilters(Nts614Article)
      .return('this')
      .build()

    const normalised = normalise(query)

    expect(normalised).toContain('WHERE ((this.tenant = $tenant))')
    expect(params['tenant']).toBe('acme')
  })

  it('withoutFilters disables a named filter while other clauses stay', () => {
    setFilterParams('tenant', 'acme')

    const builder = new Builder()
      .match('article', 'Nts614Article')
      .where('article.articleID', 'a1')
      .withFilters(Nts614Article, 'article', { withoutFilters: ['tenant'] })
      .return('article')

    const normalised = normalise(builder.build().query)

    expect(normalised).not.toContain('$tenant')
    expect(normalised).toContain('article.articleID =')
  })

  it('a model with no filters composes nothing', () => {
    const { query } = new Builder()
      .match('this', 'Nts614Plain')
      .withFilters(Nts614Plain)
      .return('this')
      .build()

    expect(normalise(query)).not.toContain('WHERE')
  })

  it('an unregistered model fails with a fix-suggesting error', () => {
    class NeverRegistered {}

    expect(() => new Builder().match('this', 'X').withFilters(NeverRegistered)).toThrow(NeodeError)
  })
})
