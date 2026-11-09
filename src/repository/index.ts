import { THIS_NODE } from '../constants.js'
import type { QueryOutput } from '../driver/types.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { Newable } from '../meta/newable.js'
import { PropertyType, type PropertySchema } from '../meta/property-schema.js'
import type { INeode } from '../neode.interface.js'
import { Builder, eagerNode } from '../query/index.js'
import type { ReadOptions, WithSpec } from '../query/load-spec.js'
import { quote } from '../query/quote.js'
import { applyOrder, type OrderSpec } from '../query/order-spec.js'
import { getMergeFields } from '../services/query/merge.service.js'
import type { DeleteOptions } from '../services/query/delete.service.js'
import type { ScoredEntity } from '../services/query/search.service.js'
import { fulltextIndexName } from '../services/schema/fulltext.service.js'
import { isGraphNode, isRecord } from '../services/type-guards.js'
import { hydrateNode } from '../utilities.js'
import { hasProjectedProperties } from '../projection/index.js'
import { projectionNode } from '../projection/projection.js'
import { applyReadFilters, WITHOUT_ALL_FILTERS, type ReadFilterOptions } from '../services/query/filters.js'

/**
Ordering, paging and row-limit options shared by findAll() and where()
*/
/**
Ordering, paging, row-limit and load-spec options shared by findAll()
and where(). Generic over the entity so the `with` load spec (NTS-560)
type-checks its relationship keys.
*/
export interface FindOptions<Entity = object> {
  order?: OrderSpec
  limit?: number
  skip?: number
  /**
  Read soft-deleted entities too (NTS-510). Standard reads exclude the
  @SoftDelete label; this opts back in.
  */
  includeDeleted?: boolean
  /**
  Named read filters to disable for this query (NTS-162) — each name is
  independent; `softDelete` names the built-in @SoftDelete filter.
  */
  withoutFilters?: string[]
  /**
  Per-relation eager load spec (NTS-560): request non-eager relationships
  and decorate their read — `with: { orders: (relation) => relation.limit(2) }`.
  With a spec the read goes through the projection path, so the standard
  read filters apply — includeDeleted is not honoured with `with`.
  */
  with?: WithSpec<Entity>
}

/**
Options for Repository#search(): `fields` selects which declared fulltext
properties form the index (default: all of them)
*/
export interface SearchOptions<Entity> {
  fields?: (keyof Entity & string)[]
  limit?: number
}

/**
The declared property types increment() may bump. ANY (no declared type)
is allowed too — the schema does not always carry a type.
*/
const NUMERIC_PROPERTY_TYPES = new Set<PropertyType>([
  PropertyType.INTEGER,
  PropertyType.FLOAT,
  PropertyType.NUMBER,
])

/**
Active-record style data-access repository for one registered model — the
TypeORM-parity surface, obtained via `neode.getRepository(Entity)` or the
@EntityRepository custom subclass.

Constructed with a registered entity class (@NodeEntity / defineModel);
unregistered entities throw. All reads return hydrated entity instances.

shortcut: saveAll() saves entities one at a time, each in its own write
transaction, so concurrent saves cannot conflict on single-transaction
connections — batch UNWIND writes are BulkService's job.
*/
export class Repository<Entity> {
  /**
  Neo4j driver returns count() as an Integer instance, Relate as a number
  */
  private static toCount(value: unknown): number {
    return hasToNumber(value) ? value.toNumber() : Number(value)
  }

  protected schema: EntitySchema

  protected readonly neode: INeode
  protected readonly entity: new (
    ...arguments_: never[]
  ) => Entity
  protected readonly database: string | undefined

  /**
  The entity is accepted in the registry's wire format (Newable — the
  metamodel keys constructors loosely) so that @EntityRepository
  subclasses keep a construct signature compatible with
  RepositoryConstructor; a registered model is always the entity's own
  constructor, so the correlation is re-established here (the same way
  resolveRepository re-establishes it on lookup).
  */
  constructor(neode: INeode, entity: Newable, database?: string) {
    const entityConstructor: unknown = entity
    const model = getModel(entityConstructor)

    if (model === undefined) {
      throw new Error(
        'Cannot create a Repository for an unregistered model — register it with @NodeEntity / defineModel first',
      )
    }

    this.neode = neode
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the registry erases the entity/repository generic correlation; the registered-model check above re-establishes it
    this.entity = entity as new (...arguments_: never[]) => Entity
    this.database = database
    this.schema = model
  }

