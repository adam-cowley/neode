import { defineModel } from '../../src/meta/map-schema'
import { getModel } from '../../src/meta'
import { hydrateNode, type EagerProjectionMap } from '../../src/utilities'
import { NeodeError, RelationNotLoadedError } from '../../src/errors'
import { setStrictRelationAccess } from '../../src/strict-relation-access'
import { toJson } from '../../src/serialise'
import { NodeEntity, OneToMany, Property } from '../../src/decorators'
import { Direction } from '../../src/query'
import type { GraphNode } from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const Pet = defineModel('StrictAccessPet', {
  name: 'string',
})

const Home = defineModel('StrictAccessHome', {
  city: 'string',
})

// One many and one singular relationship, neither eager: both start
// unloaded, and each kind has its own loaded-and-empty shape
const Person = defineModel('StrictAccessPerson', {
  name: { type: 'string', unique: true },
  pets: { type: 'nodes', relationship: 'OWNS', direction: 'out', target: 'StrictAccessPet' },
  home: { type: 'node', relationship: 'LIVES_IN', direction: 'out', target: 'StrictAccessHome' },
})

@NodeEntity()
class StrictToy {
  @Property({ type: 'string' }) name!: string
}

@NodeEntity()
class StrictOwner {
  @Property({ type: 'string', unique: true }) name!: string

  @OneToMany(() => StrictToy, 'OWNS', Direction.OUTGOING)
  toys: StrictToy[]
}

interface PersonShape {
  name?: string
  pets?: unknown
  home?: unknown
}

const node = (properties: Record<string, unknown>, label = 'StrictAccessPerson'): GraphNode => ({
  elementId: '4:unit-1',
  labels: [label],
  properties,
})

/** A projection-map node (the shape the eager read queries return) */
const projection = (eager: Record<string, unknown>): EagerProjectionMap =>
  ({
    __EAGER_ID__: '4:unit-1',
    __EAGER_LABELS__: ['StrictAccessPerson'],
    name: 'Adam',
    ...eager,
  }) as EagerProjectionMap

// ---------------------------------------------------------------------------

describe('strict relation access (NTS-155)', () => {
  afterEach(() => {
    setStrictRelationAccess(false)
  })

  it('stays lenient by default: an unloaded relationship reads undefined', () => {
    const person = hydrateNode<PersonShape>(getModel(Person), Person, node({ name: 'Adam' }))

    expect(person.pets).toBeUndefined()
    expect(person.home).toBeUndefined()
  })

  describe('strict mode', () => {
    it('throws RelationNotLoadedError naming the fix when an unloaded relationship is read', () => {
      setStrictRelationAccess(true)

      const person = hydrateNode<PersonShape>(getModel(Person), Person, node({ name: 'Adam' }))

      expect(() => person.pets).toThrow(RelationNotLoadedError)
      expect(() => person.pets).toThrow(
        'StrictAccessPerson.pets was not loaded. ' +
          "Use find(StrictAccessPerson, id, { with: { pets: true } }) or instance.load('pets').",
      )
    })

    it('extends the repo error taxonomy', () => {
      setStrictRelationAccess(true)

      const person = hydrateNode<PersonShape>(getModel(Person), Person, node({ name: 'Adam' }))

      try {
        person.pets
        expect.unreachable('reading an unloaded relationship must throw')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(RelationNotLoadedError)
        expect(error).toBeInstanceOf(NeodeError)
        expect(error).toBeInstanceOf(Error)
      }
    })

    it('reads a loaded relationship back (no throw)', () => {
      setStrictRelationAccess(true)

      const person = hydrateNode<PersonShape>(getModel(Person), Person, node({ name: 'Adam' }), {
        pets: [{ other: { node: node({ name: 'Rex' }, 'StrictAccessPet') } }],
      })

      const pets = person.pets as unknown[]
      expect(pets).toHaveLength(1)
      expect(pets[0]).toBeInstanceOf(Pet)
    })

    it('tells loaded-and-empty from not-loaded for many: an empty array, no throw', () => {
      setStrictRelationAccess(true)

      const person = hydrateNode<PersonShape>(getModel(Person), Person, projection({ pets: [] }))

      expect(person.pets).toEqual([])
    })

    it('tells loaded-and-empty from not-loaded for one: undefined, no throw', () => {
      setStrictRelationAccess(true)

      const person = hydrateNode<PersonShape>(getModel(Person), Person, projection({ home: null }))

      expect(person.home).toBeUndefined()
    })

    it('serialises unloaded relationships as omitted instead of throwing', () => {
      setStrictRelationAccess(true)

      const person = hydrateNode<PersonShape>(getModel(Person), Person, node({ name: 'Adam' }))
      const json = toJson(person)

      expect('pets' in json).toBe(false)
      expect(json['name']).toBe('Adam')
    })

    it('materialises the value when one is assigned after hydration', () => {
      setStrictRelationAccess(true)

      const owner = hydrateNode<{ name?: string; toys?: StrictToy[] }>(
        getModel(StrictOwner),
        StrictOwner,
        node({ name: 'Adam' }, 'StrictOwner'),
      )

      const toy = new StrictToy()
      toy.name = 'Ball'

      owner.toys = [toy]

      expect(owner.toys).toHaveLength(1)
      expect(owner.toys[0].name).toBe('Ball')
    })

    it('works for decorator-defined models (unloaded throws)', () => {
      setStrictRelationAccess(true)

      const owner = hydrateNode<{ name?: string; toys?: StrictToy[] }>(
        getModel(StrictOwner),
        StrictOwner,
        node({ name: 'Adam' }, 'StrictOwner'),
      )

      expect(() => owner.toys).toThrow(RelationNotLoadedError)
      expect(() => owner.toys).toThrow(
        'StrictOwner.toys was not loaded. ' +
          "Use find(StrictOwner, id, { with: { toys: true } }) or instance.load('toys').",
      )
    })
  })

  it('opts back out: the switch decides at access time', () => {
    const person = hydrateNode<PersonShape>(getModel(Person), Person, node({ name: 'Adam' }))

    setStrictRelationAccess(true)
    expect(() => person.pets).toThrow(RelationNotLoadedError)

    setStrictRelationAccess(false)
    expect(person.pets).toBeUndefined()
  })
})
