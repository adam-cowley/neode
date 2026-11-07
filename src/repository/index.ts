import { THIS_NODE } from '../constants.js'
import type { QueryOutput } from '../driver/types.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { PropertySchema } from '../meta/property-schema.js'
import type { INeode } from '../neode.interface.js'
import { Builder, eagerNode } from '../query/index.js'
import { quote } from '../query/quote.js'
import { applyOrder, type OrderSpec } from '../query/order-spec.js'
import type { ScoredEntity } from '../services/query/search.service.js'
import { fulltextIndexName } from '../services/schema/fulltext.service.js'
import { isGraphNode, isRecord } from '../services/type-guards.js'
import { hydrateNode } from '../utilities.js'

export interface FindOptions {
  order?: OrderSpec
  limit?: number
  skip?: number
}

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

  constructor(neode: INeode, entity: new (...arguments_: never[]) => Entity, database?: string) {
    const entityConstructor: unknown = entity
    const model = getModel(entityConstructor)

    if (model === undefined) {
      throw new Error(
        'Cannot create a Repository for an unregistered model — register it with @NodeEntity / defineModel first',
      )
    }

    this.neode = neode
    this.entity = entity
    this.database = database
    this.schema = model
  }

  /**
  Match every node of the entity's labels, filtered on the schema's
  declared properties only (GetService parity: unknown keys are ignored)
  */
  private matchAll(parameters: Partial<Entity> = {}): Builder {
    const record = parameters as Record<string, unknown>

    const builder = new Builder()

    builder.match(THIS_NODE, this.schema.getLabels())

    for (const property of this.schema.getProperties()) {
      const key = property.getKey()

      if (Object.hasOwn(record, key)) {
        builder.where(`${THIS_NODE}.${key}`, record[key])
      }
    }

    return builder
  }

  private returnNodes(builder: Builder): void {
    // Eager Loading: when the schema declares eager relationships the
    // root node is returned as a map projection (QueryService parity)
    const hasEagerRelationships = this.schema
      .getRelationships()
      .some((relationship) => relationship.getEager())

    builder.return(
      hasEagerRelationships ? `${eagerNode(1, THIS_NODE, this.schema)} AS ${THIS_NODE}` : THIS_NODE,
    )
  }

  private async read(builder: Builder): Promise<QueryOutput> {
    const { query, params } = builder.build()

    return this.neode.readCypher(query, params, this.database)
  }

  protected getLabels(): string[] {
    return this.schema.getLabels()
  }

  getPrimaryKey(): PropertySchema {
    const primaryKey = this.schema.getPrimaryKey()

    if (primaryKey === undefined) {
      throw new Error(
        `Cannot resolve the primary key of ${this.getLabels().join(':')} — declare one (@Primary / @Uuid / @Property({ primary: true }))`,
      )
    }

    return primaryKey
  }

  async find(id: unknown): Promise<Entity | undefined> {
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new TypeError(`Repository.find expects a string or number id, received ${typeof id}`)
    }

    return this.neode.find(this.entity, id, this.database)
  }

  async findBy(properties: Partial<Entity> = {}): Promise<Entity | undefined> {
    const results = await this.findAll(properties, { limit: 1 })

    return results[0]
  }

  async findAll(parameters: Partial<Entity> = {}, options: FindOptions = {}): Promise<Entity[]> {
    const builder = this.matchAll(parameters)

    if (options.order !== undefined) {
      applyOrder(builder, options.order)
    }

    this.returnNodes(builder)

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

  async where(parameters: Partial<Entity> = {}): Promise<Entity[]> {
    return this.findAll(parameters)
  }

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
  Delete by primary key value or by entity instance. Pass `{ ifExists: true }`
  to silently no-op when the entity does not exist (NTS-457) — the default
  throws so callers learn about missing IDs.
  */
  async delete(
    target: Entity | string | number,
    options: { ifExists?: boolean } = {},
  ): Promise<void> {
    if (isRecord(target)) {
      return this.neode.delete(target, this.database)
    }

    const entity = await this.find(target)

    if (entity === undefined) {
      if (options.ifExists === true) {
        return
      }

      throw new Error(`Cannot delete: entity not found for ID ${String(target)}`)
    }

    if (!isRecord(entity)) {
      throw new TypeError('Cannot delete: the found entity is not an object')
    }

    return this.neode.delete(entity, this.database)
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
  a loop over delete() when cascading bulk deletes are needed
  */
  async deleteAll(parameters: Partial<Entity> = {}): Promise<number> {
    const builder = this.matchAll(parameters)

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
  Atomically bump a numeric property: one server-side statement
  `SET n.prop = coalesce(n.prop, 0) + by` — safe under concurrency where
  read-modify-write via update() would lose updates.

  The property must be declared on the schema (its name is interpolated
  into the Cypher — property names cannot be parameters).
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

    if (typeof by !== 'number' || !Number.isFinite(by)) {
      throw new TypeError('Cannot increment: step must be a finite number')
    }

    // The step is a validated finite number, so inlining it into the raw
    // set is injection-safe; the Builder's raw set has no parameter channel
    const key = quote(declared.getKey())
    const primaryKey = this.getPrimaryKey().getKey()
    const id = isRecord(target) ? target[primaryKey] : target

    const builder = new Builder().match(THIS_NODE, this.schema.getLabels(), { [primaryKey]: id })
    builder.set(`${THIS_NODE}.${key} = coalesce(${THIS_NODE}.${key}, 0) + (${String(by)})`)
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
  their relevance score, best match first. Pass user text through
  `toFulltextQuery()` first — the query is bound as a parameter, but
  Lucene syntax characters in it are still parsed as such.
  */
  async search(query: string, options: { limit?: number } = {}): Promise<ScoredEntity<Entity>[]> {
    const fields = this.schema
      .getProperties()
      .filter((schemaProperty) => schemaProperty.getFulltext())
      .map((schemaProperty) => schemaProperty.getKey())

    if (fields.length === 0) {
      throw new Error(
        `Cannot search ${this.getLabels().join(':')}: no property is declared fulltext: true — declare one, or use neode.search(entity, indexName, query) with installFulltextIndexes()`,
      )
    }

    const label = this.getLabels()[0]

    if (label === undefined) {
      throw new Error(`Cannot search ${this.getLabels().join(':')}: the model has no labels`)
    }

    const indexName = fulltextIndexName({ label, properties: fields })

    return this.neode.search(this.entity, indexName, query, options.limit)
  }

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
