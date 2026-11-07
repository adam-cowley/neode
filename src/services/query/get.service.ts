import type { Newable } from '../../meta/newable.js'
import { Builder } from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { applyOrder, type OrderSpec } from '../../query/order-spec.js'
import { QueryService } from './query.service.js'

// The order forms live in the shared query module (the Repository uses the
// same ones) — re-exported here to keep the established import path
export { applyOrder, type OrderSpec } from '../../query/order-spec.js'

export class GetService extends QueryService {
  async get<T>(
    constructor: Newable,
    schema: EntitySchema,
    parameters: Record<string, unknown>,
    limit?: number,
    skip?: number,
    order?: OrderSpec,
  ): Promise<T[]> {
    const builder = new Builder()

    builder.match(THIS_NODE, schema.getLabels())

    for (const property of schema.getProperties()) {
      const key = property.getKey()

      if (Object.hasOwn(parameters, key)) {
        builder.where(`${THIS_NODE}.${key}`, parameters[key])
      }
    }

    applyOrder(builder, order)

    return this.return<T>(constructor, schema, builder, skip, limit)
  }
}
