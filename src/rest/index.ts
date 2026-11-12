/**
Framework-neutral REST handlers over the model definitions (NTS-664).

Every handler parses plain inputs (query record, path id, body) and
resolves to a `{ status, body }` — no HTTP framework is imported here.
`src/express/index.ts` adapts the Express request/response pair onto
them; a future `neode/fastify` reuses the same handlers.

All behaviour (validation, read filters, soft delete, serialization)
is inherited from the facade — nothing here writes Cypher or checks
properties itself.
*/

import { getModels, getModel } from '../meta/index.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { EntityType } from '../meta/entity/entity-schema.js'
import { PropertyType } from '../meta/property-schema.js'
import type { Newable } from '../meta/newable.js'
import { ontology } from '../meta/ontology.js'
import { NeodeError } from '../errors/index.js'
import { ConstraintViolationError } from '../errors/constraint-violation.js'
import { OptimisticLockError } from '../errors/optimistic-lock.js'
import { ValidationError } from '../validation/validation-error.js'
import { toJson } from '../serialise.js'
import { isRecord } from '../services/type-guards.js'
import type { Neode } from '../neode.service.js'

/**
Query keys the list endpoint consumes itself — everything else is an
equality filter against a declared property
*/
const RESERVED_QUERY_KEYS = new Set(['page', 'limit', 'order', 'sort'])

/**
Property types a query-string value can be parsed into a number for
*/
const NUMERIC_PROPERTY_TYPES = new Set<PropertyType>([
  PropertyType.INTEGER,
  PropertyType.FLOAT,
  PropertyType.NUMBER,
])

/**
A decimal number as a query string would render it
*/
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/

/**
The HTTP status an error maps to
*/
export function statusFor(error: unknown): number {
  if (error instanceof ValidationError) {
    return 422
  }

  if (error instanceof ConstraintViolationError || error instanceof OptimisticLockError) {
    return 409
  }

  if (error instanceof NeodeError) {
    return 400
  }

  return 500
}

/**
The JSON body for a failed request
*/
export function errorBody(error: unknown): Record<string, unknown> {
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message : String(error)

  return error instanceof ValidationError
    ? { error: name, message, details: error.details }
    : { error: name, message }
}

/**
Equality filters for the list endpoint: query keys matching DECLARED
properties pass through as parameters — unknown keys are dropped (they
must not reach Cypher), and numeric strings convert for numeric
properties so `?age=30` matches what the database stores.
*/
export function listFilter(
  schema: EntitySchema,
  query: Record<string, string | number>,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(query)) {
    const property = RESERVED_QUERY_KEYS.has(key)
      ? undefined
      : schema.getProperties().find((candidate) => candidate.getKey() === key)

    if (property === undefined) {
      continue
    }

    filter[key] = coerceNumeric(property.getType(), value)
  }

  return filter
}

/**
Numeric properties read from a query string arrive as strings — convert
the ones the property type can absorb, pass everything else through
*/
function coerceNumeric(type: PropertyType, value: string | number): string | number {
  if (typeof value !== 'string' || !NUMERIC_PATTERN.test(value)) {
    return value
  }

  return NUMERIC_PROPERTY_TYPES.has(type) ? Number(value) : value
}

/**
The registered node models keyed by name (constructor name — the same
name ontology() reports). Relationship-entity models are not exposed:
the node CRUD paths do not apply to edges.
*/
export function nodeModels(): Map<string, Newable> {
  const models = new Map<string, Newable>()

  for (const [constructor, schema] of getModels()) {
    if (schema.getType() === EntityType.RelationshipEntity) {
      continue
    }

    models.set(constructor.name, constructor)
  }

  return models
}

