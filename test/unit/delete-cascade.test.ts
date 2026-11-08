import { describe, expect, it, vi } from 'vitest'
import { DeleteService } from '../../src/services/query/delete.service'
import { defineModel } from '../../src/meta/map-schema'
import { getModel } from '../../src/meta/index'
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
