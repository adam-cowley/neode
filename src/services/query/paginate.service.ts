import { Builder } from '../../query/index.js'
import { assertCount, propertyReference } from '../../query/quote.js'
import { THIS_NODE } from '../../constants.js'
import type { QueryParams as QueryParameters, QueryRecord } from '../../driver/types.js'
import { valueToJson } from '../../serialise.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { PropertySchema } from '../../meta/property-schema.js'
import { PropertyType } from '../../meta/property-schema.js'
import { QueryService } from './query.service.js'
import { applyOrder, type OrderSpec } from './get.service.js'
import { requireLimit } from './limits.js'
import { NeodeError } from '../../errors/index.js'
import { labelPattern } from './bulk.service.js'
import { isGraphNode, isRecord } from '../type-guards.js'
import { EAGER_ID } from '../../query/eager-utilities.js'
import { applyReadFilters, readFilterFragment, type ReadFilterOptions } from './filters.js'
import { applyFilterBag, isFilterMap } from './filter-bag.js'
import { shapeNodeRows } from './shape.js'

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

/**
Extract the read-filter options from either pagination mode (and the
stream/chunk option bags that share the shape)
*/
function readFilterOptions(options: object): ReadFilterOptions {
  const { withoutFilters } = options as { withoutFilters?: string[] }

  return withoutFilters === undefined ? {} : { withoutFilters }
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
    applyFilterBag(data, schema, filter)
    applyOrder(data, options.order)

    // NTS-592 — SKIP/LIMIT pages need a total order or rows shift between
    // reads and pages overlap or skip. The caller's order stays first;
    // the unique elementId is appended as the tiebreaker (and is the
    // whole order when none was given)
    data.orderBy(`elementId(${THIS_NODE})`)

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
    applyFilterBag(count, schema, filter)
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

      // NTS-646 — the keyset statement is hand-written (the builder cannot
      // wrap a parameter in the temporal cast), so the operator tier has no
      // rendering here: an operator object is rejected instead of binding a
      // plain map as an equality parameter (which would match nothing)
      if (isFilterMap(filter[filterKey])) {
        throw new NeodeError(
          `Operator filters are not supported on keyset pagination (paginate with after/before, lazy, chunk): property "${filterKey}" carries an operator object, but this statement is written by hand — filter on it with offset pagination (the page option) or a Builder instead`,
        )
      }

      const parameter = `filter_${filterKey.replaceAll(/[^a-z0-9]+/gi, '_')}`

      parameters[parameter] = filter[filterKey]
      conditions.push(`${propertyReference(THIS_NODE, filterKey)} = $${parameter}`)
    }

    // NTS-592 — a null key never matches a keyset comparison (NULL > x is
    // null) and a null boundary cannot form a cursor, so rows with a null
    // key are excluded deterministically: a walk covers every row with a
    // set key exactly once instead of silently stopping mid-data or
    // comparing against datetime(null)
    conditions.push(`${propertyReference(THIS_NODE, key)} IS NOT NULL`)

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
          ? `${propertyReference(THIS_NODE, key)} ${comparison} ${casted}`
          : `(${propertyReference(THIS_NODE, key)} ${comparison} ${casted} OR (${propertyReference(THIS_NODE, key)} = ${casted} AND elementId(${THIS_NODE}) ${comparison} $cursorId))`,
      )

      if (id !== undefined) {
        parameters['cursorId'] = id
      }
    }

    // A total order (property, elementId) — equal property values keep a
    // stable walk order

    // NTS-592 — cursor mode returns through the same eager-aware RETURN
    // fragment as offset mode (QueryService.returnFragment), so eager
    // relationships load identically in both. The comprehension's filter
    // parameters bind onto a scratch builder and merge into the
    // hand-written statement's parameters.
    const scratch = new Builder()

    const returnFragment = this.returnFragment(schema, scratch, filters)

    for (const [name, value] of Object.entries(scratch.build().params)) {
      parameters[name] = value
    }

    const query = [
      `MATCH (${THIS_NODE}${labelPattern(schema.getLabels())})`,
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      `ORDER BY ${propertyReference(THIS_NODE, key)} ${isForward ? 'ASC' : 'DESC'}, elementId(${THIS_NODE}) ${isForward ? 'ASC' : 'DESC'}`,
      // One row over the page size answers hasMore
      `LIMIT ${String(assertCount(limit, 'limit') + 1)}`,
      `RETURN ${returnFragment}`,
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

    // Shaped through the one result-shaping layer (NTS-566): the root
    // column is the eager projection map when the schema declares eager
    // relationships, a plain node otherwise
    const items = shapeNodeRows<T>(ordered, schema, constructor, THIS_NODE)

    // The boundary item of the walk: forward, the newest row fetched;
    // backward, the oldest (the first row of the ascending items)
    const boundary = ordered[isForward ? ordered.length - 1 : 0]

    const { value: boundaryValue, id: boundaryId } =
      boundary === undefined
        ? { value: undefined, id: undefined }
        : boundaryCursor(boundary.get(THIS_NODE), key)

    const cursorValue = toCursorValue(boundaryValue, property)

    // A boundary whose key cannot travel as a cursor (null, or a value
    // the serialiser cannot carry) ends the walk — never a cursor that
    // compares against datetime(null) (NTS-592)
    const nextCursor =
      hasMore && cursorValue !== undefined && boundaryId !== undefined
        ? JSON.stringify([cursorValue, boundaryId])
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
    applyFilterBag(data, schema, filter)

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
    applyFilterBag(count, schema, filter)
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
Read the cursor key property and elementId off a boundary row's node
column — a plain GraphNode or the eager projection map (both shapes
shapeNodeRows hydrates, NTS-592 cursor/offset RETURN parity). Undefined
on either side means the page cannot form a cursor.
*/
function boundaryCursor(node: unknown, key: string): { value: unknown; id: string | undefined } {
  if (isGraphNode(node)) {
    return { value: node.properties[key], id: node.elementId }
  }

  if (isRecord(node) && Object.hasOwn(node, EAGER_ID)) {
    const id: unknown = node[EAGER_ID]

    return { value: node[key], id: typeof id === 'string' ? id : undefined }
  }

  return { value: undefined, id: undefined }
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
