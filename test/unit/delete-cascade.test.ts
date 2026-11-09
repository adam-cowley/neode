import { describe, expect, it, vi } from 'vitest'
import { DeleteService, MAX_CASCADE_DEPTH } from '../../src/services/query/delete.service'
import { defineModel } from '../../src/meta/map-schema'
import { getModel } from '../../src/meta/index'
import {
  NodeEntity,
  OneToMany,
  Primary,
  Property,
  SoftDelete,
  String as StringProperty,
} from '../../src/decorators'
import type { Runner } from '../../src/driver/types'

// Map schemas exercising the per-relationship cascade annotation:
// Order -CONTAINS-> Product is unannotated, Product -CONTAINS-> Order is
// annotated, and the Factory chain annotates every level except
// Factory -HAS-> Warehouse. Defined in dependency order so relationship
// targets resolve.
const Part = defineModel('CascadeUnitPart', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
})

const Machine = defineModel('CascadeUnitMachine', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
  parts: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'CascadeUnitPart',
    cascade: true,
  },
})

const AssemblyLine = defineModel('CascadeUnitLine', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
  machines: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'CascadeUnitMachine',
    cascade: true,
  },
})

const Warehouse = defineModel('CascadeUnitWarehouse', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
})

const Factory = defineModel('CascadeUnitFactory', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
  lines: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'CascadeUnitLine',
    cascade: true,
  },
  // Unannotated: an annotation-driven delete must leave it alone
  warehouse: {
    type: 'relationship',
    relationship: 'HAS',
    direction: 'out',
    target: 'CascadeUnitWarehouse',
  },
})

const Order = defineModel('CascadeUnitOrder', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
  products: {
    type: 'relationships',
    relationship: 'CONTAINS',
    direction: 'out',
    target: 'CascadeUnitProduct',
  },
})

const Product = defineModel('CascadeUnitProduct', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
  orders: {
    type: 'relationships',
    relationship: 'CONTAINS',
    direction: 'in',
    target: 'CascadeUnitOrder',
    cascade: true,
  },
})

const capture = (): { runner: Runner; statements: string[] } => {
  const statements: string[] = []

  return {
    statements,
    runner: {
      run: vi.fn(async (statement: string) => {
        statements.push(statement)

        return { records: [] }
      }),
    },
  }
}

describe('DeleteService per-relationship cascade', () => {
  it('a plain delete follows the cascade annotations', async () => {
    const { runner, statements } = capture()

    await new DeleteService(runner).delete(getModel(Factory), { id: 'f1' })

    expect(statements).toHaveLength(1)

    const statement = statements[0] ?? ''

    // The annotated chain is matched and deleted, three levels deep
    expect(statement).toContain('CascadeUnitLine')
    expect(statement).toContain('CascadeUnitMachine')
    expect(statement).toContain('CascadeUnitPart')
    expect(statement).toContain('DETACH DELETE this')

    // The unannotated Warehouse is not matched
    expect(statement).not.toContain('Warehouse')
  })

  it('a plain delete of an unannotated schema detaches only the node', async () => {
    const { runner, statements } = capture()

    // Order's only relationship is unannotated
    await new DeleteService(runner).delete(getModel(Order), { id: 'o1' })

    expect(statements).toHaveLength(1)
    expect(statements[0]).not.toContain('OPTIONAL MATCH')
    expect(statements[0]).toContain('DETACH DELETE this')
  })

  it('{ cascade: true } takes every relationship, annotated or not', async () => {
    const { runner, statements } = capture()

    await new DeleteService(runner).delete(getModel(Factory), { id: 'f1' }, { cascade: true })

    const statement = statements[0] ?? ''

    expect(statement).toContain('CascadeUnitLine')
    expect(statement).toContain('CascadeUnitWarehouse')
  })

  it('{ cascade: false } overrides the annotations', async () => {
    const { runner, statements } = capture()

    await new DeleteService(runner).delete(getModel(Factory), { id: 'f1' }, { cascade: false })

    expect(statements).toHaveLength(1)
    expect(statements[0]).not.toContain('OPTIONAL MATCH')
  })

  it('the annotation walk honours the incoming direction', async () => {
    const { runner, statements } = capture()

    await new DeleteService(runner).delete(getModel(Product), { id: 'p1' })

    const statement = statements[0] ?? ''

    // Product -[annotated, in]-> Order: the match points back at the order
    expect(statement).toContain('CascadeUnitOrder')
    expect(statement).toContain('<-[this_orders_rel:`CONTAINS`]')
  })
})

// ---- NTS-595 fixtures --------------------------------------------------------

// Self-referential chain: every hop is annotated, so only the depth cap
// bounds the walk
const ChainNode = defineModel('CascadeDepthNode', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
  child: {
    type: 'relationship',
    relationship: 'NEXT',
    direction: 'out',
    target: 'CascadeDepthNode',
    cascade: true,
  },
})

