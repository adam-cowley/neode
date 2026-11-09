import { Builder } from '../../query/index.js'
import { assertCount } from '../../query/quote.js'
import { THIS_NODE } from '../../constants.js'
import type { QueryParams as QueryParameters, QueryRecord } from '../../driver/types.js'
import { hydrate } from '../../hydrate.js'
import { valueToJson } from '../../serialise.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { PropertySchema } from '../../meta/property-schema.js'
import { PropertyType } from '../../meta/property-schema.js'
import { QueryService } from './query.service.js'
import { type OrderSpec, applyOrder } from './get.service.js'
import { NeodeError } from '../../errors/index.js'
import { labelPattern } from './bulk.service.js'
import { isGraphNode } from '../type-guards.js'
import { applyReadFilters, readFilterFragment, type ReadFilterOptions } from './filters.js'

/**
Property the cursor keyset defaults to when orderBy is not given
*/
const DEFAULT_CURSOR_PROPERTY = 'createdAt'

/**
Page size lazy() walks with when the caller does not pick one — the
paginate() facade default
*/
const DEFAULT_LAZY_LIMIT = 25

/**
Property -> direction pagination (the classic form):
paginate(model, filter, { page, limit, order? })
*/
export interface OffsetPaginateOptions {
  /**
  1-based page number (default 1)
  */
  page?: number

  /**
  Page size
  */
  limit: number

  /**
  Order spec, as accepted by all()/get() — keep it stable across pages
  */
  order?: OrderSpec

  /**
  Named read filters to disable for this query (NTS-162)
  */
  withoutFilters?: string[]
}

/**
Keyset/cursor pagination on a temporal (or other comparable) property:
paginate(model, filter, { limit, orderBy?, after?, before? })
*/
export interface CursorPaginateOptions {
  /**
  Page size
  */
  limit: number

  /**
  Property to keyset on (default 'createdAt')
  */
  orderBy?: string

  /**
  Cursor of the previous page's last item: walk forward in time
  */
  after?: string | number

  /**
  Cursor of the previous page's first item: walk backward in time
  */
  before?: string | number

  /**
  Named read filters to disable for this query (NTS-162)
  */
  withoutFilters?: string[]
}

/**
The union of the two pagination modes PaginateService accepts — the
options shape (page vs cursor) selects the mode.
*/
export type PaginateOptions = OffsetPaginateOptions | CursorPaginateOptions

/**
Offset/page result
*/
export interface Page<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
Cursor/keyset result — items are returned ascending either way
*/
export interface CursorPage<T> {
  items: T[]

  /**
  Cursor of the NEXT page in the walk direction (pass it back as
  `after` or `before`); undefined when the walk is exhausted.

  Opaque: a composite of the boundary property value and the boundary
  node's elementId, so rows sharing a property value (bulk writes land
  in the same millisecond) are never skipped between pages. Plain
  scalar values stay accepted as cursors.
  */
  nextCursor: string | number | undefined

  hasMore: boolean
}

/**
Non-paginated `{ items, total }` read (Prisma's findManyAndCount)
*/
export interface ManyAndCount<T> {
  items: T[]
  total: number
}

/**
findManyAndCount() options — they trim the data read only; `total`
always counts the whole filter (Prisma parity)
*/
export interface FindManyAndCountOptions {
  /**
  Order spec, as accepted by all()/get()
  */
  order?: OrderSpec

  /**
  Cap on the items returned (total is unaffected)
  */
  limit?: number

  /**
  Rows to skip before the first returned item (total is unaffected)
  */
  skip?: number

  /**
  Named read filters to disable for this query (NTS-162)
  */
  withoutFilters?: string[]
}

/**
lazy() options — the keyset walk behind cursor pagination
*/
export interface StreamOptions {
  /**
  Page size (default 25)
  */
  limit?: number

  /**
  Property to keyset on (default 'createdAt')
  */
  orderBy?: string

  /**
  Named read filters to disable for this walk (NTS-162)
  */
  withoutFilters?: string[]
}

/**
Cursor walk options with explicit undefineds — chunk()/lazy() forward
optional fields into cursorPage() (CursorPaginateOptions with
exactOptionalPropertyTypes rejects explicit undefined)
*/
interface CursorWalkOptions {
  limit: number
  orderBy?: string | undefined
  after?: string | number | undefined
  before?: string | number | undefined
}

