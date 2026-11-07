import { defineModel } from '../../src/meta/map-schema'
import { getModel } from '../../src/meta'
import type { EntitySchema } from '../../src/meta/entity/entity-schema'
import type { Newable } from '../../src/meta/newable'
import { diffDirty, dirtyValues, isTracked, recordSaved, wasChanged } from '../../src/dirty'
import { hydrateNode } from '../../src/utilities'
import type { GraphNode } from '../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const Person = defineModel('DirtyPerson', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
  age: { type: 'number' },
  species: { type: 'string', readonly: true },
  tags: { type: 'string', array: true },
})

const Pet = defineModel('DirtyPet', {
  name: 'string',
})

const Owner = defineModel('DirtyOwner', {
  name: 'string',
  pets: { type: 'node', relationship: 'OWNS', direction: 'out', target: 'DirtyPet' },
})

interface DirtyPersonInstance {
  id?: string
  name?: string
  age?: number
  species?: string
  tags?: string[]
}

const node = (properties: Record<string, unknown>, label = 'DirtyPerson'): GraphNode => ({
  elementId: '4:dirty-1',
  labels: [label],
  properties,
})

const hydrate = (properties: Record<string, unknown>): DirtyPersonInstance =>
  hydrateNode(getModel(Person), Person as Newable, node(properties)) as DirtyPersonInstance

// ---------------------------------------------------------------------------

describe('dirty tracking (NTS-157)', () => {
  it('snapshots a hydrated instance as the clean baseline', () => {
    const person = hydrate({ id: 'p1', name: 'Adam', age: 30 })

    expect(isTracked(person)).toBe(true)
    expect(diffDirty(getModel(Person), person)).toEqual([])
    expect(dirtyValues(getModel(Person), person)).toEqual({})
  })

  it('reports mutations as dirty, per key and overall', () => {
    const schema = getModel(Person)
    const person = hydrate({ id: 'p1', name: 'Adam', age: 30 })

    person['name'] = 'Ada'

    expect(diffDirty(schema, person)).toEqual(['name'])
    expect(dirtyValues(schema, person)).toEqual({ name: 'Ada' })
  })

  it('never reports the primary key dirty — identity is not state', () => {
    const person = hydrate({ id: 'p1', name: 'Adam' })

    person['id'] = 'p2'

    expect(diffDirty(getModel(Person), person)).toEqual([])
  })

  it('tracks readonly properties (save semantics) — guarded only on update', () => {
    const person = hydrate({ id: 'p1', species: 'human' })

    person['species'] = 'alien'

    expect(diffDirty(getModel(Person), person)).toEqual(['species'])
  })

  it('never tracks relationship keys', () => {
    const owner = hydrateNode(
      getModel(Owner),
      Owner as Newable,
      node({ name: 'Adam' }, 'DirtyOwner'),
    )

    owner['pets'] = []

    expect(diffDirty(getModel(Owner), owner)).toEqual([])
  })

  it('compares arrays element-wise and treats NaN as equal to itself', () => {
    const schema = getModel(Person)
    const person = hydrate({ id: 'p1', tags: ['a', 'b'], age: Number.NaN })

    person['tags']?.push('c')
    expect(diffDirty(schema, person)).toEqual(['tags'])

    person['tags'] = ['a', 'b', 'c']
    person['age'] = Number.NaN

    expect(diffDirty(schema, person)).toEqual(['tags'])
  })

  it('reports untracked instances as clean', () => {
    const person: Record<string, unknown> = new (Person as new () => Record<string, unknown>)()

    person['name'] = 'Adam'

    expect(isTracked(person)).toBe(false)
    expect(diffDirty(getModel(Person), person)).toEqual([])
    expect(dirtyValues(getModel(Person), person)).toEqual({})
  })

  it('recordSaved re-baselines and records what the write changed', () => {
    const schema = getModel(Person)
    const person = hydrate({ id: 'p1', name: 'Adam', age: 30 })

    person['name'] = 'Ada'
    person['age'] = 31

    recordSaved(schema, person, hydrate({ id: 'p1', name: 'Ada', age: 31 }))

    expect(diffDirty(schema, person)).toEqual([])
    expect(wasChanged(person)).toBe(true)
    expect(wasChanged(person, 'name')).toBe(true)
    expect(wasChanged(person, 'age')).toBe(true)
    expect(wasChanged(person, 'species')).toBe(false)
  })

  it('recordSaved with no re-hydrated state keeps the stale snapshot (over-report dirty, never lose changes)', () => {
    const schema = getModel(Person)
    const person = hydrate({ id: 'p1', name: 'Adam' })

    person['name'] = 'Ada'

    recordSaved(schema, person, undefined)

    expect(diffDirty(schema, person)).toEqual(['name'])
  })

  it('wasChanged is false until a first write is recorded', () => {
    const person = hydrate({ id: 'p1', name: 'Adam' })

    expect(wasChanged(person)).toBe(false)
    expect(wasChanged(person, 'name')).toBe(false)
  })
})
