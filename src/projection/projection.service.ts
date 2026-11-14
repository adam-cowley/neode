import { Builder, Direction } from '../query/index.js'
import { THIS_NODE } from '../constants.js'
import type { Runner } from '../driver/types.js'
import { EntitySchema } from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { PropertyType } from '../meta/property-schema.js'
import type { OrderSpec } from '../services/query/get.service.js'
import { NeodeError } from '../errors/index.js'
import { assertDirection, propertyReference } from '../query/quote.js'
import { loadSpecCalls, projectionNode } from './projection.js'
import { shapeProjectionRows } from '../services/query/shape.js'
import { requireLimit } from '../services/query/limits.js'
import { applyReadFilters, type ReadFilterOptions } from '../services/query/filters.js'
import { applyFilterOperators, isFilterMap } from '../services/query/filter-bag.js'

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
Cypher variable bound to the related node of a nested filter / sort
*/
function filterAlias(key: string): string {
  return `${THIS_NODE}_${key}_filter`
}

/**
Bind the single-hop traversal for a nested filter / sort on a related
property: `(this)-[:TYPE]->(alias:TargetLabels)`, with the target model's
named read filters (NTS-162, NTS-574) applied — a soft-deleted or
out-of-tenant related node neither satisfies a filter nor supplies a sort
key. Only ever called on a sub-builder (EXISTS / COLLECT subquery).
*/
function bindTraversal(
  builder: Builder,
  property: PropertySchema,
  alias: string,
  filters?: ReadFilterOptions,
): void {
  const types = (property.getRelationshipType() ?? property.getKey())
    .split('|')
    .filter((part) => part.length > 0)

  const direction = property.getDirection() ?? Direction.OUTGOING

  const targetEntity = property.getEntity()

  const targetSchema = typeof targetEntity === 'function' ? getModel(targetEntity) : undefined

  const labels = targetSchema instanceof EntitySchema ? targetSchema.getLabels() : false

  builder.match(THIS_NODE)

  builder.relationship(types, direction, `${alias}_rel`).to(alias, labels)

  if (targetSchema instanceof EntitySchema) {
    applyReadFilters(builder, targetSchema, filters, alias)
  }
}

/**
The property map: own properties filter as property equality (GetService
parity, unknown keys ignored) or through the operator tier (NTS-646);
object values on @RelatedOne / @RelatedMany keys filter on the related
node's properties via a bound traversal — flat equality or operator
objects — and an object value on any other property kind is an operator
object too. A nested filter renders as `WHERE EXISTS { … }` over the
traversal (NTS-574): the target's read filters apply inside it and a
@RelatedMany with several matching related nodes never duplicates the
root row.
*/
function applyFilters(
  builder: Builder,
  schema: EntitySchema,
  parameters: Record<string, unknown>,
  filters?: ReadFilterOptions,
): void {
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
      // A plain property's operator object — the NTS-646 tier
      applyFilterOperators(builder, THIS_NODE, key, value)

      continue
    }

    const alias = filterAlias(key)

    builder.whereExistsSubquery(
      (sub) => {
        bindTraversal(sub, property, alias, filters)

        for (const [field, fieldValue] of Object.entries(value)) {
          if (isFilterMap(fieldValue)) {
            applyFilterOperators(sub, alias, field, fieldValue)
          } else {
            sub.where(propertyReference(alias, field), fieldValue)
          }
        }

        return sub
      },
      [THIS_NODE],
    )
  }
}

