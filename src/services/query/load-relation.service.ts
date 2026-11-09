import { THIS_NODE } from '../../constants.js'
import { elementIdOfEntity } from '../../element-id.js'
import { NeodeError } from '../../errors/index.js'
import { type EntitySchema, EntityType } from '../../meta/entity/entity-schema.js'
import { getModel } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import type { Runner } from '../../driver/types.js'
import { Builder } from '../../query/index.js'
import {
  eagerNode,
  eagerNodeVariable,
  parseLoadLevel,
  parseTargetSchema,
  type ParsedLoadLevel,
} from '../../query/eager-utilities.js'
import type { LoadOptions } from '../../query/load-spec.js'
import { applyOrder, type OrderSpec } from '../../query/order-spec.js'
import { relationProperty } from '../../projection/projection.js'
import { isRecord } from '../type-guards.js'
import { QueryService } from './query.service.js'
import { type RelationshipEdgeRead, shapeEdgeRows, shapeNodeRows } from './shape.js'
import { applyReadFilters, type ReadFilterOptions } from './filters.js'

/**
The find() result of an edge-returning read, mirroring the cardinality of
the plain FindResult: `RelationshipEdgeRead<T>[]` for a many-key,
`RelationshipEdgeRead<T> | undefined` for a one-key. Tuple-wrapped so a
union FindResult (`T | undefined`) never distributes. The row shape itself
(RelationshipEdgeRead) lives in the one result-shaping module (NTS-566).
*/
export type EdgeFindResult<FindResult, T> = [FindResult] extends [(infer Item)[]]
  ? RelationshipEdgeRead<Item>[]
  : RelationshipEdgeRead<T> | undefined

export type { RelationshipEdgeRead } from './shape.js'

/**
The related() scope surface (NTS-497): Builder-style verbs composed on
top of one declared relationship traversal, with the terminals running
the composed statement. Property names are bare ("year") — the scope
prefixes them with the related node's variable, exactly as RelationQuery
does at load-spec replay (NTS-560). Every verb returns the scope for
chaining.

`T` is the related entity type; `FindResult` is what find() resolves to —
`T[]` for a many-key, `T | undefined` for a one-key (the declared
relationship property's own type).
*/
export interface RelatedScope<T, FindResult = T[]> {
  where(...arguments_: unknown[]): RelatedScope<T, FindResult>
  /**
  Filter on the RELATIONSHIP's own properties (NTS-499): the same
  argument forms as where(), with bare names resolving against the
  edge's variable — `whereRelationship({ role: 'Neo' })`. Composes with
  where() (target predicates) and the global filters.
  */
  whereRelationship(...arguments_: unknown[]): RelatedScope<T, FindResult>
  /**
  Return the traversed edge alongside each target (NTS-499): the
  terminals resolve to `{ node, edge }` rows instead of bare entities —
  `edge` carries the relationship's own properties. one-key cardinality
  preserved (`{ node, edge } | undefined`).
  */
  withRelationship(): RelatedScope<RelationshipEdgeRead<T>, EdgeFindResult<FindResult, T>>
  orderBy(order: OrderSpec): RelatedScope<T, FindResult>
  limit(limit: number): RelatedScope<T, FindResult>
  skip(skip: number): RelatedScope<T, FindResult>
  find(): Promise<FindResult>
  first(): Promise<T | undefined>
  count(): Promise<number>
}

/**
One recorded verb of a related() scope. Verbs are recorded, not applied —
each terminal replays them onto a fresh traversal builder, so a second
terminal on the same scope reads the same verbs (and never double-applies
them to a consumed builder).
*/
type RelatedOperation =
  | { kind: 'where'; arguments_: unknown[] }
  | { kind: 'whereRelationship'; arguments_: unknown[] }
  | { kind: 'order'; order: OrderSpec }
  | { kind: 'skip'; skip: number }
  | { kind: 'limit'; limit: number }
  | { kind: 'withRelationship' }

