import { describe, expect, it } from 'vitest'
import {
  ConstraintAction,
  ConstraintType,
  cypherPropertyType,
  propertyTypeStatement,
  schemaObjectName,
  schemaStatement,
} from '../../src/services/schema/schema.service'
import { declaredSchemaObjects } from '../../src/services/schema/inspect.service'
import { defineModel } from '../../src/meta/map-schema'
import { mergeModel, getModel } from '../../src/meta'
import { Property } from '../../src/decorators'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'

/**
 * Composite unique/index constraints and property-type constraints in schema
 * sync (NTS-140 / NTS-141).
 *
 * Syntax note: the composite unique REQUIRES the parenthesised property list
 * (`REQUIRE (n.a, n.b) IS UNIQUE`) — Relate rejects the bare
 * `REQUIRE n.a, n.b` spelling.
 */

describe('schemaStatement (single + composite)', () => {
  it('renders a single-property unique constraint', () => {
    expect(
      schemaStatement(ConstraintAction.CREATE, ConstraintType.UNIQUE, 'Person', ['email']),
    ).toBe(
      'CREATE CONSTRAINT person_email_unique_b37312eb IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS UNIQUE',
    )
  })

  it('renders a composite unique constraint with a deterministic name', () => {
    expect(
      schemaStatement(
        ConstraintAction.CREATE,
        ConstraintType.UNIQUE,
        'Person',
        ['eventId', 'email'],
        schemaObjectName('Person', ['eventId', 'email'], ConstraintType.UNIQUE),
      ),
    ).toBe(
      'CREATE CONSTRAINT person_email_eventid_unique_6279aedc IF NOT EXISTS FOR (n:`Person`) ' +
        'REQUIRE (n.`eventId`, n.`email`) IS UNIQUE',
    )
  })

  it('renders a composite index', () => {
    expect(
      schemaStatement(
        ConstraintAction.CREATE,
        ConstraintType.INDEX,
        'Person',
        ['eventId', 'email'],
        schemaObjectName('Person', ['eventId', 'email'], ConstraintType.INDEX),
      ),
    ).toBe(
      'CREATE INDEX person_email_eventid_index_bac51acd IF NOT EXISTS FOR (n:`Person`) ' +
        'ON (n.`eventId`, n.`email`)',
    )
  })

  it('renders existence constraints and drop statements as before', () => {
    expect(
      schemaStatement(ConstraintAction.CREATE, ConstraintType.EXISTS, 'Person', ['email']),
    ).toBe(
      'CREATE CONSTRAINT person_email_exists_b643d272 IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS NOT NULL',
    )
    expect(schemaStatement(ConstraintAction.DROP, ConstraintType.UNIQUE, 'Person', ['email'])).toBe(
      'DROP CONSTRAINT person_email_unique_b37312eb IF EXISTS',
    )
  })

  it('escapes backticks in property names', () => {
    expect(
      schemaStatement(ConstraintAction.CREATE, ConstraintType.UNIQUE, 'Person', ['we`ird']),
    ).toContain('n.`we``ird`')
  })
})

describe('propertyTypeStatement (NTS-141)', () => {
  it('renders a property-type constraint from the declared type', () => {
    expect(propertyTypeStatement(ConstraintAction.CREATE, 'Person', 'email', 'STRING')).toBe(
      'CREATE CONSTRAINT person_email_property_type_cb54f2b0 IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS :: STRING',
    )
  })

  it('drops with the same deterministic name', () => {
    expect(propertyTypeStatement(ConstraintAction.DROP, 'Person', 'email', 'STRING')).toBe(
      'DROP CONSTRAINT person_email_property_type_cb54f2b0 IF EXISTS',
    )
  })
})

describe('composite + property-type wiring through the schema configs', () => {
  it('registers composite unique/index and typed flags from the map API', () => {
    const CompositePerson = defineModel('CompositeSyncPerson', {
      eventId: 'string',
      email: { type: 'string', unique: ['eventId', 'email'], typed: true },
      city: { type: 'string', index: ['city', 'region'] },
    })

    const schema = getModel(CompositePerson)

    expect(schema.getProperty('email').getCompositeUnique()).toEqual(['eventId', 'email'])
    expect(schema.getProperty('email').isTyped()).toBe(true)
    // the array form must not also produce a single-property constraint
    expect(schema.getProperty('email').isUnique()).toBe(false)
    expect(schema.getProperty('city').getCompositeIndex()).toEqual(['city', 'region'])
    expect(schema.getProperty('city').isIndex()).toBe(false)
  })

  it('registers composite unique/index and typed flags from the decorator API', () => {
    class DecoratorCompositePerson {
      @Property({ type: 'string', unique: ['eventId', 'email'], typed: true })
      email: string
    }

    const schema = getModel(DecoratorCompositePerson)

    expect(schema.getProperty('email').getCompositeUnique()).toEqual(['eventId', 'email'])
    expect(schema.getProperty('email').isTyped()).toBe(true)
  })

  it('declares composite constraints and property-type constraints in the inspect set', () => {
    class InspectComposite {
      static __ogmUnitFixture?: void
    }

    const schema: EntitySchema = mergeModel(InspectComposite)

    schema.setLabels(['InspectComposite'])
    schema.addProperty('eventId')
    schema.addProperty('email')

    // the property-type constraint is generated from the declared type
    schema.getProperty('email').setType(PropertyType.STRING)
    schema.getProperty('email').setCompositeUnique(['eventId', 'email'])
    schema.getProperty('email').setTyped(true)

    const declared = declaredSchemaObjects({ enterprise: true })

    expect(declared.constraints).toEqual(
      expect.arrayContaining([
        {
          name: 'inspectcomposite_email_eventid_unique_b9433fb6',
          type: ConstraintType.UNIQUE,
          labelsOrTypes: ['InspectComposite'],
          properties: ['eventId', 'email'],
        },
        {
          name: 'inspectcomposite_email_property_type_32e145de',
          type: ConstraintType.PROPERTY_TYPE,
          labelsOrTypes: ['InspectComposite'],
          properties: ['email'],
        },
      ]),
    )

    // one declaration, one object: no duplicates from the declaring property
    expect(
      declared.constraints.filter(
        (c) => c.name === 'inspectcomposite_email_eventid_unique_b9433fb6',
      ),
    ).toHaveLength(1)
  })

  it('maps declared property types onto Cypher property types, skipping those with no equivalent', () => {
    expect(cypherPropertyType(PropertyType.STRING)).toBe('STRING')
    expect(cypherPropertyType(PropertyType.UUID)).toBe('STRING')
    expect(cypherPropertyType(PropertyType.INTEGER)).toBe('INTEGER')
    expect(cypherPropertyType(PropertyType.DATETIME)).toBe('DATETIME')
    // NUMBER spans INTEGER + FLOAT: no single Cypher property type
    expect(cypherPropertyType(PropertyType.NUMBER)).toBeUndefined()
    expect(cypherPropertyType(PropertyType.ANY)).toBeUndefined()
  })

  it('declares nothing for a typed property with no Cypher equivalent', () => {
    class InspectTypedNumber {
      static __ogmUnitFixture?: void
    }

    const schema: EntitySchema = mergeModel(InspectTypedNumber)

    schema.setLabels(['InspectTypedNumber'])
    schema.addProperty('score')
    schema.getProperty('score').setType(PropertyType.NUMBER)
    schema.getProperty('score').setTyped(true)

    const declared = declaredSchemaObjects({ enterprise: true })

    expect(declared.constraints.some((c) => c.name.startsWith('inspecttypednumber_'))).toBe(false)
  })
})
