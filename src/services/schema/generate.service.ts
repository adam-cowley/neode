/**
Database introspector (NTS-164): generate neode model definitions from an
existing graph, so adopting the OGM on a legacy database does not start
with hand-writing every model.

The walk reads what the inspect machinery reads — node labels
(`CALL db.labels()`), uniqueness constraints (`SHOW CONSTRAINTS`) — and
samples existing DATA: N nodes per label give each property its observed
value type (a property absent from some sampled nodes is optional; types
conflicting across nodes raise a descriptive NeodeError). One traversal
per label adds the out-going relationships (type, target label, average
out-degree — more than one relationship per source node renders as a
"many").

The unique constraint's property is suggested as the model's primary key
(`primary: true`). Constraints and indexes are deliberately NOT re-declared:
`installSchema()` manages them from the models, and the generated set must
round-trip — generate → register → installSchema → no drift — without
shadowing the database's installed schema under a second name.

Two output styles, both exactly the shapes the agent docs teach: decorated
TypeScript classes (`@NodeEntity()` / `@Property()` / `@RelatedOne()`) and
map schemas (`defineModel('X', { ... })`). Relationships are emitted as the
read-only eager projections @RelatedOne / @RelatedMany — the introspector
cannot know which relationships a consumer needs to WRITE.
*/

import {
  isDate,
  isDateTime,
  isDuration,
  isLocalDateTime,
  isLocalTime,
  isPoint,
  isTime,
} from 'neo4j-driver'

import type { ConnectionProvider, QueryRecord } from '../../driver/types.js'
import { NeodeError } from '../../errors/index.js'
import type {
  PropertyDefinition,
  PropertyTypeName,
  SchemaDefinition,
} from '../../meta/schema-definition.interface.js'
import { quote } from '../../query/quote.js'
import { isRecord } from '../type-guards.js'

/**
Options for generateModels.
*/
export interface GenerateModelsOptions {
  /**
  Nodes sampled per label for property-type inference (default 100)
  */
  sampleSize?: number
  /**
  Only generate models for these labels — scope the introspection to a
  subgraph (defaults to every label in the database)
  */
  labels?: string[]
}

/**
One generated relationship declaration: always direction 'out' — the walk
captures every relationship once, from its source label.
*/
export interface GeneratedRelationship {
  /**
  The property key the relationship is declared under
  */
  key: string
  /**
  The Neo4j relationship type
  */
  relationship: string
  direction: 'out'
  /**
  The label (model name) the relationship points at
  */
  target: string
  /**
  The TypeScript class name of the target model in the decorated output
  (the collision-free identifier assigned to `target`, never the raw label)
  */
  targetClassName: string
  /**
  True when the sampled out-degree exceeds one — renders as @RelatedMany /
  `type: 'relatedMany'`, otherwise @RelatedOne / `type: 'relatedOne'`
  */
  many: boolean
}

/**
One generated model: the label it maps, the inferred primary key and the
map-schema definition ready for defineModel().
*/
export interface GeneratedModel {
  /**
  The node label the model maps
  */
  label: string
  /**
  The TypeScript class name in the decorated output (the label, made a
  valid identifier; differs from `label` when the label is not one)
  */
  className: string
  /**
  The unique constraint's property, suggested as the model's primary key
  */
  primaryKey: string | undefined
  /**
  Inferred property definitions (absent properties are never emitted:
  sampling only sees what the sample holds)
  */
  properties: Record<string, PropertyDefinition>
  relationships: GeneratedRelationship[]
  /**
  The map-schema definition — pass it to defineModel()
  */
  schema: SchemaDefinition
}

/**
The generateModels result: the models plus both rendered styles.
*/
export interface GenerateModelsResult {
  models: GeneratedModel[]
  /**
  Every model rendered as decorated TypeScript classes (one module)
  */
  typescript: string
  /**
  Every model rendered as defineModel() map-schema calls (one module)
  */
  mapSchema: string
  /**
  Conflicts the walk could not resolve (properties of conflicting or
  untypeable values, relationship keys that collide, keys that cannot be
  declared): the offending property or relationship is left out of the
  generated models and reported here instead of aborting the whole run
  */
  warnings: string[]
}

