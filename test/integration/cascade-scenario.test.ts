// End-to-end test of the cascade scenario: deleting a Product deletes the
// Orders that contain it, and deleting a Factory deletes its AssemblyLines,
// Machines and Parts — as deep as required. What cascades is decided per
// relationship annotation (`cascade: true` on the schema definition);
// relationships without the annotation survive unless the delete call opts
// in with `{ cascade: true }`.
import { openBackend, TestBackend } from './support/backend'
import { getModel } from '../../src/meta'
import type { Newable } from '../../src/meta/newable'
import type { SchemaDefinition } from '../../src/meta/schema-definition.interface'
import { DeleteService } from '../../src/services/query/delete.service'

// ---- Fixtures (map-based; model registry is global per module registry) -----

const productSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  orders: {
    type: 'relationships',
    relationship: 'CONTAINS',
    direction: 'in',
    target: 'Order',
    cascade: true,
  },
}

const orderSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  products: {
    type: 'relationships',
    relationship: 'CONTAINS',
    direction: 'out',
    target: 'Product',
  },
}

const partSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
}

const machineSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  parts: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'Part',
    cascade: true,
  },
}

const lineSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  machines: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'Machine',
    cascade: true,
  },
}

const warehouseSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
}

const factorySchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  lines: {
    type: 'relationships',
    relationship: 'HAS',
    direction: 'out',
    target: 'AssemblyLine',
    cascade: true,
  },
  // Unannotated: an annotation-driven delete must leave it standing
  warehouse: {
    type: 'relationship',
    relationship: 'HAS',
    direction: 'out',
    target: 'Warehouse',
  },
}

// ---------------------------------------------------------------------------

