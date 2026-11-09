import { THIS_NODE } from '../../constants.js'
import { elementIdOfEntity } from '../../element-id.js'
import { NeodeError } from '../../errors/index.js'
import { type EntitySchema, EntityType } from '../../meta/entity/entity-schema.js'
import { getModel } from '../../meta/index.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { Builder } from '../../query/index.js'
import { eagerNode, eagerNodeVariable } from '../../query/eager-utilities.js'
import { applyOrder, type OrderSpec } from '../../query/order-spec.js'
import { hydrateNode } from '../../utilities.js'
import { isNodeLike } from '../type-guards.js'
import { QueryService } from './query.service.js'
import { applyReadFilters, type ReadFilterOptions } from './filters.js'

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

    const key = relationship.getKey()

    const elementId = elementIdOfEntity(schema, entity)

    if (elementId === undefined) {
      throw new NeodeError(
        `${schema.getLabels()[0] ?? 'entity'} has no elementId — load() reads the graph for persisted entities; save() the instance first`,
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
    // elementId(this) = $elementId RETURN this_<key>_node { ...eager } AS node
    const relationshipVariable = `${THIS_NODE}_${key}_rel`
    const nodeVariable = eagerNodeVariable(THIS_NODE, key)

    const builder = new Builder()

    builder
      .match(THIS_NODE)
      .relationship(relationship.getType(), relationship.getDirection(), relationshipVariable)
      .to(nodeVariable, targetSchema.getLabels())
      .whereId(THIS_NODE, elementId)

    // NTS-162 — the target model's named filters filter the loaded rows
    applyReadFilters(builder, targetSchema, filters, nodeVariable)

    if (options?.order !== undefined && options.order !== '') {
      applyOrder(builder, options.order, nodeVariable)
    }

    if (options?.skip !== undefined) {
      builder.skip(options.skip)
    }

    if (options?.limit !== undefined) {
      builder.limit(options.limit)
    }

    builder.return(`${eagerNode(1, nodeVariable, targetSchema, { builder, filters })} AS node`)

    const { query, params } = builder.build()

    const output = await this.runner.run(query, params)

    const hydrated = output.records.map((record) => {
      const node: unknown = record.get('node')

      if (!isNodeLike(node)) {
        throw new TypeError(`The "node" column did not return a node value`)
      }

      return hydrateNode<Record<string, unknown>>(targetSchema, targetEntity, node)
    })

    // getMany() decides the empty shape, as at hydration: [] for many,
    // undefined for one — both materialize as own properties, so the
    // strict-access guard (or lenient undefined) answers for them
    const loaded: unknown = relationship.getMany() ? hydrated : hydrated[0]

    Object.assign(entity, { [key]: loaded })

    return loaded
  }
}
