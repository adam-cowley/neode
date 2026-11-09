import { openBackend, TestBackend } from './support/backend'
import { setDefaultNeode } from '../../src/entity-methods'
import type { WithMethods } from '../../src/entity-methods'
import {
  Filter,
  NodeEntity,
  OneToMany,
  Point,
  Primary,
  Property,
  RelatedMany,
  RelationshipCount,
  SoftDelete,
} from '../../src/decorators'
import { clearFilterParams, setFilterParams } from '../../src/index'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

// Soft delete (label state) + tenant (parameterised) on the same model
@NodeEntity()
@SoftDelete()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class RfItem {
  @Primary()
  @Property({ type: 'string' })
  id: string

  @Property({ type: 'string' })
  tenant: string

  @Property({ type: 'string' })
  kind: string

  @Point()
  location: { x: number; y: number }
}

@NodeEntity()
@SoftDelete()
class RfWaypoint {
  @Primary()
  @Property({ type: 'string' })
  id: string
}

@NodeEntity()
class RfOwner {
  @Primary()
  @Property({ type: 'string' })
  id: string

  @OneToMany(() => RfItem, 'OWNS', 'out')
  items: RfItem[]

  @RelatedMany({ type: 'OWNS', direction: 'out', fields: ['id'], target: () => RfItem })
  itemIds: string[]

  // The property's own where has a top-level OR (NTS-574 parenthesisation)
  @RelationshipCount({
    type: 'OWNS',
    direction: 'out',
    target: () => RfItem,
    where: "node.kind = 'a' OR node.kind = 'b'",
  })
  specialCount: number

  @RelatedMany({
    path: [
      { type: 'VIA', direction: 'out', target: () => RfWaypoint },
      { type: 'NEXT', direction: 'out' },
    ],
    target: () => RfItem,
    fields: ['id'],
  })
  viaWaypoint: string[]
}

// ---------------------------------------------------------------------------

