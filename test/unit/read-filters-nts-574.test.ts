import {
  Filter,
  NodeEntity,
  OneToMany,
  Primary,
  Property,
  RelatedMany,
  RelationshipCount,
  SoftDelete,
} from '../../src/decorators'
import { QueryOutput, Runner } from '../../src/driver/types'
import { clearFilterParams, setFilterParams } from '../../src/index'
import { getModel } from '../../src/meta'
import { projectionNode } from '../../src/projection'
import { ProjectionService } from '../../src/projection/projection.service'
import { WithinDistanceService } from '../../src/services/query/within-distance.service'
import { TraverseBuilder } from '../../src/traverse'

/**
 * NTS-574: soft delete + named read filters on the read paths that used to
 * bypass them — traverse(), withinDistance(), nested filters on related
 * properties, filtered COUNT / EXISTS and path waypoints.
 */

const normalise = (cypher: string): string => cypher.replaceAll(/\s+/g, ' ')

interface Captured {
  query: string
  params: Record<string, unknown>
}

function capture(captured: Captured[]): Runner {
  return {
    run: async (query: string, params?: Record<string, unknown>) => {
      captured.push({ query, params: params ?? {} })

      return { records: [] } as unknown as QueryOutput
    },
  }
}

@NodeEntity()
@SoftDelete()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class F574Item {
  @Primary() @Property({ type: 'string' }) id: string
  @Property({ type: 'string' }) tenant: string
  @Property({ type: 'string' }) kind: string
  @Property({ type: 'point' }) location: { x: number; y: number }
}

@NodeEntity()
@SoftDelete()
class F574Waypoint {
  @Property({ type: 'string' }) id: string
}

@NodeEntity()
class F574Owner {
  @Primary() @Property({ type: 'string' }) id: string

  @OneToMany(() => F574Item, 'OWNS', 'out')
  items: F574Item[]

  @RelatedMany({ type: 'OWNS', direction: 'out', fields: ['id'], target: () => F574Item })
  itemIds: string[]

  // The property's own where carries a top-level OR
  @RelationshipCount({
    type: 'OWNS',
    direction: 'out',
    target: () => F574Item,
    where: "node.kind = 'a' OR node.kind = 'b'",
  })
  specialCount: number

  @RelatedMany({
    path: [
      { type: 'OWNS', direction: 'out', target: () => F574Waypoint },
      { type: 'NEXT', direction: 'out' },
    ],
    target: () => F574Item,
    fields: ['id'],
  })
  viaWaypoint: string[]
}

describe('read filters on formerly unfiltered paths (NTS-574)', () => {
  beforeEach(() => {
    clearFilterParams()
    setFilterParams('tenant', 'acme')
  })

  afterEach(() => {
    clearFilterParams()
  })

  describe('traverse()', () => {
    const run = async (configure: (builder: TraverseBuilder) => TraverseBuilder) => {
      const captured: Captured[] = []

      const builder = new TraverseBuilder(capture(captured), () => F574Owner)

      await configure(builder.hop('OWNS', 'out', F574Item)).run()

      return captured[0]
    }

    it('filters the hop node with its model filters', async () => {
      const { query, params } = await run((builder) => builder)

      const cypher = normalise(query)

      expect(cypher).toContain('NOT t1:`Deleted`')
      expect(cypher).toContain('(t1.tenant = $tenant)')
      expect(params.tenant).toBe('acme')
    })

    it('filters the aggregate read too', async () => {
      const captured: Captured[] = []

      await new TraverseBuilder(capture(captured), () => F574Item)
        .hop('OWNS', 'in', F574Owner)
        .hop('OWNS', 'out', F574Item)
        .groupBy('t2')
        .countDistinct('t2', 'times')
        .runAggregates()

      const cypher = normalise(captured[0]?.query ?? '')

      // the start node (t0) and the counted hop node (t2) are both filtered
      expect(cypher).toContain('NOT t0:`Deleted`')
      expect(cypher).toContain('NOT t2:`Deleted`')
    })

    it('withoutFilters() disables the named filters independently', async () => {
      const { query } = await run((builder) => builder.withoutFilters('softDelete'))

      const cypher = normalise(query)

      expect(cypher).not.toContain('Deleted')
      expect(cypher).toContain('(t1.tenant = $tenant)')
    })
  })

  describe('withinDistance()', () => {
    const run = async (filters?: { withoutFilters?: string[] }) => {
      const captured: Captured[] = []

      await new WithinDistanceService(capture(captured)).withinDistance(
        F574Item,
        getModel(F574Item),
        'location',
        { x: 1, y: 2 },
        10,
        {},
        undefined,
        undefined,
        undefined,
        filters,
      )

      return normalise(captured[0]?.query ?? '')
    }

    it('applies soft delete and named filters', async () => {
      const cypher = await run()

      expect(cypher).toContain('NOT this:`Deleted`')
      expect(cypher).toContain('(this.tenant = $tenant)')
    })

    it('accepts withoutFilters', async () => {
      const cypher = await run({ withoutFilters: ['softDelete', 'tenant'] })

      expect(cypher).not.toContain('Deleted')
      expect(cypher).not.toContain('$tenant')
    })
  })

  describe('projection', () => {
    it('parenthesises the property where so an OR cannot leak the read filters', () => {
      const cypher = normalise(projectionNode('this', getModel(F574Owner)))

      expect(cypher).toContain("WHERE (node.kind = 'a' OR node.kind = 'b') AND NOT node:`Deleted`")
    })

    it('applies the waypoint model filters to intermediate path nodes', () => {
      const cypher = normalise(projectionNode('this', getModel(F574Owner)))

      expect(cypher).toContain('(this)-[:`OWNS`]->(this_h1:`F574Waypoint`)')
      expect(cypher).toContain('NOT this_h1:`Deleted`')
    })

    it('renders nested filters as EXISTS with the target filters, never a bare MATCH', async () => {
      const captured: Captured[] = []

      await new ProjectionService(capture(captured)).get(F574Owner, getModel(F574Owner), {
        itemIds: { kind: 'a' },
      })

      const cypher = normalise(captured[0]?.query ?? '')

      expect(cypher).toMatch(/^MATCH \(this:F574Owner\) WHERE \(EXISTS \{ WITH this MATCH/)
      expect(cypher).toContain('NOT this_itemIds_filter:`Deleted`')
      expect(cypher).toContain('(this_itemIds_filter.tenant = $sub0_tenant)')
    })

    it('lets the nested filter opt out via withoutFilters', async () => {
      const captured: Captured[] = []

      await new ProjectionService(capture(captured)).get(
        F574Owner,
        getModel(F574Owner),
        { itemIds: { kind: 'a' } },
        undefined,
        undefined,
        undefined,
        undefined,
        { withoutFilters: ['softDelete'] },
      )

      const [exists = ''] = normalise(captured[0]?.query ?? '').split(' RETURN ')

      expect(exists).not.toContain('Deleted')
    })
  })
})
