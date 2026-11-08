// The backend import loads neode.service first, resolving the module cycles
// before anything below is evaluated
import { openBackend, TestBackend } from './support/backend'
import { Builder } from '../../src/query'
import { defineModel } from '../../src/meta/map-schema'
import { hydrate } from '../../src/hydrate'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const SugarHydrateOrder = defineModel('SugarHydrateOrder', {
  id: { type: 'string', primary: true, unique: true },
  total: { type: 'number' },
})

// NTS-553 — Neode#read / Neode#write build-and-run sugar
describe('Neode#read / Neode#write — integration', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('read(builder) routes READ and returns rows', async () => {
    await backend.neode.write('CREATE (:SugarPerson { name: "Adam" })')

    const output = await backend.neode.read(
      new Builder().match('p', 'SugarPerson').return('p.name AS name'),
    )

    expect(output.records).toHaveLength(1)
    expect(output.records[0].get('name')).toBe('Adam')
  })

  it('write(builder) routes WRITE and its writes persist', async () => {
    await backend.neode.write(
      new Builder().create('p', 'SugarPerson', { name: 'Adam' }).return('p'),
    )

    const found = await backend.neode.read(
      new Builder().match('p', 'SugarPerson').where('p.name', 'Adam').return('count(p) AS c'),
    )

    expect(Number(found.records[0].get('c'))).toBe(1)
  })

  it('tx.read returns rows in the transaction scope and commits with it', async () => {
    await backend.neode.write('CREATE (:SugarPerson { name: "Adam" })')

    const names = await backend.neode.inWriteTransaction(async (tx) => {
      const output = await tx.read(new Builder().match('p', 'SugarPerson').return('p.name AS name'))

      await tx.commit()

      return output.records.map((record) => record.get('name'))
    })

    expect(names).toEqual(['Adam'])
  })

  it('tx.write inside inWriteTransaction commits with the transaction', async () => {
    await backend.neode.inWriteTransaction(async (tx) => {
      await tx.write(new Builder().create('p', 'SugarPerson', { name: 'Adam' }))

      await tx.commit()

      return null
    })

    const found = await backend.neode.read(
      new Builder().match('p', 'SugarPerson').where('p.name', 'Adam').return('count(p) AS c'),
    )

    expect(Number(found.records[0].get('c'))).toBe(1)
  })

  it('tx.write rolls back with the transaction on throw', async () => {
    await expect(
      backend.neode.inWriteTransaction(async (tx) => {
        await tx.write(new Builder().create('p', 'SugarPerson', { name: 'Rolback' }))

        throw new Error('force rollback')
      }),
    ).rejects.toThrow('force rollback')

    const found = await backend.neode.read(
      new Builder().match('p', 'SugarPerson').where('p.name', 'Rolback').return('count(p) AS c'),
    )

    expect(Number(found.records[0].get('c'))).toBe(0)
  })
})

// NTS-559 — the hydrate option on read() / write()
describe('Neode#read / Neode#write hydrate option — integration', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('read(builder, params, { hydrate }) returns the entities an explicit hydrate() call does', async () => {
    await backend.neode.write('CREATE (:SugarHydrateOrder { id: $id, total: 10 })', { id: 'h-1' })

    const builder = new Builder().match('o', 'SugarHydrateOrder').where('o.id', 'h-1').return('o')

    const entities = await backend.neode.read(
      builder,
      {},
      { hydrate: SugarHydrateOrder, alias: 'o' },
    )

    expect(entities).toHaveLength(1)
    expect(entities[0]).toBeInstanceOf(SugarHydrateOrder)
    expect(entities[0].id).toBe('h-1')
    expect(entities[0].total).toBe(10)

    // Identical to the explicit hydrate() over the same rows
    const output = await backend.neode.read(builder)
    const explicit = hydrate(SugarHydrateOrder, output, 'o')

    expect(entities).toEqual(explicit)
  })

  it('read(builder, { hydrate }) — the two-argument form — returns the same entities', async () => {
    await backend.neode.write('CREATE (:SugarHydrateOrder { id: $id, total: 3 })', { id: 'h-4' })

    const builder = new Builder().match('o', 'SugarHydrateOrder').where('o.id', 'h-4').return('o')

    const entities = await backend.neode.read(builder, { hydrate: SugarHydrateOrder, alias: 'o' })

    expect(entities).toHaveLength(1)
    expect(entities[0].id).toBe('h-4')
  })

  it('write(builder, params, { hydrate }) hydrates the written row', async () => {
    const builder = new Builder()
      .create('o', 'SugarHydrateOrder', { id: 'h-2', total: 42 })
      .return('o')

    const entities = await backend.neode.write(
      builder,
      {},
      { hydrate: SugarHydrateOrder, alias: 'o' },
    )

    expect(entities).toHaveLength(1)
    expect(entities[0]).toBeInstanceOf(SugarHydrateOrder)
    expect(entities[0].total).toBe(42)

    const found = await backend.neode.find(SugarHydrateOrder, 'h-2')

    expect(found?.total).toBe(42)
  })

  it('tx.read hydrates in the transaction scope and commits with it', async () => {
    await backend.neode.write('CREATE (:SugarHydrateOrder { id: $id, total: 1 })', { id: 'h-3' })

    const totals = await backend.neode.inReadTransaction(async (tx) => {
      const builder = new Builder().match('o', 'SugarHydrateOrder').return('o')

      const entities = await tx.read(builder, undefined, { hydrate: SugarHydrateOrder, alias: 'o' })

      await tx.commit()

      return entities.map((entity) => entity.total)
    })

    expect(totals).toEqual([1])
  })
})
