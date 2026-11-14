// NTS-663 — the `enforce` declaration's validation contract: the write
// paths call resolveEnforceClaim before every claim-maintaining write, so
// a bad declaration fails loudly there (the target thunk may be
// unresolvable at registration time, so this is the fail-fast point).
//
// Pure metamodel assertions — no database.
import { describe, expect, it } from 'vitest'
import {
  EndNode,
  NodeEntity,
  OneToMany,
  OneToOne,
  Property,
  RelationshipEntity,
  StartNode,
  Unique,
  Uuid,
} from '../../src/decorators'
import { Direction } from '../../src/query'
import { getModel } from '../../src/meta'
import { NeodeError } from '../../src/errors'
import { resolveEnforceClaim, resolveEnforceProperty } from '../../src/services/write-utilities'

@NodeEntity()
class N663Address {
  @Uuid({ primary: true })
  id: string

  // the claimed property — MUST be unique for the enforcement to ride on
  @Property({ type: 'string', unique: true })
  currentOccupantId: string | undefined

  // exists but not unique — an enforce target that cannot back the claim
  @Property({ type: 'string' })
  plain: string | undefined
}

@NodeEntity()
class N663Person {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @OneToOne({
    type: 'N663_LIVES_AT',
    target: () => N663Address,
    direction: Direction.OUTGOING,
    enforce: 'currentOccupantId',
  })
  address: N663Address | undefined

  // 'many' + enforce is a contradiction
  @OneToMany(
    () => N663Address,
    'N663_MANY',
    Direction.OUTGOING,
    undefined,
    undefined,
    undefined,
    undefined,
    'plain',
  )
  manyWithEnforce: N663Address[]

  // the property exists on the target but is not unique
  @OneToOne({
    type: 'N663_NOT_UNIQUE',
    target: () => N663Address,
    direction: Direction.OUTGOING,
    enforce: 'plain',
  })
  notUnique: N663Address | undefined

  // the property does not exist on the target at all
  @OneToOne({
    type: 'N663_MISSING',
    target: () => N663Address,
    direction: Direction.OUTGOING,
    enforce: 'nope',
  })
  missing: N663Address | undefined

  // declared without enforce — the control case
  @OneToOne({ type: 'N663_PLAIN', target: () => N663Address, direction: Direction.OUTGOING })
  plainRel: N663Address | undefined
}

@NodeEntity()
class N663NoPk {
  // no @Primary/@Uuid({ primary: true }) — nothing to claim with
  @Property({ type: 'string' })
  name: string | undefined

  @OneToOne({
    type: 'N663_NO_PK',
    target: () => N663Address,
    direction: Direction.OUTGOING,
    enforce: 'currentOccupantId',
  })
  address: N663Address | undefined
}

// an edge entity cannot back the claim: the target is not a node model
@RelationshipEntity()
class N663Stay {
  @Uuid({ primary: true })
  id: string

  @StartNode(() => N663Person)
  occupant: N663Person

  @EndNode(() => N663Address)
  address: N663Address
}

@NodeEntity()
class N663EdgePerson {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string', unique: true })
  name: string

  @OneToOne({
    type: 'N663_EDGE_ENFORCE',
    target: () => N663Stay,
    direction: Direction.OUTGOING,
    enforce: 'currentOccupantId',
  })
  stay: N663Stay | undefined
}

const addressSchema = getModel(N663Address)
const personSchema = getModel(N663Person)
const noPkSchema = getModel(N663NoPk)
const edgePersonSchema = getModel(N663EdgePerson)

function instance<T>(constructor: new () => T, values: Record<string, unknown> = {}): T {
  const entity = new constructor()

  for (const [key, value] of Object.entries(values)) {
    Reflect.set(entity, key, value)
  }

  return entity
}

describe('enforce declaration validation (NTS-663)', () => {
  it('resolves a valid claim: the target property and the source primary-key value', () => {
    const relationship = personSchema.getRelationship('address')
    const person = instance(N663Person, { id: 'p-1' })

    expect(resolveEnforceClaim(relationship, personSchema, person, addressSchema)).toEqual({
      property: 'currentOccupantId',
      value: 'p-1',
    })
  })

  it('is undefined without an enforce declaration', () => {
    const relationship = personSchema.getRelationship('plainRel')

    expect(resolveEnforceProperty(relationship, addressSchema)).toBeUndefined()
  })

  it('rejects enforce on a many-cardinality relationship', () => {
    const relationship = personSchema.getRelationship('manyWithEnforce')
    const person = instance(N663Person, { id: 'p-1' })

    expect(() => resolveEnforceClaim(relationship, personSchema, person, addressSchema)).toThrow(
      NeodeError,
    )
  })

  it('rejects a non-unique target property', () => {
    const relationship = personSchema.getRelationship('notUnique')
    const person = instance(N663Person, { id: 'p-1' })

    expect(() => resolveEnforceClaim(relationship, personSchema, person, addressSchema)).toThrow(
      /not unique/,
    )
  })

  it('rejects a target property that does not exist', () => {
    const relationship = personSchema.getRelationship('missing')
    const person = instance(N663Person, { id: 'p-1' })

    expect(() => resolveEnforceClaim(relationship, personSchema, person, addressSchema)).toThrow(
      /no such property/,
    )
  })

  it('rejects a relationship-entity (edge) target — the claim must ride a node model', () => {
    const relationship = edgePersonSchema.getRelationship('stay')
    const person = instance(N663EdgePerson, { id: 'p-1' })

    // the far-node schema is passed (relate() parity) — the DECLARED edge
    // entity target is what makes the declaration incoherent
    expect(() =>
      resolveEnforceClaim(relationship, edgePersonSchema, person, addressSchema),
    ).toThrow(/relationship entity/)
  })

  it('rejects a source entity carrying no primary-key value (implicit pk model)', () => {
    const relationship = noPkSchema.getRelationship('address')
    const entity = instance(N663NoPk) // pk value unset — unsaved

    expect(() => resolveEnforceClaim(relationship, noPkSchema, entity, addressSchema)).toThrow(
      /carries no/,
    )
  })

  it('rejects a source entity carrying no primary-key value', () => {
    const relationship = personSchema.getRelationship('address')
    const person = instance(N663Person) // id unset — unsaved

    expect(() => resolveEnforceClaim(relationship, personSchema, person, addressSchema)).toThrow(
      /carries no id value/,
    )
  })
})
