// NTS-663 — the enforce/claim feature through a FOUR-LEVEL nested graph:
// Person -> Address -> Building -> Street -> City, each hop an enforce
// relationship. The claim is the target's `claimedBy` @Unique property
// holding the source's primary key; the database's uniqueness constraint
// makes the inverse side a database-level guarantee.
//
// Nested-create claims at every depth, cascade/mid-chain deletes, sync and
// replace claim moves, and the two claimConflict policies at depth.
import { describe, expect, it } from 'vitest'
import { openBackend, TestBackend } from './support/backend'
import { InternalId, NodeEntity, OneToOne, Property, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import { NeodeError } from '../../src/errors'
import { ConstraintViolationError } from '../../src/errors'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class ChainCity {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @Property({ type: 'string', unique: true })
  claimedBy: string | undefined
}

@NodeEntity()
class ChainStreet {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @Property({ type: 'string', unique: true })
  claimedBy: string | undefined

  @OneToOne({
    type: 'CHAIN_IN',
    target: () => ChainCity,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'claimedBy',
  })
  next: ChainCity | undefined
}

@NodeEntity()
class ChainBuilding {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @Property({ type: 'string', unique: true })
  claimedBy: string | undefined

  @OneToOne({
    type: 'CHAIN_ON',
    target: () => ChainStreet,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'claimedBy',
  })
  next: ChainStreet | undefined
}

@NodeEntity()
class ChainAddress {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @Property({ type: 'string', unique: true })
  claimedBy: string | undefined

  @OneToOne({
    type: 'CHAIN_AT',
    target: () => ChainBuilding,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'claimedBy',
  })
  next: ChainBuilding | undefined
}

@NodeEntity()
class ChainPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @OneToOne({
    type: 'CHAIN_LIVES_AT',
    target: () => ChainAddress,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'claimedBy',
  })
  next: ChainAddress | undefined
}

// the two claimConflict policies, aimed at the building level
@NodeEntity()
class ChainThrowAddress {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @Property({ type: 'string', unique: true })
  claimedBy: string | undefined

  @OneToOne({
    type: 'CHAIN_THROW_AT',
    target: () => ChainBuilding,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'claimedBy',
    claimConflict: 'throw',
  })
  next: ChainBuilding | undefined
}

@NodeEntity()
class ChainDetachAddress {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @Property({ type: 'string', unique: true })
  claimedBy: string | undefined

  @OneToOne({
    type: 'CHAIN_DETACH_AT',
    target: () => ChainBuilding,
    direction: Direction.OUTGOING,
    cardinality: 'one',
    enforce: 'claimedBy',
    claimConflict: 'detach',
  })
  next: ChainBuilding | undefined
}

const UUID_PERSON = '7e6c3c6a-0000-4000-8000-000000000001'
const UUID_ADDRESS = '7e6c3c6a-0000-4000-8000-000000000002'
const UUID_BUILDING = '7e6c3c6a-0000-4000-8000-000000000003'
const UUID_STREET = '7e6c3c6a-0000-4000-8000-000000000004'
const UUID_CITY = '7e6c3c6a-0000-4000-8000-000000000005'
const UUID_STREET_B = '7e6c3c6a-0000-4000-8000-000000000006'

function instance<T>(constructor: new () => T, values: Record<string, unknown> = {}): T {
  const entity = new constructor()

  for (const [key, value] of Object.entries(values)) {
    Reflect.set(entity, key, value)
  }

  return entity
}

