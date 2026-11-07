import { defineModel } from '../../src/meta/map-schema'
import { getModel } from '../../src/meta'
import { hydrateNode, hydrateRelationship } from '../../src/utilities'
import { EagerRelationship, EagerProjectionMap } from '../../src/utilities'
import { GraphNode, GraphRelationship } from '../../src/driver/types'
import { InternalId, Property, RelationshipEntity } from '../../src/decorators'
import { RelationshipPropertySchema } from '../../src/meta/relationship-property-schema'
import { Direction } from '../../src/query'
import { EntitySchema } from '../../src/meta/entity/entity-schema'

/**
 * Hydration defaults (NTS-139): stored/projected `null` hydrates as
 * `undefined` (a Neo4j property is either present or absent — null never
 * persists), and a `coalesce` property config supplies read-side fallbacks
 * at hydration: a literal, or sibling property names (first non-null wins).
 */

const CoalescePerson = defineModel('CoalescePerson', {
  visibility: { type: 'string', coalesce: 'public' },
  handle: { type: 'string', coalesce: ['sub', 'id'] },
  name: 'string',
})

/** A projection map (eager shape) — the only way a null property reaches hydration */
const projection = (
  properties: Record<string, unknown>,
  label = 'CoalescePerson',
): EagerProjectionMap =>
  ({
    __EAGER_ID__: '4:coalesce:0',
    __EAGER_LABELS__: [label],
    ...properties,
  }) as EagerProjectionMap

const node = (properties: Record<string, unknown>, label = 'CoalescePerson'): GraphNode => ({
  elementId: '4:coalesce:0',
  labels: [label],
  properties,
})

describe('hydration defaults (NTS-139)', () => {
  it('hydrates projected null as undefined', () => {
    const entity = hydrateNode<{ name?: string }>(
      getModel(CoalescePerson),
      CoalescePerson,
      projection({ name: null }),
    )

    expect(entity.name).toBeUndefined()
  })

  it('hydrates an absent property as undefined (unchanged)', () => {
    const entity = hydrateNode<{ name?: string }>(
      getModel(CoalescePerson),
      CoalescePerson,
      node({}),
    )

    expect(entity.name).toBeUndefined()
  })

  it('keeps a stored value over the coalesce fallback', () => {
    const entity = hydrateNode<{ visibility?: string }>(
      getModel(CoalescePerson),
      CoalescePerson,
      projection({ visibility: 'private' }),
    )

    expect(entity.visibility).toBe('private')
  })

  it('applies a literal coalesce fallback when the stored value is null or absent', () => {
    for (const stored of [projection({ visibility: null }), projection({})]) {
      const entity = hydrateNode<{ visibility?: string }>(
        getModel(CoalescePerson),
        CoalescePerson,
        stored,
      )

      expect(entity.visibility).toBe('public')
    }
  })

  it('applies an array coalesce as first non-null sibling property', () => {
    const entity = hydrateNode<{ handle?: string }>(
      getModel(CoalescePerson),
      CoalescePerson,
      projection({ handle: null, sub: 'sub-value', id: 'id-value' }),
    )

    expect(entity.handle).toBe('sub-value')

    const second = hydrateNode<{ handle?: string }>(
      getModel(CoalescePerson),
      CoalescePerson,
      projection({ sub: null, id: 'id-value' }),
    )

    expect(second.handle).toBe('id-value')
  })

  it('leaves the property undefined when every coalesce source is nullish', () => {
    const entity = hydrateNode<{ handle?: string }>(
      getModel(CoalescePerson),
      CoalescePerson,
      projection({ sub: null, id: null }),
    )

    expect(entity.handle).toBeUndefined()
  })

  it('applies coalesce to relationship properties', () => {
    @RelationshipEntity()
    class CoalesceRel {
      @InternalId() _id: string
      @Property({ type: 'string', coalesce: 'member' }) role: string
      @Property({ type: 'string' }) note: string
    }

    const rel: GraphRelationship = {
      elementId: '4:coalesce-rel:0',
      type: 'MEMBER_OF',
      startElementId: '4:coalesce:0',
      endElementId: '4:coalesce:1',
      properties: { role: null, note: null },
    }

    const eager: EagerRelationship = {
      rel,
      start: { node: node({}, 'A') },
      end: { node: node({}, 'B') },
      other: { node: node({}, 'B') },
    }

    const relSchema: RelationshipPropertySchema = new RelationshipPropertySchema('rel')
    relSchema.setDirection(Direction.OUTGOING)

    const entity = hydrateRelationship<Record<string, unknown>>(
      getModel(CoalesceRel) as EntitySchema,
      CoalesceRel,
      eager,
      relSchema,
    )

    expect(entity['role']).toBe('member')
    expect(entity['note']).toBeUndefined()
  })
})
