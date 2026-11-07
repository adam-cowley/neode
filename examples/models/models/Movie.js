module.exports = {
  labels: ['Movie'],

  studio: 'string',
  releaseDate: 'string',
  imdbId: 'string',
  runtime: 'number',
  description: 'string',
  language: 'string',
  title: {
    type: 'string',
    index: true,
  },
  version: 'number',
  // The original used uri: {scheme: ['http','https']} — neode-ogm's rule
  // table validates uri as a URL; scheme restriction omitted
  trailer: { type: 'string', uri: true },
  imageUrl: { type: 'string', uri: true },
  genre: 'string',
  tagline: 'string',
  lastModified: 'string',
  id: {
    type: 'string',
    primary: true,
  },
  homepage: { type: 'string', uri: true },
  poster: { type: 'string', uri: true },
  plot: 'string',
  released: 'string',
  imdbRating: 'float',
  year: 'integer',

  director: {
    type: 'relationship',
    relationship: 'DIRECTED',
    direction: 'in',
    target: 'Director',
    eager: true,
  },
}
