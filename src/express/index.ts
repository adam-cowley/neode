/**
`neode/express` — mount the model definitions as a REST API (NTS-664):

    import express from 'express'
    import { router } from 'neode/express'

    const app = express()
    app.use(express.json())
    app.use('/api', router(neode))

Writes trust whatever middleware is mounted in front of the router —
an unauthenticated mount is an open write API. Bodies come from the
consumer's body parser; this router adds none.

A Router is the only Express type touched here: the handlers live
framework-neutral in src/rest, so a future neode/fastify reuses them.
*/
import { Router, type Request, type RequestHandler, type Response } from 'express'

import type { Neode } from '../neode.service.js'
import {
  errorBody,
  handleCreate,
  handleDelete,
  handleGet,
  handleList,
  handleOntology,
  handleUpdate,
  modelByName,
  restModelNames,
  statusFor,
} from '../rest/index.js'

/**
- `models` — mount only these model names (default: every registered
  node model). Unknown names throw at mount time.
- `middleware` — pass-through hook (auth, tenancy resolution, …)
  mounted before every generated route.
*/
export interface ExpressRouterOptions {
  models?: string[]
  middleware?: RequestHandler[]
}

/**
A resolved handler result
*/
interface RestResult {
  status: number
  body?: unknown
}

/**
Await one handler's promise and map its result — or its error — onto
the response, inside the handler's own try/catch so rejection handling
works on Express 4 too (Express 5 catches async handlers itself).
*/
async function respond(response: Response, result: Promise<RestResult>): Promise<void> {
  try {
    const { status, body } = await result

    if (body === undefined) {
      response.status(status).end()
    } else {
      response.status(status).json(body)
    }
  } catch (error: unknown) {
    response.status(statusFor(error)).json(errorBody(error))
  }
}

/**
Query parameters as a plain record — one level deep, primitives only
(ParsedQs nests objects; a nested value is not an equality filter).
*/
function queryOf(request: Request): Record<string, string | number> {
  const query: Record<string, string | number> = {}

  for (const [key, value] of Object.entries(request.query)) {
    if (typeof value === 'string' || typeof value === 'number') {
      query[key] = value
    }
  }

  return query
}

/**
The request body as passed by the consumer's body parser — `any` in
the Express types, `unknown` from here on (the handlers validate it).
*/
function bodyOf(request: Request): unknown {
  return request.body
}

/**
404 for a model path that is not mounted — the registry is not leaked.
*/
function modelNotFound(response: Response, name: string): void {
  response.status(404).json({ error: 'NotFound', message: `No model is mounted at "${name}"` })
}

/**
A request handler for a collection route (list / create). The model
lookup happens per request, so models registered after the router was
mounted are served too.
*/
function collectionRoute(neode: Neode, name: string, operation: 'list' | 'create'): RequestHandler {
  return async (request, response) => {
    const constructor = modelByName(name)

    if (constructor === undefined) {
      modelNotFound(response, name)

      return
    }

    await respond(
      response,
      operation === 'list'
        ? handleList(neode, constructor, queryOf(request))
        : handleCreate(neode, constructor, bodyOf(request)),
    )
  }
}

/**
A request handler for an entity route (get / update / delete): resolves
the model AND the :id path parameter per request.
*/
function idRoute(
  neode: Neode,
  name: string,
  operation: 'get' | 'update' | 'delete',
): RequestHandler {
  return async (request, response) => {
    const constructor = modelByName(name)

    if (constructor === undefined) {
      modelNotFound(response, name)

      return
    }

    const id = request.params['id']

    if (typeof id !== 'string') {
      response.status(404).json({ error: 'NotFound', message: 'No route matches this path' })

      return
    }

    switch (operation) {
      case 'get': {
        await respond(response, handleGet(neode, constructor, id))

        return
      }

      case 'update': {
        await respond(response, handleUpdate(neode, constructor, id, bodyOf(request)))

        return
      }

      case 'delete': {
        await respond(response, handleDelete(neode, constructor, id))
      }
    }
  }
}

/**
Build an Express router mounting CRUD routes for every registered node
model (or the `models` subset):

- `GET /` — the ontology (self-describing index)
- `GET /:model` — paginated list (`page`, `limit`, `order`, `sort`,
  plus equality filters on declared properties)
- `GET /:model/:id` — by primary key
- `POST /:model` — create (201)
- `PATCH /:model/:id` — update
- `DELETE /:model/:id` — delete (204)
*/
export function router(neode: Neode, options: ExpressRouterOptions = {}): Router {
  const rest = Router()

  if (options.middleware !== undefined && options.middleware.length > 0) {
    rest.use(...options.middleware)
  }

  const names = restModelNames(options.models)

  // The ontology never throws and always carries a body — respond()
  // would only add an await of an already-resolved value
  rest.get('/', (_request, response) => {
    response.status(200).json(handleOntology(names).body)
  })

  for (const name of names) {
    rest.get(`/${name}`, collectionRoute(neode, name, 'list'))

    rest.post(`/${name}`, collectionRoute(neode, name, 'create'))

    rest.get(`/${name}/:id`, idRoute(neode, name, 'get'))

    rest.patch(`/${name}/:id`, idRoute(neode, name, 'update'))

    rest.delete(`/${name}/:id`, idRoute(neode, name, 'delete'))
  }

  // Everything else under the mount: a JSON 404 — the API never falls
  // through to Express's HTML error page
  rest.use((_request, response) => {
    response.status(404).json({ error: 'NotFound', message: 'No route matches this path' })
  })

  return rest
}