/**
Default nodes sampled per label
*/
const DEFAULT_SAMPLE_SIZE = 100

/**
Distinct (type, target) relationships kept per label, highest count first
*/
const RELATIONSHIP_LIMIT = 20

/**
Labels sampled per query round at once (the label walk is bounded so a
database with many labels does not open an unbounded number of statements)
*/
const LABEL_CONCURRENCY = 4

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
Property keys no generated declaration can carry: `__proto__` in an object
literal sets the prototype, and a class field named `constructor` is a
syntax error
*/
const UNDECLARABLE_KEYS = new Set(['__proto__', 'constructor'])

/**
Identifiers a generated class name must not take: the names the decorated
module imports, reserved words, and globals the output (or its consumers)
rely on
*/
const RESERVED_CLASS_NAMES = new Set([
  'NodeEntity',
  'Property',
  'RelatedOne',
  'RelatedMany',
  'Object',
  'Array',
  'Function',
  'Symbol',
  'Promise',
  'Map',
  'Set',
  'Date',
  'Error',
  'String',
  'Number',
  'Boolean',
  'BigInt',
  'undefined',
  'NaN',
  'Infinity',
  'arguments',
  'eval',
  'await',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'as',
  'any',
  'async',
  'of',
  'type',
  'null',
  'true',
  'false',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
])

/**
Deterministic string ordering for generated output (the drift service
keeps its own private copy of this helper)
*/
function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1
  }

  if (left > right) {
    return 1
  }

  return 0
}

const TS_TYPES: Record<PropertyTypeName, string> = {
  any: 'unknown',
  string: 'string',
  number: 'number',
  int: 'number',
  integer: 'number',
  float: 'number',
  boolean: 'boolean',
  uuid: 'string',
  date: 'unknown',
  time: 'unknown',
  datetime: 'unknown',
  localtime: 'unknown',
  localdatetime: 'unknown',
  point: 'unknown',
  duration: 'unknown',
}

/**
Cypher value → neode property type name. Integers arrive normalised to
plain numbers (indistinguishable from floats), temporal and spatial values
keep their driver prototypes.
*/
function valueTypeName(value: unknown): PropertyTypeName | 'unknown' {
  if (typeof value === 'string') {
    return 'string'
  }

  if (typeof value === 'boolean') {
    return 'boolean'
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return 'number'
  }

  const temporal = temporalTypeName(value)

  return temporal ?? 'unknown'
}

/**
Temporal / spatial type by driver guard, falling back to the plain-field
shape: the embedded Relate engine's temporal values are cloned to plain
objects by normalisation (the prototype is lost), so the driver guards
alone cannot see them there — the field signatures recognise the relate
client's shapes (offsetSeconds / zone / nanos spellings, mirroring
driverValueToCypher's parameter forms).
*/
function temporalTypeName(value: unknown): PropertyTypeName | undefined {
  if (isDateTime(value)) {
    return 'datetime'
  }

  if (isLocalDateTime(value)) {
    return 'localdatetime'
  }

  if (isDate(value)) {
    return 'date'
  }

  if (isLocalTime(value)) {
    return 'localtime'
  }

  if (isTime(value)) {
    return 'time'
  }

  if (isDuration(value)) {
    return 'duration'
  }

  if (isPoint(value)) {
    return 'point'
  }

  if (!isRecord(value)) {
    return undefined
  }

  const fields = Object.keys(value)
  const hasFields = (...names: string[]): boolean => names.every((name) => fields.includes(name))

  if (hasFields('srid', 'x', 'y')) {
    return 'point'
  }

  if (hasFields('months', 'days', 'seconds', 'nanos')) {
    return 'duration'
  }

  // Date family first: a DateTime carries hour fields too
  if (hasFields('year', 'month', 'day')) {
    if (!fields.includes('hour')) {
      return 'date'
    }

    return fields.includes('zone') ? 'datetime' : 'localdatetime'
  }

  if (hasFields('hour', 'minute', 'second', 'nanosecond')) {
    return fields.includes('offsetSeconds') ? 'time' : 'localtime'
  }

  return undefined
}

