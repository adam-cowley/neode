// NTS-490 regression tests — delete-flow behaviour on a real Neo4j 5.
//
// Bug classes reported against the container backend:
//   1. DELETE followed by MATCH without an intervening WITH — Neo4j 5
//      rejects it ("WITH is required between DELETE and MATCH", 42N24);
//      the embedded engine accepted it, masking the bug. Fixed by emitting
//      WITH between a DELETE clause and the following (OPTIONAL) MATCH.
//   2. Stale reads after a delete (delete-then-read returning the deleted
//      node).
// Plus a third of the same masked-by-the-embedded-engine class found while
// verifying: saving a null property emitted `DELETE this.prop`, which real
// Neo4j 5 rejects — the un-set now goes through `SET this.prop = null`.
//
// These tests pin the classes so a regression fails here at the unit
// gate (embedded engine) and on the real-server runs.
import type { Newable } from '../../src/meta/newable'
import type { SchemaDefinition } from '../../src/meta/schema-definition.interface'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (map-based; model registry is global per module registry) -----

interface PersonInstance {
  name: string
  age?: number | null
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
  age: { type: 'number' },
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

// -----------------------------------------------------------------------------

describe('Delete flow (NTS-490)', () => {
  let backend: TestBackend
  let Person: Newable
  let Pet: Newable
  let Toy: Newable

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
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  describe('DELETE followed by MATCH (42N24)', () => {
    it('cascade-deletes sibling branches through the facade', async () => {
      // The exact 42N24 shape: the cascade of the second branch (LIKES)
      // opens an OPTIONAL MATCH directly after the first branch's
      // DETACH DELETE — rejected by real Neo4j 5 without the WITH
      const saved = await createGraph()

      await backend.neode.delete(saved, { cascade: true })

      expect(await count('Person', 'Adam')).toBe(0)
      expect(await count('Person', 'Bob')).toBe(0)
      expect(await count('Pet', 'Rex')).toBe(0)
      expect(await count('Toy', 'Bone')).toBe(0)
    })

    it('carries bindings across sibling branches at a depth bound', async () => {
      // Depth 1: the second sibling's OPTIONAL MATCH still follows the
      // first sibling's DETACH DELETE, and Bone survives the depth cut
      const saved = await createGraph()

      await backend.neode.delete(saved, { cascade: true, depth: 1 })

      expect(await count('Person', 'Adam')).toBe(0)
      expect(await count('Person', 'Bob')).toBe(0)
      expect(await count('Pet', 'Rex')).toBe(0)
      expect(await count('Toy', 'Bone')).toBe(1)
    })
  })

  describe('null property on save (DELETE this.prop is not valid Cypher 5)', () => {
    it('save() un-sets a property provided as null', async () => {
      const adam = new Person() as unknown as PersonInstance
      adam.name = 'Adam'
      adam.age = 33

      const saved = (await backend.neode.save(adam)) as unknown as PersonInstance
      expect(saved.age).toBe(33)

      // The save path un-sets the property through setPropertyInBuilder:
      // `SET this.age = null` — `DELETE this.age` is rejected by real Neo4j 5
      saved.age = null

      const updated = (await backend.neode.save(saved)) as unknown as PersonInstance

      const stored = await backend.neode.readCypher(
        'MATCH (n:Person { name: "Adam" }) RETURN n.age AS age',
      )
      expect(stored.records[0].get('age')).toBeNull()
      expect(updated.age).toBeUndefined()
    })
  })

  describe('stale reads after delete', () => {
    it('reads through the facade see the deletion', async () => {
      const saved = await createGraph()
      const id = saved.id as string

      await backend.neode.delete(saved)

      const byKey = await backend.neode.find(Person, id)
      expect(byKey).toBeUndefined()

      const byName = await backend.neode.get(Person, { name: 'Adam' })
      expect(byName).toEqual([])
    })

    it('reads inside the same transaction see the deletion', async () => {
      const saved = await createGraph()
      const id = saved.id as string

      const tx = await backend.neode.openWriteTransaction()

      try {
        await tx.delete(saved)

        const byKey = await tx.find(Person, id)
        expect(byKey).toBeUndefined()

        const byName = await tx.get(Person, { name: 'Adam' })
        expect(byName).toEqual([])
      } finally {
        await tx.commit()
      }

      // Committed: a read outside the transaction sees it too
      const afterCommit = await backend.neode.find(Person, id)
      expect(afterCommit).toBeUndefined()
    })

    it('deleteAll removes matching nodes and later reads see none', async () => {
      await createGraph()

      const deleted = await backend.neode.deleteAll(Person, { name: 'Adam' })
      expect(deleted).toBe(1)

      const remaining = await backend.neode.get(Person, { name: 'Adam' })
      expect(remaining).toEqual([])
    })
  })
})