describe('enforce through a four-level nested graph (NTS-663)', () => {
  let backend: TestBackend

  const claimOf = async (label: string, name: string): Promise<string | null> => {
    const result = await backend.neode.readCypher(
      `MATCH (n:${label} { name: $name }) RETURN n.claimedBy AS claim`,
      { name },
    )

    const value: unknown = result.records[0]?.get('claim')

    // NB: the @String decorator shadows the global String() in this file
    return value === null || value === undefined ? null : (value as string)
  }

  const saved = async (constructor: new () => object, values: Record<string, unknown>) => {
    const entity = instance(constructor, values)

    return backend.neode.save(entity)
  }

  beforeAll(async () => {
    backend = await openBackend()

    // the claims ride the targets' uniqueness constraints
    await backend.neode.installSchema()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('a four-level nested create claims every target', async () => {
    // no explicit ids: create() generates the @Uuid defaults and the
    // claims must reference the SAME values the nodes were written with
    const person = await backend.neode.create(ChainPerson, {
      name: 'P',
      next: instance(ChainAddress, {
        name: 'address',
        next: instance(ChainBuilding, {
          name: 'building',
          next: instance(ChainStreet, {
            name: 'street',
            next: instance(ChainCity, { name: 'city' }),
          }),
        }),
      }),
    })

    // each level's claim holds the id of the level below it
    const stored = await backend.neode.readCypher(
      'MATCH (n) WHERE n.claimedBy IS NOT NULL RETURN labels(n)[0] AS label, n.id AS id, n.claimedBy AS claim',
    )

    const ids = new Map<string, string>()
    const claims = new Map<string, string>()

    for (const record of stored.records) {
      const label = record.get('label') as string
      ids.set(label, record.get('id') as string)
      claims.set(label, record.get('claim') as string)
    }

    expect(claims.get('ChainAddress')).toBe(Reflect.get(person, 'id'))
    expect(claims.get('ChainBuilding')).toBe(ids.get('ChainAddress'))
    expect(claims.get('ChainStreet')).toBe(ids.get('ChainBuilding'))
    expect(claims.get('ChainCity')).toBe(ids.get('ChainStreet'))
  })

  it('a cascade delete from the root releases all four claims', async () => {
    const city = instance(ChainCity, { id: UUID_CITY, name: 'city' })
    const street = instance(ChainStreet, { id: UUID_STREET, name: 'street', next: city })
    const building = instance(ChainBuilding, { id: UUID_BUILDING, name: 'building', next: street })
    const address = instance(ChainAddress, { id: UUID_ADDRESS, name: 'address', next: building })
    const person = instance(ChainPerson, { id: UUID_PERSON, name: 'P', next: address })

    await backend.neode.save(person)

    await backend.neode.delete(person, { cascade: true })

    expect(await claimOf('ChainAddress', 'address')).toBeNull()
    expect(await claimOf('ChainBuilding', 'building')).toBeNull()
    expect(await claimOf('ChainStreet', 'street')).toBeNull()
    expect(await claimOf('ChainCity', 'city')).toBeNull()
  })

  it('deleting a MID-CHAIN node releases its own and the deeper claims', async () => {
    const city = instance(ChainCity, { id: UUID_CITY, name: 'city' })
    const street = instance(ChainStreet, { id: UUID_STREET, name: 'street', next: city })
    const building = instance(ChainBuilding, { id: UUID_BUILDING, name: 'building', next: street })
    const address = instance(ChainAddress, { id: UUID_ADDRESS, name: 'address', next: building })
    const person = instance(ChainPerson, { id: UUID_PERSON, name: 'P', next: address })

    await backend.neode.save(person)

    // the address (level 1) cascades into building -> street -> city
    await backend.neode.delete(address, { cascade: true })

    expect(await claimOf('ChainBuilding', 'building')).toBeNull()
    expect(await claimOf('ChainStreet', 'street')).toBeNull()
    expect(await claimOf('ChainCity', 'city')).toBeNull()
  })

  it('syncEdges on a mid-level node moves the claim without touching the deeper ones', async () => {
    const city = instance(ChainCity, { id: UUID_CITY, name: 'city' })
    const streetA = instance(ChainStreet, { id: UUID_STREET, name: 'street-a', next: city })
    const streetB = instance(ChainStreet, { id: UUID_STREET_B, name: 'street-b' })
    const building = instance(ChainBuilding, { id: UUID_BUILDING, name: 'building', next: streetA })

    await backend.neode.save(building)
    await backend.neode.save(streetB)

    await backend.neode.syncEdges(ChainBuilding, building, 'next', [streetB])

    expect(await claimOf('ChainStreet', 'street-a')).toBeNull()
    expect(await claimOf('ChainStreet', 'street-b')).toBe(Reflect.get(building, 'id'))
    // level 3 is untouched: the city is still claimed by STREET-A
    expect(await claimOf('ChainCity', 'city')).toBe(UUID_STREET)
  })

  it('replaceRelationship on a mid-level node moves the claim in one statement', async () => {
    const city = instance(ChainCity, { id: UUID_CITY, name: 'city' })
    const streetA = instance(ChainStreet, { id: UUID_STREET, name: 'street-a', next: city })
    const streetB = instance(ChainStreet, { id: UUID_STREET_B, name: 'street-b' })
    const building = instance(ChainBuilding, { id: UUID_BUILDING, name: 'building', next: streetA })

    await backend.neode.save(building)
    await backend.neode.save(streetB)

    await backend.neode.replaceRelationship(building, 'next', [streetB])

    expect(await claimOf('ChainStreet', 'street-a')).toBeNull()
    expect(await claimOf('ChainStreet', 'street-b')).toBe(Reflect.get(building, 'id'))
  })

  it('claimConflict: throw fails loudly at depth', async () => {
    const building = await saved(ChainBuilding, { id: UUID_BUILDING, name: 'building' })
    const addressA = await saved(ChainThrowAddress, { id: UUID_ADDRESS, name: 'A' })
    const addressB = await saved(ChainThrowAddress, { id: UUID_STREET_B, name: 'B' })

    await backend.neode.relate(ChainThrowAddress, addressA, building, 'next')

    const attempt = backend.neode.relate(ChainThrowAddress, addressB, building, 'next')

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/already claimed/)
    expect(await claimOf('ChainBuilding', 'building')).toBe(Reflect.get(addressA, 'id'))
  })

  it('claimConflict: detach takes the target from the other source at depth', async () => {
    const building = await saved(ChainBuilding, { id: UUID_BUILDING, name: 'building' })
    const addressA = await saved(ChainDetachAddress, { id: UUID_ADDRESS, name: 'A' })
    const addressB = await saved(ChainDetachAddress, { id: UUID_STREET_B, name: 'B' })

    await backend.neode.relate(ChainDetachAddress, addressA, building, 'next')

    await backend.neode.relate(ChainDetachAddress, addressB, building, 'next')

    expect(await claimOf('ChainBuilding', 'building')).toBe(Reflect.get(addressB, 'id'))

    const edges = await backend.neode.readCypher(
      'MATCH (:ChainDetachAddress)-[r:CHAIN_DETACH_AT]->(:ChainBuilding { name: "building" }) RETURN count(r) AS c',
    )

    expect(Number(edges.records[0].get('c'))).toBe(1)
  })

  it('a raw-Cypher writer claiming a claimed target at level 4 is rejected', async () => {
    const city = instance(ChainCity, { id: UUID_CITY, name: 'city' })
    const street = instance(ChainStreet, { id: UUID_STREET, name: 'street', next: city })

    await backend.neode.save(street)

    // a SECOND city claiming the same street — through any writer, raw
    // Cypher included — violates the database constraint
    await backend.neode.save(instance(ChainCity, { id: UUID_STREET_B, name: 'city-2' }))

    const attempt = backend.neode.writeCypher(
      'MATCH (c:ChainCity { name: $name }) SET c.claimedBy = $pid',
      { name: 'city-2', pid: UUID_STREET },
    )

    await expect(attempt).rejects.toBeInstanceOf(ConstraintViolationError)
  })
})