// Wide fan-out: two annotated cascades from the root, each reaching one
// more annotated level — the shape whose sibling frames cross-multiplied
const LeafNts595 = defineModel('CascadeFanLeaf', {
  id: { type: 'uuid', primary: true },
})

const MidANts595 = defineModel('CascadeFanMidA', {
  id: { type: 'uuid', primary: true },
  leaves: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'CascadeFanLeaf',
    cascade: true,
  },
  spares: {
    type: 'relationships',
    relationship: 'SPARES',
    direction: 'out',
    target: 'CascadeFanLeaf',
    cascade: true,
  },
})

const MidBNts595 = defineModel('CascadeFanMidB', {
  id: { type: 'uuid', primary: true },
  leaves: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'CascadeFanLeaf',
    cascade: true,
  },
})

const RootNts595 = defineModel('CascadeFanRoot', {
  id: { type: 'uuid', primary: true },
  midsA: {
    type: 'relationships',
    relationship: 'A',
    direction: 'out',
    target: 'CascadeFanMidA',
    cascade: true,
  },
  midsB: {
    type: 'relationships',
    relationship: 'B',
    direction: 'out',
    target: 'CascadeFanMidB',
    cascade: true,
  },
})

@NodeEntity()
@SoftDelete()
class CascadeSoftDoc {
  @Primary()
  @Property({ type: 'string' })
  id!: string

  @StringProperty()
  title!: string

  @OneToMany({ type: 'TAGGED', direction: 'OUT', target: () => CascadeSoftTag, cascade: true })
  tags!: CascadeSoftTag[]
}

@NodeEntity()
class CascadeSoftTag {
  @Primary()
  @Property({ type: 'string' })
  id!: string
}

const countClause = (statement: string, clause: string): number =>
  statement.split(clause).length - 1

describe('cascade depth cap (NTS-595)', () => {
  it('caps the self-referential walk at MAX_CASCADE_DEPTH hops', async () => {
    const { runner, statements } = capture()

    await new DeleteService(runner).delete(getModel(ChainNode), { id: 'c1' })

    const statement = statements[0] ?? ''

    expect(MAX_CASCADE_DEPTH).toBe(10)
    expect(countClause(statement, 'OPTIONAL MATCH')).toBe(MAX_CASCADE_DEPTH)
  })

  it('the per-call depth option overrides the cap', async () => {
    const { runner, statements } = capture()

    await new DeleteService(runner).delete(getModel(ChainNode), { id: 'c1' }, { depth: 2 })

    expect(countClause(statements[0] ?? '', 'OPTIONAL MATCH')).toBe(2)
  })
})

describe('cascade row multiplication (NTS-595)', () => {
  it('sibling frames re-state only the alias chain, with DISTINCT', async () => {
    const { runner, statements } = capture()

    await new DeleteService(runner).delete(getModel(RootNts595), { id: 'r1' })

    const statement = statements[0] ?? ''

    // Between the root's two cascade segments: DISTINCT collapses the
    // rows the previous segment fanned out — the old build carried every
    // bound alias (`WITH this, this_…_node, …`), cross-multiplying
    expect(statement).toContain('WITH DISTINCT this\n')
    expect(statement).toContain('WITH DISTINCT this, this_midsA_node\n')
    expect(statement).not.toMatch(/WITH (this|this_\w+), /)

    // Every level still matched and deleted: two leaves under midsA, one
    // under midsB, both mids, the root (the builder may merge several
    // aliases into one DETACH DELETE clause)
    const deletedAliases = (statements[0] ?? '')
      .split('\n')
      .filter((line) => line.includes('DETACH DELETE'))
      .flatMap((line) => line.replace('DETACH DELETE', '').split(','))
      .map((alias) => alias.trim())

    expect(deletedAliases).toHaveLength(6)
    expect(deletedAliases).toContain('this_midsA_node')
    expect(deletedAliases).toContain('this')
  })
})

describe('soft delete semantics (NTS-595)', () => {
  it('is node-only: the label gate and stamp, no cascade clauses', async () => {
    const { runner, statements } = capture()

    await new DeleteService(runner).delete(getModel(CascadeSoftDoc), { id: 'd1' })

    const statement = statements[0] ?? ''

    // The gate: an already-labelled node matches zero rows, so a repeat
    // soft delete is a no-op and deletedAt is never re-stamped
    expect(statement).toContain('NOT this:Deleted')
    expect(statement).toContain('SET this:`Deleted`')
    expect(statement).toContain('deletedAt')

    // Node-only: the cascade-annotated tags relationship is untouched
    expect(statement).not.toContain('OPTIONAL MATCH')
    expect(statement).not.toContain('CascadeSoftTag')
  })
})
