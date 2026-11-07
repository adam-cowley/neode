// The backend import loads neode.service first, resolving the
// query.service -> utils -> neode.service module cycle before the
// query services below are evaluated
import { openBackend, TestBackend } from './support/backend'
import { getModel } from '../../src/meta'
import type { Newable } from '../../src/meta/newable'
import type { SchemaDefinition } from '../../src/meta/schema-definition.interface'
import { DeleteService } from '../../src/services/query/delete.service'

// ---- Fixtures (map-based; model registry is global per module registry) -----

interface PersonInstance {
  name: string
  owns?: PetInstance
  likes?: PersonInstance
  id?: string
  _id?: string
}

interface PetInstance {
  name: string
  owns?: ToyInstance
  id?: string
  _id?: string
}

interface ToyInstance {
  name: string
  id?: string
  _id?: string
}

const personSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  owns: { type: 'relationship', relationship: 'OWNS', direction: 'out', target: 'Pet' },
  likes: { type: 'relationship', relationship: 'LIKES', direction: 'out', target: 'Person' },
}

const petSchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
  owns: { type: 'relationship', relationship: 'OWNS', direction: 'out', target: 'Toy' },
}

const toySchema: SchemaDefinition = {
  id: { type: 'uuid', primary: true },
  name: { type: 'string', unique: true },
}

// ---------------------------------------------------------------------------

describe('Cascade delete', () => {
  let backend: TestBackend
  let Person: Newable
  let Pet: Newable
  let Toy: Newable
  let deleteService: DeleteService

  const count = async (label: string, name: string): Promise<number> => {
    const res = await backend.neode.readCypher(
      `MATCH (n:${label} { name: "${name}" }) RETURN count(n) AS c`,
    )

    return Number(res.records[0].get('c'))
  }

  /** Adam -OWNS-> Rex -OWNS-> Bone, Adam -LIKES-> Bob */
  const createGraph = async (): Promise<PersonInstance> => {
    const adam = new Person() as unknown as PersonInstance
    adam.name = 'Adam'

    const bob = new Person() as unknown as PersonInstance
    bob.name = 'Bob'

    const rex = new Pet() as unknown as PetInstance
    rex.name = 'Rex'

    const bone = new Toy() as unknown as ToyInstance
    bone.name = 'Bone'

    rex.owns = bone
    adam.owns = rex
    adam.likes = bob

    return backend.neode.save(adam) as unknown as Promise<PersonInstance>
  }

  beforeAll(async () => {
    backend = await openBackend()

    backend.neode.with({ Person: personSchema, Pet: petSchema, Toy: toySchema })

    Person = backend.neode.model('Person')
    Pet = backend.neode.model('Pet')
    Toy = backend.neode.model('Toy')

    deleteService = new DeleteService(backend.connection)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('deletes a single node by default, keeping related nodes', async () => {
    const saved = await createGraph()

    await deleteService.delete(getModel(saved.constructor), saved)

    expect(await count('Person', 'Adam')).toBe(0)
    expect(await count('Person', 'Bob')).toBe(1)
    expect(await count('Pet', 'Rex')).toBe(1)
    expect(await count('Toy', 'Bone')).toBe(1)
  })

  it('cascade delete removes directly and transitively related nodes', async () => {
    const saved = await createGraph()

    await deleteService.delete(getModel(saved.constructor), saved, { cascade: true })

    expect(await count('Person', 'Adam')).toBe(0)
    expect(await count('Person', 'Bob')).toBe(0)
    expect(await count('Pet', 'Rex')).toBe(0)
    expect(await count('Toy', 'Bone')).toBe(0)
  })

  it('cascade delete is bounded by depth', async () => {
    const saved = await createGraph()

    await deleteService.delete(getModel(saved.constructor), saved, { cascade: true, depth: 1 })

    expect(await count('Person', 'Adam')).toBe(0)

    // Depth 1: direct relations are deleted
    expect(await count('Pet', 'Rex')).toBe(0)
    expect(await count('Person', 'Bob')).toBe(0)

    // Depth 2: Bone survives
    expect(await count('Toy', 'Bone')).toBe(1)
  })

  it('detach mode removes relationships but keeps related nodes', async () => {
    const saved = await createGraph()

    await deleteService.delete(getModel(saved.constructor), saved, {
      cascade: true,
      mode: 'detach',
    })

    expect(await count('Person', 'Adam')).toBe(0)
    expect(await count('Person', 'Bob')).toBe(1)
    expect(await count('Pet', 'Rex')).toBe(1)
    expect(await count('Toy', 'Bone')).toBe(1)

    // Adam's relationship to Rex is gone...
    const ownedByAdam = await backend.neode.readCypher(
      'MATCH (:Pet { name: "Rex" })<-[r:OWNS]-() RETURN count(r) AS c',
    )
    expect(Number(ownedByAdam.records[0].get('c'))).toBe(0)

    // ...but Rex's own relationship to Bone survives
    const rexToBone = await backend.neode.readCypher(
      'MATCH (:Pet { name: "Rex" })-[r:OWNS]->(:Toy { name: "Bone" }) RETURN count(r) AS c',
    )
    expect(Number(rexToBone.records[0].get('c'))).toBe(1)
  })
})
