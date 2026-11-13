/**
Type-level tests for NTS-493 — the type-surface gaps surfaced by the
migration-guide snippet verification: run with `pnpm test:types` (vitest
typecheck mode) — no runtime assertions here.

1. ValidationError / TransactionError are exported from the package root,
   so `catch` blocks can discriminate with `instanceof`.
2. Map-schema property definitions accept the validation rule keys the
   rule table implements (min/max/required/…), with type errors for
   unknown keys.
3. The documented @EntityRepository subclass pattern type-checks under
   strict tsc (Repository's construct signature is RepositoryConstructor-
   compatible).
*/
import { describe, expectTypeOf, it } from 'vitest'
import { EntityRepository, NodeEntity, Property } from '../../src/decorators/index.js'
import { Repository } from '../../src/repository/index.js'
import {
  type BatchStatementError,
  NeodeError,
  type RepositoryConstructor,
  TransactionError,
  ValidationError,
  defineModel,
  type SchemaDefinition,
  type ValidationIssue,
} from '../../src/index.js'

@NodeEntity()
class Person {
  @Property({ type: 'string', primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string
}

describe('NTS-493: error classes are exported from the package root', () => {
  it('catch blocks can discriminate with instanceof ValidationError', () => {
    try {
      defineModel('Nts493Person', {
        age: { type: 'number', min: 0, max: 150, required: true },
      })
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        expectTypeOf(error.issues).toEqualTypeOf<ValidationIssue[]>()
      }

      if (error instanceof TransactionError) {
        expectTypeOf(error.details).toEqualTypeOf<BatchStatementError[]>()
      }
    }
  })

  it('both classes sit in the taxonomy (Error base / NeodeError base)', () => {
    expectTypeOf<ValidationError>().toExtend<Error>()
    expectTypeOf<TransactionError>().toExtend<NeodeError>()
  })
})

describe('NTS-493: map-schema validation rule keys are typed', () => {
  it('rule keys from the rule table type-check on property definitions', () => {
    const schema: SchemaDefinition = {
      age: {
        type: 'number',
        min: 0,
        max: 150,
        required: true,
        integer: true,
        multiple: 3,
        precision: 2,
        positive: true,
        negative: true,
        port: true,
      },
      name: {
        type: 'string',
        length: 5,
        email: true,
        regex: { pattern: /^[a-z]+$/, name: 'lowercase', invert: false },
        replace: { pattern: /a/g, replace: 'b' },
        hex: { prefix: true, byteAligned: true },
        base64: { paddingRequired: false },
        normalize: { form: 'NFD' },
        guid: { version: 'uuidv4' },
        trim: true,
        lowercase: true,
        uppercase: true,
        before: 'now',
        after: new Date(),
        valid: ['a', 'b'],
        invalid: 'c',
        allow: ['x'],
        insensitive: true,
        truncate: true,
        alphanum: true,
        creditCard: true,
        token: true,
        hostname: true,
        truthy: true,
        falsy: true,
        iso: true,
        isoDate: true,
        optional: true,
        forbidden: true,
        strip: true,
        strict: true,
        empty: true,
      },
    }

    expectTypeOf(schema).toEqualTypeOf<SchemaDefinition>()
  })

  it('unknown rule keys are type errors', () => {
    const bad: SchemaDefinition = {
      name: {
        type: 'string',
        // @ts-expect-error notARule is not a rule-table key
        notARule: true,
      },
    }

    void bad
  })
})

describe('NTS-493: @EntityRepository subclasses type-check', () => {
  it('the documented subclass pattern applies the decorator cleanly', () => {
    @EntityRepository(Person)
    class PeopleRepository extends Repository<Person> {
      adults(): Promise<Person[]> {
        return this.findAll()
      }
    }

    expectTypeOf<PeopleRepository>().toExtend<Repository<Person>>()
    expectTypeOf<PeopleRepository>().toExtend<Repository<unknown>>()
  })

  it('Repository subclasses satisfy the RepositoryConstructor wire format', () => {
    class Plain extends Repository<Person> {}

    expectTypeOf(Plain).toExtend<RepositoryConstructor>()
    expectTypeOf(Repository).toExtend<RepositoryConstructor>()
  })
})
