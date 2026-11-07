import { describe, expect, it } from 'vitest'
import { Driver, Session as DriverSession, Transaction as DriverTransaction } from 'neo4j-driver'

import {
  classifyError,
  ConstraintViolationError,
  isTransientError,
  NeodeError,
  redactParameters,
  TransientError,
  withQueryContext,
} from '../../src/errors'
import {
  Neo4jConnectionProvider,
  Neo4jTransactionHandle,
} from '../../src/driver/neo4j-connection-provider.js'
import { defineModel, extendModel, getModelByName } from '../../src/meta/map-schema.js'
import { getModel } from '../../src/meta/index.js'
import { RelationshipPropertySchema } from '../../src/meta/relationship-property-schema.js'
import { Direction } from '../../src/query/direction.js'
import { RelateService } from '../../src/services/query/relate.service.js'
import { knn } from '../../src/services/query/knn.service.js'
import { search } from '../../src/services/query/search.service.js'
import { validate, ValidationError } from '../../src/validation/index.js'
import { hydrate } from '../../src/hydrate.js'
import type { QueryOutput, Runner } from '../../src/driver/types.js'

/**
 * A Neo4jError / RelateError-shaped error: both carry the `code` and
 * `gqlStatus` classification fields (Relate additionally `retryable`),
 * which is all classifyError looks at.
 */
const driverError = (message: string, facts: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(message), facts)

describe('classifyError', () => {
  describe('constraint violations', () => {
    it('types a Neo4j 5.x unique violation and parses label and property', () => {
      const raw = driverError(
        "New node(4:123) with label `Movie` and property `title` = 'X' already exists with node(4:456)",
        { code: 'Neo.ClientError.Schema.ConstraintViolation', gqlStatus: '42N51' },
      )

      const typed = classifyError(raw) as ConstraintViolationError

      expect(typed).toBeInstanceOf(ConstraintViolationError)
      expect(typed).toBeInstanceOf(NeodeError)
      expect(typed.message).toBe(raw.message)
      expect(typed.label).toBe('Movie')
      expect(typed.property).toBe('title')
    })

    it('types a pre-5.x unique violation and parses label and property', () => {
      const typed = classifyError(
        driverError("Node(123) already exists with label `Movie` and property `title` = 'X'", {
          code: 'Neo.ClientError.Schema.ConstraintValidation',
        }),
      ) as ConstraintViolationError

      expect(typed).toBeInstanceOf(ConstraintViolationError)
      expect(typed.label).toBe('Movie')
      expect(typed.property).toBe('title')
    })

    it('types the Relate engine unique violation (message carries no label)', () => {
      const raw = driverError(
        'semantic error: ConstraintValidationFailed: `movie_title_unique` uniqueness',
        {
          code: 'Neo.ClientError.Schema.ConstraintValidationFailed',
          gqlStatus: '42000',
          retryable: false,
          stage: 'runtime',
        },
      )

      const typed = classifyError(raw) as ConstraintViolationError

      expect(typed).toBeInstanceOf(ConstraintViolationError)
      // The engine's message names only the constraint: label/property
      // stay undefined rather than guessed
      expect(typed.label).toBeUndefined()
      expect(typed.property).toBeUndefined()
    })

    it('preserves the original error as cause', () => {
      const raw = driverError('dup', {
        code: 'Neo.ClientError.Schema.ConstraintViolation',
      })

      const typed = classifyError(raw) as ConstraintViolationError

      expect(typed.cause).toBe(raw)
    })

    it('parses multi-property violations as the first property', () => {
      const typed = classifyError(
        driverError(
          "New node(1) with label `Movie` and properties `title` = 'X', `year` = 2000 already exists",
          { code: 'Neo.ClientError.Schema.ConstraintViolation' },
        ),
      ) as ConstraintViolationError

      expect(typed.label).toBe('Movie')
      expect(typed.property).toBe('title')
    })
  })

  describe('transient errors', () => {
    it('types Neo.TransientError.* codes as retryable', () => {
      const raw = driverError('Connection failed', {
        code: 'Neo.TransientError.Network.CommunicationError',
      })

      const typed = classifyError(raw) as TransientError

      expect(typed).toBeInstanceOf(TransientError)
      expect(typed).toBeInstanceOf(NeodeError)
      expect(typed.isRetryable).toBe(true)
      expect(typed.code).toBe('Neo.TransientError.Network.CommunicationError')
    })

    it('types retryable-flagged driver failures (ServiceUnavailable) as transient', () => {
      const typed = classifyError(
        driverError('Could not connect', { code: 'ServiceUnavailable', retryable: true }),
      ) as TransientError

      expect(typed).toBeInstanceOf(TransientError)
      expect(typed.isRetryable).toBe(true)
    })
  })

  describe('unknown errors', () => {
    it('leaves plain errors untouched', () => {
      const raw = new Error('boom')

      expect(classifyError(raw)).toBe(raw)
    })

    it('leaves non-taxonomy driver codes untouched', () => {
      const raw = driverError('variable not defined', {
        code: 'Neo.ClientError.Statement.SyntaxError',
        gqlStatus: '42N06',
      })

      expect(classifyError(raw)).toBe(raw)
    })

    it('leaves non-Error values untouched', () => {
      expect(classifyError('nope')).toBe('nope')
      expect(classifyError(undefined)).toBeUndefined()
    })

    it('is idempotent for already-typed errors', () => {
      const typed = new ConstraintViolationError('dup', 'Movie', 'title')

      expect(classifyError(typed)).toBe(typed)
    })
  })

  describe('isTransientError', () => {
    it('is true for classified transient errors', () => {
      const typed = classifyError(
        driverError('Connection failed', {
          code: 'Neo.TransientError.Network.CommunicationError',
        }),
      )

      expect(isTransientError(typed)).toBe(true)
    })

    it('is false for unclassified and other typed errors', () => {
      expect(
        isTransientError(
          driverError('Connection failed', {
            code: 'Neo.TransientError.Network.CommunicationError',
          }),
        ),
      ).toBe(false)
      expect(isTransientError(new ConstraintViolationError('dup', 'Movie', 'title'))).toBe(false)
    })
  })
})

