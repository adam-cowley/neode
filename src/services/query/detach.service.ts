import { Builder } from '../../query/index.js'
import { getModel } from '../../meta/index.js'
import { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { EntitySchema as EntitySchemaType } from '../../meta/entity/entity-schema.js'
import type { RelationshipPropertySchema } from '../../meta/relationship-property-schema.js'
import { elementIdOfEntity } from '../../element-id.js'
import { matchCriteriaForEntity } from '../../utilities.js'
import { FindByIdService } from './find-by-id.service.js'
import { QueryService } from './query.service.js'
import { NeodeError } from '../../errors/index.js'
import { constructorOf } from '../type-guards.js'

export interface DetachResult<From, To> {
  from: From | undefined
  to: To | undefined
}

export class DetachService extends QueryService {
  /**
  Re-hydrate an entity by its elementId
  */
  private async refresh<T extends object>(
    schema: EntitySchemaType,
    entity: T,
  ): Promise<T | undefined> {
    const elementId = elementIdOfEntity(schema, entity)

    const constructor = constructorOf(entity)

    return constructor === undefined || elementId === undefined || elementId.length === 0
      ? undefined
      : new FindByIdService(this.runner).find<T>(constructor, schema, elementId)
  }

  /**
  Remove the relationship(s) of the given type between two nodes
  (neode DetachFrom.js, narrowed to the relationship type and
  direction declared on the schema) and return both re-hydrated nodes.
  */
  async detach<From extends object, To extends object>(
    schema: EntitySchemaType,
    fromEntity: From,
    toEntity: To,
    relationship: RelationshipPropertySchema,
  ): Promise<DetachResult<From, To>> {
    const toConstructor: unknown = constructorOf(toEntity)

    const targetSchema = typeof toConstructor === 'function' ? getModel(toConstructor) : undefined

    if (!(targetSchema instanceof EntitySchema)) {
      // NTS-446: name the relationship, what was received, and the fix
      throw new NeodeError(
        `Couldn't find a model for the target of relationship "${relationship.getKey()}" ` +
          `— received "${typeof toConstructor === 'function' ? toConstructor.name : String(toConstructor)}". ` +
          'Register the target model with @NodeEntity or defineModel() first.',
      )
    }

    const fromAlias = 'from'
    const toAlias = 'to'
    const relationshipAlias = 'rel'

    const fromMatch = matchCriteriaForEntity(schema, fromEntity)
    const toMatch = matchCriteriaForEntity(targetSchema, toEntity)

    const builder = new Builder()

    builder.matchEntity(fromAlias, schema, fromMatch)

    builder.relationship(relationship.getType(), relationship.getDirection(), relationshipAlias)

    builder.toEntity(toAlias, targetSchema, toMatch)

    builder.delete(relationshipAlias)

    const { query, params } = builder.build()

    await this.runner.run(query, params)

    return {
      from: await this.refresh<From>(schema, fromEntity),
      to: await this.refresh<To>(targetSchema, toEntity),
    }
  }
}
