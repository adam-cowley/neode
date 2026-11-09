/**
Leaf declarations shared by the schema services. Kept free of local
(schema service) imports so the index/constraint services can use them
without creating cycles.
*/
import { PropertyType } from '../../meta/property-schema.js'
import { quote, safeKey } from '../../query/quote.js'
import type { ConnectionProvider } from '../../driver/types.js'

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

const compareStrings = (left: string, right: string): number => {
  if (left < right) {
    return -1
  }

  if (left > right) {
    return 1
  }

  return 0
}

/**
A copy sorted into the stable hash/name order
*/
const sortedCopy = (values: string[]): string[] => {
  const copy = [...values]

  copy.sort(compareStrings)

  return copy
}

/**
NTS-598 — short deterministic hash (FNV-1a, 32-bit hex) over the schema
identity. Case-sensitive inputs keep `User` and `user` labels distinct,
and the JSON-encoded tuple with a sorted property list keeps
(`a`,`b_c`) and (`a_b`,`c`) distinct — neither survives the joined
readable part. No runtime randomness: the same (type, label, properties)
hashes identically in every process.
*/
const schemaNameHash = (type: string, label: string, properties: string[]): string => {
  const payload = JSON.stringify([type, label, sortedCopy(properties)])

  let hash = 2_166_136_261 // FNV-1a 32-bit offset basis

  for (let index = 0; index < payload.length; index++) {
    hash ^= payload.codePointAt(index) ?? 0
    hash = Math.imul(hash, 16_777_619) // FNV-1a 32-bit prime
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
Deterministic, INJECTIVE schema object name (NTS-598):
`<label>_<props joined by _>_<type>_<hash>` — the readable part stays
recognisable, the hash suffix disambiguates what the join cannot.
The property list is sorted in BOTH parts: declaration order must never
produce a different name for the same object.
*/
export const schemaObjectName = (label: string, properties: string[], type: string): string =>
  `${label.toLowerCase()}_${sortedCopy(properties)
    .map((property) => property.toLowerCase())
    .join('_')}_${type.toLowerCase()}_${schemaNameHash(type, label, properties)}`

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
  name: string = schemaObjectName(label, properties, type),
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
  name: string = schemaObjectName(label, [property], ConstraintType.PROPERTY_TYPE),
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

/**
NTS-598 — the connection's edition, probed once per connection through the
provider's `CALL dbms.components()`-backed `edition()` and cached: EXISTS
and property-type constraints are Enterprise-only, so the declared set
must come from what the server IS, not from a manual flag that drifts out
of sync with the database. An 'unknown' edition (or a failed probe) counts
as Community — the fail-safe default that never sends unsupported DDL.
*/
const editionCache = new WeakMap<ConnectionProvider, Promise<boolean>>()

export const isEnterpriseConnection = async (connection: ConnectionProvider): Promise<boolean> => {
  const cached = editionCache.get(connection)

  if (cached !== undefined) {
    return cached
  }

  const detected = (async () => {
    try {
      return (await connection.edition()) === 'enterprise'
    } catch {
      // no probe on this provider — Community behaviour (fail-safe default)
      return false
    }
  })()

  editionCache.set(connection, detected)

  return detected
}
