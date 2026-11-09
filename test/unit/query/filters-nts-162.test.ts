import {
  NodeEntity,
  Property,
  Primary,
  SoftDelete,
  Filter,
  OneToMany,
} from '../../../src/decorators'
import { Direction } from '../../../src/query'
import { Builder } from '../../../src/query'
import { getModel, mergeModel } from '../../../src/meta'
import { eagerNode, eagerPattern } from '../../../src/query/eager-utilities'
import { loadSpecCalls, projectionNode } from '../../../src/projection'
import {
  applyReadFilters,
  readFilterClauses,
  readFilterFragment,
  setFilterParams,
  clearFilterParams,
  WITHOUT_ALL_FILTERS,
  SOFT_DELETE_FILTER,
} from '../../../src/services/query/filters'
import { NeodeError } from '../../../src/errors'
import { THIS_NODE } from '../../../src/constants'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
@SoftDelete()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class FilterArticle {
  @Primary()
  @Property({ type: 'string' })
  articleID!: string

  @Property({ type: 'string' })
  tenant!: string
}

@NodeEntity()
@Filter({ name: 'notArchived', where: 'NOT node:Archived' })
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class FilterNote {
  @Primary()
  @Property({ type: 'string' })
  noteID!: string

  @OneToMany(() => FilterArticle, 'ATTACHED', Direction.OUTGOING, true)
  articles!: FilterArticle[]

  attachedOne: FilterArticle | undefined
}

const normalise = (query: string): string => query.replaceAll(/\s+/g, ' ').trim()

const articleSchema = getModel(FilterArticle)
const noteSchema = getModel(FilterNote)

