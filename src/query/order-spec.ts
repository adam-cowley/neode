import { THIS_NODE } from '../constants.js'
import type { Builder } from './builder.js'

/**
Ordering spec, matching neode's all() forms:

- `'name'` - order by one property ascending
- `['name', 'age']` - order by several properties
- `{ name: 'DESC' }` - property -> direction map
- `[{ name: 'DESC' }, { age: 'ASC' }]` - list of property -> direction maps
- `{ field: 'name', order: 'DESC' }` - two-arg (key, direction) descriptor
*/
export type OrderSpec =
  | string
  | (string | Record<string, string>)[]
  | Record<string, string>
  | { field: string; order?: string }

/**
Render an OrderSpec into `alias.field direction` terms — the text an
ORDER BY clause consumes. applyOrder and the lazy relation loader's
in-comprehension ORDER BY (NTS-558) share this renderer, so the accepted
order forms stay identical everywhere.
*/
export function orderTerms(order: OrderSpec, alias: string): string[] {
  if (typeof order === 'string') {
    return [`${alias}.${order}`]
  }

  if (Array.isArray(order)) {
    return order.flatMap((entry) => orderTerms(entry as OrderSpec, alias))
  }

  if ('field' in order && typeof order.field === 'string') {
    const direction = order.order

    return [`${alias}.${order.field}${direction === undefined || direction === '' ? '' : ` ${direction}`}`]
  }

  return Object.entries(order as Record<string, string>).map(([key, direction]) => {
    return `${alias}.${key}${direction === '' ? '' : ` ${direction}`}`
  })
}

/**
Apply an ordering spec against the builder, prefixing each field with the
node alias (default: the query's root alias) so callers can use bare
property names.

Shared by the query services and the Repository so the accepted order
forms stay identical everywhere.
*/
export function applyOrder(builder: Builder, order?: OrderSpec, alias: string = THIS_NODE): void {
  if (order === undefined || order === '') {
    return
  }

  for (const term of orderTerms(order, alias)) {
    builder.orderBy(term)
  }
}
