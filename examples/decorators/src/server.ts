/**
Watch or Not — a basic movie recommendation engine using neode-ogm's
decorator API. Ported from https://github.com/adam-cowley/neode-example/blob/master/server.js
— the map-definition form of this app lives in `examples/models/server.js`.

Differences from the original:
 - decorated model classes (see ./models.ts) instead of map definitions
   loaded from a directory — classes are self-registering on import
 - `neode.cypher()` → `neode.readCypher()` (read routing, NTS-124)
 - `neode.hydrateFirst(res, 'g')` → `neode.hydrateFirst(Genre, res, 'g')`
 - Cypher uses `$param` syntax and `elementId()` instead of numeric `id()`
*/
import express from 'express'
import session from 'express-session'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { fromEnv as fromEnvironment, hydrate, hydrateFirst } from '../../../dist'
import type { WithMethods } from '../../../dist'
import { Genre, Movie } from './models'
import api from './routes/api'

/**
Load neode-ogm with the variables stored in `.env`
*/
const n = fromEnvironment()

/**
Create a new Express instance
*/
const app = express()

app.set('view engine', 'jade')
app.set('views', path.join(__dirname, '/views'))

app.use(function (request, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'X-Requested-With')
  next()
})

app.use(
  session({
    genid: () => randomUUID(),
    resave: false,
    saveUninitialized: true,
    secret: 'neoderocks',
  }),
)

app.use(express.static(path.join(__dirname, 'public')))

/**
Get a random movie to rate based on the name of the genre
*/
async function getNextMovie(
  genre: string,
  rated: string[],
): Promise<{
  genre: WithMethods<Genre> | undefined
  movie: WithMethods<Movie> | undefined
}> {
  const ignore = rated.length > 0 ? 'AND NOT elementId(m) IN $rated' : ''
  const cypher = `
        MATCH (g:Genre)<-[:IN_GENRE]-(m:Movie)
        WHERE g.name = $genre
        ${ignore}
        RETURN g, m
        ORDER BY RAND() LIMIT 1
    `

  return n.readCypher(cypher, { genre, rated }).then((res) => ({
    genre: hydrateFirst(Genre, res, 'g') as WithMethods<Genre> | undefined,
    movie: hydrateFirst(Movie, res, 'm') as WithMethods<Movie> | undefined,
  }))
}

/**
Home page: a list of genres
*/
app.get('/', (request, res) => {
  n.all(Genre).then((genres) => {
    res.render('index', { title: 'Home', genres })
  })
})

/**
Initial recommendation screen with the first movie ready to rate
*/
app.get('/recommend/:genre', (request, res) => {
  getNextMovie(request.params.genre, [])
    .then(({ genre, movie }) => {
      if (!genre || !movie) {
        res.redirect('/')
        return
      }

      res.render('vote', {
        title: genre.name + ' Recommendations',
        genre,
        movie,
      })
    })
    .catch((error) => {
      res.status(500).send((error as Error).message)
    })
})

/**
Return a new movie to rate in the supplied genre, ignoring the
movies that have already been rated
*/
app.get('/recommend/:genre/next', (request, res) => {
  const rated = request.query.rated ? String(request.query.rated).split(',') : []

  getNextMovie(request.params.genre, rated)
    .then(({ movie }) => movie!.toJson())
    .then((json) => res.send(json))
    .catch((error) => {
      res.status(500).send((error as Error).message)
    })
})

/**
Create a set of RATED relationships from the query string, then run
the collaborative-filtering query to recommend a film based on the
ratings of similar users.
*/
app.get('/recommend/:genre/results', (request, res) => {
  const query = `
        MATCH (g:Genre) WHERE g.name = $genre
        MERGE (u:User {user_id: $user_id})
        WITH g, u

        UNWIND keys($ratings) AS movie
        MATCH (m) WHERE elementId(m) = movie
        MERGE (u)-[r:RATED]->(m)
        SET r.rating = $ratings[movie]

        WITH DISTINCT g, u

        MATCH (u)-[r1:RATED]->()<-[r2:RATED]-(other)
        WITH g, u, other, count(*) as in_common
        ORDER BY in_common DESC LIMIT 10

        MATCH (other)-[:RATED]->(recommendation)-[:IN_GENRE]->(g)
        WHERE NOT (u)-[:RATED]->(recommendation)

        RETURN g, recommendation, count(*) as occurrences
        ORDER BY occurrences DESC LIMIT 1
    `

  const parameters = {
    genre: request.params.genre,
    user_id: request.sessionID,
    ratings: JSON.parse(String(request.query.ratings)),
  }

  n.readCypher(query, parameters)
    .then((results) => {
      const genre = hydrateFirst(Genre, results, 'g')
      const movie = hydrateFirst(Movie, results, 'recommendation')

      if (!movie) {
        return res.status(404).send('No recommendation found — rate more films!')
      }

      res.render('recommendation', {
        title: 'We recommend ' + movie.title,
        genre,
        movie,
      })
    })
    .catch((error) => {
      res.status(500).send((error as Error).message)
    })
})

/**
For examples of how to use neode-ogm to quickly generate a REST API,
see the route examples in ./routes/api.ts
*/
app.use(api(n))

/**
Listen for requests on port 3000
*/
app.listen(3000, function () {
  console.log('app listening on http://localhost:3000') // eslint-disable-line no-console
})