// Property type -> Cypher cast function for cursor comparisons
const TEMPORAL_CASTS: Partial<Record<PropertyType, string>> = {
  [PropertyType.DATE]: 'date',
  [PropertyType.TIME]: 'time',
  [PropertyType.DATETIME]: 'datetime',
  [PropertyType.LOCALTIME]: 'localtime',
  [PropertyType.LOCALDATETIME]: 'localdatetime',
}

/**
The Cypher cast that turns a plain param into the property's temporal type
*/
export function temporalCastFunction(type: PropertyType): string | undefined {
  return TEMPORAL_CASTS[type]
}

/**
A stored property value as a portable cursor: temporal values become ISO
strings (driver instances via toString(), the Relate engine's plain
objects via the shared serialisation — engine temporal objects are not
portable params, so cursors travel as plain values cast in Cypher)
*/
export function toCursorValue(
  value: unknown,
  property: PropertySchema,
): string | number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const json = valueToJson(value, property)

  if (typeof json === 'string' || typeof json === 'number') {
    return json
  }

  // Counts and large integers can surface as bigint
  if (typeof json === 'bigint') {
    return Number(json)
  }

  return undefined
}

function requireLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) {
    throw new NeodeError(`limit must be a positive integer, received ${String(limit)}`)
  }

  return limit
}

/**
Extract the read-filter options from either pagination mode (and the
stream/chunk option bags that share the shape)
*/
function readFilterOptions(options: object): ReadFilterOptions {
  const { withoutFilters } = options as { withoutFilters?: string[] }

  return withoutFilters === undefined ? {} : { withoutFilters }
}

/**
Property-equality filter, the same semantics as get()/all()
*/
function applyFilter(
  builder: Builder,
  schema: EntitySchema,
  filter: Record<string, unknown>,
): void {
  for (const property of schema.getProperties()) {
    const key = property.getKey()

    if (Object.hasOwn(filter, key)) {
      builder.where(`${THIS_NODE}.${key}`, filter[key])
    }
  }
}

