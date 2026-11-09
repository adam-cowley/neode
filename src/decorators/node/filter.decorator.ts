import { mergeModel } from '../../meta/index.js'
import { assertFilterName } from '../../meta/entity/entity-schema.js'
import type { FilterDefinition } from '../../meta/entity/entity-schema.js'
import type { Newable } from '../../meta/newable.js'

/**
Named global filter (NTS-162): declare a named read filter on the model and
it applies to every standard read — find / get / all / paginate / search /
knn / eager loads / projections / repository reads — composed in one central
place in the query services.

- Disable per query with `withoutFilters: ['name']` on the read options;
  each filter is independent.
- Parameterise with `withFilterParams({ name: value }, async () => ...)`
  (request-scoped, async-safe; NTS-575); the `where` fragment references the
  value as `$name`. `setFilterParams(name, value)` sets a process-wide default
  that the scope overrides — it is unsafe under concurrent requests. A filter
  whose `$name` has no value fails closed with a NeodeError.
- `where` is a Cypher predicate over the filtered node; `node` names that
  node (the read root, or the related node inside a filtered relation's
  pattern comprehension). Label-state filters (labels-as-state, NTS-128)
  are just label predicates: `where: 'NOT node:Archived'`.
- Over relations, the target model's filters render inside the relation's
  pattern comprehension — a filtered-out target simply doesn't match, so
  the edge reads as absent and the parent row survives. Never OPTIONAL MATCH.

Example — soft delete + tenancy as independent named filters:

```ts
@NodeEntity()
@Filter({ name: 'notDeleted', where: 'NOT node:Archived' })
@Filter({ name: 'tenant', where: 'node.tenantId = $tenant' })
class Post {
  @Property({ type: 'string', primary: true }) id!: string
  @Property({ type: 'string' }) tenantId!: string

  @OneToMany(() => Comment, 'ON', Direction.OUTGOING, true)
  comments!: Comment[]
}

await withFilterParams({ tenant: 'acme' }, async () => {
  await Post.all()
})
```
*/
export function Filter(
  config: FilterDefinition,
): (constructor: Newable, context: ClassDecoratorContext) => void {
  return function (constructor: Newable): void {
    assertFilterName(config.name)

    const schema = mergeModel(constructor)

    schema.addFilter(config)
  }
}
