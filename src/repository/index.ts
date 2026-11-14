import { THIS_NODE } from '../constants.js'
import type { QueryOutput } from '../driver/types.js'
import { NeodeError, GuardViolationError, unknownPropertyError } from '../errors/index.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { Newable } from '../meta/newable.js'
import { PropertyType, type PropertySchema } from '../meta/property-schema.js'
import type { INeode } from '../neode.interface.js'
import { Builder, eagerNode } from '../query/index.js'
import type { LoadedEntity, QueryLoadSpec, ReadOptions, WithSpec } from '../query/load-spec.js'
import { quote } from '../query/quote.js'
import { applyOrder, type OrderSpec } from '../query/order-spec.js'
import { getMergeFields } from '../services/query/merge.service.js'
import { requireLimit } from '../services/query/limits.js'
import { assertDeleteAllScope } from '../services/query/delete.service.js'
import type { DeleteOptions } from '../services/query/delete.service.js'
import type { ScoredEntity } from '../services/query/search.service.js'
import type { KnnMode } from '../services/query/knn.service.js'
import { fulltextIndexName } from '../services/schema/fulltext.service.js'
import { vectorIndexName } from '../services/schema/vector.service.js'
import { isGraphNode, isRecord } from '../services/type-guards.js'
import {
  stampExpression,
  timestampProperty,
  versionBump,
  versionProperty,
  deriveProperties,
} from '../services/write-utilities.js'
import { shapeNodeRows, shapeProjectionRows } from '../services/query/shape.js'
import type { ManyAndCount } from '../services/query/paginate.service.js'
import { hasProjectedProperties } from '../projection/index.js'
import { projectionNode } from '../projection/projection.js'
import {
  applyReadFilters,
  assertPublicWithoutFilters,
  type ReadFilterOptions,
} from '../services/query/filters.js'
import { applyFilterBag } from '../services/query/filter-bag.js'
import type { WhereFilterLevel } from '../query/where-filter.js'

/**
Ordering, paging, row-limit and load-spec options shared by findAll()
and where(). Generic over the entity AND the model constructor: the
`with` load spec (NTS-560/NTS-154/NTS-563) is checked against the
constructor's `neodeRelationships` phantom static when the model declares
one (QueryLoadSpec), falling back to the declared object/array field keys
(QueryLoadLevel) — the same spec the facade paths accept.
*/
export interface FindOptions<
  Entity = object,
  C extends Newable = new (
    ...arguments_: never[]
  ) => Entity,
