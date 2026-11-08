// The backend import loads neode.service first, resolving the module cycles
// before anything below is evaluated
import { openBackend, TestBackend } from './support/backend'
import { Builder } from '../../src/query'

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
