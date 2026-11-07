// The backend import loads neode.service first, resolving the module cycles
// before anything below is evaluated
import { openBackend, TestBackend } from './support/backend'
import { Neode } from '../../src/neode.service'

describe('Per-query read/write routing', () => {
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

  it('executes explicit READ routing', async () => {
    const output = await backend.neode.cypher('RETURN 1 AS one', {}, { routing: 'READ' })

    expect(output.records[0].get('one')).toBe(1)
  })

  it('persists explicit WRITE routing', async () => {
    await backend.neode.cypher(
      'CREATE (n:Routing { name: $name })',
      { name: 'explicit' },
      { routing: 'WRITE' },
    )

    const found = await backend.neode.readCypher('MATCH (n:Routing) RETURN count(n) AS c')

    expect(Number(found.records[0].get('c'))).toBe(1)
  })

  it('persists with defaultRouting WRITE and no per-call routing', async () => {
    const neode = new Neode(backend.connection, false, { defaultRouting: 'WRITE' })

    await neode.cypher('CREATE (n:Routing { name: "default" })')

    const found = await backend.neode.readCypher(
      'MATCH (n:Routing { name: "default" }) RETURN count(n) AS c',
    )

    expect(Number(found.records[0].get('c'))).toBe(1)
  })

  it('keeps writeCypher on the write path and transactions on their own mode', async () => {
    await backend.neode.writeCypher('CREATE (n:Routing { name: "tx" })')

    const created = await backend.neode.inWriteTransaction(async (tx) => {
      await tx.writeCypher('CREATE (n:Routing { name: "inside" })')

      const counts = await tx.readCypher('MATCH (n:Routing) RETURN count(n) AS c')

      await tx.commit()

      return counts
    })

    expect(Number(created.records[0].get('c'))).toBe(2)
  })
})
