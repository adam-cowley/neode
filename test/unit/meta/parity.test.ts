import {
  Default,
  InternalId,
  NodeEntity,
  Number,
  OneToMany,
  OneToOne,
  Property,
  Uuid,
} from '../../../src/decorators'
import { getModel } from '../../../src/meta'
import { EntitySchema } from '../../../src/meta/entity/entity-schema'
import { defineModel } from '../../../src/meta/map-schema'
import { Newable } from '../../../src/meta/newable'
import { Direction } from '../../../src/query'

/**
 * Golden parity tests (NTS-14): the same model intent expressed through the
 * decorator API and the map-based API (defineModel) must produce identical
 * EntitySchema state.
 *
 * Decorator classes declare `@InternalId() _id` because map-defined models
 * get that property implicitly.
 */

/** Full PropertySchema state, read only through the public getters */
function properties(schema: EntitySchema) {
  return schema
    .getProperties()
    .map((property) => ({
      key: property.getKey(),
      type: property.getType(),
      primary: property.isPrimaryKey(),
      unique: property.isUnique(),
      array: property.isArray(),
      required: property.isRequired(),
      hidden: property.isHidden(),
      protected: property.isProtected(),
      readonly: property.isReadonly(),
      index: property.isIndex(),
      exists: property.isExists(),
      onCreateSet: property.getOnCreateSet(),
      onMatchSet: property.getOnMatchSet(),
      alwaysSet: property.getAlwaysSet(),
      // Factories (uuid generators etc.) are compared by kind, not identity
      default:
        typeof property.getDefaultValue() === 'function' ? 'function' : property.getDefaultValue(),
      coalesce: property.getCoalesce(),
      typed: property.isTyped(),
      compositeUnique: property.getCompositeUnique(),
      compositeIndex: property.getCompositeIndex(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** Full RelationshipPropertySchema state; targets compared by their labels */
function relationships(schema: EntitySchema) {
  return schema
    .getRelationships()
    .map((rel) => ({
      key: rel.getKey(),
      type: rel.getType(),
      direction: rel.getDirection(),
      many: rel.getMany(),
      eager: rel.getEager(),
      targetLabels: getModel(rel.getTarget()).getLabels(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function snapshot(constructor: Newable) {
  const schema = getModel(constructor)

  // Note: getPrimaryKey() materialises the <label>_id fallback on first call,
  // so it is read before the properties are collected on both sides.
  const primaryKey = schema.getPrimaryKey()

  return {
    type: schema.getType(),
    labels: schema.getLabels(),
    primaryKey: primaryKey?.getKey(),
    properties: properties(schema),
    relationships: relationships(schema),
  }
}

describe('decorator / map-schema parity (NTS-14)', () => {
  it('simple model: uuid primary + string', () => {
    @NodeEntity()
    class ParitySimplePerson {
      @InternalId() _id: string
      @Uuid({ primary: true }) id: string
      @Property({ type: 'string' }) name: string
    }

    const Person = defineModel('ParitySimplePerson', {
      id: { type: 'uuid', primary: true },
      name: 'string',
    })

    expect(snapshot(ParitySimplePerson)).toEqual(snapshot(Person))
  })

  it('multi-label model', () => {
    @NodeEntity({ labels: ['Person', 'Employee'] })
    class ParityMultiLabelPerson {
      @InternalId() _id: string
      @Property({ type: 'string' }) name: string
    }

    const Person = defineModel('ParityMultiLabelPerson', {
      labels: ['Person', 'Employee'],
      name: 'string',
    })

    expect(snapshot(ParityMultiLabelPerson)).toEqual(snapshot(Person))
  })

  it('relationships: one-to-one out (eager) and one-to-many in', () => {
    @NodeEntity()
    class ParityRelPerson {
      @InternalId() _id: string
      @OneToOne({
        type: 'KNOWS',
        direction: Direction.OUTGOING,
        eager: true,
        target: () => ParityRelPerson,
      })
      bestFriend: ParityRelPerson
      @OneToMany(() => ParityRelPerson, 'FOLLOWS', Direction.INCOMING)
      followers: ParityRelPerson[]
    }

    const Person = defineModel('ParityRelPerson', {
      bestFriend: {
        type: 'relationship',
        relationship: 'KNOWS',
        direction: 'out',
        target: 'ParityRelPerson',
        eager: true,
      },
      followers: {
        type: 'relationships',
        relationship: 'FOLLOWS',
        direction: 'in',
        target: 'ParityRelPerson',
      },
    })

    expect(snapshot(ParityRelPerson)).toEqual(snapshot(Person))
  })

  it('defaults: literal and factory', () => {
    @NodeEntity()
    class ParityDefaultsPerson {
      @InternalId() _id: string
      @Property({ type: 'string' })
      @Default('unemployed')
      job: string
      @Property({ type: 'datetime' })
      @Default(() => new Date())
      createdAt: string
    }

    const Person = defineModel('ParityDefaultsPerson', {
      job: { type: 'string', default: 'unemployed' },
      createdAt: { type: 'datetime', default: () => new Date() },
    })

    expect(snapshot(ParityDefaultsPerson)).toEqual(snapshot(Person))

    // Factory defaults on both sides produce the right shapes
    for (const constructor of [ParityDefaultsPerson, Person]) {
      const schema = getModel(constructor)
      expect(schema.getProperty('job').getDefaultValue()).toEqual('unemployed')
      expect(schema.getProperty('createdAt').getDefaultValue()()).toBeInstanceOf(Date)
    }
  })

  it('uuid default: an explicit default wins on both APIs', () => {
    @NodeEntity()
    class ParityUuidDefaultPerson {
      @InternalId() _id: string
      @Uuid({ default: 'fixed-uuid' }) id: string
    }

    const Person = defineModel('ParityUuidDefaultPerson', {
      id: { type: 'uuid', default: 'fixed-uuid' },
    })

    expect(snapshot(ParityUuidDefaultPerson)).toEqual(snapshot(Person))
  })

  it('shorthand number and float', () => {
    @NodeEntity()
    class ParityNumberPerson {
      @InternalId() _id: string
      @Number() age: number
      @Property({ type: 'number' }) score: number
      @Property({ type: 'float' }) height: number
    }

    const Person = defineModel('ParityNumberPerson', {
      age: 'number',
      score: 'number',
      height: 'float',
    })

    expect(snapshot(ParityNumberPerson)).toEqual(snapshot(Person))
  })

  it('every PropertySchema flag set', () => {
    @NodeEntity()
    class ParityFlaggedPerson {
      @InternalId() _id: string
      @Property({
        type: 'string',
        unique: true,
        index: true,
        required: true,
        hidden: true,
        protected: true,
        readonly: true,
        exists: true,
        onCreateSet: true,
        onMatchSet: true,
        alwaysSet: true,
      })
      audited: string
    }

    const Person = defineModel('ParityFlaggedPerson', {
      audited: {
        type: 'string',
        unique: true,
        index: true,
        required: true,
        hidden: true,
        protected: true,
        readonly: true,
        exists: true,
        onCreateSet: true,
        onMatchSet: true,
        alwaysSet: true,
      },
    })

    expect(snapshot(ParityFlaggedPerson)).toEqual(snapshot(Person))
  })

  it('coalesce, typed and composite unique/index configs (NTS-139/140/141)', () => {
    @NodeEntity()
    class ParityHydratePerson {
      @InternalId() _id: string
      @Property({ type: 'string', coalesce: 'public' }) visibility: string
      @Property({ type: 'string', coalesce: ['sub', 'id'] }) handle: string
      @Property({ type: 'string', typed: true }) email: string
      @Property({ type: 'string', unique: ['eventId', 'email'] }) eventId: string
      @Property({ type: 'string', index: ['city', 'region'] }) city: string
    }

    const Person = defineModel('ParityHydratePerson', {
      visibility: { type: 'string', coalesce: 'public' },
      handle: { type: 'string', coalesce: ['sub', 'id'] },
      email: { type: 'string', typed: true },
      eventId: { type: 'string', unique: ['eventId', 'email'] },
      city: { type: 'string', index: ['city', 'region'] },
    })

    expect(snapshot(ParityHydratePerson)).toEqual(snapshot(Person))
  })

  it('primary key falls back to <first label>_id identically', () => {
    @NodeEntity({ labels: ['ParityFallback'] })
    class ParityFallbackPerson {
      @InternalId() _id: string
      @Property({ type: 'string' }) name: string
    }

    const Person = defineModel('ParityFallbackPerson', {
      labels: ['ParityFallback'],
      name: 'string',
    })

    expect(snapshot(ParityFallbackPerson)).toEqual(snapshot(Person))
    expect(getModel(ParityFallbackPerson).getPrimaryKey()?.getKey()).toEqual('parityfallback_id')
  })
})