> {
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
  and decorate their read — `with: { orders: { toys: true } }`. With a
  spec the read goes through the projection path, so the standard read
  filters apply — includeDeleted is not honoured with `with`.
  */
  with?: QueryLoadSpec<C>
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
Active-record style data-access repository for one registered model — constructor-generic over the model CONSTRUCTOR (NTS-563): the `with` load spec of find / findAll is map-checked against the model's `neodeRelationships` phantom static and the returns narrow, the same with() contract as the facade paths (NTS-154) — the TypeORM-parity surface, obtained via `neode.getRepository(Entity)` or the
@EntityRepository custom subclass.

Constructed with a registered entity class (@NodeEntity / defineModel);
unregistered entities throw. All reads return hydrated entity instances.

The second type parameter is the MODEL CONSTRUCTOR (NTS-563, closing the
NTS-154 ceiling): `neode.getRepository(Person)` hands back
`Repository<Person, typeof Person>`, so the `with` load spec of find /
findAll checks its keys against the model's `neodeRelationships` phantom
static (QueryLoadSpec) and the returns narrow to the hydrated shape —
`findAll({}, { with: { pets: { toys: true } } })` resolves to
`(Person & { pets: (Pet & { toys: Toy[] })[] })[]`. Annotated as plain
`Repository<Person>` (the custom-repository default), the spec falls back
to the declared object/array field keys — nested levels still type-check,
without the map's property-key exclusion.

shortcut: saveAll() saves entities one at a time, each in its own write
transaction, so concurrent saves cannot conflict on single-transaction
connections — batch UNWIND writes are BulkService's job.
*/
export class Repository<Entity, C extends Newable = new (...arguments_: never[]) => Entity> {
  /**
  Neo4j driver returns count() as an Integer instance, Relate as a number
  */
  private static patchProtection(property: PropertySchema): string | undefined {
    if (property.isPrimaryKey()) {
      return 'the primary key'
    }

    if (property.isVersion()) {
      return 'the @Version counter, which the library manages'
    }

    if (property.isCreatedAt()) {
      return '@CreatedAt, which is stamped once on create'
    }

    if (property.isReadonly()) {
      return 'readonly'
    }

    if (property.isProtected()) {
      return 'protected'
    }

    return undefined
  }

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
      throw new NeodeError(
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
  declared properties only (GetService parity: unknown keys are ignored;
  NTS-646 operator objects render through the shared filter-bag helper).
  The named read filters apply (soft delete included) unless
  shouldBypassFilters is set — the bulk-write paths pass true: writes
  never read through filters (NTS-162).

  The parameter union is every bag shape the callers hand over (the loose
  record, the typed NTS-646 bag, the legacy Partial) — the Repository's
  subclass-constructor relation (RepositoryConstructor wire format) needs
  this member to relate across Entity instantiations, so spell it out
  rather than narrowing to one shape.
  */
  private matchAll(
    parameters: Partial<Entity> | WhereFilterLevel<Entity> | Record<string, unknown> = {},
    filters?: ReadFilterOptions,
    shouldBypassFilters = false,
  ): Builder {
    const builder = new Builder()

    builder.match(THIS_NODE, this.schema.getLabels())

    if (!shouldBypassFilters) {
      applyReadFilters(builder, this.schema, filters)
    }

    applyFilterBag(builder, this.schema, parameters)

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
      throw new NeodeError(
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

  Map-narrowed with spec (NTS-563): `options.with` is checked against the
  model's type-level relationship map (the `neodeRelationships` phantom
  static, falling back to the declared object/array field keys) and the
  resolved entity carries every requested relationship —
  `find(id, { with: { orders: { toys: true } } })` resolves to
  `(Entity & { orders: (Order & { toys: Toy[] })[] }) | undefined`. The
  same load-spec rendering runs as on the facade paths (one statement per
  read).
  */
  async find<const WithSpecT extends QueryLoadSpec<C>>(
    id: unknown,
    options: {
      with: WithSpecT
      database?: string | undefined
      withoutFilters?: string[] | undefined
    },
  ): Promise<LoadedEntity<Entity, WithSpecT> | undefined>
  async find(id: unknown, options?: ReadOptions<Entity>): Promise<Entity | undefined>
  async find(
    id: unknown,
    options?: {
      with?: object
      database?: string | undefined
      withoutFilters?: string[] | undefined
    },
  ): Promise<unknown> {
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new TypeError(`Repository.find expects a string or number id, received ${typeof id}`)
    }

    if (options === undefined) {
      return this.neode.find(this.entity, id, this.database)
    }

    // The spec rides the legacy ReadOptions overload of INeode — the
    // map-narrowed INeode overloads are the 0002 breaking follow-up. The
    // runtime renders nested spec objects identically (NTS-154), and the
    // runtime validation is the checked edge for keys the compile-time
    // tiers cannot exclude.

    // the repository's pinned database applies unless the caller overrode
    // it (NTS-607)
    const readOptions =
      options.database === undefined && this.database !== undefined
        ? { ...options, database: this.database }
        : options

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the narrowed overload above carries the precise spec type; INeode keeps the legacy ReadOptions shape (docs/decisions/0002-typing-eager-loads.md)
    return this.neode.find(this.entity, id, readOptions as ReadOptions<Entity>)
  }
  /**
  The first entity matching the given properties (declared properties
  only), or undefined when nothing matches.
  */
  async findBy(properties?: WhereFilterLevel<Entity>): Promise<Entity | undefined> {
    const results = await this.findAll(properties, { limit: 1 })

    return results[0]
  }

  /**
  All entities matching the given properties (declared properties only —
  unknown keys are ignored), ordered/paged/limited by options.

  Map-narrowed with spec (NTS-563): `options.with` is checked against the
  model's type-level relationship map and the resolved entities carry
  every requested relationship — `findAll({}, { with: { pets: { toys:
  true } } })` resolves to `(Person & { pets: (Pet & { toys: Toy[] })[]
  })[]`, nested spec levels and the level's order / skip / limit trims
  riding the same statement as on the facade paths.

  Models declaring read-model decorators (@RelatedOne/@RelationshipCount/…)
  read through the projection-aware path (NTS-501): the facade's all()
  returns every projected value hydrated, matching neode.all() semantics.
  Plain models keep the local Builder path.
  */
  async findAll<const WithSpecT extends QueryLoadSpec<C>>(
    parameters: Partial<Entity> | WhereFilterLevel<Entity>,
    options: {
      with: WithSpecT
      order?: OrderSpec
      limit?: number
      skip?: number
      withoutFilters?: string[] | undefined
    },
  ): Promise<LoadedEntity<Entity, WithSpecT>[]>
  async findAll(
    parameters?: WhereFilterLevel<Entity>,
    options?: FindOptions<Entity, C>,
  ): Promise<Entity[]>
  async findAll(
    parameters: Partial<Entity> | WhereFilterLevel<Entity> | Record<string, unknown> = {},
    options: {
      with?: object
      order?: OrderSpec
      limit?: number
      skip?: number
      includeDeleted?: boolean
      withoutFilters?: string[] | undefined
    } = {},
  ): Promise<Entity[]> {
    assertPublicWithoutFilters(options.withoutFilters)

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
      if (withSpec === undefined) {
        return this.neode.all<Entity>(
          this.entity,
          parameters,
          options.order,
          options.limit,
          options.skip,
          this.database,
          { withoutFilters: options.withoutFilters },
        )
      }

      // The spec rides the legacy INeode overload — the map-narrowed
      // INeode overloads are the 0002 breaking follow-up. The runtime
      // renders nested spec objects identically (NTS-154).
      const legacySpec = withSpec as WithSpec<Entity>

      return this.neode.all<Entity>(
        this.entity,
        parameters,
        options.order,
        options.limit,
        options.skip,
        this.database,
        { with: legacySpec, withoutFilters: options.withoutFilters },
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

    if (options.limit !== undefined) {
      builder.limit(requireLimit(options.limit))
    }

    const output = await this.read(builder)

    return shapeNodeRows<Entity>(output.records, this.schema, this.entity, THIS_NODE)
  }

  /**
  findAll() alias — every entity matching the given properties.
  */
  async where(parameters?: WhereFilterLevel<Entity>): Promise<Entity[]> {
    return this.findAll(parameters)
  }

  /**
  Count of entities matching the given properties (a Cypher count(), so
  no entities are hydrated). The named read filters apply.
  */
  async count(parameters?: WhereFilterLevel<Entity>): Promise<number> {
    const builder = this.matchAll(parameters ?? {})

    builder.return(`count(${THIS_NODE}) AS count`)

    const output = await this.read(builder)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new NeodeError('count query returned no records')
    }

    return Repository.toCount(firstRecord.get('count'))
  }

  /**
  Existence check by primary key — one `RETURN 1 LIMIT 1`, no projection,
  no hydration: the cheap answer to "does this id exist", where find()
  would hydrate the full projected read-model (eager @RelatedMany
  included) only to be thrown away. The named read filters apply, so a
  soft-deleted node reads as absent. Accepts string and number keys only.
  */
  async exists(id: unknown, options?: { withoutFilters?: string[] | undefined }): Promise<boolean> {
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new TypeError(`Repository.exists expects a string or number id, received ${typeof id}`)
    }

    assertPublicWithoutFilters(options?.withoutFilters)

    const filters: ReadFilterOptions = {}

    if (options?.withoutFilters !== undefined) {
      filters.withoutFilters = options.withoutFilters
    }

    const primaryKey = this.getPrimaryKey().getKey()

    const builder = new Builder()

    builder.match(THIS_NODE, this.schema.getLabels())
    applyReadFilters(builder, this.schema, filters)
    builder.where(`${THIS_NODE}.${primaryKey}`, id)

    builder.return('1 AS one')
    builder.limit(1)

    const output = await this.read(builder)

    return output.records.length > 0
  }

  /**
  All entities whose primary key is in `ids` — one `WHERE this.pk IN $ids`
  read instead of one find() per id. Models declaring read-model
  decorators read through the same RETURN map projection as findAll()
  (ProjectionService parity); the named read filters apply. Row order
  follows the database — pass options.order when the caller needs one.
  */
  async findAllByIds(
    ids: (string | number)[],
    options: {
      order?: OrderSpec
      limit?: number
      withoutFilters?: string[] | undefined
    } = {},
  ): Promise<Entity[]> {
    assertPublicWithoutFilters(options.withoutFilters)

    if (ids.length === 0) {
      return []
    }

    const filters: ReadFilterOptions = {}

    if (options.withoutFilters !== undefined) {
      filters.withoutFilters = options.withoutFilters
    }

    const primaryKey = this.getPrimaryKey().getKey()

    const builder = this.matchAll({}, filters)

    builder.where(`${THIS_NODE}.${primaryKey}`, 'IN', [...new Set(ids)])

    if (options.order !== undefined) {
      applyOrder(builder, options.order)
    }

    const isProjected = hasProjectedProperties(this.schema)

    if (isProjected) {
      // ProjectionService.run() parity: the RETURN map projection
      // hydrates through shapeProjectionRows
      builder.return(
        `${projectionNode(THIS_NODE, this.schema, undefined, { builder, filters })} AS ${THIS_NODE}`,
      )
    } else {
      this.returnNodes(builder, filters)
    }

    if (options.limit !== undefined) {
      builder.limit(requireLimit(options.limit))
    }

    const output = await this.read(builder)

    return isProjected
      ? shapeProjectionRows<Entity>(output.records, this.schema, this.entity, THIS_NODE)
      : shapeNodeRows<Entity>(output.records, this.schema, this.entity, THIS_NODE)
  }

  /**
  findAll() + count() as one call (TypeORM's findAndCount, the
  repository form of the facade's findManyAndCount): `items` trimmed by
  options.order/limit/skip, `total` the full filter count. On a
  transaction-scoped Repository both reads share the transaction's
  snapshot. The two statements run sequentially so single-transaction
  connections (the embedded engine) are safe.
  */
  async findAndCount(
    parameters: WhereFilterLevel<Entity> = {},
    options: FindOptions<Entity, C> = {},
  ): Promise<ManyAndCount<Entity>> {
    const items = await this.findAll(parameters, options)
    const total = await this.count(parameters)

    return { items, total }
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
    // Protected properties cannot be patched (NTS-580): a changed primary
    // key would make save() MERGE a duplicate node, and @Version /
    // @CreatedAt / readonly / protected values are library-managed or
    // immutable after create
    for (const schemaProperty of this.schema.getProperties()) {
      const key = schemaProperty.getKey()

      if (
        !Object.hasOwn(properties, key) ||
        (properties as Record<string, unknown>)[key] === undefined
      ) {
        continue
      }

      const reason = Repository.patchProtection(schemaProperty)

      if (reason !== undefined) {
        throw new NeodeError(
          `Cannot patch ${this.getLabels().join(':')}.${key} — it is ${reason}. Remove "${key}" from the patch; to change a primary key, create a new node and delete the old one.`,
        )
      }
    }

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
      throw new NeodeError(
        `Cannot upsert ${this.getLabels().join(':')} — the model declares no unique or indexed properties to match on. Declare one (@Unique / @Index / @Property({ unique: true })).`,
      )
    }

    const hasMatchKey = mergeFields.some((field) => properties[field.getKey()] !== undefined)

    if (!hasMatchKey) {
      const keys = mergeFields.map((field) => field.getKey()).join(', ')

      throw new NeodeError(
        `Cannot upsert ${this.getLabels().join(':')} — properties must include at least one merge field to match on: [${keys}]`,
      )
    }

    const merged = await this.neode.merge(this.entity, properties, this.database)

    return merged?.entity
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
      throw new NeodeError(
        `Cannot restore ${this.getLabels().join(':')} — the model does not declare @SoftDelete`,
      )
    }

    const primaryKey = this.getPrimaryKey().getKey()
    const id = isRecord(target) ? target[primaryKey] : target

    // Gated on the label being there: restoring a live node matches zero
    // rows — a no-op that never re-stamps or double-bumps (NTS-595
    // symmetry with the delete path's not-labelled gate)
    const builder = new Builder()
      .match(THIS_NODE, this.schema.getLabels(), { [primaryKey]: id })
      .whereLabel(THIS_NODE, soft.label, false)

    builder.remove(`${THIS_NODE}:${quote(soft.label)}`, `${THIS_NODE}.deletedAt`)

    // NTS-604: restore is a write like every other — stamp updatedAt and
    // bump the version, mirroring the soft-delete branch
    const updatedAt = timestampProperty(this.schema, 'updatedAt')

    if (updatedAt !== undefined) {
      builder.setExpr(`${THIS_NODE}.${updatedAt.getKey()}`, stampExpression(updatedAt))
    }

    const version = versionProperty(this.schema)

    if (version !== undefined) {
      builder.setExpr(`${THIS_NODE}.${version.getKey()}`, versionBump(THIS_NODE, version.getKey()))
    }

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

    // The lookup bypasses the read filters directly (NTS-610: '*' is no
    // longer accepted through the public find mappers): delete is a write —
    // rows hidden by the current filter view stay deletable
    const primaryKey = this.getPrimaryKey().getKey()
    const id = isRecord(target) ? target[primaryKey] : target

    const builder = new Builder().match(THIS_NODE, this.schema.getLabels(), { [primaryKey]: id })
    builder.limit(1)
    builder.return(THIS_NODE)

    const output = await this.read(builder)

    const [entity] = shapeNodeRows<Entity>(output.records, this.schema, this.entity, THIS_NODE)

    if (entity === undefined) {
      if (ifExists === true) {
        return
      }

      throw new NeodeError(`Cannot delete: entity not found for ID ${String(target)}`)
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
    parameters?: WhereFilterLevel<Entity>,
  ): Promise<Record<string, number>> {
    const declared = this.schema
      .getProperties()
      .find((schemaProperty) => schemaProperty.getKey() === property)

    if (declared === undefined) {
      throw unknownPropertyError(
        this.getLabels().join(':') || 'entity',
        property,
        this.schema.getProperties().map((schemaProperty) => schemaProperty.getKey()),
      )
    }

    const key = declared.getKey().replaceAll('`', '``')
    const builder = this.matchAll(parameters ?? {})
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

  Guarded (NTS-595, NTS-578 destructive-guards precedent): a call with no
  filters deletes every node carrying the model's labels and is refused —
  pass at least one filter, or `{ all: true }` to confirm the wipe.

  shortcut: one DETACH DELETE statement rather than per-node deletes,
  so per-node delete events and cascade options do not apply — switch to
  a loop over delete() when cascading bulk deletes are needed. A bulk
  write: named read filters do not apply (NTS-162).
  */
  async deleteAll(parameters?: WhereFilterLevel<Entity> & { all?: true }): Promise<number> {
    assertDeleteAllScope(parameters ?? {}, this.getLabels())

    const builder = this.matchAll(parameters ?? {}, undefined, true)

    builder.detachDelete(THIS_NODE)
    builder.return(`count(${THIS_NODE}) AS count`)

    const { query, params: queryParameters } = builder.build()

    const output = await this.neode.writeCypher(query, queryParameters, this.database)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      throw new NeodeError('count query returned no records')
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

  With `min` (NTS-655) the statement carries a guard terminal —
  `WITH this WHERE this.prop >= $min` — so the floor is checked in the
  same statement, under the write lock: a post-write value below the
  floor (inclusive — exactly `min` passes) filters the statement's only
  row out, and the zero-row result throws `GuardViolationError` instead
  of returning a value. The throw rolls a managed write transaction
  (inWriteTransaction / ambient transaction) back — the write lock makes
  the check-and-decrement atomic, so no interleaving writer can slip
  between them; under autocommit the SET itself still commits, so wrap
  guarded decrements in a transaction. The floor works for both signs of
  `by` (on a positive increment it is a no-op: the value only grows).
  `min` takes precedence over `ifExists`: a zero-row result always
  throws, because a missing entity matches zero rows too and the two
  cases cannot be told apart inside one statement.
  */
  async increment(
    target: Entity | string | number,
    property: keyof Entity & string,
    by = 1,
    options: { ifExists?: boolean; min?: number } = {},
  ): Promise<number> {
    const declared = this.schema
      .getProperties()
      .find((schemaProperty) => schemaProperty.getKey() === property)

    if (declared === undefined) {
      throw unknownPropertyError(
        this.getLabels().join(':') || 'entity',
        property,
        this.schema.getProperties().map((schemaProperty) => schemaProperty.getKey()),
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

    if (
      options.min !== undefined &&
      (typeof options.min !== 'number' || !Number.isFinite(options.min))
    ) {
      throw new TypeError('Cannot increment: min must be a finite number')
    }

    // The property name is schema-validated and quoted (names cannot be
    // parameters); the step is bound as a query parameter
    const key = quote(declared.getKey())
    const primaryKey = this.getPrimaryKey().getKey()
    const id = isRecord(target) ? target[primaryKey] : target

    const builder = new Builder().match(THIS_NODE, this.schema.getLabels(), { [primaryKey]: id })
    builder.setExpr(`${THIS_NODE}.${key}`, `coalesce(${THIS_NODE}.${key}, 0) + $by`, { by })

    // A write like any other (NTS-580): stamp @UpdatedAt and bump @Version
    // (unless the counter is the version itself)
    const updatedAt = timestampProperty(this.schema, 'updatedAt')
    const version = versionProperty(this.schema)

    if (updatedAt !== undefined && updatedAt.getKey() !== declared.getKey()) {
      builder.setExpr(`${THIS_NODE}.${quote(updatedAt.getKey())}`, stampExpression(updatedAt))
    }

    if (version !== undefined && version.getKey() !== declared.getKey()) {
      const versionKey = quote(version.getKey())

      builder.setExpr(`${THIS_NODE}.${versionKey}`, versionBump(THIS_NODE, versionKey))
    }

    // NTS-597: a stored derived property with the counter among its sources
    // recomputes on increment. Cypher-side derivations ride the same
    // statement — sequential SET clauses read the bumped counter. Compute-
    // side ones cannot run in the database: the statement also returns the
    // post-write node, and the recomputed values follow in a second,
    // targeted write.
    const counterKey = declared.getKey()
    const dirtyCounter = new Set([counterKey])

    const derivedSets = deriveProperties(this.schema, {}, dirtyCounter).cypherSets

    // NTS-597: the WITH boundary splits the derived SET into its own
    // clause — SET items inside one clause do not observe each other's
    // writes on every backend (the embedded Relate engine evaluates a
    // clause against the pre-statement state), and the expressions must
    // read the bumped counter
    if (derivedSets.length > 0) {
      builder.with(THIS_NODE)
    }

    for (const { key: derivedKey, cypher } of derivedSets) {
      builder.setExpr(`${THIS_NODE}.${quote(derivedKey)}`, cypher)
    }

    // NTS-655: the min floor renders as a WITH … WHERE terminal in the
    // decrement's own statement, under the write lock — a post-write
    // value below the floor filters the statement's only row out and the
    // zero-rows check below throws. The value is bound as a parameter.
    if (options.min !== undefined) {
      builder.with(THIS_NODE)
      builder.param('min', options.min)
      builder.whereRaw(`${THIS_NODE}.${key} >= $min`)
    }

    const shouldRecomputeFromCounter = this.schema.getProperties().some((property) => {
      const derived = property.getDerived()

      if (derived === undefined || typeof derived.compute !== 'function') {
        return false
      }

      const sources = Array.isArray(derived.from) ? derived.from : []

      return property.getKey() !== counterKey && sources.includes(counterKey)
    })

    builder.return(
      `${THIS_NODE}.${key} AS value`,
      ...(shouldRecomputeFromCounter ? [THIS_NODE] : []),
    )

    const { query, params } = builder.build()
    const output = await this.neode.writeCypher(query, params, this.database)

    const firstRecord = output.records[0]

    if (firstRecord === undefined) {
      // The guard cannot tell a violated floor from a missing entity —
      // both match zero rows — so a set min always throws (fail-closed,
      // taking precedence over ifExists)
      if (options.min !== undefined) {
        throw new GuardViolationError(this.getLabels().join(':') || 'entity', property, options.min)
      }

      if (options.ifExists === true) {
        return 0
      }

      throw new NeodeError(`Cannot increment: entity not found for ${String(target)}`)
    }

    const value = Repository.toCount(firstRecord.get('value'))

    if (shouldRecomputeFromCounter) {
      const written: unknown = firstRecord.get(THIS_NODE)

      if (isGraphNode(written)) {
        const postState: Record<string, unknown> = { ...written.properties }

        const post = deriveProperties(this.schema, postState, dirtyCounter)

        if (post.recomputed.length > 0) {
          const patch = Object.fromEntries(
            post.recomputed.map((derivedKey): [string, unknown] => [
              derivedKey,
              postState[derivedKey],
            ]),
          )

          const followUp = new Builder()
            .match(THIS_NODE, this.schema.getLabels(), { [primaryKey]: id })
            .set(THIS_NODE, patch, '+=')

          const statement = followUp.build()

          await this.neode.writeCypher(statement.query, statement.params, this.database)
        }
      }
    }

    return value
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
      throw new NeodeError(
        `Cannot search ${this.getLabels().join(':')}: no property is declared fulltext: true — declare one, or use neode.search(entity, indexName, query) with installFulltextIndexes()`,
      )
    }

    // Declaration order, so the resolved name matches the index
    // installSchema() (or a subset install) created for those fields
    // regardless of the order the caller lists them in
    const selected = options.fields === undefined ? undefined : new Set<string>(options.fields)
    const fields = selected === undefined ? declared : declared.filter((key) => selected.has(key))

    if (selected !== undefined && (fields.length === 0 || fields.length !== selected.size)) {
      throw new NeodeError(
        `Cannot search ${this.getLabels().join(':')}: fields must name properties declared fulltext: true — declared fulltext properties are [${declared.join(', ')}]`,
      )
    }

    const label = this.getLabels()[0]

    if (label === undefined) {
      throw new NeodeError(`Cannot search ${this.getLabels().join(':')}: the model has no labels`)
    }

    const indexName = fulltextIndexName({ label, properties: fields })

    return this.neode.search(this.entity, indexName, query, options.limit)
  }

  /**
  k-nearest-neighbour search over the vector index `installSchema()`
  created for this model's declared `@Vector` property — the kNN
  counterpart of search(): the index name is derived from the model
  declaration, so the caller passes just the property key and the query
  vector. Hydrated entities with their similarity score, best match
  first.
  */
  async knn(
    property: string,
    vector: number[],
    k: number,
    mode?: KnnMode,
  ): Promise<ScoredEntity<Entity>[]> {
    const label = this.getLabels()[0]

    if (label === undefined) {
      throw new NeodeError(
        `Cannot run a kNN search on ${this.getLabels().join(':')}: the model has no labels`,
      )
    }

    const schemaProperty = this.schema
      .getProperties()
      .find((candidate) => candidate.getKey() === property)

    if (schemaProperty === undefined) {
      throw new NeodeError(
        `Cannot run a kNN search on ${label}: no property named "${property}" — declare it, or pass a property the model declares`,
      )
    }

    const vectorConfig = schemaProperty.getVector()

    if (vectorConfig === undefined) {
      throw new NeodeError(
        `Cannot run a kNN search on ${label}.${property} — the property is not declared with @Vector. Declare @Vector on it, or use neode.knn(entity, indexName, …) with an explicit index name`,
      )
    }

    const indexName = vectorIndexName({ label, property, ...vectorConfig })

    return this.neode.knn(this.entity, indexName, vector, k, mode)
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
