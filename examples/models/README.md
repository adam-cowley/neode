# Watch or Not — neode-ogm example (map-based models)

This is the example project from [adam-cowley/neode-example](https://github.com/adam-cowley/neode-example)
("Watch or Not", based on the Recommendations example in the
[Neo4j Sandbox](https://neo4j.com/sandbox-v2)), ported to run on **neode-ogm**
with the **map-based schema API** (plain model objects loaded with
`withDirectory()`). The same app expressed with decorated classes lives in
[`../decorators`](../decorators).

## Running it

```bash
# from the neode-ogm repo root: build the library first
npm run build

# then in this folder
npm install
cp .env.example .env   # add your Neo4j credentials
node server.js         # the Watch or Not web app on :3000
node index.js          # the standalone workflow (works on an empty database)
```

`node index.js` merges a Movie, creates three Actors, relates them with
`ACTS_IN` relationships and merges a Director — the flow from the original
repo, using neode-ogm's map-based models loaded with `withDirectory()`.

## What changed from the original

| neode 0.4.9                                | neode-ogm                                               |
| ------------------------------------------ | ------------------------------------------------------- |
| `require('neode')`                         | `require('../dist')`                                    |
| `neode.model('Movie').mergeOn(match, set)` | `neode.mergeOn(neode.model('Movie'), match, set)`       |
| `neode.cypher(query, params)`              | `neode.readCypher()` / `neode.writeCypher()`            |
| `neode.hydrateFirst(res, 'g')`             | `neode.hydrateFirst(constructor, res, 'g')`             |
| `neode.all('Genre')`                       | `neode.all(neode.model('Genre'))`                       |
| `neode.findById('Movie', numericId)`       | `neode.findById(Movie, elementId)`                      |
| `{param}` in Cypher                        | `$param` (Neo4j 4+ syntax)                              |
| numeric `id()` in Cypher                   | `elementId()`                                           |
| `node.get('title')` in views               | plain properties (`movie.title`)                        |
| `neode.merge` with nested instances        | same — nested entity instances create the relationships |

The `models/` definitions are the original map-based schemas — neode-ogm
supports them unchanged (two tweaks: the original's `indexed: true` key was
a typo that never did anything, now `index: true`; and `uri: {scheme: [...]}`
is simplified to `uri: true`).

## Known differences

- The collaborative-filtering query in `server.js` matches rated movies by
  `elementId()` (a stable string) rather than Neo4j's deprecated numeric ids.
- Relationship `properties` in map definitions are schema metadata only —
  they are not validated (tracked in the roadmap). `relateTo(..., props)`
  still writes them.
- The dataset comes from the Neo4j Sandbox Recommendations example — load it
  into your Neo4j instance to see the recommender at work. `node index.js`
  works standalone on an empty database.
