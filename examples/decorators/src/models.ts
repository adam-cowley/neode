/**
Watch or Not model classes — the decorator API form of the map definitions
in `examples/models/models/*.js`.

Ordering matters: decorator factories run at class-decoration time, so a
relationship's target class must exist before the class that points at it.
The one unavoidable cycle — Movie's inverse `director` view of the
`DIRECTED` relationship — is registered through the metamodel directly at
the bottom of this file (the map API resolves targets lazily by name, so
it never hits this).
*/
import {
  Direction,
  Float,
  InternalId,
  NodeEntity,
  Number,
  OneToMany,
  Property,
  mergeRelationshipProperty,
} from '../../../dist'

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

@NodeEntity()
export class Genre {
  @InternalId() _id!: string

  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
export class Person {
  @InternalId() _id!: string

  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'string' })
  birthday!: string

  @Property({ type: 'string' })
  birthplace!: string

  @Property({ type: 'string' })
  biography!: string

  @Property({ type: 'string' })
  profileImageUrl!: string

  @Property({ type: 'number' })
  version!: number

  @Property({ type: 'string' })
  lastModified!: string
}

@NodeEntity({ labels: ['Movie'] })
export class Movie {
  @InternalId() _id!: string

  @Property({ type: 'string', primary: true })
  id!: string

  @Property({ type: 'string', index: true })
  title!: string

  @Property({ type: 'string' })
  tagline!: string

  @Property({ type: 'string' })
  description!: string

  @Property({ type: 'string' })
  plot!: string

  @Property({ type: 'number' })
  year!: number

  @Property({ type: 'number' })
  runtime!: number

  @Float()
  imdbRating!: number

  @Property({ type: 'string', uri: true })
  poster!: string

  @Property({ type: 'string', uri: true })
  trailer!: string

  @Property({ type: 'string', uri: true })
  homepage!: string

  @Property({ type: 'string', uri: true })
  imageUrl!: string

  @Property({ type: 'string' })
  genre!: string

  @Property({ type: 'string' })
  studio!: string

  @Property({ type: 'string' })
  language!: string

  @Property({ type: 'string' })
  released!: string

  @Property({ type: 'string' })
  releaseDate!: string

  @Property({ type: 'string' })
  imdbId!: string

  @Property({ type: 'number' })
  version!: number

  @Property({ type: 'string' })
  lastModified!: string
}

@NodeEntity()
export class Actor {
  @InternalId() _id!: string

  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'string' })
  birthday!: string

  @Property({ type: 'string' })
  birthplace!: string

  @Property({ type: 'string' })
  biography!: string

  @Property({ type: 'string', uri: true })
  profileImageUrl!: string

  @Property({ type: 'number' })
  version!: number

  @Property({ type: 'string' })
  lastModified!: string

  /**
  Outgoing ACTS_IN relationships to Movie. The character name is a
  relationship property — set it via `actor.relateTo(movie, 'acts_in',
  { name: 'Sam' })`.
  */
  @OneToMany(() => Movie, 'ACTS_IN', Direction.OUTGOING)
  acts_in!: Movie[]
}

// Directors are People with a DIRECTED relationship (the original map
// definition carries both labels)
@NodeEntity({ labels: ['Movie', 'Person'] })
export class Director {
  @InternalId() _id!: string

  @Property({ type: 'string', index: true })
  name!: string

  @Property({ type: 'string' })
  birthday!: string

  @Property({ type: 'string' })
  birthplace!: string

  @Property({ type: 'string' })
  biography!: string

  @Property({ type: 'string', uri: true })
  profileImageUrl!: string

  @Property({ type: 'number' })
  version!: number

  @Property({ type: 'string' })
  lastModified!: string

  @OneToMany(() => Movie, 'DIRECTED', Direction.OUTGOING)
  directed!: Movie[]
}

// ---------------------------------------------------------------------------
// Inverse relationship, registered through the metamodel
// ---------------------------------------------------------------------------

// `movie.director` — the singular, eager inverse of `Director.directed`.
// Both sides of DIRECTED reference the other class, so one of them has to be
// registered after the fact: decorator factories run at class-decoration
// time and can't point at a class that hasn't been defined yet (the map API
// resolves targets lazily by name, which is why examples/models doesn't have
// this problem).
mergeRelationshipProperty(Movie, 'director', 'DIRECTED', Director, Direction.INCOMING, false, true)
