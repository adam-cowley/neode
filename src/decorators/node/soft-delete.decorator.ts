import { mergeModel } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'

/**
Declarative soft delete (NTS-510): mark the model so delete() stamps a
label + deletedAt instead of DETACH DELETE, and every standard read
(find / findAll / all / projections / repository reads) filters the
label out. Restore with restore(); hard-delete with delete(force).

The label defaults to 'Deleted'; the stamp property is `deletedAt`
(declared implicitly, server-stamped with datetime()).
*/
export function SoftDelete(
  label = 'Deleted',
): (constructor: Newable, context: ClassDecoratorContext) => void {
  return function (constructor: Newable): void {
    const schema = mergeModel(constructor)

    schema.setSoftDelete(label)
  }
}
