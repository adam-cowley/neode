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
import { errorBody, listFilter, restModelNames, statusFor } from '../../src/rest/index.js'

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
