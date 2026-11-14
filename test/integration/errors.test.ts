/**
 * Typed error taxonomy (NTS-129) — integration tests.
 *
 * Runs against the selected backend (Relate by default). Constraint
 * classification is exercised end-to-end through create(); the raw
 * driver/engine error is classified either at the driver level (Neo4j
 * backend) or here via classifyError — which is idempotent, so the same
 * assertions hold on both.
 */
import { openBackend, TestBackend } from './support/backend'

import { NodeEntity, InternalId, Property } from '../../src/decorators'
import { classifyError, ConstraintViolationError } from '../../src/errors'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class TypedErrorMovie {
  @InternalId()
  _id: string

  @Property({ type: 'string', unique: true })
  title: string
}

const UNIQUE_CONSTRAINT = 'typed_error_title_unique'

describe('typed errors', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    if (backend.capabilities.constraints) {
      try {
        await backend.connection.run(`DROP CONSTRAINT ${UNIQUE_CONSTRAINT} IF EXISTS`)
      } catch {
        // not all backends support dropping constraints
      }
    }

    await backend.close()
  })

  it('surfaces unique violations as a typed ConstraintViolationError', async () => {
    if (!backend.capabilities.constraints) {
      return
    }

    await backend.connection.run(
      `CREATE CONSTRAINT ${UNIQUE_CONSTRAINT} IF NOT EXISTS FOR (n:TypedErrorMovie) REQUIRE n.title IS UNIQUE`,
    )

    await backend.neode.create(TypedErrorMovie, { title: 'typed-error-probe' })

    const raw = await backend.neode.create(TypedErrorMovie, { title: 'typed-error-probe' }).then(
      () => null,
      (error) => error,
    )

    expect(raw).toBeTruthy()

    // Idempotent: on the Neo4j backend the driver-level wiring already
    // typed the error, on Relate the raw RelateError is typed here
    const typed = classifyError(raw)

    expect(typed).toBeInstanceOf(ConstraintViolationError)

    const violation = typed as ConstraintViolationError

    if (backend.name === 'relate') {
      // The embedded engine's message carries only the constraint name
      // ("…ConstraintValidationFailed: `<name>` uniqueness"): the label
      // and property cannot be parsed from it
      expect(violation.label).toBeUndefined()
      expect(violation.property).toBeUndefined()
    } else {
      expect(violation.label).toBe('TypedErrorMovie')
      expect(violation.property).toBe('title')
    }
  })

  it('leaves unknown errors untouched', async () => {
    const raw = await backend.connection.run('RETURN undefinedVariable').then(
      () => null,
      (error) => error,
    )

    expect(raw).toBeTruthy()
    expect(classifyError(raw)).toBe(raw)
  })
})
