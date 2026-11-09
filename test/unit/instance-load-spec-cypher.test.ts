import { NodeEntity, OneToMany, OneToOne, Property } from '../../src/decorators'
import { Direction } from '../../src/query'
import { eagerNode } from '../../src/query/eager-utilities'
import { parseLoadLevel } from '../../src/services/query/load-relation.service'
import { getModel } from '../../src/meta'
import { Builder } from '../../src/query'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

@NodeEntity()
class SpecLine {
  @Property({ type: 'number' })
  position!: number
}

@NodeEntity()
class SpecRegion {
  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
class SpecOrder {
  @Property({ type: 'number' })
  placedAt!: number

  @OneToMany(() => SpecLine, 'CONTAINS', Direction.OUTGOING)
  lines!: SpecLine[]

  @OneToOne({ type: 'IN_REGION', target: () => SpecRegion, direction: Direction.OUTGOING })
  region!: SpecRegion | undefined
}

@NodeEntity()
class SpecCustomer {
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => SpecOrder, 'PLACED', Direction.OUTGOING)
  orders!: SpecOrder[]

  @OneToOne({ type: 'HAS_CARD', target: () => SpecOrder, direction: Direction.OUTGOING })
  card!: SpecOrder | undefined
}

// ---------------------------------------------------------------------------

const normalise = (query: string): string => query.replaceAll(/\s+/g, ' ').trim()

describe('per-instance load spec Cypher composition (NTS-498)', () => {
  const customerSchema = getModel(SpecCustomer)
  const orderSchema = getModel(SpecOrder)

  it('a plain nested level renders a pattern comprehension inside the parent projection', () => {
    const root = parseLoadLevel(customerSchema, { orders: { lines: true } })
    const orderLevel = root.nested.get('orders')

    const builder = new Builder()
    const projection = normalise(eagerNode(1, 'node', orderSchema, { builder }, orderLevel))

    expect(projection).toContain(
      'lines: [ (node)-[node_lines_rel:`CONTAINS`]->(node_lines_node:SpecLine) |',
    )
  })

  it('a trimmed nested level renders a COLLECT { MATCH … RETURN … ORDER BY … } subquery', () => {
    const root = parseLoadLevel(customerSchema, {
      orders: {
        order: { placedAt: 'DESC' },
        limit: 3,
        lines: { order: { position: 'DESC' }, limit: 2 },
      },
    })
    const orderLevel = root.nested.get('orders')

    const builder = new Builder()
    const projection = normalise(eagerNode(1, 'node', orderSchema, { builder }, orderLevel))

    expect(projection).toContain(
      'lines: COLLECT { WITH node MATCH (node)-[node_lines_rel:`CONTAINS`]->(node_lines_node:SpecLine) ' +
        'RETURN node_lines_node { .* ,__EAGER_ID__: elementId(node_lines_node) ,' +
        '__EAGER_LABELS__: labels(node_lines_node) } ORDER BY node_lines_node.position DESC LIMIT 2 }',
    )
  })

  it('a one-key nested level appends [0] to the comprehension', () => {
    const root = parseLoadLevel(customerSchema, { orders: { region: true } })
    const orderLevel = root.nested.get('orders')

    const builder = new Builder()
    const projection = normalise(eagerNode(1, 'node', orderSchema, { builder }, orderLevel))

    expect(projection).toContain(
      'region: [ (node)-[node_region_rel:`IN_REGION`]->(node_region_node:SpecRegion) | ' +
        'node_region_node { .* ,__EAGER_ID__: elementId(node_region_node) ,' +
        '__EAGER_LABELS__: labels(node_region_node) } ][0]',
    )
  })

  it('an unknown key at depth throws, naming the model and the valid relationships', () => {
    expect(() => parseLoadLevel(orderSchema, { wishlist: true })).toThrow(
      'Relationship "wishlist" is not defined on model "SpecOrder"',
    )
    expect(() => parseLoadLevel(orderSchema, { wishlist: true })).toThrow('lines')

    // …and at depth, against the nested level's own schema
    expect(() => parseLoadLevel(customerSchema, { orders: { wishlist: true } })).toThrow(
      'Relationship "wishlist" is not defined on model "SpecOrder"',
    )
  })

  it('a non-true non-object entry throws', () => {
    expect(() => parseLoadLevel(customerSchema, { orders: 3 })).toThrow(
      'must be true or a spec object of relationship keys',
    )
  })
})
