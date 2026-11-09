// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import { search } from '../../src/services/query/search.service'
import { toFulltextQuery } from '../../src/services/index-support/lucene'
import { FulltextIndexService } from '../../src/services/schema/fulltext.service'
import { NodeEntity, InternalId, String } from '../../src/decorators'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Movie {
  @InternalId()
  _id: string

  @String()
  title: string

  @String()
  plot: string
}

// ---------------------------------------------------------------------------

const INDEX = 'movie_plot_title_fulltext_fb2ce53c'

describe('full-text search', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    if (backend.capabilities.fulltext) {
      const results = await new FulltextIndexService(backend.connection, [
        { label: 'Movie', properties: ['title', 'plot'] },
      ]).create()

      expect(results.every((result) => result.success)).toBe(true)
    }
  })

  beforeEach(async () => {
    await backend.clearGraph()

    await backend.connection.run(
      "CREATE (:Movie {title: 'The Matrix', plot: 'A computer hacker learns the truth'})",
    )
    await backend.connection.run(
      "CREATE (:Movie {title: 'Se7en', plot: 'Two detectives hunt a hacker'})",
    )
  })

  afterAll(async () => {
    await backend.close()
  })

  it('returns matching nodes hydrated with a score', async () => {
    if (!backend.capabilities.fulltext) {
      return
    }

    const results = await search<Movie>(backend.connection, Movie, INDEX, 'truth')

    expect(results).toHaveLength(1)
    expect(results[0].entity).toBeInstanceOf(Movie)
    expect(results[0].entity.title).toBe('The Matrix')
    expect(typeof results[0].score).toBe('number')
  })

  it('returns every matching node', async () => {
    if (!backend.capabilities.fulltext) {
      return
    }

    const results = await search<Movie>(backend.connection, Movie, INDEX, 'hacker')

    expect(results.map((result) => result.entity.title).sort()).toEqual(['Se7en', 'The Matrix'])
  })

  it('does not choke on Lucene syntax characters in the query', async () => {
    if (!backend.capabilities.fulltext) {
      return
    }

    // The raw string 'hacker)' would be parsed as Lucene syntax; the
    // helper strips it down to plain terms
    const results = await search<Movie>(
      backend.connection,
      Movie,
      INDEX,
      toFulltextQuery('hacker)'),
    )

    expect(results).toHaveLength(2)
  })

  it('honours a limit', async () => {
    if (!backend.capabilities.fulltext) {
      return
    }

    const results = await search<Movie>(backend.connection, Movie, INDEX, 'hacker', 1)

    expect(results).toHaveLength(1)
  })

  it('rejects empty index names and queries', async () => {
    await expect(search(backend.connection, Movie, '', 'hacker')).rejects.toThrow(TypeError)
    await expect(search(backend.connection, Movie, INDEX, '')).rejects.toThrow(TypeError)
  })

  it('drops the index following the schema service result pattern', async () => {
    const results = await new FulltextIndexService(backend.connection, [
      { label: 'Movie', properties: ['title', 'plot'] },
    ]).drop()

    expect(results).toHaveLength(1)
    expect(results[0].action).toBe('DROP')
    expect(results[0].statement).toBe(
      'DROP FULLTEXT INDEX movie_plot_title_fulltext_fb2ce53c IF EXISTS',
    )
    // success is not asserted: dropping full-text indexes is not
    // supported on every backend (e.g. Relate), which the result
    // pattern reports per statement instead of throwing
  })
})
