import { Builder, Direction } from '../query/index.js'
import { THIS_NODE } from '../constants.js'
import type { Runner } from '../driver/types.js'
import { EntitySchema } from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { PropertyType } from '../meta/property-schema.js'
import type { OrderSpec } from '../services/query/get.service.js'
import { isRecord } from '../services/type-guards.js'
import { NeodeError } from '../errors/index.js'
import { loadSpecCalls, projectionNode } from './projection.js'
import { hydrateProjection } from './hydrate.js'
import { applySoftDeleteFilter } from '../services/query/soft-delete.js'

/**
True for the related-projection kinds that support nested filters / sort
*/
function isRelatedProjection(property: PropertySchema): boolean {
  return (
    property.getType() === PropertyType.RELATED_ONE ||
    property.getType() === PropertyType.RELATED_MANY
  )
}

/**
A nested filter value: a plain map of related-property filters
*/
function isFilterMap(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype: unknown = Object.getPrototypeOf(value)

  // Plain maps only — Date, driver temporals etc. stay own-property values
  return prototype === Object.prototype || prototype === null
}

/**
Cypher variable bound to the related node of a nested filter / sort
*/
function filterAlias(key: string): string {
  return `${THIS_NODE}_${key}_filter`
}

/**
Bind the single-hop traversal for a nested filter on a related property:
`(this)-[:TYPE]->(alias:TargetLabels)`. An inner MATCH filters the read —
a nested filter is the intent, so related-less rows drop (NTS-565: sorts
never bind this way, they ride a COLLECT { } subquery instead).
*/
function bindTraversal(builder: Builder, property: PropertySchema, alias: string): void {
  const types = (property.getRelationshipType() ?? property.getKey())
    .split('|')
    .filter((part) => part.length > 0)

  const direction = property.getDirection() ?? Direction.OUTGOING

  const targetEntity = property.getEntity()

  const targetSchema = typeof targetEntity === 'function' ? getModel(targetEntity) : undefined

  const labels = targetSchema instanceof EntitySchema ? targetSchema.getLabels() : false

  builder.match(THIS_NODE)

  builder.relationship(types, direction, `${alias}_rel`).to(alias, labels)
}

/**
The property map: own properties filter as property equality (GetService
parity, unknown keys ignored); object values on @RelatedOne / @RelatedMany
keys filter on the related node's properties via a bound traversal, and an
object value on any other property kind is a clear error. Returns the
traversal aliases bound per property key, for nested sort reuse.
*/
function applyFilters(
  builder: Builder,
  schema: EntitySchema,
  parameters: Record<string, unknown>,
): Map<string, string> {
  const bound = new Map<string, string>()

  for (const property of schema.getProperties()) {
    const key = property.getKey()

    if (!Object.hasOwn(parameters, key)) {
      continue
    }

    const value = parameters[key]

    if (!isFilterMap(value)) {
      builder.where(`${THIS_NODE}.${key}`, value)

      continue
    }

    if (!isRelatedProjection(property)) {
      throw new NeodeError(
        `Cannot apply a nested filter on '${key}': only @RelatedOne and @RelatedMany properties support nested filters`,
      )
    }

    const alias = filterAlias(key)

    // shortcut: a @RelatedOne with several matching relationships yields
    // duplicate rows (the projection takes [0], the filter MATCH does not
    // dedupe) — upgrade to an EXISTS { } wrap if singular graphs stop holding
    bindTraversal(builder, property, alias)

    for (const [field, fieldValue] of Object.entries(value)) {
      builder.where(`${alias}.${field}`, fieldValue)
    }

    bound.set(key, alias)
  }

  return bound
}

/**
One deferred sort key: the ORDER BY expression with its direction (when
the caller gave one), and the traversal alias it reads when that alias
must survive the WITH clause carrying the collected keys
*/
interface SortKey {
  expression: string
  order: string
  alias?: string
}

/**
The WITH-carried binding for one fresh nested sort key (NTS-565, the
house Cypher doctrine): a per-row `COLLECT { MATCH … RETURN … ORDER BY … }`
subquery over the traversal, collected into `sortAlias` — a missing
relation yields [] → [0] → null, so no row is dropped or multiplied (the
semantics the old OPTIONAL MATCH binding gave, without the row shaping);
the inner ORDER BY keeps [0] deterministic when a singular graph carries
several matching relationships
*/
function collectedSort(
  builder: Builder,
  property: PropertySchema,
  sortAlias: string,
  field: string,
): string {
  return `${builder.collectExpr(
    (sub) => {
      bindTraversal(sub, property, sortAlias)
      sub.return(`${sortAlias}.${field}`)
      sub.orderBy(`${sortAlias}.${field}`)

      return sub
    },
    [THIS_NODE],
  )} AS ${sortAlias}`
}

