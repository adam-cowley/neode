/**
Integration test for the neode/express router (NTS-664): full CRUD over
the model definitions through supertest, against the embedded engine.
*/
import express, { type Express } from 'express'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { defineModel } from '../../src'
import { NodeEntity, String, Number, Property, Uuid } from '../../src/decorators'
import type { ExpressRouterOptions } from '../../src/express/index.js'
import { router } from '../../src/express/index.js'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class RestPerson {
  @Uuid({ primary: true })
  id!: string

  @String()
  name!: string

  @Number()
  age!: number

  @String({ unique: true })
  email!: string
}

@NodeEntity()
class RestGauge {
  @Property({ type: 'number', primary: true })
  id!: number

  @String()
  name!: string
}

// Map-defined model: the router mounts the shared registry, whatever
// API registered it
defineModel('RestMapItem', {
  id: { type: 'string', primary: true },
  name: 'string',
})

// ---------------------------------------------------------------------------

function appFor(backend: TestBackend, options?: ExpressRouterOptions): Express {
  const app = express()

  app.use(express.json())
  app.use('/api', router(backend.neode, options))

  return app
}

describe('rest router', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    if (backend.capabilities.constraints) {
      await backend.neode.installSchema()
    }
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('describes the mounted models at the router root', async () => {
    const response = await request(appFor(backend)).get('/api')

    expect(response.status).toBe(200)
    expect(response.body.entities.map((entity: { name: string }) => entity.name)).toContain(
      'RestPerson',
    )
  })

  it('creates an entity through POST', async () => {
    const response = await request(appFor(backend))
      .post('/api/RestPerson')
      .send({ name: 'Adam', age: 30, email: `adam-${Date.now()}@example.com` })

    expect(response.status).toBe(201)
    expect(response.body.name).toBe('Adam')
    expect(response.body.age).toBe(30)
    expect(response.body.id).toBeDefined()
  })

  it('returns validation failures as 422 with details', async () => {
    const response = await request(appFor(backend))
      .post('/api/RestPerson')
      .send({ name: 'Adam', age: 'not-a-number' })

    expect(response.status).toBe(422)
    expect(response.body.error).toBe('ValidationError')
    expect(response.body.issues.length).toBeGreaterThan(0)
  })

  it('reads one entity by primary key', async () => {
    const created = await backend.neode.create(RestPerson, {
      name: 'Adam',
      age: 30,
    })

    const found = await request(appFor(backend)).get(`/api/RestPerson/${created.id}`)

    expect(found.status).toBe(200)
    expect(found.body.name).toBe('Adam')
  })

  it('404s an unknown id without leaking the registry', async () => {
    const response = await request(appFor(backend)).get('/api/RestPerson/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('NotFound')
  })

  it('404s an unknown model path as JSON', async () => {
    const response = await request(appFor(backend)).get('/api/NotAModel')

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('NotFound')
    expect(JSON.stringify(response.body)).not.toContain('RestPerson')
  })

  it('lists with pagination, filters and ordering', async () => {
    const app = appFor(backend)

    await request(app).post('/api/RestPerson').send({ name: 'Adam', age: 30 })
    await request(app).post('/api/RestPerson').send({ name: 'Bea', age: 42 })

    const all = await request(app).get('/api/RestPerson')

    expect(all.status).toBe(200)
    expect(all.body.total).toBe(2)
    expect(all.body.items).toHaveLength(2)
    expect(all.body.page).toBe(1)

    const filtered = await request(app).get('/api/RestPerson?name=Adam&age=30')
    expect(filtered.body.total).toBe(1)
    expect(filtered.body.items[0].name).toBe('Adam')

    const ordered = await request(app).get('/api/RestPerson?order=age&sort=DESC')
    expect(ordered.body.items[0].name).toBe('Bea')

    // lowercase sorts the same way — not the opposite direction
    const lowercase = await request(app).get('/api/RestPerson?order=age&sort=desc')
    expect(lowercase.body.items[0].name).toBe('Bea')

    const capped = await request(app).get('/api/RestPerson?limit=100000')
    expect(capped.body.limit).toBe(100)

    const paged = await request(app).get('/api/RestPerson?page=2&limit=1')
    expect(paged.body.items).toHaveLength(1)
    expect(paged.body.totalPages).toBe(2)
  })

  it('treats a hostile query string as data, never as Cypher or options (NTS-675)', async () => {
    const app = appFor(backend)

    await request(app).post('/api/RestPerson').send({ name: 'Adam', age: 30 })

    // Unknown filter keys dropped, the order key quoted downstream,
    // withoutFilters never reaches the read options
    const hostile = await request(app).get(
      '/api/RestPerson?order=name} DETACH DELETE x //&hacker=DROP ALL&withoutFilters=*',
    )

    expect(hostile.status).toBe(200)
    expect(hostile.body.total).toBe(1)

    // a negative page fails closed (400), it does not reach the database
    const negative = await request(app).get('/api/RestPerson?page=-1&limit=1')

    expect(negative.status).toBe(400)
  })

  it('updates through PATCH', async () => {
    const app = appFor(backend)

    const created = await request(app).post('/api/RestPerson').send({ name: 'Adam', age: 30 })
    const updated = await request(app).patch(`/api/RestPerson/${created.body.id}`).send({ age: 31 })

    expect(updated.status).toBe(200)
    expect(updated.body.age).toBe(31)
    expect(updated.body.name).toBe('Adam')
  })

  it('deletes through DELETE', async () => {
    const app = appFor(backend)

    const created = await request(app).post('/api/RestPerson').send({ name: 'Adam', age: 30 })
    const deleted = await request(app).delete(`/api/RestPerson/${created.body.id}`)

    expect(deleted.status).toBe(204)

    const gone = await request(app).get(`/api/RestPerson/${created.body.id}`)
    expect(gone.status).toBe(404)
  })

  it('mounts map-defined models from the shared registry', async () => {
    const response = await request(appFor(backend))
      .post('/api/RestMapItem')
      .send({ id: 'item-1', name: 'Thing' })

    expect(response.status).toBe(201)
    expect(response.body.name).toBe('Thing')
  })

  it('runs the pass-through middleware before the routes', async () => {
    const app = appFor(backend, {
      models: ['RestPerson'],
      // A middleware that responds ends the chain — it must not call next
      middleware: [
        (_request, response) => {
          response.status(401).json({ error: 'Unauthorized' })
        },
      ],
    })

    const response = await request(app).get('/api/RestPerson')

    expect(response.status).toBe(401)
  })

  it('mounts a subset when models is given', async () => {
    const app = appFor(backend, { models: ['RestPerson'] })

    const mounted = await request(app).get('/api/RestPerson')
    expect(mounted.status).toBe(200)

    const notMounted = await request(app).get('/api/RestMapItem')
    expect(notMounted.status).toBe(404)
  })

  it('matches numeric primary keys through the string path id', async () => {
    const app = appFor(backend)

    const created = await request(app).post('/api/RestGauge').send({ id: 7, name: 'gauge' })
    expect(created.status).toBe(201)

    const read = await request(app).get('/api/RestGauge/7')
    expect(read.status).toBe(200)
    expect(read.body.name).toBe('gauge')

    const removed = await request(app).delete('/api/RestGauge/7')
    expect(removed.status).toBe(204)
  })

  it('reports a unique-conflict as 409', async () => {
    if (!backend.capabilities.constraints) {
      return
    }

    const app = appFor(backend)
    const email = `conflict-${Date.now()}@example.com`

    const first = await request(app).post('/api/RestPerson').send({ name: 'Adam', age: 30, email })
    expect(first.status).toBe(201)

    const second = await request(app).post('/api/RestPerson').send({ name: 'Bea', age: 42, email })

    expect(second.status).toBe(409)
    expect(second.body.error).toBe('ConstraintViolationError')
  })
})