/**
The names the router mounts — every registered node model, or the
requested subset. An unknown subset name fails loudly at mount time:
a typo'd model name should not silently route 404s.
*/
export function restModelNames(subset?: string[]): string[] {
  const models = nodeModels()

  // Array.from with a map function — the only iterable-to-array spelling
  // both unicorn/prefer-spread and unicorn/prefer-iterator-to-array accept
  // at this lib level
  const names = Array.from(models.keys(), (name) => name)

  if (subset === undefined) {
    return names
  }

  for (const name of subset) {
    if (!models.has(name)) {
      throw new NeodeError(
        `Model "${name}" is not registered — cannot mount REST routes. ` +
          `Registered models: ${names.join(', ') || '(none)'}. ` +
          'Import the model file, or define it with defineModel(), before mounting the router.',
      )
    }
  }

  return [...new Set(subset)]
}

/**
The constructor for a URL model segment, or undefined when unknown —
the adapter turns undefined into a 404 (unknown models must not leak
the registry).
*/
export function modelByName(name: string): Newable | undefined {
  return nodeModels().get(name)
}

/**
A resolved handler result
*/
export interface RestResponse {
  status: number
  body?: unknown
}

function notFound(): RestResponse {
  return { status: 404, body: { error: 'NotFound', message: 'No entity matched the given id' } }
}

function found(entity: unknown): RestResponse {
  return entity === undefined || entity === null
    ? notFound()
    : { status: 200, body: toJson(entity) }
}

/**
`GET /:model` — paginate(model, filter, { page, limit, order })
*/
export async function handleList(
  neode: Neode,
  constructor: Newable,
  query: Record<string, string | number>,
): Promise<RestResponse> {
  const schema = getModel(constructor)

  const page = query['page'] === undefined ? 1 : Number(query['page'])
  const limit = query['limit'] === undefined ? 25 : Number(query['limit'])
  const order =
    query['order'] === undefined
      ? undefined
      : {
          [String(query['order'])]: query['sort'] === 'DESC' ? ('DESC' as const) : ('ASC' as const),
        }

  // page is always resolved: paginate() selects its mode by the presence
  // of the `page` key — a bag without it means keyset pagination, which
  // the list endpoint does not offer
  const result = await neode.paginate(constructor, listFilter(schema, query), {
    page: Number.isNaN(page) ? 1 : page,
    limit: Number.isNaN(limit) ? 25 : limit,
    ...(order !== undefined && { order }),
  })

  return {
    status: 200,
    body: { ...result, items: result.items.map((item) => toJson(item)) },
  }
}

/**
`GET /:model/:id` — find(model, id) on the primary key
*/
export async function handleGet(
  neode: Neode,
  constructor: Newable,
  id: string,
): Promise<RestResponse> {
  return found(await neode.find(constructor, id))
}

/**
`POST /:model` — create(model, body)
*/
export async function handleCreate(
  neode: Neode,
  constructor: Newable,
  body: unknown,
): Promise<RestResponse> {
  const created = await neode.create(constructor, asRecord(body, 'create'))

  return { status: 201, body: toJson(created) }
}

/**
`PATCH /:model/:id` — find, then update(entity, body)
*/
export async function handleUpdate(
  neode: Neode,
  constructor: Newable,
  id: string,
  body: unknown,
): Promise<RestResponse> {
  const entity = await neode.find(constructor, id)

  if (!isRecord(entity)) {
    return notFound()
  }

  await neode.update(entity, asRecord(body, 'update'))

  return found(await neode.find(constructor, id))
}

/**
`DELETE /:model/:id` — find, then delete(entity)
*/
export async function handleDelete(
  neode: Neode,
  constructor: Newable,
  id: string,
): Promise<RestResponse> {
  const entity = await neode.find(constructor, id)

  if (!isRecord(entity)) {
    return notFound()
  }

  await neode.delete(entity)

  return { status: 204 }
}

/**
`GET /` — the ontology over every registered model: the self-describing
index of what the router mounts
*/
export function handleOntology(): RestResponse {
  return { status: 200, body: ontology() }
}

function asRecord(body: unknown, verb: string): Record<string, unknown> {
  if (body === undefined || body === null) {
    return {}
  }

  if (!isRecord(body)) {
    throw new ValidationError(
      [{ message: `Expected a JSON object to ${verb}`, path: [], type: 'object.base' }],
      {},
    )
  }

  return body
}