describe('Neo4j provider classification wiring', () => {
  const constraintRaw = () =>
    driverError("New node(4:123) with label `Movie` and property `title` = 'X' already exists", {
      code: 'Neo.ClientError.Schema.ConstraintViolation',
    })

  const transientRaw = () =>
    driverError('Connection failed', {
      code: 'Neo.TransientError.Network.CommunicationError',
    })

  const fakeDriver = (error: unknown): Driver =>
    ({
      session: () => ({
        run: async () => {
          throw error
        },
        close: async () => {},
        beginTransaction: () => {
          throw error
        },
      }),
    }) as unknown as Driver

  it('surfaces run() failures as typed constraint violations', async () => {
    const raw = constraintRaw()
    const provider = new Neo4jConnectionProvider(fakeDriver(raw))

    const caught = await provider.run('CREATE (n:Movie)').then(
      () => null,
      (error) => error,
    )

    expect(caught).toBeInstanceOf(ConstraintViolationError)
    expect((caught as ConstraintViolationError).label).toBe('Movie')
  })

  it('surfaces run() failures as typed transient errors', async () => {
    const provider = new Neo4jConnectionProvider(fakeDriver(transientRaw()))

    const caught = await provider.run('RETURN 1').then(
      () => null,
      (error) => error,
    )

    expect(caught).toBeInstanceOf(TransientError)
    expect((caught as TransientError).isRetryable).toBe(true)
  })

  it('wraps unknown run() failures with the failing statement and redacted params (NTS-446)', async () => {
    const raw = new Error('boom')
    const provider = new Neo4jConnectionProvider(fakeDriver(raw))

    const caught = await provider.run('RETURN 1').then(
      () => null,
      (error) => error,
    )

    // NTS-446: the unclassified error is wrapped with what failed and
    // where (the statement); the original is preserved as cause
    expect(caught).toBeInstanceOf(NeodeError)
    expect((caught as Error).message).toContain('RETURN 1')
    expect((caught as Error).message).toContain('boom')
    expect((caught as Error).cause).toBe(raw)
  })

  it('surfaces beginTransaction() failures as typed transient errors', async () => {
    const provider = new Neo4jConnectionProvider(fakeDriver(transientRaw()))

    const caught = await provider.beginTransaction().then(
      () => null,
      (error) => error,
    )

    expect(caught).toBeInstanceOf(TransientError)
  })

  it('surfaces transaction run() failures as typed constraint violations', async () => {
    const raw = constraintRaw()
    const session = { close: async () => {} } as unknown as DriverSession
    const tx = {
      run: async () => {
        throw raw
      },
    } as unknown as DriverTransaction
    const handle = new Neo4jTransactionHandle(session, tx)

    const caught = await handle.run('CREATE (n:Movie)').then(
      () => null,
      (error) => error,
    )

    expect(caught).toBeInstanceOf(ConstraintViolationError)
  })
})

