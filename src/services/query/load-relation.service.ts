import { THIS_NODE } from '../../constants.js'
import { elementIdOfEntity } from '../../element-id.js'
import { NeodeError } from '../../errors/index.js'
import { type EntitySchema, EntityType } from '../../meta/entity/entity-schema.js'
import { getModel } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { Builder } from '../../query/index.js'
import { eagerNode, eagerNodeVariable } from '../../query/eager-utilities.js'
import { applyOrder, type OrderSpec } from '../../query/order-spec.js'
import { relationProperty } from '../../projection/projection.js'
import { hydrateNode } from '../../utilities.js'
import { isNodeLike, isRecord } from '../type-guards.js'
import { QueryService } from './query.service.js'
import { applyReadFilters, type ReadFilterOptions } from './filters.js'
import type { Runner } from '../../driver/types.js'

/**
Traversal options for a lazy relation load (`instance.load(key, options)`,
NTS-558): pushed into the traversal's ORDER BY / SKIP / LIMIT — the sorted
and truncated related reads that otherwise drop callers to a raw Builder
(e.g. newest-20 history).
*/
export interface LoadOptions {
  order?: OrderSpec
  skip?: number
  limit?: number
  /**
  Named read filters to disable for this load (NTS-162)
  */
  withoutFilters?: string[]
}

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
  | { kind: 'order'; order: OrderSpec }
  | { kind: 'skip'; skip: number }
  | { kind: 'limit'; limit: number }

/**
The state of one traversal read: the builder with the match and the
target filters applied, the related node's variable, and the hydrated
target's schema and constructor
*/
interface RelatedReadState {
  builder: Builder
  nodeVariable: string
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

  return { builder, nodeVariable, targetSchema, target: targetEntity }
}

/**
Run a traversal statement and hydrate the related entities through the
regular hydration path (shared by load() and the related() scope)
*/
async function runTraversal(runner: Runner, read: RelatedReadState): Promise<unknown[]> {
  const { query, params } = read.builder.build()

  const output = await runner.run(query, params)

  return output.records.map((record) => {
    const node: unknown = record.get('node')

    if (!isNodeLike(node)) {
      throw new TypeError(`The "node" column did not return a node value`)
    }

    return hydrateNode<Record<string, unknown>>(read.targetSchema, read.target, node)
  })
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
  async load(
    schema: EntitySchema,
    entity: object,
    relationship: RelationshipPropertySchema,
    options?: LoadOptions,
  ): Promise<unknown> {
    const filters: ReadFilterOptions | undefined =
      options?.withoutFilters === undefined ? undefined : { withoutFilters: options.withoutFilters }

    const read = relatedRead(schema, entity, relationship, filters)

    if (options?.order !== undefined && options.order !== '') {
      applyOrder(read.builder, options.order, read.nodeVariable)
    }

    if (options?.skip !== undefined) {
      read.builder.skip(options.skip)
    }

    if (options?.limit !== undefined) {
      read.builder.limit(options.limit)
    }

    read.builder.return(
      `${eagerNode(1, read.nodeVariable, read.targetSchema, { builder: read.builder, filters })} AS node`,
    )

    const hydrated = await runTraversal(this.runner, read)

    // getMany() decides the empty shape, as at hydration: [] for many,
    // undefined for one — both materialize as own properties, so the
    // strict-access guard (or lenient undefined) answers for them
    const loaded: unknown = relationship.getMany() ? hydrated : hydrated[0]

    Object.assign(entity, { [relationship.getKey()]: loaded })

    return loaded
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

  constructor(
    run: <Result>(work: (runner: Runner) => Promise<Result>) => Promise<Result>,
    schema: EntitySchema,
    entity: object,
    relationship: RelationshipPropertySchema,
  ) {
    this.run = run
    this.schema = schema
    this.entity = entity
    this.relationship = relationship
  }

  /**
  A fresh traversal builder with the recorded verbs replayed onto it:
  rows for the hydrating terminals (eager map projection RETURN), a
  count for count() — the row-shaping verbs do not affect a count.
  */
  private statement(isCount: boolean): RelatedReadState {
    const read = relatedRead(this.schema, this.entity, this.relationship)

    for (const operation of this.operations) {
      if (isCount && operation.kind !== 'where') {
        continue
      }

      applyOperation(read, operation)
    }

    read.builder.return(
      isCount
        ? `count(${read.nodeVariable}) AS count`
        : `${eagerNode(1, read.nodeVariable, read.targetSchema, { builder: read.builder })} AS node`,
    )

    return read
  }

  private async rows(): Promise<unknown[]> {
    return this.run(async (runner) => runTraversal(runner, this.statement(false)))
  }

  async find(): Promise<unknown> {
    const hydrated = await this.rows()

    return this.relationship.getMany() ? hydrated : hydrated[0]
  }

  async first(): Promise<unknown> {
    const hydrated = await this.rows()

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