/**
The state of one traversal read: the builder with the match and the
target filters applied, the related node's variable, the traversed
relationship's variable, whether the edge returns alongside the node,
and the hydrated target's schema and constructor
*/
interface RelatedReadState {
  builder: Builder
  nodeVariable: string
  relationshipVariable: string
  withEdge: boolean
  targetSchema: EntitySchema
  target: Newable
}

/**
The shared traversal read behind load() (NTS-558) and related() (NTS-497):
validate the relationship and its target, then open the MATCH through the
relationship to the related node with the target model's named read
filters (NTS-162) applied — a filtered-out target simply doesn't match.
The caller layers its own verbs and RETURN on top.
*/
function relatedRead(
  schema: EntitySchema,
  entity: object,
  relationship: RelationshipPropertySchema,
  filters?: ReadFilterOptions,
): RelatedReadState {
  const key = relationship.getKey()

  const elementId = elementIdOfEntity(schema, entity)

  if (elementId === undefined) {
    throw new NeodeError(
      `${schema.getLabels()[0] ?? 'entity'} has no elementId — load()/related() read the graph for persisted entities; save() the instance first`,
    )
  }

  const targetEntity = relationship.getTarget()
  // getModel declares non-nullable but returns undefined for
  // unregistered models — cast to the checked edge (as eagerPattern does)
  const targetSchema = getModel(targetEntity) as EntitySchema | undefined

  if (targetSchema === undefined) {
    throw new NeodeError(
      `${schema.getLabels()[0] ?? 'entity'}.${key} targets an unregistered model — cannot load '${key}'`,
    )
  }

  if (targetSchema.getType() === EntityType.RelationshipEntity) {
    throw new NeodeError(
      `${schema.getLabels()[0] ?? 'entity'}.${key} targets a relationship entity — load() does not hydrate those yet; ` +
        `request it in the load spec instead: find(schema labels, id, { with: { ${key}: true } })`,
    )
  }

  // MATCH (this)-[this_<key>_rel:T]->(this_<key>_node:Target) WHERE
  // elementId(this) = $elementId
  const relationshipVariable = `${THIS_NODE}_${key}_rel`
  const nodeVariable = eagerNodeVariable(THIS_NODE, key)

  const builder = new Builder()

  builder
    .match(THIS_NODE)
    .relationship(relationship.getType(), relationship.getDirection(), relationshipVariable)
    .to(nodeVariable, targetSchema.getLabels())
    .whereId(THIS_NODE, elementId)

  // NTS-162 — the target model's named filters filter the traversed rows
  applyReadFilters(builder, targetSchema, filters, nodeVariable)

  return {
    builder,
    nodeVariable,
    relationshipVariable,
    withEdge: false,
    targetSchema,
    target: targetEntity,
  }
}

/**
Run a traversal statement and shape the related entities through the one
result-shaping layer (shared by load() and the related() scope; NTS-566)
*/
async function runTraversal(runner: Runner, read: RelatedReadState): Promise<unknown[]> {
  const { query, params } = read.builder.build()

  const output = await runner.run(query, params)

  // Edge-returning read (NTS-499): the row is { node, edge } — the
  // traversed relationship in its normalized GraphRelationship shape
  return read.withEdge
    ? shapeEdgeRows<Record<string, unknown>>(
        output.records,
        read.targetSchema,
        read.target,
        'node',
        'edge',
      )
    : shapeNodeRows<Record<string, unknown>>(output.records, read.targetSchema, read.target, 'node')
}

/**
Prefix the bare properties of a where() argument list with the related
node's variable — the same bare-name convention RelationQuery replays at
load-spec time (NTS-560). Object-map keys and string first arguments are
prefixed; raw Cypher fragments (dotted names, predicates) pass through
untouched.
*/
function prefixWhere(nodeVariable: string, arguments_: unknown[]): unknown[] {
  const [first, ...rest] = arguments_

  if (typeof first === 'string') {
    return [relationProperty(nodeVariable, first), ...rest]
  }

  if (isRecord(first)) {
    return [
      Object.fromEntries(
        Object.entries(first).map(([property, value]) => [
          relationProperty(nodeVariable, property),
          value,
        ]),
      ),
      ...rest,
    ]
  }

  return arguments_
}

