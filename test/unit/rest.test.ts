/**
Unit tests for the framework-neutral REST handlers (NTS-664): error
mapping and list-filter building. Handler behaviour over a live
database is covered in test/integration/rest-router.test.ts.
*/
import { describe, expect, it } from 'vitest'

import { NodeEntity, String, Number, Property } from '../../src/decorators'
import { getModel } from '../../src/meta/index.js'
import { NeodeError } from '../../src/errors/index.js'
import { ConstraintViolationError } from '../../src/errors/constraint-violation.js'
import { OptimisticLockError } from '../../src/errors/optimistic-lock.js'
import { ValidationError } from '../../src/validation/validation-error.js'
import {
  errorBody,
  handleList,
  handleOntology,
  listFilter,
  restModelNames,
  statusFor,
} from '../../src/rest/index.js'

@NodeEntity()
class RestUnitPerson {
  @Property({ type: 'uuid', primary: true })
  id!: string

  @String()
  name!: string

  @Number()
  age!: number
}

const validationError = new ValidationError(
  [{ message: 'bad value', path: ['age'], type: 'number.invalid' }],
  { age: 'x' },
)

describe('statusFor', () => {
  it('maps the typed taxonomy onto HTTP statuses', () => {
    expect(statusFor(validationError)).toBe(422)
    expect(statusFor(new ConstraintViolationError('duplicate', 'Person', 'email'))).toBe(409)
    expect(statusFor(new OptimisticLockError('Person'))).toBe(409)
    expect(statusFor(new NeodeError('bad request shape'))).toBe(400)
    expect(statusFor(new Error('exploded'))).toBe(500)
    expect(statusFor(undefined)).toBe(500)
  })
})

describe('errorBody', () => {
  it('carries the error name and message', () => {
    expect(errorBody(new NeodeError('nope'))).toEqual({
      error: 'NeodeError',
      message: 'nope',
    })
  })

  it('carries the validation details', () => {
    const body = errorBody(validationError)

    expect(body.error).toBe('ValidationError')
    expect(body.details).toHaveLength(1)
  })
})

describe('listFilter', () => {
  const schema = getModel(RestUnitPerson)

  it('drops reserved and unknown query keys', () => {
    const filter = listFilter(schema, {
      page: '2',
      limit: '10',
      order: 'name',
      sort: 'DESC',
      name: 'Adam',
      hacker: 'DROP ALL',
    })

    expect(filter).toEqual({ name: 'Adam' })
  })

  it('converts numeric strings for numeric properties', () => {
    expect(listFilter(schema, { age: '30' })).toEqual({ age: 30 })
    expect(listFilter(schema, { age: 'thirty' })).toEqual({ age: 'thirty' })
    expect(listFilter(schema, { name: '30' })).toEqual({ name: '30' })
  })
})

describe('handleOntology', () => {
  it('indexes only the mounted models', () => {
    const body = handleOntology(['RestUnitPerson']).body as {
      entities: { name: string }[]
    }

    expect(body.entities.map((entity) => entity.name)).toEqual(['RestUnitPerson'])
  })
})

describe('restModelNames', () => {
  it('mounts every registered node model by name', () => {
    expect(restModelNames()).toContain('RestUnitPerson')
  })

  it('mounts the requested subset, deduplicated', () => {
    expect(restModelNames(['RestUnitPerson', 'RestUnitPerson'])).toEqual(['RestUnitPerson'])
  })

  it('names the registered models when a subset name is unknown', () => {
    expect(() => restModelNames(['NotAModel'])).toThrow(NeodeError)
    expect(() => restModelNames(['NotAModel'])).toThrow(/RestUnitPerson/)
  })
})

describe('handleList — query string to filter/order mapping (NTS-675)', () => {
  const schema = getModel(RestUnitPerson)

  type Captured = {
    filter: Record<string, unknown>
    options: Record<string, unknown>
  }

  const list = async (query: Record<string, string>): Promise<Captured> => {
    const captured: Captured = { filter: {}, options: {} }

    const neode = {
      paginate: (
        _constructor: unknown,
        filter: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        captured.filter = filter
        captured.options = options

        return Promise.resolve({ items: [], total: 0, page: 1, limit: 25, totalPages: 0 })
      },
    }

    await handleList(neode as never, RestUnitPerson, query)

    return captured
  }

  it('maps query keys onto the filter bag and never passes read options', async () => {
    const { filter, options } = await list({
      name: 'Adam',
      age: '30',
      // hostile / reserved keys: unknown ones are dropped as filters, and
      // nothing on the query string can reach the options bag (read
      // filters, withoutFilters included) — listFilter only mirrors
      // DECLARED property keys into the filter
      hacker: 'DROP ALL',
      withoutFilters: '*',
    })

    expect(filter).toEqual({ name: 'Adam', age: 30 })
    expect(Object.hasOwn(options, 'withoutFilters')).toBe(false)
  })

  it('maps order/sort onto an OrderSpec (quoted downstream) and clamps limit', async () => {
    const hostile = 'name} DETACH DELETE x //'
    const captured = await list({ order: hostile, sort: 'desc', limit: '100000' })

    // the hostile key travels as DATA (an OrderSpec key, which orderTerms
    // backtick-quotes — see the identifier-injection suite), never
    // interpolated into a statement here
    expect(captured.options['order']).toEqual({ [hostile]: 'DESC' })
    expect(captured.options['limit']).toBe(100)
  })

  it('defaults sort to ASC and a broken page to 1', async () => {
    const captured = await list({ order: 'name', sort: 'NOT A DIRECTION', page: 'not-a-number' })

    expect(captured.options['order']).toEqual({ name: 'ASC' })
    expect(captured.options['page']).toBe(1)
  })
})
