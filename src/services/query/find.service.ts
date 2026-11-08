import type { Newable } from '../../meta/newable.js'
import { Builder } from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { QueryService } from './query.service.js'
import { NeodeError } from '../../errors/index.js'
import { applySoftDeleteFilter } from './soft-delete.js'

export class FindService extends QueryService {
  async find<T>(
    constructor: Newable,
    schema: EntitySchema,
    value: unknown,
  ): Promise<T | undefined> {
    const builder = new Builder()

    const primaryKey = schema.getPrimaryKey()

    if (primaryKey === undefined) {
      throw new NeodeError(`Cannot find ${schema.getLabels().join(':')}: no primary key declared`)
    }

    builder.match(THIS_NODE, schema.getLabels(), { [primaryKey.getKey()]: value })

    applySoftDeleteFilter(builder, schema)

    return this.returnFirst<T>(constructor, schema, builder)
  }
}