/**
Lazy relation load (NTS-558): traverse ONE declared relationship off a
hydrated entity — the loader the RelationNotLoadedError message promises —
and materialize the result as an own property on the instance, so the
strict-relation-access guard (NTS-155) stops firing for the key.

The related entities hydrate through the regular hydration path: each
traversed node returns as its eager map projection (eagerNode), so nested
eager relationships and property transforms apply exactly as they do for
the `with` load spec. shortcut: relationship-entity targets are not
hydrated here yet (their start/end stashes need the eager projection
shape) — request them via the load spec instead.
*/
export class LoadRelationService extends QueryService {
  /**
  The one traversal read shared by load() and loadSpec(): MATCH through the
  relationship, trim with the level's order/skip/limit, RETURN the target's
  eager projection with the level's nested spec rendered inside, hydrate,
  and materialize the result as an own property on the instance.
  */
  private async traverse(
    schema: EntitySchema,
    entity: object,
    relationship: RelationshipPropertySchema,
    level: ParsedLoadLevel,
  ): Promise<unknown> {
    const filters: ReadFilterOptions | undefined =
      level.withoutFilters === undefined || level.withoutFilters.length === 0
        ? undefined
        : { withoutFilters: level.withoutFilters }

    const read = relatedRead(schema, entity, relationship, filters)

    if (level.order !== undefined && level.order !== '') {
      applyOrder(read.builder, level.order, read.nodeVariable)
    }

    if (level.skip !== undefined) {
      read.builder.skip(level.skip)
    }

    if (level.limit !== undefined) {
      read.builder.limit(level.limit)
    }

    // One-key: the loader takes hydrated[0] — order by the target's
    // primary key when the level gives none, so the row picked is
    // deterministic, and read one row when the level trims none
    if (!relationship.getMany()) {
      if (level.order === undefined || level.order === '') {
        applyOrder(read.builder, read.targetSchema.getPrimaryKey()?.getKey(), read.nodeVariable)
      }

      if (level.limit === undefined) {
        read.builder.limit(1)
      }
    }

    read.builder.return(
      `${eagerNode(1, read.nodeVariable, read.targetSchema, { builder: read.builder, filters }, level)} AS node`,
    )

    const hydrated = await runTraversal(this.runner, read)

    // getMany() decides the empty shape, as at hydration: [] for many,
    // undefined for one — both materialize as own properties, so the
    // strict-access guard (or lenient undefined) answers for them
    const loaded: unknown = relationship.getMany() ? hydrated : hydrated[0]

    Object.assign(entity, { [relationship.getKey()]: loaded })

    return loaded
  }

  /**
  Lazy relation load (NTS-558): traverse ONE declared relationship off a
  hydrated entity — the loader the RelationNotLoadedError message
  promises — and materialize the result as an own property on the
  instance, so the strict-relation-access guard (NTS-155) stops firing
  for the key.

  The related entities hydrate through the regular hydration path: each
  traversed node returns as its eager map projection (eagerNode), so nested
  eager relationships and property transforms apply exactly as they do for
  the `with` load spec. shortcut: relationship-entity targets are not
  hydrated here yet (their start/end stashes need the eager projection
  shape) — request them via the load spec instead.
  */
  async load(
    schema: EntitySchema,
    entity: object,
    relationship: RelationshipPropertySchema,
    options?: LoadOptions,
  ): Promise<unknown> {
    return this.traverse(schema, entity, relationship, {
      order: options?.order,
      skip: options?.skip,
      limit: options?.limit,
      withoutFilters: options?.withoutFilters,
      nested: new Map(),
    })
  }