/**
Collect every sort key of an order spec, in the order the caller listed
them — deferred so a composite sort's fresh nested keys can share one
WITH clause and one ORDER BY
*/
function collectOrder(
  builder: Builder,
  order: OrderSpec | undefined,
  schema: EntitySchema,
  bound: Map<string, string>,
  keys: SortKey[],
  bindings: string[],
): void {
  if (order === undefined || order === '') {
    return
  }

  if (typeof order === 'string') {
    keys.push({ expression: `${THIS_NODE}.${order}`, order: '' })
  } else if (Array.isArray(order)) {
    for (const entry of order) {
      collectOrder(builder, entry, schema, bound, keys, bindings)
    }
  } else if ('field' in order && typeof order.field === 'string') {
    keys.push({ expression: `${THIS_NODE}.${order.field}`, order: order.order ?? '' })
  } else {
    for (const [key, field] of Object.entries(order as Record<string, string>)) {
      const property = schema.hasProperty(key) ? schema.getProperty(key) : undefined

      if (property === undefined || !isRelatedProjection(property)) {
        keys.push({ expression: `${THIS_NODE}.${key}`, order: field })

        continue
      }

      if (property.getType() === PropertyType.RELATED_MANY) {
        throw new NeodeError(
          `Cannot sort by a nested property of '${key}': @RelatedMany has no single related node to order by`,
        )
      }

      const alias = bound.get(key)

      if (alias !== undefined) {
        keys.push({ expression: `${alias}.${field}`, order: '', alias })

        continue
      }

      const sortAlias = filterAlias(key)

      bindings.push(collectedSort(builder, property, sortAlias, field))

      keys.push({ expression: `${sortAlias}[0]`, order: '' })
    }
  }
}

/**
Ordering with nested sort support (NTS-145): a map key naming a
@RelatedOne orders by the related node's property — `{ course: 'slug' }`
collects the traversal into a WITH-carried `COLLECT { … }` subquery and
the composite ORDER BY sorts on `<alias>[0]` (NTS-565 — no OPTIONAL MATCH
in library-emitted reads). A nested sort reuses the alias a nested filter
on the same key already bound. Every other form behaves exactly like the
plain applyOrder.
*/
function applyOrder(
  builder: Builder,
  order: OrderSpec | undefined,
  schema: EntitySchema,
  bound: Map<string, string>,
): void {
  const keys: SortKey[] = []
  const bindings: string[] = []

  collectOrder(builder, order, schema, bound, keys, bindings)

  if (keys.length === 0) {
    return
  }

  const descriptors = keys.map((key) => ({ field: key.expression, order: key.order }))

  if (bindings.length === 0) {
    builder.orderBy(descriptors)

    return
  }

  // The WITH re-projects scope: carry every traversal alias a key reads
  // (nested filters bind theirs on the main statement) alongside the
  // collected sort keys
  const aliases = new Set<string>()

  for (const key of keys) {
    if (key.alias !== undefined) {
      aliases.add(key.alias)
    }
  }

  builder.with(THIS_NODE, ...aliases, ...bindings)
  builder.withOrder(descriptors)
}

/**
Read service for models with projected properties (NTS-135/136/137/138):
the same match / where surface as the plain query services, but the
RETURN map projection carries every projected value — related subsets,
counts, exists, label predicates, expressions — in one query per read.

NTS-145: object values on @RelatedOne / @RelatedMany filter keys traverse
to the related node and filter on its properties (`{ course: { slug: 'x' } }`);
a nested sort key (`{ course: 'slug' }`) ORDER BYs a COLLECT { } subquery
over the traversal (NTS-565 — no OPTIONAL MATCH in library-emitted reads).
*/
export class ProjectionService {
  private readonly runner: Runner

  constructor(runner: Runner) {
    this.runner = runner
  }

  private async run<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    builder: Builder,
    limit?: number,
    skip?: number,
    withSpec?: object,
  ): Promise<T[]> {
    // Decorated load specs (NTS-560) emit their CALL subqueries before
    // the RETURN, whose projection map reads the collected aliases
    loadSpecCalls(builder, THIS_NODE, schema, withSpec)

    builder.return(`${projectionNode(THIS_NODE, schema, withSpec)} AS ${THIS_NODE}`)

    if (skip !== undefined && skip !== 0) {
      builder.skip(skip)
    }
    if (limit !== undefined && limit !== 0) {
      builder.limit(limit)
    }

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    return result.records.map((row) => {
      const projection = row.get(THIS_NODE)

      if (!isRecord(projection)) {
        throw new TypeError(`The "${THIS_NODE}" column did not return a projection map`)
      }

      return hydrateProjection<T>(schema, constructor, projection)
    })
  }

  /**
  All nodes matching the given property map (GetService parity)
  */
  async get<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    parameters: Record<string, unknown> = {},
    limit?: number,
    skip?: number,
    order?: OrderSpec,
    withSpec?: object,
  ): Promise<T[]> {
    const builder = new Builder()

    builder.match(THIS_NODE, schema.getLabels())

    applySoftDeleteFilter(builder, schema)

    const bound = applyFilters(builder, schema, parameters)

    applyOrder(builder, order, schema, bound)

    return this.run<T>(constructor, schema, builder, limit, skip, withSpec)
  }

  /**
  One node by primary key value (FindService parity)
  */
  async find<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    value: unknown,
    withSpec?: object,
  ): Promise<T | undefined> {
    const builder = new Builder()

    const primaryKey = schema.getPrimaryKey()

    if (primaryKey === undefined) {
      throw new NeodeError(`Cannot find ${schema.getLabels().join(':')}: no primary key declared`)
    }

    builder.match(THIS_NODE, schema.getLabels(), { [primaryKey.getKey()]: value })

    applySoftDeleteFilter(builder, schema)

    const results = await this.run<T>(constructor, schema, builder, 1, undefined, withSpec)

    return results[0]
  }

  /**
  One node by element ID (FindByIdService parity)
  */
  async findById<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    elementId: string,
  ): Promise<T | undefined> {
    const builder = new Builder()

    builder.match(THIS_NODE).whereId(THIS_NODE, elementId)

    applySoftDeleteFilter(builder, schema)

    const results = await this.run<T>(constructor, schema, builder, 1)

    return results[0]
  }
}
