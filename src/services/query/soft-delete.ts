import type { Builder } from '../../query/index.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { THIS_NODE } from '../../constants.js'

/**
The global soft-delete read filter (NTS-510): when the model declares
@SoftDelete, every standard read excludes the soft-deleted label unless
the caller opts back in. Applied by FindService, GetService,
FindByIdService, ProjectionService and the repository's own reads.
*/
export function applySoftDeleteFilter(
  builder: Builder,
  schema: EntitySchema,
  hasIncludeDeleted = false,
  alias: string = THIS_NODE,
): void {
  const softDelete = schema.getSoftDelete()

  if (softDelete === undefined || hasIncludeDeleted) {
    return
  }

  builder.whereRaw(`NOT ${alias}:\`${softDelete.label}\``)
}
