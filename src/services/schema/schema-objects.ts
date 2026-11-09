/**
Leaf declarations shared by the schema services. Kept free of local
(schema service) imports so the index/constraint services can use them
without creating cycles.
*/
import { PropertyType } from '../../meta/property-schema.js'
import { quote, safeKey } from '../../query/quote.js'

export const ConstraintAction = {
  CREATE: 'CREATE',
  DROP: 'DROP',
  /**
  NTS-551 — graph type extension (`ALTER CURRENT GRAPH TYPE ADD`)
  */
  ADD: 'ADD',
  /**
  NTS-551 — graph type element-type redefinition (`ALTER CURRENT GRAPH TYPE ALTER`)
  */
  ALTER: 'ALTER',
} as const

export type ConstraintAction = (typeof ConstraintAction)[keyof typeof ConstraintAction]

export const ConstraintType = {
  UNIQUE: 'UNIQUE',
  EXISTS: 'EXISTS',
  INDEX: 'INDEX',
  FULLTEXT: 'FULLTEXT',
  VECTOR: 'VECTOR',
  PROPERTY_TYPE: 'PROPERTY_TYPE',
  GRAPH_TYPE: 'GRAPH_TYPE',
} as const

export type ConstraintType = (typeof ConstraintType)[keyof typeof ConstraintType]

export interface SchemaResult {
  action: ConstraintAction
  type: ConstraintType
  label: string
  property: string
  /**
  All indexed properties (composite and full-text cover more than one)
  */
  properties?: string[]
  statement: string
  success: boolean
  error?: Error
}

/**
Deterministic schema object name: `<label>_<property>_<type>` (PLAN §G)
*/
export const schemaObjectName = (label: string, property: string, type: string): string =>
  `${label.toLowerCase()}_${property}_${type.toLowerCase()}`

/**
Deterministic name for a composite object: `<label>_<props joined by _>_<type>`
*/
export const compositeSchemaObjectName = (
  label: string,
  properties: string[],
  type: string,
): string =>
  schemaObjectName(label, properties.map((property) => property.toLowerCase()).join('_'), type)

/**
CREATE/DROP statement for a single- or composite-property UNIQUE, EXISTS or
INDEX schema object. Composite uniques use the parenthesised property list —
the only spelling the Relate engine parses.
*/
export function schemaStatement(
  action: ConstraintAction,
  type: ConstraintType,
  label: string,
  properties: string[],
  name: string = schemaObjectName(label, properties[0] ?? '', type),
  shouldQuoteLabel = true,
): string {
  if (properties.length === 0) {
    throw new TypeError(`Cannot create a ${type} schema object on ${label}: no properties given`)
  }

  const kind = type === ConstraintType.INDEX ? 'INDEX' : 'CONSTRAINT'

  if (action === ConstraintAction.DROP) {
    return `DROP ${kind} ${safeKey(name)} IF EXISTS`
  }

  const quoted = properties.map((property) => `n.${quote(property)}`)
  const labelPattern = shouldQuoteLabel ? `n:${quote(label)}` : `n:${label}`

  const [firstProperty] = properties

  if (firstProperty === undefined) {
    throw new TypeError(`Cannot create a ${type} schema object on ${label}: no properties given`)
  }

  const firstQuoted = `n.${quote(firstProperty)}`

  let target: string

  if (type === ConstraintType.INDEX) {
    target = `ON (${quoted.join(', ')})`
  } else if (type === ConstraintType.UNIQUE) {
    target =
      quoted.length > 1
        ? `REQUIRE (${quoted.join(', ')}) IS UNIQUE`
        : `REQUIRE ${firstQuoted} IS UNIQUE`
  } else {
    target = `REQUIRE ${firstQuoted} IS NOT NULL`
  }

  return `CREATE ${kind} ${safeKey(name)} IF NOT EXISTS FOR (${labelPattern}) ${target}`
}

/**
CREATE/DROP statement for a property-type constraint (NTS-141): `REQUIRE n.prop IS :: STRING`
*/
export function propertyTypeStatement(
  action: ConstraintAction,
  label: string,
  property: string,
  cypherType: string,
  name: string = schemaObjectName(label, property, ConstraintType.PROPERTY_TYPE),
  shouldQuoteLabel = true,
): string {
  const labelPattern = shouldQuoteLabel ? `n:${quote(label)}` : `n:${label}`

  return action === ConstraintAction.DROP
    ? `DROP CONSTRAINT ${safeKey(name)} IF EXISTS`
    : `CREATE CONSTRAINT ${safeKey(name)} IF NOT EXISTS FOR (${labelPattern}) REQUIRE n.${quote(property)} IS :: ${cypherType}`
}

/**
Cypher property-type name for a declared property type, or undefined when
the type has no single Cypher equivalent (NUMBER spans INTEGER + FLOAT, ANY
is untyped): property-type constraints cannot be generated for those.
*/
const CYPHER_PROPERTY_TYPES: Partial<Record<PropertyType, string>> = {
  [PropertyType.STRING]: 'STRING',
  [PropertyType.UUID]: 'STRING',
  [PropertyType.INTEGER]: 'INTEGER',
  [PropertyType.FLOAT]: 'FLOAT',
  [PropertyType.BOOLEAN]: 'BOOLEAN',
  [PropertyType.DATE]: 'DATE',
  [PropertyType.TIME]: 'TIME',
  [PropertyType.DATETIME]: 'DATETIME',
  [PropertyType.LOCALTIME]: 'LOCALTIME',
  [PropertyType.LOCALDATETIME]: 'LOCALDATETIME',
  [PropertyType.POINT]: 'POINT',
  [PropertyType.DURATION]: 'DURATION',
}

export function cypherPropertyType(type: PropertyType): string | undefined {
  return CYPHER_PROPERTY_TYPES[type]
}
