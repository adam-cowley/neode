import type { Newable } from '../../meta/newable.js'
import { Builder } from '../../query/index.js'
import { THIS_NODE } from '../../constants.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { QueryService } from './query.service.js'
import { applyReadFilters, type ReadFilterOptions } from './filters.js'

export class FindByIdService extends QueryService {
  async find<T>(
    constructor: Newable,
    schema: EntitySchema,
    elementId: string,
    filters?: ReadFilterOptions,
  ): Promise<T | undefined> {
    const builder = new Builder()

    builder.match(THIS_NODE).whereId(THIS_NODE, elementId)

    applyReadFilters(builder, schema, filters)

    return this.returnFirst<T>(constructor, schema, builder, filters)
  }
}
