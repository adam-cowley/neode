// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import { NodeEntity, Uuid, String, InternalId, Number } from '../../src/decorators'
import { getModel } from '../../src/meta'
import { GetService, type OrderSpec } from '../../src/services/query/get.service'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Person {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  name: string

  @Number()
  age: number
}

// ---------------------------------------------------------------------------

describe('GetService ordering (all() parity)', () => {
  let backend: TestBackend
  let service: GetService

  beforeAll(async () => {
    backend = await openBackend()
    service = new GetService(backend.connection)
  })

  beforeEach(async () => {
    await backend.clearGraph()

    await backend.connection.run(
      "CREATE (:Person {name: 'Adam', age: 30}) " +
        "CREATE (:Person {name: 'Ada', age: 30}) " +
        "CREATE (:Person {name: 'Alan', age: 20})",
    )
  })

  afterAll(async () => {
    await backend.clearGraph()
    await backend.close()
  })

  const names = async (order?: OrderSpec): Promise<string[]> => {
    const schema = getModel(Person)

    const results = await service.get<Person>(Person, schema, {}, undefined, undefined, order)

    return results.map((person) => person.name)
  }

  it('orders by a single property (string form)', async () => {
    expect(await names('name')).toEqual(['Ada', 'Adam', 'Alan'])
  })

  it('orders by several properties (array of strings)', async () => {
    expect(await names(['age', 'name'])).toEqual(['Alan', 'Ada', 'Adam'])
  })

  it('orders by a key -> direction map (object form)', async () => {
    expect(await names({ age: 'ASC', name: 'DESC' })).toEqual(['Alan', 'Adam', 'Ada'])
  })

  it('orders by an array of key -> direction maps', async () => {
    expect(await names([{ age: 'ASC' }, { name: 'DESC' }])).toEqual(['Alan', 'Adam', 'Ada'])
  })

  it('orders ascending by default (two-arg descriptor form)', async () => {
    expect(await names({ field: 'name' })).toEqual(['Ada', 'Adam', 'Alan'])
  })

  it('orders descending via the two-arg descriptor form', async () => {
    expect(await names({ field: 'age', order: 'DESC' })).toHaveLength(3)
  })

  it('combines ordering with skip and limit', async () => {
    const schema = getModel(Person)

    const results = await service.get<Person>(Person, schema, {}, 1, 1, 'name')

    expect(results.map((person) => person.name)).toEqual(['Adam'])
  })
})
