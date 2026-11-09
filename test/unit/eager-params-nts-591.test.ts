import { NodeEntity, OneToMany, OneToOne, Property, Filter } from '../../src/decorators'
import { Direction, Builder } from '../../src/query'
import { eagerNode, eagerPattern, parseLoadLevel } from '../../src/query/eager-utilities'
import { getModel } from '../../src/meta'
import { clearFilterParams, setFilterParams } from '../../src/services/query/filters'

// ---- Fixtures (per-file: decorator registry is global per module) -----------

// The stamp carries a parameterised global filter (NTS-162): every eager
// pattern reaching it renders `node.tenant = $tenant`
@NodeEntity()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class Stamp591 {
  @Property({ type: 'string' })
  tenant!: string
}

// The card carries its own filter and an EAGER relationship to the stamp —
// the stamp's pattern renders INSIDE any parent COLLECT of the card
@NodeEntity()
@Filter({ name: 'tier', where: 'node.tier = $tier' })
class Card591 {
  @Property({ type: 'string' })
  tier!: string

  @OneToMany(() => Stamp591, 'STAMPED', Direction.OUTGOING, true)
  stamps!: Stamp591[]
}

@NodeEntity()
class Wallet591 {
  @Property({ type: 'string' })
  owner!: string

  @OneToMany(() => Card591, 'HOLDS', Direction.OUTGOING)
  cards!: Card591[]

  @OneToOne({ type: 'PRIMARY_CARD', target: () => Card591, direction: Direction.OUTGOING })
  primary!: Card591 | undefined
}

// ---------------------------------------------------------------------------

const normalise = (query: string): string => query.replaceAll(/\s+/g, ' ').trim()

describe('one-key eager hydration + eager filter param binding (NTS-591)', () => {
  beforeEach(() => {
    clearFilterParams()
  })

  it('a trimmed one-key level hydrates single: the COLLECT carries [0] and every nested filter param binds', () => {
    setFilterParams('tenant', 'acme')
    setFilterParams('tier', 'gold')

    const schema = getModel(Wallet591)
    const level = parseLoadLevel(schema, { primary: { order: { tier: 'ASC' } } })

    const builder = new Builder().match('node', 'Wallet591')

    builder.return(`${eagerNode(1, 'node', schema, { builder }, level)} AS node`)

    // Building the statement fail-fasts on unbound parameters: before the
    // fix the nested stamp pattern bound $tenant on the outer builder
    // while its text compiled inside the COLLECT subquery —
    // "Unbound parameter $tenant in a sub-query"
    const { query, params } = builder.build()

    const normalised = normalise(query)

    // One-key: single value — the same [0] the untrimmed comprehension gives
    expect(normalised).toContain('} ORDER BY node_primary_node.tier ASC }[0] } AS node')

    // The card's own filter and the nested stamp filter ride the
    // subquery's namespaced parameters
    expect(normalised).toContain('node_primary_node.tier = $sub0_tier')
    expect(normalised).toContain('node_primary_node_stamps_node.tenant = $sub0_tenant')
    expect(params['sub0_tier']).toBe('gold')
    expect(params['sub0_tenant']).toBe('acme')
  })

  it('a trimmed many-key level still collects a list (no [0])', () => {
    setFilterParams('tenant', 'acme')
    setFilterParams('tier', 'gold')

    const schema = getModel(Wallet591)
    const level = parseLoadLevel(schema, { cards: { order: { tier: 'ASC' } } })

    const builder = new Builder().match('node', 'Wallet591')

    builder.return(`${eagerNode(1, 'node', schema, { builder }, level)} AS node`)

    const { query } = builder.build()

    expect(normalise(query)).toContain('cards: COLLECT {')
    expect(normalise(query)).not.toContain('[0]')
  })

  it('an eager pattern whose filters render with no executing builder fails fast', () => {
    setFilterParams('tenant', 'acme')

    const rel = getModel(Card591).getRelationship('stamps')

    expect(() => eagerPattern(1, 'node', rel)).toThrow(/no executing builder to bind on/)
  })

  it('a trimmed spec level whose filters render with no executing builder fails fast', () => {
    setFilterParams('tier', 'gold')

    const schema = getModel(Wallet591)
    const level = parseLoadLevel(schema, { cards: { order: { tier: 'ASC' } } })

    // No EagerFilterContext: the COLLECT's filter parameters could never
    // reach a statement
    expect(() => eagerNode(1, 'node', schema, undefined, level)).toThrow(
      /no executing builder to bind on/,
    )
  })
})
