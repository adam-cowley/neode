import { NodeEntity, Property, Primary } from '../../src/index'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class QueueDoc {
  @Primary()
  @Property({ type: 'string' })
  qid!: string

  @Property({ type: 'string' })
  title!: string

  static create(qid: string, title: string): QueueDoc {
    const doc = new QueueDoc()
    doc.qid = qid
    doc.title = title

    return doc
  }
}

// ---------------------------------------------------------------------------

describe('autocommit runs queue behind open transactions (NTS-545)', () => {
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

  it('an autocommit read during an open transaction waits and succeeds', async () => {
    await backend.neode.save(QueueDoc.create('q1', 'visible'))

    const tx = await backend.neode.openWriteTransaction()

    // Fire the autocommit read while the tx holds the slot — it must
    // wait, not fail
    const autocommit = backend.neode.readCypher('MATCH (d:QueueDoc) RETURN count(d) AS c', {})

    await tx.commit()

    const output = await autocommit

    expect(Number(output.records[0]?.get('c'))).toBe(1)
  })

  it('an autocommit write during an open transaction queues too', async () => {
    const tx = await backend.neode.openWriteTransaction()

    const autocommit = backend.neode.writeCypher(
      'CREATE (d:QueueDoc { qid: "q2", title: "queued" })',
      {},
    )

    await tx.commit()
    await autocommit

    const output = await backend.neode.readCypher(
      'MATCH (d:QueueDoc { qid: "q2" }) RETURN count(d) AS c',
      {},
    )

    expect(Number(output.records[0]?.get('c'))).toBe(1)
  })
})