  /**
  Multi-key, multi-level per-instance load (NTS-498): hydrate every key of
  the spec object onto the instance, each value `true`, a LoadOptions-ish
  level, or a nested spec one level down the declared relationship graph.

  One traversal statement per ROOT key (the roots are unrelated patterns —
  one shared statement would multiply rows); nested levels render INSIDE
  that statement's projection (pattern comprehension, or a COLLECT {
  MATCH … RETURN … ORDER BY … } subquery when the level trims), so no
  level ever N+1s per entity. The whole spec parses and validates before
  the first read.
  */
  async loadSpec(schema: EntitySchema, entity: object, spec: object): Promise<void> {
    if (!isRecord(spec)) {
      throw new NeodeError('load() takes a relationship key, or a spec object of relationship keys')
    }

    const parsed: { relationship: RelationshipPropertySchema; level: ParsedLoadLevel }[] = []

    for (const key of Object.keys(spec)) {
      const relationship = schema.getRelationship(key)

      // The value's option keys trim the traversal INTO the target, its
      // relationship keys name relationships on the target — parse it
      // against the target's schema
      parsed.push({
        relationship,
        level: parseLoadLevel(parseTargetSchema(schema, relationship), Reflect.get(spec, key)),
      })
    }

    for (const { relationship, level } of parsed) {
      await this.traverse(schema, entity, relationship, level)
    }
  }
}

/**
Replay one recorded verb onto a traversal builder — the bare-name
prefixing for where, the alias prefix for order, the page trims
*/
function applyOperation(read: RelatedReadState, operation: RelatedOperation): void {
  switch (operation.kind) {
    case 'where': {
      read.builder.where(...prefixWhere(read.nodeVariable, operation.arguments_))

      break
    }
    case 'whereRelationship': {
      // NTS-499 — bare names resolve against the EDGE's variable, so the
      // predicate lands on the traversed relationship, not the target node
      read.builder.where(...prefixWhere(read.relationshipVariable, operation.arguments_))

      break
    }
    case 'order': {
      applyOrder(read.builder, operation.order, read.nodeVariable)

      break
    }
    case 'skip': {
      read.builder.skip(operation.skip)

      break
    }
    case 'limit': {
      read.builder.limit(operation.limit)

      break
    }
    case 'withRelationship': {
      read.withEdge = true

      break
    }
  }
}

/**
The scope instance.related(key) returns (NTS-497): the queryable
generalisation of load() — Builder-style verbs (where / orderBy / limit /
skip) composed ON TOP of the relationship traversal, with the terminal
find() / first() / count() running it and hydrating the related entities
through the regular hydration path (projection-aware: nested eager
relationships ride the eager map projection, as at load()). The related
target's own global filters (NTS-162) apply inside the traversal read — a
filtered-out target yields an empty result, never an error, and the
parent row is never affected (plain MATCH — no OPTIONAL MATCH, NTS-565).

NTS-499 extends the scope with relationship-aware reads: whereRelationship()
filters on the EDGE's own properties (the predicate joins the traversal's
WHERE, composed with the target predicates of where()), and
withRelationship() returns each row as `{ node, edge }` — the hydrated
target alongside the traversed GraphRelationship. Both ride the same flat
MATCH: no new clause shapes, no OPTIONAL MATCH.

The typed view of the scope is the RelatedScope interface, projected
through EntityMethods.related — the class is the runtime engine, its
terminals answering `unknown` exactly as MethodImpl.load does.

Each terminal runs its own READ scope: verbs are recorded at chain time
and replayed onto a fresh traversal per terminal. count() counts the
matching related nodes — the row-shaping verbs (order / skip / limit) do
not affect it, as with a total alongside a paged read.
*/
export class RelatedQuery {
  private readonly operations: RelatedOperation[] = []

  private readonly run: <Result>(work: (runner: Runner) => Promise<Result>) => Promise<Result>

  private readonly schema: EntitySchema

  private readonly entity: object

  private readonly relationship: RelationshipPropertySchema

