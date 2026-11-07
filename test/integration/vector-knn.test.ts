// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import { knn } from '../../src/services/query/knn.service'
import { VectorIndexService } from '../../src/services/schema/vector.service'
import { NodeEntity, InternalId, Float } from '../../src/decorators'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Doc {
  @InternalId()
  _id: string

  @Float({ array: true })
  emb: number[]
}

// ---------------------------------------------------------------------------

const INDEX = 'doc_emb_vector'

describe('vector kNN search', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    if (backend.capabilities.vector) {
      const results = await new VectorIndexService(backend.connection, [
        { label: 'Doc', property: 'emb', dimensions: 3 },
      ]).create()

      expect(results.every((result) => result.success)).toBe(true)
    }
  })

  beforeEach(async () => {
    await backend.clearGraph()

    // Near, Far, and the nearest neighbour of the query vector
    await backend.connection.run('CREATE (:Doc {emb: [1.0, 0.0, 0.0]})')
    await backend.connection.run('CREATE (:Doc {emb: [0.0, 1.0, 0.0]})')
    await backend.connection.run('CREATE (:Doc {emb: [0.9, 0.1, 0.0]})')
  })

  afterAll(async () => {
    await backend.close()
  })

  it('returns the nearest neighbours hydrated with scores, best first', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    const results = await knn<Doc>(backend.connection, Doc, INDEX, [1, 0.1, 0], 2)

    expect(results).toHaveLength(2)
    expect(results[0].entity).toBeInstanceOf(Doc)
    expect(results[0].entity.emb).toEqual([0.9, 0.1, 0])
    expect(results[1].entity.emb).toEqual([1, 0, 0])
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
  })

  it('works through both query forms explicitly', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    for (const mode of ['procedure', 'search-clause'] as const) {
      const results = await knn<Doc>(backend.connection, Doc, INDEX, [1, 0.1, 0], 1, mode)

      expect(results).toHaveLength(1)
      expect(results[0].entity.emb).toEqual([0.9, 0.1, 0])
    }
  })

  it('auto-degrades from the SEARCH clause to the procedure', async () => {
    if (!backend.capabilities.vector) {
      return
    }

    const results = await knn<Doc>(backend.connection, Doc, INDEX, [1, 0.1, 0], 1)

    expect(results).toHaveLength(1)
  })

  it('validates its arguments before touching the database', async () => {
    await expect(knn(backend.connection, Doc, INDEX, [1, 0, 0], 0)).rejects.toThrow(TypeError)
    await expect(knn(backend.connection, Doc, INDEX, [], 1)).rejects.toThrow(TypeError)
    await expect(knn(backend.connection, Doc, INDEX, [1, 'x' as never], 1)).rejects.toThrow(
      TypeError,
    )
    await expect(knn(backend.connection, Doc, '', [1, 0, 0], 1)).rejects.toThrow(TypeError)
  })

  it('drops the index following the schema service result pattern', async () => {
    const results = await new VectorIndexService(backend.connection, [
      { label: 'Doc', property: 'emb', dimensions: 3 },
    ]).drop()

    expect(results).toHaveLength(1)
    expect(results[0].action).toBe('DROP')
    expect(results[0].statement).toBe('DROP VECTOR INDEX doc_emb_vector IF EXISTS')
    // success is not asserted: dropping vector indexes is not supported
    // on every backend (e.g. Relate), which the result pattern reports
    // per statement instead of throwing
  })
})