/**
One property's definition from its observed sampled values: type from the
values (lists give `array: true`), never `required` — sampling can never
prove NOT NULL. Undefined when the property was never observed.
*/
export function inferProperty(
  label: string,
  key: string,
  values: unknown[],
): PropertyDefinition | undefined {
  const observed = values.filter((value) => value !== null && value !== undefined)

  if (observed.length === 0) {
    return undefined
  }

  let isList = false
  const typeNames = new Set<PropertyTypeName>()

  for (const value of observed) {
    if (Array.isArray(value)) {
      isList = true

      for (const item of value) {
        const name = valueTypeName(item)

        if (name !== 'unknown') {
          typeNames.add(name)
        }
      }

      continue
    }

    const name = valueTypeName(value)

    if (name === 'unknown') {
      throw new NeodeError(
        `Cannot generate a model for :${label}: property "${key}" holds a value the ` +
          `introspector cannot type (${JSON.stringify(value)}). Give the property an ` +
          'explicit type in the generated model.',
      )
    }

    typeNames.add(name)
  }

  if (typeNames.size > 1) {
    const names = [...typeNames].join(', ')

    throw new NeodeError(
      `Cannot generate a model for :${label}: property "${key}" holds conflicting types ` +
        `(${names}) across ${String(observed.length)} sampled values. Sampling cannot ` +
        'choose — give the property an explicit type in the generated model.',
    )
  }

  const [type = 'any'] = typeNames

  return {
    type,
    ...(isList && { array: true }),
  }
}

/**
Label → valid TypeScript identifier (invalid characters dropped, leading
digit prefixed)
*/
function sanitizeClassName(label: string): string {
  const name = label.replaceAll(/[^A-Za-z0-9_$]/g, '')

  return name === '' || /^\d/.test(name) ? `_${name}` : name
}

/**
Label → unique class name, for every label of one run. Labels that already
are valid, non-reserved identifiers keep their own name; the rest are
sanitised and, when the result is reserved or taken (`A-B` vs `AB`, a label
named `Property` or `class`), suffixed `_2`, `_3`, … Assignment walks the
labels in sorted order, so the mapping is deterministic whatever order the
database lists them in.
*/
export function assignClassNames(labels: Iterable<string>): Map<string, string> {
  const sorted = [...new Set(labels)]

  sorted.sort(compareStrings)

  const names = new Map<string, string>()
  const taken = new Set<string>()

  for (const label of sorted) {
    if (!IDENTIFIER.test(label) || RESERVED_CLASS_NAMES.has(label)) {
      continue
    }

    names.set(label, label)
    taken.add(label)
  }

  for (const label of sorted) {
    if (names.has(label)) {
      continue
    }

    const base = sanitizeClassName(label)
    let name = base
    let suffix = 2

    while (taken.has(name) || RESERVED_CLASS_NAMES.has(name)) {
      name = `${base}_${String(suffix)}`
      suffix += 1
    }

    names.set(label, name)
    taken.add(name)
  }

  return names
}

/**
The relationship property key: the type itself when a valid identifier
(the docs' `ACTED_IN:` shape), camelCased otherwise
*/
function relationshipKey(type: string): string {
  if (IDENTIFIER.test(type)) {
    return type
  }

  const camel = type
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('')

  return IDENTIFIER.test(camel) ? camel : `_${camel}`
}