describe('named global filters (NTS-162)', () => {
  beforeEach(() => {
    clearFilterParams()
  })

  describe('registry', () => {
    it('registers @Filter definitions on the schema', () => {
      // TC39 class decorators run bottom-up — source order reverses
      expect(noteSchema.getFilters().map((filter) => filter.name)).toEqual([
        'tenant',
        'notArchived',
      ])
    })

    it('rejects duplicate filter names — they are the withoutFilters keys', () => {
      const Dup = class Dup {}

      Filter({ name: 'dup_filter' })(Dup)

      expect(() => Filter({ name: 'dup_filter' })(Dup)).toThrow(NeodeError)
    })

    it('rejects names that cannot be Cypher parameters', () => {
      expect(() => setFilterParams('bad name', 1)).toThrow(NeodeError)
      expect(() => setFilterParams('$leading', 1)).toThrow(NeodeError)
    })
  })

  describe('root read composition (the one central place)', () => {
    it('composes the soft-delete label check and the declared where onto the root alias', () => {
      setFilterParams('tenant', 'acme')

      const builder = new Builder().match(THIS_NODE, articleSchema.getLabels())

      applyReadFilters(builder, articleSchema)

      const { query, params } = builder.build()

      expect(normalise(query)).toContain('NOT this:`Deleted`')
      expect(normalise(query)).toContain('this.tenant = $tenant')
      expect(params['tenant']).toBe('acme')
    })

    it('honours withoutFilters per name — each filter is independent', () => {
      const builder = new Builder().match(THIS_NODE, articleSchema.getLabels())

      applyReadFilters(builder, articleSchema, { withoutFilters: ['tenant'] })

      const normalised = normalise(builder.build().query)

      expect(normalised).toContain('NOT this:`Deleted`')
      expect(normalised).not.toContain('$tenant')
    })

    it('disabling softDelete by name drops the label check', () => {
      const builder = new Builder().match(THIS_NODE, articleSchema.getLabels())

      applyReadFilters(builder, articleSchema, { withoutFilters: [SOFT_DELETE_FILTER] })

      const normalised = normalise(builder.build().query)

      expect(normalised).not.toContain('`Deleted`')
      // The other filters stay active — independence both ways
      expect(normalised).toContain('this.tenant = $tenant')
    })

    it('includeDeleted is the soft-delete opt back in (NTS-510 spelling)', () => {
      const viaFlag = readFilterClauses(articleSchema, THIS_NODE, { includeDeleted: true })
      const viaName = readFilterClauses(articleSchema, THIS_NODE, {
        withoutFilters: [SOFT_DELETE_FILTER],
      })

      expect(viaFlag.clauses).toEqual(viaName.clauses)
    })

    it('two where filters compose with AND on the same alias', () => {
      const builder = new Builder().match(THIS_NODE, noteSchema.getLabels())

      applyReadFilters(builder, noteSchema)

      const normalised = normalise(builder.build().query)

      expect(normalised).toContain('NOT this:Archived')
      expect(normalised).toContain('this.tenant = $tenant')
    })

    it('a filter param that was never set still renders the predicate (loud at execution)', () => {
      const { clauses, parameters } = readFilterClauses(articleSchema, THIS_NODE)

      expect(clauses).toContain('(this.tenant = $tenant)')
      expect(parameters['tenant']).toBeUndefined()
    })

    it('the reserved wildcard disables every named filter (the write-path bypass)', () => {
      const { clauses, parameters } = readFilterClauses(articleSchema, THIS_NODE, {
        withoutFilters: [WITHOUT_ALL_FILTERS],
      })

      expect(clauses).toEqual([])
      expect(parameters).toEqual({})
    })

    it('readFilterFragment joins the clauses for the hand-written statements', () => {
      setFilterParams('tenant', 'acme')

      const { fragment, parameters } = readFilterFragment(articleSchema, 'node', {
        withoutFilters: [SOFT_DELETE_FILTER],
      })

      expect(fragment).toBe('(node.tenant = $tenant)')
      expect(parameters).toEqual({ tenant: 'acme' })
    })

    it('no filters declared — no clauses, no fragment', () => {
      const Plain = class Plain {}

      mergeModel(Plain)

      const { clauses, parameters } = readFilterClauses(getModel(Plain), THIS_NODE)

      expect(clauses).toEqual([])
      expect(parameters).toEqual({})
    })
  })

  describe('filtered relations render as pattern comprehensions', () => {
    const noteSchema = getModel(FilterNote)

    it('the eager comprehension carries the target filters as a WHERE inside the pattern', () => {
      setFilterParams('tenant', 'acme')

      const parent = new Builder()

      const pattern = eagerPattern(1, THIS_NODE, noteSchema.getRelationship('articles'), {
        builder: parent,
        filters: {},
      })

      const normalised = normalise(pattern)

      // Comprehension, not OPTIONAL MATCH: the target filter sits inside [ ... | ... ]
      expect(normalised).toContain('[')
      expect(normalised).toContain('|')
      expect(normalised).not.toContain('OPTIONAL MATCH')

      // The filter applies to the comprehension's related node variable
      expect(normalised).toContain('this_articles_node.tenant = $tenant')
      expect(normalised).toContain('NOT this_articles_node:`Deleted`')

      // The comprehension's filter params bind onto the executing builder
      expect(parent.build().params['tenant']).toBe('acme')
    })

    it('the parameters survive into the full read query', () => {
      setFilterParams('tenant', 'acme')

      const builder = new Builder().match(THIS_NODE, noteSchema.getLabels())

      builder.return(
        `${eagerNode(1, THIS_NODE, noteSchema, { builder, filters: {} })} AS ${THIS_NODE}`,
      )

      const { query, params } = builder.build()

      expect(normalise(query)).toContain('this_articles_node.tenant = $tenant')
      expect(params['tenant']).toBe('acme')
    })

    it('withoutFilters reaches the comprehensions too', () => {
      const pattern = eagerPattern(1, THIS_NODE, noteSchema.getRelationship('articles'), {
        builder: new Builder(),
        filters: { withoutFilters: [SOFT_DELETE_FILTER, 'tenant'] },
      })

      const normalised = normalise(pattern)

      expect(normalised).not.toContain('`Deleted`')
      expect(normalised).not.toContain('$tenant')
    })
  })

  describe('the load-spec COLLECT subquery path', () => {
    it('the target filters filter the collected rows, parameters namespaced', () => {
      setFilterParams('tenant', 'acme')

      const builder = new Builder().match(THIS_NODE, 'FilterNote')

      loadSpecCalls(
        builder,
        THIS_NODE,
        noteSchema,
        { articles: (relation) => relation.limit(2) },
        {},
      )

      const { query } = builder.build()

      const normalised = normalise(query)

      expect(normalised).toContain('CALL')
      expect(normalised).toContain('this_articles_node.tenant = $sub0_tenant')
      expect(normalised).not.toContain('OPTIONAL MATCH')
    })

    it('projectionNode keeps the filters out of the decorated keys (the subquery owns them)', () => {
      setFilterParams('tenant', 'acme')

      const projection = projectionNode(
        THIS_NODE,
        noteSchema,
        { articles: () => {} },
        {
          builder: new Builder(),
          filters: {},
        },
      )

      expect(normalise(projection)).toContain('articles: this_articles_loaded')
    })
  })
})
