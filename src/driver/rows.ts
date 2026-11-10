import { jsonSafe } from './json-safe.js'
import type { QueryOutput } from './types.js'

/**
The rows of a raw query result as plain objects keyed by column name —
the `toObject()` shape the neo4j driver's Record offers, with every value
run through jsonSafe. The row type is a caller assertion (the RETURN
columns are not statically known): pass it explicitly for dot access —
`rows<{ name: string }>(output)` — or read index-signature style with
brackets. The scalar pattern for a single-row result is
`rows<{ n: number }>(output)[0]?.n`.
*/
export function rows<T = Record<string, unknown>>(result: QueryOutput): T[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the RETURN columns are not statically known; the row type is a caller assertion by design (doc comment above)
  return result.records.map((record) =>
    Object.fromEntries(record.keys.map((key) => [key, jsonSafe(record.get(key))])),
  ) as T[]
}