// ---- NTS-446: descriptive, fix-suggesting errors ---------------------------

describe('withQueryContext (NTS-446)', () => {
  it('wraps an unclassified driver error with the statement and redacted params', () => {
    const raw = driverError('Variable `x` not defined', {
      code: 'Neo.ClientError.Statement.SyntaxError',
    })

    const wrapped = withQueryContext(raw, 'MATCH (n) WHERE n.secret = $secret RETURN n', {
      secret: 'hunter2',
      k: 5,
    }) as Error

    expect(wrapped).toBeInstanceOf(NeodeError)
    // what failed + why
    expect(wrapped.message).toContain('Cypher query failed')
    expect(wrapped.message).toContain('Variable `x` not defined')
    // where: the failing statement
    expect(wrapped.message).toContain('MATCH (n) WHERE n.secret = $secret RETURN n')
    // values never leak — keys and shapes only
    expect(wrapped.message).toContain('secret: <redacted string>')
    expect(wrapped.message).toContain('k: <redacted number>')
    expect(wrapped.message).not.toContain('hunter2')
    expect(wrapped.cause).toBe(raw)
  })

  it('passes typed constraint violations through unchanged', () => {
    const raw = driverError(
      "Node(1) with label `Movie` and property `title` = 'X' already exists",
      {
        code: 'Neo.ClientError.Schema.ConstraintViolation',
      },
    )

    const typed = withQueryContext(raw, 'CREATE (n:Movie)', {})

    expect(typed).toBeInstanceOf(ConstraintViolationError)
    expect((typed as Error).message).not.toContain('CREATE (n:Movie)')
  })

  it('passes NeodeErrors through untouched (no double wrapping)', () => {
    const typed = new NeodeError('already descriptive')

    expect(withQueryContext(typed, 'RETURN 1')).toBe(typed)
  })

  describe('redactParameters', () => {
    it('shows keys and shapes, never values', () => {
      const rendered = redactParameters({ password: 'hunter2', count: 3, ids: ['a', 'b'] })

      expect(rendered).toContain('password: <redacted string>')
      expect(rendered).toContain('count: <redacted number>')
      expect(rendered).toContain('ids: <redacted array>')
      expect(rendered).not.toContain('hunter2')
      expect(rendered).not.toContain("'a'")
    })

    it('renders absent and empty parameters as (none)', () => {
      expect(redactParameters(undefined)).toBe('(none)')
      expect(redactParameters({})).toBe('(none)')
    })
  })
})

describe('unknown model name names the known models and the fix (NTS-446)', () => {
  it('extendModel lists the defined models and the fix', () => {
    defineModel('KnownModel446', { name: 'string' })

    let caught: NeodeError | undefined
    try {
      extendModel('Nopesville446', 'Clone446')
    } catch (error) {
      caught = error as NeodeError
    }

    expect(caught).toBeInstanceOf(NeodeError)
    expect(caught?.message).toContain('Couldn\'t find a definition for "Nopesville446"')
    expect(caught?.message).toContain('KnownModel446')
    expect(caught?.message).toContain('— register it with defineModel() or a decorator first')
  })

  it('getModelByName stays undefined for unknown names (no throw)', () => {
    expect(getModelByName('Nopesville446')).toBeUndefined()
  })

  it('hydrate names the constructor, the known models, and the fix', () => {
    class Unknown446 {}

    const output: QueryOutput = { records: [] }

    expect(() => hydrate(Unknown446, output)).toThrow(/Unknown446/)
    expect(() => hydrate(Unknown446, output)).toThrow(/Registered model\(s\) are: .*KnownModel446/)
    expect(() => hydrate(Unknown446, output)).toThrow(/@NodeEntity or defineModel/)
  })
})