/**
Pagination helpers.

Two modes, selected by the options shape:
 - `{ page, limit, order? }` — offset pagination over two autocommit
   reads (data + COUNT), returning { items, total, page, limit, totalPages }
 - `{ limit, orderBy?, after?/before? }` — keyset pagination on a
   temporal property (`WHERE this.createdAt > datetime($cursor)`),
   returning { items, nextCursor, hasMore }
*/
export class PaginateService extends QueryService {
  /**
  Data query + COUNT query, two autocommit reads
  */
  private async offsetPage<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    filter: Record<string, unknown>,
    options: OffsetPaginateOptions,
    limit: number,
    filters?: ReadFilterOptions,
  ): Promise<Page<T>> {
    const page = options.page ?? 1

    if (!Number.isSafeInteger(page) || page < 1) {
      throw new NeodeError(`page must be a positive integer, received ${String(page)}`)
    }

    // Data query — hydrated through the shared eager-aware return path
    const data = new Builder()

    data.match(THIS_NODE, schema.getLabels())
    applyReadFilters(data, schema, filters)
    applyFilter(data, schema, filter)
    applyOrder(data, options.order)

    const items = await this.return<T>(
      constructor,
      schema,
      data,
      (page - 1) * limit,
      limit,
      filters,
    )

    // Count query — a second autocommit read
    const count = new Builder()

    count.match(THIS_NODE, schema.getLabels())
    applyReadFilters(count, schema, filters)
    applyFilter(count, schema, filter)
    count.return(`count(${THIS_NODE}) AS total`)

    const built = count.build()
    const output = await this.runner.run(built.query, built.params)

    const total = Number(output.records[0]?.get('total') ?? 0)

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
  Keyset page: LIMIT limit+1 answers hasMore; the statement is written
  by hand because the builder cannot wrap a parameter in the temporal
  cast (src/query is upstream of this service)
  */
  private async cursorPage<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    filter: Record<string, unknown>,
    options: CursorWalkOptions,
    limit: number,
    filters?: ReadFilterOptions,
  ): Promise<CursorPage<T>> {
    if (options.after !== undefined && options.before !== undefined) {
      throw new NeodeError('paginate accepts either after or before, not both')
    }

    const key = options.orderBy ?? DEFAULT_CURSOR_PROPERTY

    const property = schema.getProperties().find((candidate) => candidate.getKey() === key)

    if (property === undefined) {
      throw new NeodeError(
        `Unknown cursor property "${key}" on ${schema.getLabels().join(':') || 'entity'}`,
      )
    }

    const cast = temporalCastFunction(property.getType())

    // Forward walks after a cursor; backward walks before one. Items
    // come back ascending either way
    const isForward = options.before === undefined

    const cursor = isForward ? options.after : options.before

    const parameters: QueryParameters = {}
    const conditions: string[] = []

    // NTS-162 — the named read filters join the hand-written WHERE (the
    // cursor statement is written by hand, so the fragment path applies)
    const { fragment: filterFragment_, parameters: filterParameters_ } = readFilterFragment(
      schema,
      THIS_NODE,
      filters,
    )

    if (filterFragment_ !== undefined) {
      conditions.push(filterFragment_)

      for (const [name, value] of Object.entries(filterParameters_)) {
        parameters[name] = value
      }
    }

    for (const candidate of schema.getProperties()) {
      const filterKey = candidate.getKey()

      if (!Object.hasOwn(filter, filterKey)) {
        continue
      }

      const parameter = `filter_${filterKey.replaceAll(/[^a-z0-9]+/gi, '_')}`

      parameters[parameter] = filter[filterKey]
      conditions.push(`${THIS_NODE}.${filterKey} = $${parameter}`)
    }

    if (cursor !== undefined) {
      // Composite cursors tie-break on elementId, so keyset pages never
      // skip rows sharing the boundary value; scalar cursors (and raw
      // property values) compare on the property alone
      const { value, id } = parseCursor(cursor)

      const comparison = isForward ? '>' : '<'

      const casted = cast === undefined ? '$cursor' : `${cast}($cursor)`

      parameters['cursor'] = value

      conditions.push(
        id === undefined
          ? `${THIS_NODE}.${key} ${comparison} ${casted}`
          : `(${THIS_NODE}.${key} ${comparison} ${casted} OR (${THIS_NODE}.${key} = ${casted} AND elementId(${THIS_NODE}) ${comparison} $cursorId))`,
      )

      if (id !== undefined) {
        parameters['cursorId'] = id
      }
    }

    // A total order (property, elementId) — equal property values keep a
    // stable walk order
    const query = [
      `MATCH (${THIS_NODE}${labelPattern(schema.getLabels())})`,
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      `ORDER BY ${THIS_NODE}.${key} ${isForward ? 'ASC' : 'DESC'}, elementId(${THIS_NODE}) ${isForward ? 'ASC' : 'DESC'}`,
      // One row over the page size answers hasMore
      `LIMIT ${String(assertCount(limit, 'limit') + 1)}`,
      `RETURN ${THIS_NODE}`,
    ]
      .filter((line) => line.length > 0)
      .join('\n')

    const output = await this.runner.run(query, parameters)

    const hasMore = output.records.length > limit

    const pageRecords = hasMore ? output.records.slice(0, limit) : output.records

    // Backward walks fetch descending; items are returned ascending.
    // (Array#toReversed is outside the ES2022 lib target.)
    const ordered = isForward
      ? pageRecords
      : pageRecords.reduceRight<QueryRecord[]>((records, record) => {
          records.push(record)

          return records
        }, [])

    const items = hydrate<T>(constructor, { records: ordered }, THIS_NODE)

    // The boundary item of the walk: forward, the newest row fetched;
    // backward, the oldest (the first row of the ascending items)
    const boundary = ordered[isForward ? ordered.length - 1 : 0]

    const boundaryNode: unknown = boundary === undefined ? undefined : boundary.get(THIS_NODE)

    const nextCursor =
      hasMore && isGraphNode(boundaryNode)
        ? JSON.stringify([
            toCursorValue(boundaryNode.properties[key], property),
            boundaryNode.elementId,
          ])
        : undefined

    return { items, nextCursor, hasMore }
  }

  /**
  Every keyset page of a walk, one autocommit read per page — the shared
  walk behind chunk() and lazy(). One page of rows is held at a time, so
  memory stays flat on large reads; an early for-await break finalises
  the generator with nothing left open (no session spans pages).
  */
  private async *pages<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    filter: Record<string, unknown>,
    limit: number,
    orderBy?: string,
    filters?: ReadFilterOptions,
  ): AsyncGenerator<T[]> {
    let after: string | number | undefined
    let hasMore = true

    while (hasMore) {
      const page = await this.cursorPage<T>(
        constructor,
        schema,
        filter,
        { limit, orderBy, after },
        limit,
        filters,
      )

      // A dropped boundary node leaves the cursor undefined (hydrate
      // filters non-node rows) — stop the walk rather than restart it
      hasMore = page.hasMore && page.nextCursor !== undefined
      after = page.nextCursor

      yield page.items
    }
  }

  async paginate<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    filter: Record<string, unknown> = {},
    options: PaginateOptions,
  ): Promise<Page<T> | CursorPage<T>> {
    const limit = requireLimit((options as { limit?: unknown }).limit)

    const filters = readFilterOptions(options)

    if ('page' in options) {
      if ('after' in options || 'before' in options) {
        throw new NeodeError('paginate accepts either page or after/before, not both')
      }

      return this.offsetPage<T>(constructor, schema, filter, options, limit, filters)
    }

    return this.cursorPage<T>(constructor, schema, filter, options, limit, filters)
  }

  /**
  Non-paginated read (NTS-166): every entity matching the filter plus
  its total in one call — one data read + one COUNT read. paginate()'s
  offset mode covers page reads ({ page, limit }); this is the
  non-paginated variant. Options trim the data read only.
  */
  async findManyAndCount<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    filter: Record<string, unknown> = {},
    options: FindManyAndCountOptions = {},
  ): Promise<ManyAndCount<T>> {
    const data = new Builder()

    data.match(THIS_NODE, schema.getLabels())
    applyReadFilters(data, schema, options)
    applyFilter(data, schema, filter)

    if (options.order !== undefined) {
      applyOrder(data, options.order)
    }

    const items = await this.return<T>(
      constructor,
      schema,
      data,
      options.skip,
      options.limit,
      options,
    )

    const count = new Builder()

    count.match(THIS_NODE, schema.getLabels())
    applyReadFilters(count, schema, options)
    applyFilter(count, schema, filter)
    count.return(`count(${THIS_NODE}) AS total`)

    const built = count.build()
    const output = await this.runner.run(built.query, built.params)

    return { items, total: Number(output.records[0]?.get('total') ?? 0) }
  }

  /**
  Walk a large read in chunks (NTS-166): `callback` receives every page
  of `size` items in keyset order; return false from the callback to
  stop early. Resolves to the number of items delivered.
  */
  async chunk<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    filter: Record<string, unknown>,
    size: number,
    callback: (items: T[]) => unknown,
    options: { orderBy?: string; withoutFilters?: string[] | undefined } = {},
  ): Promise<number> {
    const limit = requireLimit(size)

    let delivered = 0

    const walk = this.pages<T>(
      constructor,
      schema,
      filter,
      limit,
      options.orderBy,
      readFilterOptions(options),
    )

    for await (const items of walk) {
      delivered += items.length

      if (callback(items) === false) {
        break
      }
    }

    return delivered
  }

  /**
  Async iterator over a large read (NTS-166), paging by keyset under the
  hood so memory stays flat at one page. Breaking out of the for-await
  loop stops the walk cleanly — each page is its own autocommit read, so
  no session is left open.
  */
  async *lazy<T>(
    constructor: new (...arguments_: never[]) => T,
    schema: EntitySchema,
    filter: Record<string, unknown> = {},
    options: StreamOptions = {},
  ): AsyncGenerator<T> {
    const limit = requireLimit(options.limit ?? DEFAULT_LAZY_LIMIT)

    const walk = this.pages<T>(
      constructor,
      schema,
      filter,
      limit,
      options.orderBy,
      readFilterOptions(options),
    )

    for await (const items of walk) {
      for (const item of items) {
        yield item
      }
    }
  }
}

/**
Split a cursor into its compared value and tie-break elementId: a
composite cursor is the JSON array `[value, elementId]`; anything else is
the scalar value itself (raw property values stay accepted).
*/
function parseCursor(cursor: string | number): { value: string | number; id?: string } {
  if (typeof cursor === 'string' && cursor.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(cursor)

      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        (typeof parsed[0] === 'string' || typeof parsed[0] === 'number') &&
        typeof parsed[1] === 'string'
      ) {
        return { value: parsed[0], id: parsed[1] }
      }
    } catch {
      // Not a composite cursor — fall through and compare as a scalar
    }
  }

  return { value: cursor }
}
