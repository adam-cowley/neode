import { NodeEntity, Uuid, String, InternalId } from '../../src/decorators'
import { Neode } from '../../src/neode.service'
import { ConstraintAction, ConstraintType } from '../../src/services/schema/schema.service'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --
// A constraint and a plain index cannot co-exist on the same label/property,
// so each concern gets its own property.

@NodeEntity()
class SchemaPerson {
  @InternalId()
  _id!: string

  @Uuid({ primary: true })
  id!: string

  @String({ index: true })
  email!: string

  @String({ exists: true })
  title!: string
}

// The model registers itself via the decorators above
void SchemaPerson

// ---------------------------------------------------------------------------

const UNIQUE_CONSTRAINT = 'schemaperson_id_unique_b4e03243'
const EMAIL_INDEX = 'schemaperson_email_index_ddbbe415'
const TITLE_EXISTS = 'schemaperson_title_exists_f6dd81eb'

async function constraintNames(backend: TestBackend): Promise<string[]> {
  const result = await backend.connection.run('SHOW CONSTRAINTS', {}, 'READ')

  return result.records.map((record) => record.get('name') as string)
}

async function indexNames(backend: TestBackend): Promise<string[]> {
  const result = await backend.connection.run('SHOW INDEXES', {}, 'READ')

  return result.records.map((record) => record.get('name') as string)
}

describe('Schema sync (constraints + indexes)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    await backend.close()
  })

  // The backend supports DDL unless the probe in support/backend.ts failed;
  // every test below guards on capabilities.constraints so it can run against
  // any backend without failing on unsupported statements.
  describe('with constraint/index support', () => {
    const requiresConstraints = (): boolean => backend.capabilities.constraints

    it('installs unique constraints and indexes and they exist in the database', async () => {
      if (!requiresConstraints()) {
        return
      }
      if (!backend.capabilities.constraints) {
        return
      }

      const results = await backend.neode.installSchema()

      const unique = results.find((result) => result.type === ConstraintType.UNIQUE)
      const index = results.find((result) => result.type === ConstraintType.INDEX)

      expect(unique).toMatchObject({
        action: ConstraintAction.CREATE,
        type: ConstraintType.UNIQUE,
        label: 'SchemaPerson',
        property: 'id',
        success: true,
        statement: `CREATE CONSTRAINT ${UNIQUE_CONSTRAINT} IF NOT EXISTS FOR (n:\`SchemaPerson\`) REQUIRE n.\`id\` IS UNIQUE`,
      })

      expect(index).toMatchObject({
        action: ConstraintAction.CREATE,
        type: ConstraintType.INDEX,
        label: 'SchemaPerson',
        property: 'email',
        success: true,
        statement: `CREATE INDEX ${EMAIL_INDEX} IF NOT EXISTS FOR (n:\`SchemaPerson\`) ON (n.\`email\`)`,
      })

      expect(await constraintNames(backend)).toContain(UNIQUE_CONSTRAINT)
      expect(await indexNames(backend)).toContain(EMAIL_INDEX)
    })

    it('is idempotent — installing twice does not fail', async () => {
      if (!requiresConstraints()) {
        return
      }

      const first = await backend.neode.installSchema()
      const second = await backend.neode.installSchema()

      for (const result of [...first, ...second]) {
        expect(result.error).toBeUndefined()
        expect(result.success).toBe(true)
      }
    })

    it('drops constraints and indexes and removes them from the database', async () => {
      if (!requiresConstraints()) {
        return
      }

      await backend.neode.installSchema()

      const results = await backend.neode.dropSchema()

      const unique = results.find((result) => result.type === ConstraintType.UNIQUE)
      const index = results.find((result) => result.type === ConstraintType.INDEX)

      expect(unique).toMatchObject({
        action: ConstraintAction.DROP,
        type: ConstraintType.UNIQUE,
        success: true,
        statement: `DROP CONSTRAINT ${UNIQUE_CONSTRAINT} IF EXISTS`,
      })

      expect(index).toMatchObject({
        action: ConstraintAction.DROP,
        type: ConstraintType.INDEX,
        success: true,
        statement: `DROP INDEX ${EMAIL_INDEX} IF EXISTS`,
      })

      expect(await constraintNames(backend)).not.toContain(UNIQUE_CONSTRAINT)
      expect(await indexNames(backend)).not.toContain(EMAIL_INDEX)
    })

    it('creates existence constraints only on Enterprise editions, DETECTED not flagged (NTS-598)', async () => {
      if (!requiresConstraints()) {
        return
      }

      // The edition is probed from the connection (CALL dbms.components()):
      // no EXISTS constraints on Community, even for exists: true properties
      const results = await backend.neode.installSchema()

      expect(results.some((result) => result.type === ConstraintType.EXISTS)).toBe(
        backend.capabilities.edition === 'enterprise',
      )

      if (backend.capabilities.edition !== 'enterprise') {
        return
      }

      // Enterprise edition: existence constraints (IS NOT NULL) are
      // created and dropped through the full lifecycle
      const enterpriseResults = results
      const exists = enterpriseResults.filter((result) => result.type === ConstraintType.EXISTS)

      expect(exists).toHaveLength(1)
      expect(exists[0]).toMatchObject({
        action: ConstraintAction.CREATE,
        type: ConstraintType.EXISTS,
        label: 'SchemaPerson',
        property: 'title',
        success: true,
        statement: `CREATE CONSTRAINT ${TITLE_EXISTS} IF NOT EXISTS FOR (n:\`SchemaPerson\`) REQUIRE n.\`title\` IS NOT NULL`,
      })
      expect(await constraintNames(backend)).toContain(TITLE_EXISTS)

      await backend.neode.dropSchema()
      expect(await constraintNames(backend)).not.toContain(TITLE_EXISTS)
    })
  })
})