describe('index-backed searches name the index and the installSchema() fix (NTS-446)', () => {
  const Doc = defineModel('Errors446Doc', { title: 'string' })

  const failingRunner = (error: unknown): Runner => ({
    run: async (): Promise<QueryOutput> => {
      throw error
    },
  })

  it('knn (procedure mode) wraps the raw driver error with the index and the fix', async () => {
    const attempt = knn<unknown>(
      failingRunner(new Error('There is no index with the name `errors446_doc_vector`')),
      Doc,
      'errors446_doc_vector',
      [1, 0, 0],
      2,
      'procedure',
    )

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/kNN search over index "errors446_doc_vector" failed/)
    await expect(attempt).rejects.toThrow(/There is no index with the name/)
    await expect(attempt).rejects.toThrow(/installSchema\(\)/)
  })

  it('search wraps the raw driver error with the index and the fix', async () => {
    const attempt = search<unknown>(
      failingRunner(new Error('No such fulltext index')),
      Doc,
      'errors446_doc_fulltext',
      'hello',
    )

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(
      /Full-text search over index "errors446_doc_fulltext" failed — No such fulltext index/,
    )
    await expect(attempt).rejects.toThrow(/installSchema\(\)/)
  })

  it('keeps transient failures typed (retryable) instead of hinting the index', async () => {
    // The real provider classifies before the service sees the error —
    // simulate that here (mock runners bypass the provider)
    const raw = classifyError(
      driverError('Connection failed', {
        code: 'Neo.TransientError.Network.CommunicationError',
      }),
    )

    const attempt = knn<unknown>(
      failingRunner(raw),
      Doc,
      'errors446_doc_vector',
      [1, 0, 0],
      2,
      'procedure',
    )

    await expect(attempt).rejects.toBeInstanceOf(TransientError)
    await expect(attempt).rejects.toThrow(/Connection failed/)
  })
})

describe('relate to an unregistered target names relationship, target and received (NTS-446)', () => {
  it('names the relationship, its configured target, the received value and the fix', async () => {
    const From = defineModel('Relate446From', { name: 'string' })

    class NotRegistered446 {}

    const relationship = new RelationshipPropertySchema('ACTED_IN')
    relationship.setType('ACTED_IN')
    relationship.setDirection(Direction.OUTGOING)
    relationship.setTarget(NotRegistered446)

    const fromSchema = getModel(From)!

    const attempt = new RelateService({ run: async () => ({ records: [] }) }).relate(
      fromSchema,
      {},
      {},
      relationship,
    )

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/relationship "ACTED_IN"/)
    await expect(attempt).rejects.toThrow(/configured target: "NotRegistered446"/)
    await expect(attempt).rejects.toThrow(/received "Object"/)
    await expect(attempt).rejects.toThrow(/defineModel/)
  })
})

describe('validation reports every failing property with rule and reason (NTS-446)', () => {
  it('collects all failing properties into the message and details', () => {
    const Doc = defineModel('Errors446ValidatedDoc', {
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      age: { type: 'integer' },
    })

    const schema = getModel(Doc)!

    const attempt = (): unknown => {
      validate({ age: 'not-a-number' }, schema)

      return null
    }

    expect(attempt).toThrow(ValidationError)

    let caught: ValidationError | undefined
    try {
      attempt()
    } catch (error) {
      caught = error as ValidationError
    }

    // every failing property, with property name + rule + message
    expect(caught?.message).toContain('"name" (any.required): "name" is required')
    expect(caught?.message).toContain('"email" (any.required): "email" is required')
    expect(caught?.message).toContain('"age"')
    expect(caught?.message).toContain('Validation failed on')
    expect(caught?.details.length).toBeGreaterThanOrEqual(3)
  })
})
