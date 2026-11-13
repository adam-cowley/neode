import { Builder } from '../../query/index.js'
import { QueryService } from './query.service.js'
import { isRecord } from '../type-guards.js'

const REL = 'rel'

export class RelationshipService extends QueryService {
  /**
  `MATCH ()-[rel]-()` plus an elementId or property-equality where clause
  */
  private matchRelationship(builder: Builder, match: string | Record<string, unknown>): void {
    builder.match().relationship(undefined, undefined, REL).toAnything()

    if (typeof match === 'string') {
      builder.whereId(REL, match)
    } else {
      for (const [key, value] of Object.entries(match)) {
        builder.where(`${REL}.${key}`, value)
      }
    }
  }

  /**
  Update the properties of a relationship, matched by element ID or by
  property equality on the relationship itself
  (neode UpdateRelationship.js, elementId instead of id()).

  @returns the updated properties, or undefined when nothing matched
  */
  async update(
    match: string | Record<string, unknown>,
    properties: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const builder = new Builder()

    this.matchRelationship(builder, match)

    for (const [key, value] of Object.entries(properties)) {
      if (value !== undefined) {
        builder.set(`${REL}.${key}`, value)
      }
    }

    builder.return(`properties(${REL}) AS props`)

    const { query, params } = builder.build()

    const result = await this.runner.run(query, params)

    const updatedProperties: unknown = result.records[0]?.get('props')

    return isRecord(updatedProperties) ? updatedProperties : undefined
  }

  /**
  Delete a relationship by element ID (neode DeleteRelationship.js)
  */
  async delete(relationshipElementId: string): Promise<void> {
    const builder = new Builder()

    this.matchRelationship(builder, relationshipElementId)
    builder.delete(REL)

    const { query, params } = builder.build()

    await this.runner.run(query, params)
  }
}