describe('Cascade delete scenario', () => {
  let backend: TestBackend
  let Product: Newable
  let Order: Newable
  let Factory: Newable
  let deleteService: DeleteService

  const count = async (label: string, name: string): Promise<number> => {
    const res = await backend.neode.readCypher(
      `MATCH (n:${label} { name: "${name}" }) RETURN count(n) AS c`,
    )

    return Number(res.records[0].get('c'))
  }

  /** The primary key of a node, looked up by its unique name */
  const idOf = async (label: string, name: string): Promise<string> => {
    const res = await backend.neode.readCypher(
      `MATCH (n:${label} { name: "${name}" }) RETURN n.id AS id`,
    )

    return String(res.records[0]?.get('id'))
  }

  /** Order 1 contains Widget + Spare, Order 2 contains Gadget */
  const createOrders = async (): Promise<void> => {
    const widget = new Product() as unknown as { name: string }
    widget.name = 'Widget'

    const spare = new Product() as unknown as { name: string }
    spare.name = 'Spare'

    const gadget = new Product() as unknown as { name: string }
    gadget.name = 'Gadget'

    const order1 = new Order() as unknown as {
      name: string
      products: unknown[]
    }
    order1.name = 'Order 1'
    order1.products = [widget, spare]

    const order2 = new Order() as unknown as {
      name: string
      products: unknown[]
    }
    order2.name = 'Order 2'
    order2.products = [gadget]

    await backend.neode.save(order1)
    await backend.neode.save(order2)
  }

  /**
  Factory 1: two lines, each with a machine, each with a part, plus a
  warehouse. Factory 2: one line/machine/part — must survive every delete.
  */
  const createFactories = async (): Promise<void> => {
    const part = (name: string) => {
      const node = new (backend.neode.model('Part'))() as unknown as { name: string }
      node.name = name

      return node
    }

    const machine = (name: string, parts: unknown[]) => {
      const node = new (backend.neode.model('Machine'))() as unknown as {
        name: string
        parts: unknown[]
      }
      node.name = name
      node.parts = parts

      return node
    }

    const line = (name: string, machines: unknown[]) => {
      const node = new (backend.neode.model('AssemblyLine'))() as unknown as {
        name: string
        machines: unknown[]
      }
      node.name = name
      node.machines = machines

      return node
    }

    const factory = (name: string, lines: unknown[], warehouse?: unknown) => {
      const node = new Factory() as unknown as {
        name: string
        lines: unknown[]
        warehouse?: unknown
      }
      node.name = name
      node.lines = lines
      node.warehouse = warehouse

      return node
    }

    const warehouse = new (backend.neode.model('Warehouse'))() as unknown as { name: string }
    warehouse.name = 'Warehouse 1'

    await backend.neode.save(
      factory(
        'Factory 1',
        [
          line('Line 1', [machine('Machine 1', [part('Part 1')])]),
          line('Line 2', [machine('Machine 2', [part('Part 2')])]),
        ],
        warehouse,
      ),
    )

    await backend.neode.save(
      factory('Factory 2', [line('Line 3', [machine('Machine 3', [part('Part 3')])])]),
    )
  }

  beforeAll(async () => {
    backend = await openBackend()

    backend.neode.with({
      Product: productSchema,
      Order: orderSchema,
      Part: partSchema,
      Machine: machineSchema,
      AssemblyLine: lineSchema,
      Warehouse: warehouseSchema,
      Factory: factorySchema,
    })

    Product = backend.neode.model('Product')
    Order = backend.neode.model('Order')
    Factory = backend.neode.model('Factory')

    deleteService = new DeleteService(backend.connection)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('deleting a Product deletes the Orders that contain it, and no others', async () => {
    await createOrders()

    await deleteService.delete(getModel(Product), { id: await idOf('Product', 'Widget') })

    expect(await count('Product', 'Widget')).toBe(0)
    expect(await count('Order', 'Order 1')).toBe(0)

    // Order 1's products relationship is unannotated, so its other
    // product survives — cascade stops there
    expect(await count('Product', 'Spare')).toBe(1)

    // Order 2 and its product are untouched
    expect(await count('Order', 'Order 2')).toBe(1)
    expect(await count('Product', 'Gadget')).toBe(1)
  })

  it('deleting an Order leaves its Products alive (unannotated relationship)', async () => {
    await createOrders()

    await deleteService.delete(getModel(Order), { id: await idOf('Order', 'Order 1') })

    expect(await count('Order', 'Order 1')).toBe(0)
    expect(await count('Product', 'Widget')).toBe(1)
    expect(await count('Product', 'Spare')).toBe(1)
  })

  it('{ cascade: true } on a Product takes everything reached, annotated or not', async () => {
    await createOrders()

    await deleteService.delete(
      getModel(Product),
      { id: await idOf('Product', 'Widget') },
      { cascade: true },
    )

    expect(await count('Product', 'Widget')).toBe(0)
    expect(await count('Order', 'Order 1')).toBe(0)
    expect(await count('Product', 'Spare')).toBe(0)

    expect(await count('Order', 'Order 2')).toBe(1)
    expect(await count('Product', 'Gadget')).toBe(1)
  })

  it('deleting a Factory cascades AssemblyLines, Machines and Parts — not the unannotated Warehouse', async () => {
    await createFactories()

    await deleteService.delete(getModel(Factory), { id: await idOf('Factory', 'Factory 1') })

    expect(await count('Factory', 'Factory 1')).toBe(0)
    expect(await count('AssemblyLine', 'Line 1')).toBe(0)
    expect(await count('AssemblyLine', 'Line 2')).toBe(0)
    expect(await count('Machine', 'Machine 1')).toBe(0)
    expect(await count('Machine', 'Machine 2')).toBe(0)
    expect(await count('Part', 'Part 1')).toBe(0)
    expect(await count('Part', 'Part 2')).toBe(0)

    // Unannotated relationship: the warehouse survives
    expect(await count('Warehouse', 'Warehouse 1')).toBe(1)

    // The other factory's chain is untouched
    expect(await count('Factory', 'Factory 2')).toBe(1)
    expect(await count('AssemblyLine', 'Line 3')).toBe(1)
    expect(await count('Machine', 'Machine 3')).toBe(1)
    expect(await count('Part', 'Part 3')).toBe(1)
  })

  it('{ cascade: true } on a Factory also takes the unannotated Warehouse', async () => {
    await createFactories()

    await deleteService.delete(
      getModel(Factory),
      { id: await idOf('Factory', 'Factory 1') },
      { cascade: true },
    )

    expect(await count('Factory', 'Factory 1')).toBe(0)
    expect(await count('Warehouse', 'Warehouse 1')).toBe(0)

    expect(await count('Factory', 'Factory 2')).toBe(1)
    expect(await count('Part', 'Part 3')).toBe(1)
  })

  it('the facade delete still opts in/out over the annotations', async () => {
    await createFactories()

    // Opt out: nothing but the node goes, annotations included
    const factory1 = await backend.neode.find(Factory, await idOf('Factory', 'Factory 1'))
    await backend.neode.delete(factory1, { cascade: false })

    expect(await count('Factory', 'Factory 1')).toBe(0)
    expect(await count('AssemblyLine', 'Line 1')).toBe(1)
    expect(await count('Warehouse', 'Warehouse 1')).toBe(1)

    await backend.clearGraph()

    // No options: the annotations decide
    await createFactories()
    const again = await backend.neode.find(Factory, await idOf('Factory', 'Factory 1'))
    await backend.neode.delete(again)

    expect(await count('AssemblyLine', 'Line 1')).toBe(0)
    expect(await count('Part', 'Part 2')).toBe(0)
    expect(await count('Warehouse', 'Warehouse 1')).toBe(1)
  })

  it('the instance method delete opts in/out over the annotations', async () => {
    await createFactories()

    const repo = backend.neode.getRepository(Factory)
    const factory = await repo.find(await idOf('Factory', 'Factory 1'))

    await (factory as { delete(options?: unknown): Promise<unknown> }).delete({ cascade: false })

    expect(await count('Factory', 'Factory 1')).toBe(0)
    expect(await count('Machine', 'Machine 1')).toBe(1)
  })

  it('the Repository delete forwards cascade options (previously force only)', async () => {
    await createFactories()

    const repo = backend.neode.getRepository(Factory)
    const factoryId = await idOf('Factory', 'Factory 1')

    // Default: annotation-driven — the unannotated warehouse survives
    await repo.delete(factoryId)

    expect(await count('AssemblyLine', 'Line 1')).toBe(0)
    expect(await count('Warehouse', 'Warehouse 1')).toBe(1)

    await backend.clearGraph()

    // Opt in: everything goes
    await createFactories()
    await repo.delete(await idOf('Factory', 'Factory 1'), { cascade: true })

    expect(await count('Warehouse', 'Warehouse 1')).toBe(0)
    expect(await count('Part', 'Part 3')).toBe(1)
  })
})
