// The backend import loads neode.service first, resolving the module cycles
// before anything below is evaluated
import { openBackend, TestBackend } from './support/backend'
import { InternalId, NodeEntity, Property, Uuid } from '../../src/decorators'
import { Neode } from '../../src/neode.service'

@NodeEntity()
class RawPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  static create(name: string): RawPerson {
    const person = new RawPerson()
    person.name = name

    return person
  }
}

describe('Neode#cypher — raw Cypher escape hatch', () => {
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

  it('returns raw records from a read', async () => {
    const output = await backend.neode.cypher('RETURN 1 AS one')

    expect(output.records).toHaveLength(1)
    expect(output.records[0].get('one')).toBe(1)
    expect(output.records[0].keys).toContain('one')
  })

  it('persists writes through the routing option', async () => {
    await backend.neode.cypher(
      'CREATE (n:RawCypher { name: $name })',
      { name: 'Adam' },
      { routing: 'WRITE' },
    )

    const found = await backend.neode.readCypher('MATCH (n:RawCypher) RETURN count(n) AS c')

    expect(Number(found.records[0].get('c'))).toBe(1)
  })

  it('hydrates rows into entities of the given class', async () => {
    await backend.neode.save(RawPerson.create('Adam'))

    const results = await backend.neode.cypher(
      'MATCH (n:RawPerson) RETURN n AS this',
      {},
      { hydrate: RawPerson },
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toBeInstanceOf(RawPerson)
    expect(results[0].name).toBe('Adam')
  })

  it('hydrates from a custom alias column', async () => {
    await backend.neode.save(RawPerson.create('Adam'))

    const results = await backend.neode.cypher(
      'MATCH (n:RawPerson) RETURN n AS node',
      {},
      { hydrate: RawPerson, alias: 'node' },
    )

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Adam')
  })

  it('serialises graph values in raw rows JSON-safely', async () => {
    await backend.neode.cypher(
      'CREATE (a:RawCypher { name: "a" })-[:LIKES]->(b:RawCypher { name: "b" })',
      {},
      { routing: 'WRITE' },
    )

    const path = await backend.neode.cypher(
      'MATCH p = (a:RawCypher { name: "a" })-[:LIKES]->(b) RETURN p',
    )

    expect(() => JSON.stringify(path.records[0].get('p'))).not.toThrow()

    const point = await backend.neode.cypher('RETURN point({ x: 1, y: 2 }) AS p')

    expect(() => JSON.stringify(point.records[0].get('p'))).not.toThrow()

    const temporal = await backend.neode.cypher(
      'RETURN date({ year: 2020, month: 1, day: 2 }) AS d',
    )

    expect(() => JSON.stringify(temporal.records[0].get('d'))).not.toThrow()
  })

  it('honours defaultRouting from the connection options', async () => {
    // A second facade over the same connection, defaulting to WRITE
    const neode = new Neode(backend.connection, false, { defaultRouting: 'WRITE' })

    await neode.cypher('CREATE (n:RawCypher { name: "default-routing" })')

    const found = await backend.neode.readCypher(
      'MATCH (n:RawCypher { name: "default-routing" }) RETURN count(n) AS c',
    )

    expect(Number(found.records[0].get('c'))).toBe(1)
  })
})