describe('read filters on formerly unfiltered read paths (NTS-574)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    setDefaultNeode(backend.neode)
  })

  beforeEach(async () => {
    await backend.clearGraph()
    clearFilterParams()
    setFilterParams('tenant', 'acme')

    // o1 owns: live-acme (a), deleted-acme (a), live-other (a), live-acme (b)
    // o2 owns: only a soft-deleted acme item (a)
    await backend.connection.run(`
      CREATE (o1:RfOwner {id: 'o1'}), (o2:RfOwner {id: 'o2'})
      CREATE (o1)-[:OWNS]->(:RfItem {id: 'live-a', tenant: 'acme', kind: 'a', location: point({x: 1, y: 1})})
      CREATE (o1)-[:OWNS]->(:RfItem:Deleted {id: 'dead-a', tenant: 'acme', kind: 'a', location: point({x: 1, y: 1})})
      CREATE (o1)-[:OWNS]->(:RfItem {id: 'other-a', tenant: 'globex', kind: 'a', location: point({x: 1, y: 1})})
      CREATE (o1)-[:OWNS]->(:RfItem {id: 'live-b', tenant: 'acme', kind: 'b', location: point({x: 1, y: 1})})
      CREATE (o2)-[:OWNS]->(:RfItem:Deleted {id: 'dead-o2', tenant: 'acme', kind: 'a', location: point({x: 1, y: 1})})
      CREATE (o1)-[:VIA]->(:RfWaypoint {id: 'w-live'})-[:NEXT]->(:RfItem {id: 'via-live', tenant: 'acme', kind: 'c'})
      CREATE (o1)-[:VIA]->(:RfWaypoint:Deleted {id: 'w-dead'})-[:NEXT]->(:RfItem {id: 'via-dead', tenant: 'acme', kind: 'c'})
    `)
  })

  afterEach(async () => {
    clearFilterParams()

    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  const sorted = (values: unknown[]): string[] => values.map(String).sort()

  describe('traverse()', () => {
    const itemIds = async (withoutFilters?: string[]): Promise<string[]> => {
      const builder = backend.neode
        .traverse(RfOwner, withoutFilters === undefined ? undefined : { withoutFilters })
        .where({ id: 'o1' })
        .hop('OWNS', 'out', RfItem)

      const rows = await builder.run()

      return sorted(rows.map((row) => (row.nodes[1] as RfItem).id))
    }

    it('drops soft-deleted and other-tenant hop nodes', async () => {
      expect(await itemIds()).toEqual(['live-a', 'live-b'])
    })

    it('withoutFilters opts each filter out independently', async () => {
      expect(await itemIds(['softDelete'])).toEqual(['dead-a', 'live-a', 'live-b'])
      expect(await itemIds(['tenant'])).toEqual(['live-a', 'live-b', 'other-a'])
      expect(await itemIds(['softDelete', 'tenant'])).toEqual([
        'dead-a',
        'live-a',
        'live-b',
        'other-a',
      ])
    })

    it('filters the start node', async () => {
      const rows = await backend.neode.traverse(RfItem).where({ id: 'dead-a' }).run()

      expect(rows).toHaveLength(0)

      const unfiltered = await backend.neode
        .traverse(RfItem, { withoutFilters: ['softDelete'] })
        .where({ id: 'dead-a' })
        .run()

      expect(unfiltered).toHaveLength(1)
    })

    it('excludes filtered nodes from aggregate counts', async () => {
      const count = async (withoutFilters?: string[]): Promise<unknown> => {
        const builder = backend.neode
          .traverse(RfOwner, withoutFilters === undefined ? undefined : { withoutFilters })
          .where({ id: 'o1' })
          .hop('OWNS', 'out', RfItem)
          .groupBy('t0')
          .countDistinct('t1', 'items')

        return (await builder.runAggregates())[0]?.items
      }

      expect(Number(await count())).toBe(2)
      expect(Number(await count(['*']))).toBe(4)
    })
  })

  describe('withinDistance()', () => {
    const ids = async (withoutFilters?: string[]): Promise<string[]> => {
      const results = await backend.neode.withinDistance<RfItem>(
        RfItem,
        'location',
        { x: 0, y: 0 },
        10,
        {},
        undefined,
        undefined,
        undefined,
        undefined,
        withoutFilters === undefined ? undefined : { withoutFilters },
      )

      return sorted(results.map((item) => item.id))
    }

    it('excludes soft-deleted and other-tenant nodes', async () => {
      expect(await ids()).toEqual(['live-a', 'live-b'])
    })

    it('accepts withoutFilters', async () => {
      expect(await ids(['softDelete', 'tenant'])).toEqual([
        'dead-a',
        'dead-o2',
        'live-a',
        'live-b',
        'other-a',
      ])
    })
  })

  describe('projection read-model properties', () => {
    it('does not leak soft-deleted nodes through an OR in the property where', async () => {
      const owner = await backend.neode.find(RfOwner, 'o1')

      // live-a and live-b — NOT dead-a (kind a), which `A OR B AND NOT Deleted` would count
      expect(owner?.specialCount).toBe(2)
    })

    it('does not traverse a soft-deleted path waypoint', async () => {
      const owner = await backend.neode.find(RfOwner, 'o1')

      expect(owner?.viaWaypoint).toEqual(['via-live'])
    })

    it('a nested filter matches live related nodes only, without duplicating roots', async () => {
      // o1 has two live acme items of kind a/b — one matching 'a' (live-a) and the
      // other-tenant/deleted ones are invisible; o2 only has a soft-deleted match
      const owners = await backend.neode.get<RfOwner>(RfOwner, { itemIds: { kind: 'a' } })

      expect(owners.map((owner) => owner.id)).toEqual(['o1'])
    })

    it('does not duplicate a root when several live related nodes match', async () => {
      await backend.connection.run(
        "MATCH (o:RfOwner {id: 'o1'}) " +
          "CREATE (o)-[:OWNS]->(:RfItem {id: 'live-a2', tenant: 'acme', kind: 'a'})",
      )

      const owners = await backend.neode.get<RfOwner>(RfOwner, { itemIds: { kind: 'a' } })

      expect(owners.map((owner) => owner.id)).toEqual(['o1'])
    })

    it('a nested filter honours withoutFilters', async () => {
      const owners = await backend.neode.get<RfOwner>(
        RfOwner,
        { itemIds: { kind: 'a' } },
        undefined,
        undefined,
        { withoutFilters: ['softDelete'] },
      )

      expect(sorted(owners.map((owner) => owner.id))).toEqual(['o1', 'o2'])
    })
  })

  describe('related()', () => {
    it('applies the target filters and accepts withoutFilters', async () => {
      const owner = (await backend.neode.find(RfOwner, 'o1')) as WithMethods<RfOwner>

      const filtered = (await owner.related('items').find()) as RfItem[]

      expect(sorted(filtered.map((item) => item.id))).toEqual(['live-a', 'live-b'])

      const unfiltered = (await owner
        .related('items', { withoutFilters: ['softDelete', 'tenant'] })
        .find()) as RfItem[]

      expect(sorted(unfiltered.map((item) => item.id))).toEqual([
        'dead-a',
        'live-a',
        'live-b',
        'other-a',
      ])

      expect(await owner.related('items').count()).toBe(2)
      expect(await owner.related('items', { withoutFilters: ['*'] }).count()).toBe(4)
    })
  })
})
