import { NodeEntity, Uuid, String, InternalId } from '../../src/decorators'
import { getModel } from '../../src/meta'
import { ConstraintType } from '../../src/services/schema/schema.service'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --
// A constraint and a plain index cannot co-exist on the same label/property,
// so each concern gets its own property.

@NodeEntity()
class RoundtripPerson {
  @InternalId()
  _id!: string

  @Uuid({ primary: true })
  id!: string

  @String({ unique: true })
  email!: string

  @String({ index: true })
  city!: string

  @String({ exists: true })
  title!: string
}

@NodeEntity({ labels: ['RoundtripAlpha', 'RoundtripBeta'] })
class RoundtripMultiLabel {
  @InternalId()
  _id!: string

  @Uuid({ primary: true })
  id!: string
}

// The models register themselves via the decorators above
void RoundtripPerson
void RoundtripMultiLabel

// ---------------------------------------------------------------------------

const ID_UNIQUE = 'roundtripperson_id_unique'
const EMAIL_UNIQUE = 'roundtripperson_email_unique'
const CITY_INDEX = 'roundtripperson_city_index'
const ALPHA_UNIQUE = 'roundtripalpha_id_unique'
const BETA_UNIQUE = 'roundtripbeta_id_unique'
const UNRELATED_CONSTRAINT = 'roundtrip_unrelated_keep'

async function constraintNames(backend: TestBackend): Promise<string[]> {
  const result = await backend.connection.run('SHOW CONSTRAINTS', {}, 'READ')

  return result.records.map((record) => record.get('name') as string)
}

async function indexNames(backend: TestBackend): Promise<string[]> {
  const result = await backend.connection.run('SHOW INDEXES', {}, 'READ')

  return result.records.map((record) => record.get('name') as string)
}

describe('Schema install/drop round-trip', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    await backend.close()
  })

  describe('with constraint/index support', () => {
    const requiresConstraints = (): boolean => backend.capabilities.constraints

    it('installs, shows up under deterministic names, drops, and leaves unrelated constraints alone', async () => {
      if (!requiresConstraints()) {
        return
      }

      // An unrelated constraint the OGM does not know about must survive
      // the round-trip untouched
      await backend.connection.run(
        `CREATE CONSTRAINT ${UNRELATED_CONSTRAINT} IF NOT EXISTS FOR (n:__RoundtripUnrelated__) REQUIRE n.\`code\` IS UNIQUE`,
        {},
        'WRITE',
      )

      await backend.neode.installSchema()

      const constraints = await constraintNames(backend)
      expect(constraints).toContain(ID_UNIQUE)
      expect(constraints).toContain(EMAIL_UNIQUE)
      expect(constraints).not.toContain('roundtripperson_title_exists')
      expect(await indexNames(backend)).toContain(CITY_INDEX)

      // The unrelated constraint survived the install
      expect(constraints).toContain(UNRELATED_CONSTRAINT)

      await backend.neode.dropSchema()

      const afterDrop = await constraintNames(backend)
      expect(afterDrop).not.toContain(ID_UNIQUE)
      expect(afterDrop).not.toContain(EMAIL_UNIQUE)
      expect(await indexNames(backend)).not.toContain(CITY_INDEX)

      // ...and still survives the drop
      expect(afterDrop).toContain(UNRELATED_CONSTRAINT)
    })

    it('is idempotent — install twice and drop twice with zero failures', async () => {
      if (!requiresConstraints()) {
        return
      }

      const first = await backend.neode.installSchema()
      const second = await backend.neode.installSchema()

      for (const result of [...first, ...second]) {
        expect(result.success).toBe(true)
        expect(result.error).toBeUndefined()
      }

      const dropFirst = await backend.neode.dropSchema()
      const dropSecond = await backend.neode.dropSchema()

      for (const result of [...dropFirst, ...dropSecond]) {
        expect(result.success).toBe(true)
        expect(result.error).toBeUndefined()
      }
    })

    it('drops on a fresh database with zero failures (IF EXISTS guards)', async () => {
      if (!requiresConstraints()) {
        return
      }

      const results = await backend.neode.dropSchema()

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        expect(result.success).toBe(true)
        expect(result.error).toBeUndefined()
      }
    })

    it('omits existence constraints from install results unless enterprise is active', async () => {
      if (!requiresConstraints()) {
        return
      }

      if (backend.capabilities.edition === 'enterprise') {
        // The enterprise-active path is env-gated (OGM_TEST_BACKEND=
        // neo4j against an Enterprise edition); it is covered by
        // schema-sync.test.ts and not exercised here
        return
      }

      const results = await backend.neode.installSchema()

      expect(results.some((result) => result.type === ConstraintType.EXISTS)).toBe(false)

      await backend.neode.dropSchema()
    })

    it('installs and drops constraints per label for a multi-label model', async () => {
      if (!requiresConstraints()) {
        return
      }

      await backend.neode.installSchema()

      const constraints = await constraintNames(backend)
      expect(constraints).toContain(ALPHA_UNIQUE)
      expect(constraints).toContain(BETA_UNIQUE)

      await backend.neode.dropSchema()

      const afterDrop = await constraintNames(backend)
      expect(afterDrop).not.toContain(ALPHA_UNIQUE)
      expect(afterDrop).not.toContain(BETA_UNIQUE)
    })
  })
})
