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
Apply an ordering spec against the builder, prefixing each field with the
node alias so callers can use bare property names.

Shared by the query services and the Repository so the accepted order
forms stay identical everywhere.
*/
export function applyOrder(builder: Builder, order?: OrderSpec): void {
  if (order === undefined || order === '') {
    return
  }

  if (typeof order === 'string') {
    builder.orderBy(`${THIS_NODE}.${order}`)
  } else if (Array.isArray(order)) {
    for (const entry of order) {
      applyOrder(builder, entry)
    }
  } else if ('field' in order && typeof order.field === 'string') {
    builder.orderBy({ field: `${THIS_NODE}.${order.field}`, order: order.order })
  } else {
    for (const [key, direction] of Object.entries(order as Record<string, string>)) {
      builder.orderBy(`${THIS_NODE}.${key}`, direction)
    }
  }
}