/**
The uniqueness constraint backing one label's primary key: the first
single-property uniqueness constraint on exactly that label. SHOW
CONSTRAINTS spells the kind per server: UNIQUE (Neo4j), NODE_KEY
(uniqueness plus existence), NODE_PROPERTY_UNIQUENESS (the embedded
Relate engine).
*/
function primaryKeyFor(label: string, constraints: SchemaObjectRow[]): string | undefined {
  for (const constraint of constraints) {
    const isSinglePropertyOnLabel =
      constraint.labelsOrTypes.length === 1 &&
      constraint.labelsOrTypes[0] === label &&
      constraint.properties.length === 1

    if (!isSinglePropertyOnLabel) {
      continue
    }

    const type = constraint.type.replaceAll('_', ' ').toUpperCase()

    if (type === 'NODE KEY' || type.includes('UNIQUE')) {
      return constraint.properties[0]
    }
  }

  return undefined
}

/**
The SHOW CONSTRAINTS columns generateModels reads (the SchemaObject shape)
*/
interface SchemaObjectRow {
  type: string
  labelsOrTypes: string[]
  properties: string[]
}

function schemaObjectRow(row: QueryRecord): SchemaObjectRow {
  const stringList = (key: string): string[] => {
    const value = row.has(key) ? row.get(key) : undefined

    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  }

  const type = row.has('type') ? row.get('type') : undefined

  return {
    type: typeof type === 'string' ? type : '',
    labelsOrTypes: stringList('labelsOrTypes'),
    properties: stringList('properties'),
  }
}

/**
One row of the per-label relationship walk
*/
interface RelationshipWalkRow {
  type: string
  targetLabels: string[]
  count: number
  sources: number
}

