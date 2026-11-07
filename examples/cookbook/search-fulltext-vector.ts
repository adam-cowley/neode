/**
Cookbook — full-text and vector search.

Install the two index kinds over a model, write nodes, then query them:
search() runs a Lucene full-text query (pass user text through
toFulltextQuery()), knn() finds the k nearest neighbours of a query
vector. Both return hydrated entities with their relevance score, best
match first. Vector indexes need Neo4j 5.15+.

Run:  npx tsx examples/cookbook/search-fulltext-vector.ts
*/
import { Float, NodeEntity, Property, toFulltextQuery, fromEnv } from 'neode'

@NodeEntity()
class Movie {
  @Property({ type: 'string' })
  title!: string

  @Property({ type: 'string' })
  plot!: string

  // 3 dimensions to keep the demo embedding readable — match this to
  // your real embedding model
  @Float({ array: true })
  embedding!: number[]
}

const FULLTEXT_INDEX = 'movie_search'
const VECTOR_INDEX = 'movie_embedding_vector'

async function main(): Promise<void> {
  const neode = fromEnv()

  try {
    await neode.installFulltextIndexes([
      { label: 'Movie', properties: ['title', 'plot'], name: FULLTEXT_INDEX },
    ])
    await neode.installVectorIndexes([
      { label: 'Movie', property: 'embedding', dimensions: 3, name: VECTOR_INDEX },
    ])

    await Promise.all([
      neode.create(Movie, {
        title: 'The Matrix',
        plot: 'A computer hacker learns the truth',
        embedding: [1.0, 0.2, 0.0],
      }),
      neode.create(Movie, {
        title: 'Se7en',
        plot: 'Two detectives hunt a hacker',
        embedding: [0.0, 1.0, 0.2],
      }),
    ])

    // Full-text: Lucene over title + plot; toFulltextQuery escapes user input
    for (const hit of await neode.search(Movie, FULLTEXT_INDEX, toFulltextQuery('hacker'), 5)) {
      console.log(`fulltext ${hit.score.toFixed(3)}: ${hit.entity.title}`)
    }

    // Vector: nearest neighbours of a query embedding
    for (const hit of await neode.knn(Movie, VECTOR_INDEX, [0.9, 0.1, 0.0], 2)) {
      console.log(`vector ${hit.score.toFixed(3)}: ${hit.entity.title}`)
    }

    const movies = await neode.get(Movie, {})
    await Promise.all(movies.map((movie) => neode.delete(movie)))
  } finally {
    await neode.close()
  }
}

main().catch(console.error)