  /**
  Match every node of the entity's labels, filtered on the schema's
  declared properties only (GetService parity: unknown keys are ignored).
  The named read filters apply (soft delete included) unless
  shouldBypassFilters is set — the bulk-write paths pass true: writes
  never read through filters (NTS-162).
  */
  private matchAll(
    parameters: Partial<Entity> = {},
    filters?: ReadFilterOptions,
    shouldBypassFilters = false,
  ): Builder {
    const record = parameters as Record<string, unknown>

    const builder = new Builder()

    builder.match(THIS_NODE, this.schema.getLabels())

    if (!shouldBypassFilters) {
      applyReadFilters(builder, this.schema, filters)
    }

    for (const property of this.schema.getProperties()) {
      const key = property.getKey()

      if (Object.hasOwn(record, key)) {
        builder.where(`${THIS_NODE}.${key}`, record[key])
      }
    }

    return builder
  }

  private returnNodes(builder: Builder, filters?: ReadFilterOptions): void {
    // Projected models read through the projection's RETURN map — the
    // includeDeleted bypass renders it directly (the neode.all delegate
    // always applies the read filters)
    if (hasProjectedProperties(this.schema)) {
      builder.return(projectionNode(THIS_NODE, this.schema, undefined, { builder, filters }))

      return
    }

    // Eager Loading: when the schema declares eager relationships the
    // root node is returned as a map projection (QueryService parity)
    const hasEagerRelationships = this.schema
      .getRelationships()
      .some((relationship) => relationship.getEager())

    builder.return(
      hasEagerRelationships
        ? `${eagerNode(1, THIS_NODE, this.schema, { builder, filters })} AS ${THIS_NODE}`
        : THIS_NODE,
    )
  }

  private async read(builder: Builder): Promise<QueryOutput> {
    const { query, params } = builder.build()

    return this.neode.readCypher(query, params, this.database)
  }

  protected getLabels(): string[] {
    return this.schema.getLabels()
  }

  /**
  The schema's primary key property. Throws when the model declares none
  (@Primary / @Uuid / @Property({ primary: true })).
  */
  getPrimaryKey(): PropertySchema {
    const primaryKey = this.schema.getPrimaryKey()

    if (primaryKey === undefined) {
      throw new Error(
        `Cannot resolve the primary key of ${this.getLabels().join(':')} — declare one (@Primary / @Uuid / @Property({ primary: true }))`,
      )
    }

    return primaryKey
  }

  /**
  Find one entity by its primary key value, or undefined when absent.
  Accepts string and number keys only — anything else throws TypeError.
  `options.withoutFilters` disables named read filters for this lookup
  (NTS-162).
  */
  async find(id: unknown, options?: ReadOptions<Entity>): Promise<Entity | undefined> {
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new TypeError(`Repository.find expects a string or number id, received ${typeof id}`)
    }