/**
One model built from its sample: the pure core of generateModels (unit
tested without a database). `generatedLabels` is the set of labels this
run generates models for — relationships naming anything outside it are
skipped, because a declaration naming an unknown model would not resolve.
*/
export function buildModel(
  label: string,
  samples: Record<string, unknown>[],
  walks: RelationshipWalkRow[],
  primaryKey: string | undefined,
  generatedLabels: ReadonlySet<string>,
  warnings?: string[],
  classNames: ReadonlyMap<string, string> = assignClassNames([label, ...generatedLabels]),
): GeneratedModel | undefined {
  if (samples.length === 0) {
    return undefined
  }

  // Without a `warnings` sink a conflict throws (the strict behaviour);
  // with one, it is recorded and the offending member is left out
  const conflict = (message: string): void => {
    if (warnings === undefined) {
      throw new NeodeError(message)
    }

    warnings.push(message)
  }

  const properties: Record<string, PropertyDefinition> = {}
  const keys = new Set<string>(samples.flatMap((sample) => Object.keys(sample)))

  for (const key of keys) {
    if (UNDECLARABLE_KEYS.has(key)) {
      conflict(
        `Skipped property "${key}" of :${label}: the key cannot be declared on a generated ` +
          'model. Map it by hand if you need it.',
      )

      continue
    }

    let definition: PropertyDefinition | undefined

    try {
      definition = inferProperty(
        label,
        key,
        samples.map((sample) => sample[key]),
      )
    } catch (error) {
      if (warnings === undefined || !(error instanceof NeodeError)) {
        throw error
      }

      warnings.push(error.message)

      continue
    }

    if (definition !== undefined) {
      Object.defineProperty(properties, key, {
        value: definition,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  }

  const relationships: GeneratedRelationship[] = []
  // Property key -> the type that claimed it; a second TYPE reaching the
  // same key is a real conflict, a repeated row of the same type (a target
  // with two label lists) is deduplicated, highest count first
  const claimed = new Map<string, string>()

  for (const walk of walks) {
    const target = walk.targetLabels.find((candidate) => generatedLabels.has(candidate))

    if (target === undefined) {
      continue
    }

    const key = relationshipKey(walk.type)

    // A property of the same name would be overwritten by the
    // relationship declaration — surface the conflict instead
    if (Object.hasOwn(properties, key)) {
      conflict(
        `Cannot generate a model for :${label}: the relationship "${walk.type}" maps to ` +
          `the property key "${key}", taken by a property of the same name. Rename one ` +
          'in the generated model.',
      )

      continue
    }

    if (UNDECLARABLE_KEYS.has(key)) {
      conflict(
        `Skipped relationship "${walk.type}" of :${label}: its property key "${key}" cannot ` +
          'be declared on a generated model.',
      )

      continue
    }

    const existing = claimed.get(key)

    if (existing !== undefined) {
      if (existing === walk.type) {
        continue
      }

      conflict(
        `Cannot generate a model for :${label}: the relationships "${existing}" and ` +
          `"${walk.type}" both map to the property key "${key}". Rename one in the ` +
          'generated model.',
      )

      continue
    }

    claimed.set(key, walk.type)

    relationships.push({
      key,
      relationship: walk.type,
      direction: 'out',
      target,
      targetClassName: classNames.get(target) ?? sanitizeClassName(target),
      many: walk.sources > 0 && walk.count > walk.sources,
    })
  }

  const schema: SchemaDefinition = {}

  // Primary key first, then alphabetical — deterministic, readable output
  const sortedKeys = Object.keys(properties)

  sortedKeys.sort(compareStrings)

  if (primaryKey !== undefined) {
    const position = sortedKeys.indexOf(primaryKey)

    if (position > 0) {
      sortedKeys.splice(position, 1)
      sortedKeys.unshift(primaryKey)
    }
  }

  for (const key of sortedKeys) {
    const definition = properties[key]

    if (definition !== undefined) {
      schema[key] = key === primaryKey ? { ...definition, primary: true } : definition
    }
  }

  for (const relationship of relationships) {
    schema[relationship.key] = {
      type: relationship.many ? 'relatedMany' : 'relatedOne',
      relationship: relationship.relationship,
      direction: relationship.direction,
      target: relationship.target,
    }
  }

  return {
    label,
    className: classNames.get(label) ?? sanitizeClassName(label),
    primaryKey,
    properties,
    relationships,
    schema,
  }
}

const STRING_ESCAPES = new Map([
  ['\\', String.raw`\\`],
  ["'", String.raw`\'`],
  ['\n', String.raw`\n`],
  ['\r', String.raw`\r`],
])

/**
Single-quoted TypeScript string literal — the docs' spelling. Escapes the
backslash, the quote, line terminators (including U+2028 / U+2029) and every
other control character, so no label, type or key can leave the literal.
*/
function tsString(value: string): string {
  let escaped = ''

  for (const char of value) {
    const named = STRING_ESCAPES.get(char)

    if (named !== undefined) {
      escaped += named

      continue
    }

    const code = char.codePointAt(0) ?? 0
    const isControl = code < 32 || code === 127 || code === 8232 || code === 8233

    escaped += isControl ? String.raw`\u${code.toString(16).padStart(4, '0')}` : char
  }

  return `'${escaped}'`
}

/**
Member name for the generated code: bare when a valid identifier, an
escaped string literal otherwise
*/
function memberName(key: string): string {
  return IDENTIFIER.test(key) ? key : tsString(key)
}

/**
The @Property config object literal for one inferred definition
*/
function propertyConfig(definition: PropertyDefinition, isPrimaryKey: boolean): string {
  const parts = [`type: '${definition.type}'`]

  if (definition.array === true) {
    parts.push('array: true')
  }

  if (isPrimaryKey) {
    parts.push('primary: true')
  }

  return `{ ${parts.join(', ')} }`
}

/**
Decorated TypeScript classes for the generated models (one module)
*/
export function renderDecoratedModels(models: GeneratedModel[]): string {
  const lines: string[] = [
    '// Generated by neode-generate — entity models introspected from a live graph.',
    '// Sampling cannot prove NOT NULL, so every property is optional: tighten',
    '// with @Required where the model demands it.',
  ]

  const hasOne = models.some((model) =>
    model.relationships.some((relationship) => !relationship.many),
  )
  const hasMany = models.some((model) =>
    model.relationships.some((relationship) => relationship.many),
  )

  lines.push(
    `import { ${['NodeEntity', 'Property', ...(hasOne ? ['RelatedOne'] : []), ...(hasMany ? ['RelatedMany'] : [])].join(', ')} } from 'neode'`,
  )

  const decorated = models.map((model) => {
    const classLines = [
      model.className === model.label && IDENTIFIER.test(model.label)
        ? '@NodeEntity()'
        : `@NodeEntity({ labels: [${tsString(model.label)}] })`,
      `export class ${model.className} {`,
    ]

    for (const key of orderedPropertyKeys(model)) {
      const definition = model.properties[key]

      if (definition === undefined) {
        continue
      }

      const tsType = TS_TYPES[definition.type]
      const suffix = definition.array === true ? '[]' : ''

      classLines.push(
        `  @Property(${propertyConfig(definition, key === model.primaryKey)}) ${memberName(key)}?: ${tsType}${suffix}`,
      )
    }

    for (const relationship of model.relationships) {
      const tsType = relationship.many
        ? `${relationship.targetClassName}[]`
        : relationship.targetClassName
      const decorator = relationship.many ? 'RelatedMany' : 'RelatedOne'

      classLines.push(
        `  @${decorator}({ type: ${tsString(relationship.relationship)}, direction: 'out', target: () => ${relationship.targetClassName} }) ${memberName(relationship.key)}?: ${tsType}`,
      )
    }

    classLines.push('}')

    return classLines.join('\n')
  })

  return [...lines, '', ...decorated, ''].join('\n')
}

/**
The model's property keys, primary key first, then alphabetical — the
same order the schema definition carries
*/
function orderedPropertyKeys(model: GeneratedModel): string[] {
  const keys = Object.keys(model.properties)

  keys.sort(compareStrings)

  if (model.primaryKey !== undefined) {
    const position = keys.indexOf(model.primaryKey)

    if (position > 0) {
      keys.splice(position, 1)
      keys.unshift(model.primaryKey)
    }
  }

  return keys
}

/**
Keys defineModel() reserves for model configuration — a property with one of
these names is skipped as a property and must not be emitted into map schemas
*/
const MAP_SCHEMA_RESERVED_KEYS = new Set(['labels', 'description', 'filters'])

/**
defineModel() map-schema calls for the generated models (one module)
*/
export function renderMapModels(models: GeneratedModel[], warnings: string[] = []): string {
  const lines: string[] = [
    '// Generated by neode-generate — map-schema definitions introspected from a live graph.',
    '// Sampling cannot prove NOT NULL, so every property is optional: add `required: true`',
    '// where the model demands it.',
    "import { defineModel } from 'neode'",
    '',
  ]

  for (const model of models) {
    const entries: string[] = []

    for (const key of orderedPropertyKeys(model)) {
      const definition = model.properties[key]

      if (definition === undefined) {
        continue
      }

      // defineModel() reserves these keys for model configuration and skips
      // them as properties, so emitting them would silently drop data
      if (MAP_SCHEMA_RESERVED_KEYS.has(key)) {
        warnings.push(
          `Property "${key}" on ${model.label} was omitted from the map schema: ` +
            'defineModel reserves labels/description/filters for model configuration. ' +
            'The decorated class in models.ts still has it, or rename the property.',
        )

        continue
      }

      const parts = [`type: '${definition.type}'`]

      if (definition.array === true) {
        parts.push('array: true')
      }

      if (key === model.primaryKey) {
        parts.push('primary: true')
      }

      entries.push(`  ${memberName(key)}: { ${parts.join(', ')} },`)
    }

    for (const relationship of model.relationships) {
      entries.push(
        `  ${memberName(relationship.key)}: { type: '${relationship.many ? 'relatedMany' : 'relatedOne'}', relationship: ${tsString(relationship.relationship)}, direction: 'out', target: ${tsString(relationship.target)} },`,
      )
    }

    lines.push(`defineModel(${tsString(model.label)}, {`, ...entries, '})', '')
  }

  return lines.join('\n')
}

/**
Generate model definitions from the graph: labels, sampled property types,
relationships and unique-constraint primary keys (NTS-164). Labels without
nodes produce no model (nothing to infer from).
*/
export async function generateModels(
  connection: ConnectionProvider,
  options: GenerateModelsOptions = {},
): Promise<GenerateModelsResult> {
  const requested = Math.floor(options.sampleSize ?? DEFAULT_SAMPLE_SIZE)
  const sampleSize = Number.isFinite(requested) ? Math.max(1, requested) : DEFAULT_SAMPLE_SIZE

  const [labelRows, constraintRows] = await Promise.all([
    connection.run('CALL db.labels()', {}, 'READ'),
    connection.run('SHOW CONSTRAINTS', {}, 'READ'),
  ])

  const wanted = options.labels
  const labels = labelRows.records
    .map((row) => row.get('label'))
    .filter((label): label is string => typeof label === 'string')
    .filter((label) => wanted === undefined || wanted.includes(label))

  const constraints = constraintRows.records.map((row) => schemaObjectRow(row))
  const generatedLabels = new Set(labels)

  const classNames = assignClassNames(labels)
  const warnings: string[] = []

  const built = await mapWithConcurrency(labels, LABEL_CONCURRENCY, async (label) => {
    // Sample first, then walk only the sampled nodes: the relationship walk
    // never scans the whole label, and only property maps (not whole nodes)
    // come back
    // Inlined: a JS number parameter reaches Neo4j as a float, which LIMIT rejects
    // (sampleSize is a validated positive integer)
    const limit = String(sampleSize)
    const [sample, walk] = await Promise.all([
      connection.run(
        `MATCH (n:${quote(label)}) WITH n LIMIT ${limit} RETURN properties(n) AS properties`,
        {},
        'READ',
      ),
      connection.run(
        `MATCH (n:${quote(label)}) WITH n LIMIT ${limit} MATCH (n)-[r]->(m) ` +
          'RETURN type(r) AS type, labels(m) AS labels, count(*) AS rels, count(DISTINCT n) AS sources ' +
          `ORDER BY rels DESC LIMIT ${String(RELATIONSHIP_LIMIT)}`,
        {},
        'READ',
      ),
    ])

    const samples = sample.records
      .map((row) => row.get('properties'))
      .filter((properties): properties is Record<string, unknown> => isRecord(properties))

    const walks: RelationshipWalkRow[] = walk.records.map((row) => ({
      type: rowString(row, 'type'),
      targetLabels: rowStringList(row, 'labels'),
      // count() arrives as a plain number (driver integers are normalised)
      count: rowNumber(row, 'rels'),
      sources: rowNumber(row, 'sources'),
    }))

    const labelWarnings: string[] = []
    const model = buildModel(
      label,
      samples,
      walks,
      primaryKeyFor(label, constraints),
      generatedLabels,
      labelWarnings,
      classNames,
    )

    return { model, labelWarnings }
  })

  // Collected in label order, so the output is deterministic whatever the
  // order the concurrent walks finished in
  const models: GeneratedModel[] = []

  for (const { model, labelWarnings } of built) {
    warnings.push(...labelWarnings)
    models.push(...(model === undefined ? [] : [model]))
  }

  return {
    models,
    typescript: renderDecoratedModels(models),
    mapSchema: renderMapModels(models, warnings),
    warnings,
  }
}

/**
Map over the items with at most `limit` callbacks in flight, keeping the
results in input order
*/
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  callback: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      const item = items[index]

      next += 1

      if (item === undefined) {
        continue
      }

      results[index] = await callback(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return results
}

function rowString(row: QueryRecord, key: string): string {
  const value = row.get(key)

  return typeof value === 'string' ? value : ''
}

function rowStringList(row: QueryRecord, key: string): string[] {
  const value = row.get(key)

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function rowNumber(row: QueryRecord, key: string): number {
  const value = row.get(key)

  return typeof value === 'number' ? value : 0
}