/**
One deferred sort key: the ORDER BY expression with its direction (when
the caller gave one)
*/
interface SortKey {
  expression: string
  order: string
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
  filters?: ReadFilterOptions,
): string {
  return `${builder.collectExpr(
    (sub) => {
      bindTraversal(sub, property, sortAlias, filters)
      sub.return(propertyReference(sortAlias, field))
      sub.orderBy(propertyReference(sortAlias, field))

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
  keys: SortKey[],
  bindings: string[],
  filters?: ReadFilterOptions,
): void {
  if (order === undefined || order === '') {
    return
  }

  if (typeof order === 'string') {
    keys.push({ expression: propertyReference(THIS_NODE, order), order: '' })
  } else if (Array.isArray(order)) {
    for (const entry of order) {
      collectOrder(builder, entry, schema, keys, bindings, filters)
    }
  } else if ('field' in order && typeof order.field === 'string') {
    keys.push({
      expression: propertyReference(THIS_NODE, order.field),
      order: assertDirection(order.order ?? ''),
    })
  } else {
    for (const [key, field] of Object.entries(order as Record<string, string>)) {
      const property = schema.hasProperty(key) ? schema.getProperty(key) : undefined

      if (property === undefined || !isRelatedProjection(property)) {
        keys.push({ expression: propertyReference(THIS_NODE, key), order: assertDirection(field) })

        continue
      }

      if (property.getType() === PropertyType.RELATED_MANY) {
        throw new NeodeError(
          `Cannot sort by a nested property of '${key}': @RelatedMany has no single related node to order by`,
        )
      }

      const sortAlias = filterAlias(key)

      bindings.push(collectedSort(builder, property, sortAlias, field, filters))

      keys.push({ expression: `${sortAlias}[0]`, order: '' })
    }
  }
}

/**
Ordering with nested sort support (NTS-145): a map key naming a
@RelatedOne orders by the related node's property — `{ course: 'slug' }`
collects the traversal into a WITH-carried `COLLECT { … }` subquery and
the composite ORDER BY sorts on `<alias>[0]` (NTS-565 — no OPTIONAL MATCH
in library-emitted reads); the target's read filters apply inside the
subquery (NTS-574). Every other form behaves exactly like the
plain applyOrder.
*/
function applyOrder(
  builder: Builder,
  order: OrderSpec | undefined,
  schema: EntitySchema,
  filters?: ReadFilterOptions,
): void {
  const keys: SortKey[] = []
  const bindings: string[] = []

  collectOrder(builder, order, schema, keys, bindings, filters)

  if (keys.length === 0) {
    return
  }

  const descriptors = keys.map((key) => ({ field: key.expression, order: key.order }))

  if (bindings.length === 0) {
    builder.orderBy(descriptors)

    return
  }

  builder.with(THIS_NODE, ...bindings)
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
    filters?: ReadFilterOptions,
  ): Promise<T[]> {
    // Decorated load specs (NTS-560) emit their CALL subqueries before
    // the RETURN, whose projection map reads the collected aliases —
    // the related rows carry the target models' read filters (NTS-162)
    loadSpecCalls(builder, THIS_NODE, schema, withSpec, filters)

    builder.return(
      `${projectionNode(THIS_NODE, schema, withSpec, { builder, filters })} AS ${THIS_NODE}`,
    )

    if (skip !== undefined && skip !== 0) {
      builder.skip(skip)
    }
    if (limit !== undefined) {
      builder.limit(requireLimit(limit))
    }

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    return shapeProjectionRows<T>(result.records, schema, constructor, THIS_NODE)
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
    filters?: ReadFilterOptions,
  ): Promise<T[]> {
    const builder = new Builder()

    builder.match(THIS_NODE, schema.getLabels())

    applyReadFilters(builder, schema, filters)

    applyFilters(builder, schema, parameters, filters)

    applyOrder(builder, order, schema, filters)

    return this.run<T>(constructor, schema, builder, limit, skip, withSpec, filters)
  }

  /**
  One node by primary key value (FindService parity)
  */
  async find<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    value: unknown,
    withSpec?: object,
    filters?: ReadFilterOptions,
  ): Promise<T | undefined> {
    const builder = new Builder()

    const primaryKey = schema.getPrimaryKey()

    if (primaryKey === undefined) {
      throw new NeodeError(`Cannot find ${schema.getLabels().join(':')}: no primary key declared`)
    }

    builder.match(THIS_NODE, schema.getLabels(), { [primaryKey.getKey()]: value })

    applyReadFilters(builder, schema, filters)

    const results = await this.run<T>(constructor, schema, builder, 1, undefined, withSpec, filters)

    return results[0]
  }

  /**
  One node by element ID (FindByIdService parity)
  */
  async findById<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    elementId: string,
    filters?: ReadFilterOptions,
  ): Promise<T | undefined> {
    const builder = new Builder()

    builder.match(THIS_NODE).whereId(THIS_NODE, elementId)

    applyReadFilters(builder, schema, filters)

    const results = await this.run<T>(
      constructor,
      schema,
      builder,
      1,
      undefined,
      undefined,
      filters,
    )

    return results[0]
  }
}