    return options === undefined
      ? this.neode.find(this.entity, id, this.database)
      : this.neode.find(this.entity, id, options)
  }
  /**
  The first entity matching the given properties (declared properties
  only), or undefined when nothing matches.
  */
  async findBy(properties: Partial<Entity> = {}): Promise<Entity | undefined> {
    const results = await this.findAll(properties, { limit: 1 })

    return results[0]
  }

  /**
  All entities matching the given properties (declared properties only —
  unknown keys are ignored), ordered/paged/limited by options.

  Models declaring read-model decorators (@RelatedOne/@RelationshipCount/…)
  read through the projection-aware path (NTS-501): the facade's all()
  returns every projected value hydrated, matching neode.all() semantics.
  Plain models keep the local Builder path.
  */
  async findAll(parameters: Partial<Entity> = {}, options: FindOptions = {}): Promise<Entity[]> {
    const hasIncludeDeleted = options.includeDeleted === true

    const filters: ReadFilterOptions = {}

    if (options.includeDeleted === true) {
      filters.includeDeleted = true
    }

    if (options.withoutFilters !== undefined) {
      filters.withoutFilters = options.withoutFilters
    }

    const withSpec = options.with

    if (!hasIncludeDeleted && (withSpec !== undefined || hasProjectedProperties(this.schema))) {
      const delegateOptions: { with?: WithSpec<Entity>; withoutFilters?: string[] } = {}

      if (withSpec !== undefined) {
        delegateOptions.with = withSpec
      }

      if (options.withoutFilters !== undefined) {
        delegateOptions.withoutFilters = options.withoutFilters
      }

      return this.neode.all<Entity>(
        this.entity,
        parameters,
        options.order,
        options.limit,
        options.skip,
        this.database,
        delegateOptions,
      )
    }

    const builder = this.matchAll(parameters, filters)

    if (options.order !== undefined) {
      applyOrder(builder, options.order)
    }

    this.returnNodes(builder, filters)

    if (options.skip !== undefined && options.skip !== 0) {
      builder.skip(options.skip)
    }

    if (options.limit !== undefined && options.limit !== 0) {
      builder.limit(options.limit)
    }

    const output = await this.read(builder)

    return output.records.map((row) => {
      const node = row.get(THIS_NODE)

      if (!isGraphNode(node)) {
        throw new TypeError(`The "${THIS_NODE}" column did not return a node value`)
      }

      return hydrateNode<Entity>(this.schema, this.entity, node)
    })
  }

  /**
  findAll() alias — every entity matching the given properties.
  */
  async where(parameters: Partial<Entity> = {}): Promise<Entity[]> {
    return this.findAll(parameters)
  }

  /**
  Count of entities matching the given properties (a Cypher count(), so
  no entities are hydrated). The named read filters apply.
  */
  async count(parameters: Partial<Entity> = {}): Promise<number> {
    const builder = this.matchAll(parameters)

    builder.return(`count(${THIS_NODE}) AS count`)

    const output = await this.read(builder)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new Error('count query returned no records')
    }

    return Repository.toCount(firstRecord.get('count'))
  }

  /**
  Persist an entity (save = MERGE on its primary key / elementId).
  */
  async save(object: Entity): Promise<Entity> {
    return this.neode.save(object, this.database)
  }

  /**
  Save entities one at a time: each save opens its own write transaction,
  so concurrent saves would conflict on single-transaction connections
  */
  async saveAll(objects: Entity[]): Promise<Entity[]> {
    const saved: Entity[] = []

    for (const object of objects) {
      saved.push(await this.save(object))
    }

    return saved
  }

  /**
  Apply a partial patch to a persisted entity, then persist it.

  Named `patch` (not `update`) so domain interfaces that declare their own
  `update(id, input)` can be implemented by subclasses without clashing
  with the base signature (NTS-454/458/459).
  */
  async patch(entity: Entity & object, properties: Partial<Entity>): Promise<Entity> {
    Object.assign(entity, properties)

    return this.save(entity)
  }

  /**
  Create-or-update in one statement (TypeORM upsert parity): MERGE on the
  model's merge fields (unique / indexed properties) and SET everything
  else, returning the hydrated entity. `properties` must carry at least
  one merge field to match on, and the model must declare one — an
  unguarded MERGE would silently create a new node per call.

  Validation, defaults, server-side timestamps and @Version bumps all
  apply, because the statement runs through the regular merge path.
  */
  async upsert(properties: Partial<Entity> & Record<string, unknown>): Promise<Entity | undefined> {
    const mergeFields = getMergeFields(this.schema)

    if (mergeFields.length === 0) {
      throw new Error(
        `Cannot upsert ${this.getLabels().join(':')} — the model declares no unique or indexed properties to match on. Declare one (@Unique / @Index / @Property({ unique: true })).`,
      )
    }

    const hasMatchKey = mergeFields.some((field) => properties[field.getKey()] !== undefined)

    if (!hasMatchKey) {
      const keys = mergeFields.map((field) => field.getKey()).join(', ')

      throw new Error(
        `Cannot upsert ${this.getLabels().join(':')} — properties must include at least one merge field to match on: [${keys}]`,
      )
    }

    return this.neode.merge(this.entity, properties, this.database)
  }

  /**
  Undo a soft delete (NTS-510): remove the @SoftDelete label and the
  deletedAt stamp, returning the re-hydrated entity. Throws when the
  model does not declare @SoftDelete. Accepts an entity or a primary key
  value.
  */
  async restore(target: Entity | string | number): Promise<Entity | undefined> {
    const soft = this.schema.getSoftDelete()

    if (soft === undefined) {
      throw new Error(
        `Cannot restore ${this.getLabels().join(':')} — the model does not declare @SoftDelete`,
      )
    }

    const primaryKey = this.getPrimaryKey().getKey()
    const id = isRecord(target) ? target[primaryKey] : target

    const builder = new Builder().match(THIS_NODE, this.schema.getLabels(), { [primaryKey]: id })

    builder.remove(`${THIS_NODE}:${quote(soft.label)}`, `${THIS_NODE}.deletedAt`)

    const { query, params } = builder.build()

    await this.neode.writeCypher(query, params, this.database)

    return this.find(id)
  }

  /**
  Delete by primary key value or by entity instance. Pass `{ ifExists: true }`
  to silently no-op when the entity does not exist (NTS-457) — the default
  throws so callers learn about missing IDs.
  */
  async delete(
    target: Entity | string | number,
    options: DeleteOptions & { ifExists?: boolean } = {},
  ): Promise<void> {
    // ifExists is repository-level (the ID lookup); the rest are the
    // delete service's options — cascade in/out, force, soft, depth
    const { ifExists, ...forwarded } = options

    if (isRecord(target)) {
      return this.neode.delete(target, forwarded, this.database)
    }

    // The lookup bypasses the read filters (WITHOUT_ALL_FILTERS): delete
    // is a write — rows hidden by the current filter view stay deletable
    const entity = await this.find(target, { withoutFilters: [WITHOUT_ALL_FILTERS] })

    if (entity === undefined) {
      if (ifExists === true) {
        return
      }

      throw new Error(`Cannot delete: entity not found for ID ${String(target)}`)
    }

    if (!isRecord(entity)) {
      throw new TypeError('Cannot delete: the found entity is not an object')
    }

    return this.neode.delete(entity, forwarded, this.database)
  }

  /**
  Count entities grouped by one declared property's value (NTS-453):
  `countBy('status')` → `{ ACTIVE: 3, CLOSED: 1 }`.
  */
  async countBy(
    property: keyof Entity & string,
    parameters: Partial<Entity> = {},
  ): Promise<Record<string, number>> {
    const declared = this.schema
      .getProperties()
      .find((schemaProperty) => schemaProperty.getKey() === property)

    if (declared === undefined) {
      throw new Error(
        `Cannot countBy: "${property}" is not a declared property on ${this.getLabels().join(':')}`,
      )
    }

    const key = declared.getKey().replaceAll('`', '``')
    const builder = this.matchAll(parameters)
    builder.return(`${THIS_NODE}.\`${key}\` AS value, count(${THIS_NODE}) AS count`)

    const output = await this.read(builder)

    const result: Record<string, number> = {}

    for (const row of output.records) {
      const value = row.get('value')
      result[String(value)] = Repository.toCount(row.get('count'))
    }

    return result
  }

  /**
  Delete every entity matching params and return the number deleted.

  shortcut: one DETACH DELETE statement rather than per-node deletes,
  so per-node delete events and cascade options do not apply — switch to
  a loop over delete() when cascading bulk deletes are needed. A bulk
  write: named read filters do not apply (NTS-162), every node carrying
  the model's labels is deleted.
  */
  async deleteAll(parameters: Partial<Entity> = {}): Promise<number> {
    const builder = this.matchAll(parameters, undefined, true)

    builder.detachDelete(THIS_NODE)
    builder.return(`count(${THIS_NODE}) AS count`)

    const { query, params: queryParameters } = builder.build()

    const output = await this.neode.writeCypher(query, queryParameters, this.database)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new Error('count query returned no records')
    }

    return Repository.toCount(firstRecord.get('count'))
  }

  /**
  Atomically bump a numeric property (NTS-435): one server-side statement
  `SET n.prop = coalesce(n.prop, 0) + $by` — safe under concurrency where
  read-modify-write via update() would lose updates. Returns the new value.

  The property must be a declared numeric property of the schema: its name
  is interpolated into the Cypher (property names cannot be parameters),
  so the declaration check is the injection guard.
  */
  async increment(
    target: Entity | string | number,
    property: keyof Entity & string,
    by = 1,
    options: { ifExists?: boolean } = {},
  ): Promise<number> {
    const declared = this.schema
      .getProperties()
      .find((schemaProperty) => schemaProperty.getKey() === property)

    if (declared === undefined) {
      throw new Error(
        `Cannot increment: "${property}" is not a declared property on ${this.getLabels().join(':')}`,
      )
    }

    const type = declared.getType()

    if (type !== PropertyType.ANY && !NUMERIC_PROPERTY_TYPES.has(type)) {
      throw new TypeError(
        `Cannot increment: "${property}" is not a numeric property on ${this.getLabels().join(':')}`,
      )
    }

    if (typeof by !== 'number' || !Number.isFinite(by)) {
      throw new TypeError('Cannot increment: step must be a finite number')
    }

    // The property name is schema-validated and quoted (names cannot be
    // parameters); the step is bound as a query parameter
    const key = quote(declared.getKey())
    const primaryKey = this.getPrimaryKey().getKey()
    const id = isRecord(target) ? target[primaryKey] : target

    const builder = new Builder().match(THIS_NODE, this.schema.getLabels(), { [primaryKey]: id })
    builder.setExpr(`${THIS_NODE}.${key}`, `coalesce(${THIS_NODE}.${key}, 0) + $by`, { by })
    builder.return(`${THIS_NODE}.${key} AS value`)

    const { query, params } = builder.build()
    const output = await this.neode.writeCypher(query, params, this.database)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      if (options.ifExists === true) {
        return 0
      }

      throw new Error(`Cannot increment: entity not found for ${String(target)}`)
    }

    return Repository.toCount(firstRecord.get('value'))
  }

  /**
  Full-text search over the index `installSchema()` created for this
  model's `fulltext: true` properties (NTS-436): hydrated entities with
  their relevance score, best match first. `fields` selects which declared
  fulltext properties form the index (default: all of them). Pass user
  text through `toFulltextQuery()` first — the query is bound as a
  parameter, but Lucene syntax characters in it are still parsed as such.
  */
  async search(
    query: string,
    options: SearchOptions<Entity> = {},
  ): Promise<ScoredEntity<Entity>[]> {
    const declared = this.schema
      .getProperties()
      .filter((schemaProperty) => schemaProperty.getFulltext())
      .map((schemaProperty) => schemaProperty.getKey())

    if (declared.length === 0) {
      throw new Error(
        `Cannot search ${this.getLabels().join(':')}: no property is declared fulltext: true — declare one, or use neode.search(entity, indexName, query) with installFulltextIndexes()`,
      )
    }

    // Declaration order, so the resolved name matches the index
    // installSchema() (or a subset install) created for those fields
    // regardless of the order the caller lists them in
    const selected = options.fields === undefined ? undefined : new Set<string>(options.fields)
    const fields = selected === undefined ? declared : declared.filter((key) => selected.has(key))

    if (selected !== undefined && (fields.length === 0 || fields.length !== selected.size)) {
      throw new Error(
        `Cannot search ${this.getLabels().join(':')}: fields must name properties declared fulltext: true — declared fulltext properties are [${declared.join(', ')}]`,
      )
    }

    const label = this.getLabels()[0]

    if (label === undefined) {
      throw new Error(`Cannot search ${this.getLabels().join(':')}: the model has no labels`)
    }

    const indexName = fulltextIndexName({ label, properties: fields })

    return this.neode.search(this.entity, indexName, query, options.limit)
  }

  /**
  A Builder matching the entity by its primary key value — the seam for
  subclass queries that continue from a known entity.
  */
  matchEntity(variable: string = THIS_NODE, object: Entity): Builder {
    const builder = new Builder()

    const primaryKey = this.getPrimaryKey().getKey()
    const value = isRecord(object) ? object[primaryKey] : undefined

    return builder.match(variable, this.schema.getLabels(), { [primaryKey]: value })
  }
}

/**
A driver Integer (or any object carrying toNumber) — the checked edge for
count values.
*/
function hasToNumber(value: unknown): value is { toNumber(): number } {
  return isRecord(value) && typeof value['toNumber'] === 'function'
}