  private readonly filters: ReadFilterOptions | undefined

  constructor(
    run: <Result>(work: (runner: Runner) => Promise<Result>) => Promise<Result>,
    schema: EntitySchema,
    entity: object,
    relationship: RelationshipPropertySchema,
    filters?: ReadFilterOptions,
  ) {
    this.run = run
    this.schema = schema
    this.entity = entity
    this.relationship = relationship
    this.filters = filters
  }

  /**
  A fresh traversal builder with the recorded verbs replayed onto it:
  rows for the hydrating terminals (eager map projection RETURN), a
  count for count() — the row-shaping verbs do not affect a count.

  `isFirstOnly` pushes LIMIT 1 into the Cypher for the terminals that take
  the first row (first(), and find() on a one-key) — only when the caller
  recorded no limit of its own, which must stand.
  */
  private statement(isCount: boolean, isFirstOnly = false): RelatedReadState {
    const read = relatedRead(this.schema, this.entity, this.relationship, this.filters)

    for (const operation of this.operations) {
      // Filters apply to a count; the row-shaping verbs do not, and the
      // edge-returning flag only changes the RETURN shape (NTS-499)
      const isFilterOperation = operation.kind === 'where' || operation.kind === 'whereRelationship'

      if (isCount && !isFilterOperation) {
        continue
      }

      applyOperation(read, operation)
    }

    if (
      isFirstOnly &&
      !isCount &&
      this.operations.every((operation) => operation.kind !== 'limit')
    ) {
      read.builder.limit(1)
    }

    const projection = `${eagerNode(1, read.nodeVariable, read.targetSchema, { builder: read.builder, filters: this.filters })} AS node`

    if (isCount) {
      read.builder.return(`count(${read.nodeVariable}) AS count`)
    } else if (read.withEdge) {
      // NTS-499 — the edge-returning read appends the traversed relationship
      read.builder.return(`${projection}, ${read.relationshipVariable} AS edge`)
    } else {
      read.builder.return(projection)
    }

    return read
  }

  private async rows(isFirstOnly = false): Promise<unknown[]> {
    return this.run(async (runner) => runTraversal(runner, this.statement(false, isFirstOnly)))
  }

  async find(): Promise<unknown> {
    const hydrated = await this.rows(!this.relationship.getMany())

    return this.relationship.getMany() ? hydrated : hydrated[0]
  }

  async first(): Promise<unknown> {
    const hydrated = await this.rows(true)

    return hydrated[0]
  }

  async count(): Promise<number> {
    const read = this.statement(true)

    const { query, params } = read.builder.build()

    const output = await this.run(async (runner) => runner.run(query, params))

    const value: unknown = output.records[0]?.get('count')

    return typeof value === 'number' ? value : 0
  }

  where(...arguments_: unknown[]): this {
    this.operations.push({ kind: 'where', arguments_ })

    return this
  }

  /**
  Filter on the relationship's own properties (NTS-499): the same
  argument forms as where(), with bare property names resolving against
  the traversed edge's variable. Composes with where() — target
  predicates and edge predicates AND together inside the traversal's
  WHERE (never OPTIONAL MATCH, NTS-565).
  */
  whereRelationship(...arguments_: unknown[]): this {
    this.operations.push({ kind: 'whereRelationship', arguments_ })

    return this
  }

  /**
  Return the traversed edge alongside each target (NTS-499): find() /
  first() resolve to `{ node, edge }` — `edge` the normalized
  GraphRelationship (type, elementId, endpoints, properties). count()
  is unaffected.
  */
  withRelationship(): this {
    this.operations.push({ kind: 'withRelationship' })

    return this
  }

  orderBy(order: OrderSpec): this {
    this.operations.push({ kind: 'order', order })

    return this
  }

  limit(limit: number): this {
    this.operations.push({ kind: 'limit', limit })

    return this
  }

  skip(skip: number): this {
    this.operations.push({ kind: 'skip', skip })

    return this
  }
}
