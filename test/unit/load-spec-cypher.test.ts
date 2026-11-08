import { NodeEntity, OneToMany, OneToOne, Property } from '../../src/decorators'
import { Direction } from '../../src/query'
import { projectionNode, loadSpecCalls, hasProjectedProperties } from '../../src/projection'
import { getModel } from '../../src/meta'
import { Builder } from '../../src/query'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class SpecCypherOrder {
  @Property({ type: 'number' })
  orderDate!: number
}

@NodeEntity()
class SpecCypherCustomer {
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => SpecCypherOrder, 'PLACED', Direction.OUTGOING)
  orders!: SpecCypherOrder[]

  @OneToOne({ type: 'HAS_CARD', target: () => SpecCypherOrder, direction: Direction.OUTGOING })
  card!: SpecCypherOrder | undefined
}

const normalise = (query: string): string => query.replaceAll(/\s+/g, ' ').trim()

describe('load spec (`with`) Cypher composition (NTS-560)', () => {
  const schema = getModel(SpecCypherCustomer)

  it('a `true` request renders the standard full-entity comprehension for a non-eager relation', () => {
    const query = normalise(projectionNode('this', schema, { orders: true }))

    expect(query).toContain(
      'orders: [ (this)-[this_orders_rel:`PLACED`]->(this_orders_node:SpecCypherOrder) |',
    )
  })

  it('a decorated request renders the subquery alias in the projection, [0] for one', () => {
    const projection = normalise(
      projectionNode('this', schema, { orders: () => {}, card: () => {} }),
    )

    // many -> the list; one -> first element
    expect(projection).toContain('orders: this_orders_loaded')
    expect(projection).toContain('card: this_card_loaded[0]')
  })

  it('the decorated read renders as one CALL subquery collected into the same RETURN', () => {
    const builder = new Builder().match('this', 'SpecCypherCustomer').where('this.name', 'Adam')

    loadSpecCalls(builder, 'this', schema, {
      orders: (relation) => relation.where('orderDate', 20).orderBy('orderDate', 'DESC').limit(2),
    })

    builder.return(`${projectionNode('this', schema, { orders: () => {} })} AS this`)

    const query = normalise(builder.build().query)

    expect(query).toBe(
      normalise(
        `MATCH (this:SpecCypherCustomer) WHERE (this.name = $where_this_name)
CALL {
WITH this
MATCH (this)-[this_orders_rel:\`PLACED\`]->(this_orders_node:SpecCypherOrder)
WHERE (this_orders_node.orderDate = $sub0_where_this_orders_node_orderDate)
WITH this_orders_node ORDER BY this_orders_node.orderDate DESC LIMIT 2
RETURN collect(this_orders_node { .*, __EAGER_ID__: elementId(this_orders_node), __EAGER_LABELS__: labels(this_orders_node) }) AS this_orders_loaded
}
RETURN this { .*, __EAGER_ID__: elementId(this), __EAGER_LABELS__: labels(this), orders: this_orders_loaded } AS this`,
      ),
    )
  })

  it('decorated specs override the default eager pattern for eager relationships', () => {
    const eagerSchema = getModel(SpecCypherCustomer)
    const query = normalise(
      projectionNode('this', eagerSchema, { orders: (relation) => relation.limit(1) }),
    )

    // No comprehension fragment for the decorated key — the subquery alias stands in
    expect(query).toContain('orders: this_orders_loaded')
    expect(query).not.toContain('orders: [ ')
  })

  it('an unknown key throws, naming the model and key', () => {
    expect(() => projectionNode('this', schema, { wishlists: true })).toThrow(
      'Unknown relationship "wishlists" on SpecCypherCustomer',
    )
  })

  it('a model without the spec projects exactly as before (no behavior change)', () => {
    const query = normalise(projectionNode('this', schema))

    expect(query).toContain('.*')
    expect(query).not.toContain('_loaded')
    expect(hasProjectedProperties(schema)).toBe(false)
  })
})
