// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import { inspectSchema } from '../../src/services/schema/inspect.service'
import { SchemaService } from '../../src/services/schema/schema.service'
import { FulltextIndexService } from '../../src/services/schema/fulltext.service'
import { VectorIndexService } from '../../src/services/schema/vector.service'
import { NodeEntity, Uuid, String } from '../../src/decorators'
import { getModel } from '../../src/meta'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class InspectPerson {
  @Uuid({ primary: true })
  id: string

  @String({ unique: true })
  name: string

  @String({ index: true })
  email: string
}

// ---------------------------------------------------------------------------

const FULLTEXT = { label: 'InspectPerson', properties: ['name'] }
const VECTOR = { label: 'InspectPerson', property: 'embedding', dimensions: 4 }

describe('inspectSchema', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('reports declared-but-missing schema objects on an empty database', async () => {
    // Sanity: the decorated fixture is registered under its label
    expect(getModel(InspectPerson).getLabels()).toEqual(['InspectPerson'])

    const report = await inspectSchema(backend.connection)

    expect(report.constraints.missing).toContain('inspectperson_name_unique_0da7b6ae')
    expect(report.indexes.missing).toContain('inspectperson_email_index_36e00322')
    // installed may carry capability-probe scratch indexes — the point
    // is that nothing declared is installed yet
    expect(report.indexes.installed.map((i) => i.name)).not.toContain(
      'inspectperson_email_index_36e00322',
    )
  })

  it('reconciles missing objects once the schema is installed', async () => {
    const results = await new SchemaService(backend.connection).create()

    expect(results.every((result) => result.success)).toBe(true)

    const report = await inspectSchema(backend.connection)

    expect(report.constraints.missing).not.toContain('inspectperson_name_unique_0da7b6ae')
    expect(report.indexes.missing).not.toContain('inspectperson_email_index_36e00322')
    expect(report.constraints.installed.map((c) => c.name)).toContain(
      'inspectperson_name_unique_0da7b6ae',
    )
    expect(report.indexes.installed.map((i) => i.name)).toContain(
      'inspectperson_email_index_36e00322',
    )

    // Installed and declared → neither missing nor extra
    expect(report.constraints.extra).not.toContain('inspectperson_name_unique_0da7b6ae')
  })

  it('reports installed-but-undeclared objects as extra', async () => {
    await backend.connection.run(
      'CREATE CONSTRAINT __ogm_inspect_extra__ IF NOT EXISTS FOR (n:__InspectExtra__) REQUIRE n.x IS UNIQUE',
    )

    try {
      const report = await inspectSchema(backend.connection)

      expect(report.constraints.extra).toContain('__ogm_inspect_extra__')
    } finally {
      await backend.connection.run('DROP CONSTRAINT __ogm_inspect_extra__ IF EXISTS')
    }
  })

  it('includes full-text and vector definitions in the declared index set', async () => {
    const before = await inspectSchema(backend.connection, {
      fulltext: [FULLTEXT],
      vector: [VECTOR],
    })

    expect(before.indexes.declared.map((i) => i.name)).toEqual(
      expect.arrayContaining([
        'inspectperson_name_fulltext_cf3a3001',
        'inspectperson_embedding_vector_f316d4f2',
      ]),
    )
    expect(before.indexes.missing).toEqual(
      expect.arrayContaining([
        'inspectperson_name_fulltext_cf3a3001',
        'inspectperson_embedding_vector_f316d4f2',
      ]),
    )

    await new FulltextIndexService(backend.connection, [FULLTEXT]).create()

    if (backend.capabilities.vector) {
      await new VectorIndexService(backend.connection, [VECTOR]).create()
    }

    const after = await inspectSchema(backend.connection, {
      fulltext: [FULLTEXT],
      vector: [VECTOR],
    })

    expect(after.indexes.missing).not.toContain('inspectperson_name_fulltext_cf3a3001')

    if (backend.capabilities.vector) {
      expect(after.indexes.missing).not.toContain('inspectperson_embedding_vector_f316d4f2')
    }
  })
})
