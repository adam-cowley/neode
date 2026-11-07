import { describe, expect, it } from 'vitest'
import {
  applySchemaDrift,
  formatSchemaDrift,
  schemaDrift,
  type SchemaDrift,
  type SchemaDriftEntry,
} from '../../src/services/schema/drift.service'
import type { ConnectionProvider, QueryRecord } from '../../src/driver/types'
import { mergeModel } from '../../src/meta'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'

/**
 * Schema drift workflow (NTS-450): structured diff with fix statements,
 * human-readable report, idempotent apply — all without a database.
 */

const record = (values: Record<string, unknown>): QueryRecord => ({
  keys: Object.keys(values),
  get: (key) => values[key],
  has: (key) => key in values,
})

/** Provider answering SHOW CONSTRAINTS / SHOW INDEXES and recording writes */
const provider = (constraints: QueryRecord[], indexes: QueryRecord[]) => {
  const statements: string[] = []

  const connection = {
    run: async (statement: string) => {
      if (statement === 'SHOW CONSTRAINTS') {
        return { records: constraints }
      }

      if (statement === 'SHOW INDEXES') {
        return { records: indexes }
      }

      statements.push(statement)

      return { records: [] }
    },
  } as unknown as ConnectionProvider

  return { connection, statements }
}

/** Model declaring one of every drift-able object kind */
function registerDriftModel(): void {
  class DriftPerson {
    static __ogmUnitFixture?: void
  }

  const schema: EntitySchema = mergeModel(DriftPerson)

  schema.setLabels(['DriftPerson'])
  schema.addProperty('email')
  schema.getProperty('email').setUnique()
  schema.getProperty('email').setType(PropertyType.STRING)
  schema.getProperty('email').setTyped(true)
  schema.addProperty('score')
  schema.getProperty('score').setIndex()
  schema.addProperty('bio')
  schema.getProperty('bio').setFulltext()
}

const VECTOR_OPTION = { label: 'DriftPerson', property: 'emb', dimensions: 1536 }

/** Model declaring a vector-indexed property (NTS-447 metadata, NTS-450 drift) */
function registerVectorModel(): void {
  class DriftDoc {
    static __ogmUnitFixture?: void
  }

  const schema: EntitySchema = mergeModel(DriftDoc)

  schema.setLabels(['DriftDoc'])
  schema.addProperty('emb')
  schema.getProperty('emb').setVector({ dimensions: 768 })
}

describe('schemaDrift (NTS-450)', () => {
  registerDriftModel()
  registerVectorModel()

  const database = () => [
    record({
      name: 'driftperson_email_unique',
      type: 'UNIQUE',
      labelsOrTypes: ['DriftPerson'],
      properties: ['email'],
    }),
    // stale constraint: installed, not declared
    record({
      name: 'driftperson_old_exists',
      type: 'EXISTENCE',
      labelsOrTypes: ['DriftPerson'],
      properties: ['legacy'],
    }),
  ]

  const indexes = () => [
    // RANGE is the SHOW spelling of a declared INDEX — not drift
    record({
      name: 'driftperson_score_index',
      type: 'RANGE',
      labelsOrTypes: ['DriftPerson'],
      properties: ['score'],
    }),
    // same name as the declared fulltext index, different properties — mismatched
    record({
      name: 'driftperson_bio_fulltext',
      type: 'FULLTEXT',
      labelsOrTypes: ['DriftPerson'],
      properties: ['title'],
    }),
    // stale index
    record({
      name: 'driftperson_legacy_index',
      type: 'RANGE',
      labelsOrTypes: ['DriftPerson'],
      properties: ['legacy'],
    }),
  ]

  it('reports missing, stale and mismatched objects with fix statements', async () => {
    const { connection } = provider(database(), indexes())

    const drift = await schemaDrift(connection, { vector: [VECTOR_OPTION] })

    // missing: the vector index is declared via options AND via DriftDoc
    // model metadata (NTS-447 wiring) — two missing vector indexes
    expect(drift.indexes.missing).toHaveLength(2)
    const declaredVector = drift.indexes.missing.find(
      (entry) => entry.name === 'driftperson_emb_vector',
    )
    expect(declaredVector).toMatchObject({
      name: 'driftperson_emb_vector',
      type: 'VECTOR',
    })
    expect(declaredVector?.createStatement).toBe(
      'CREATE VECTOR INDEX driftperson_emb_vector IF NOT EXISTS ' +
        "FOR (n:`DriftPerson`) ON (n.`emb`) OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } }",
    )

    // clean: UNIQUE constraint and the RANGE spelling of the declared INDEX
    expect(drift.constraints.missing.map((entry) => entry.name)).toEqual([
      'driftperson_email_property_type',
    ])
    expect(drift.constraints.mismatched).toHaveLength(0)
    expect(
      drift.indexes.missing.filter((entry) => entry.name === 'driftperson_score_index'),
    ).toHaveLength(0)

    // stale: EXISTENCE constraint and RANGE index, each with a drop statement
    expect(drift.constraints.stale.map((entry) => entry.name)).toEqual(['driftperson_old_exists'])
    expect(drift.constraints.stale[0]?.dropStatement).toBe(
      'DROP CONSTRAINT driftperson_old_exists IF EXISTS',
    )
    expect(drift.indexes.stale.map((entry) => entry.name)).toEqual(['driftperson_legacy_index'])
    expect(drift.indexes.stale[0]?.dropStatement).toBe(
      'DROP INDEX driftperson_legacy_index IF EXISTS',
    )

    // mismatched: fulltext index re-purposed onto another property
    expect(drift.indexes.mismatched).toHaveLength(1)
    expect(drift.indexes.mismatched[0]?.name).toBe('driftperson_bio_fulltext')
    expect(drift.indexes.mismatched[0]?.createStatement).toBe(
      'CREATE FULLTEXT INDEX driftperson_bio_fulltext IF NOT EXISTS FOR (n:`DriftPerson`) ON EACH [n.`bio`]',
    )
    expect(drift.indexes.mismatched[0]?.dropStatement).toBe(
      'DROP FULLTEXT INDEX driftperson_bio_fulltext IF EXISTS',
    )
  })

  it('derives fulltext indexes declared on model properties and builds missing constraint statements', async () => {
    const { connection } = provider([], [])

    const drift = await schemaDrift(connection, { vector: [VECTOR_OPTION] })

    expect(drift.indexes.missing.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['driftperson_bio_fulltext', 'driftperson_score_index']),
    )

    const propertyType = drift.constraints.missing.find(
      (entry) => entry.name === 'driftperson_email_property_type',
    )

    expect(propertyType?.createStatement).toBe(
      'CREATE CONSTRAINT driftperson_email_property_type IF NOT EXISTS ' +
        'FOR (n:`DriftPerson`) REQUIRE n.`email` IS :: STRING',
    )
  })

  it('reports nothing on a clean database', async () => {
    const { connection } = provider(
      [
        record({
          name: 'driftperson_email_unique',
          type: 'UNIQUE',
          labelsOrTypes: ['DriftPerson'],
          properties: ['email'],
        }),
      ],
      [],
    )

    const drift = await schemaDrift(connection, { vector: [VECTOR_OPTION] })

    // the vector index is still declared but never installed here — only
    // constraint-level drift is checked for cleanliness
    const clean = await schemaDrift(
      provider(
        [],
        [
          record({
            name: 'driftperson_emb_vector',
            type: 'VECTOR',
            labelsOrTypes: ['DriftPerson'],
            properties: ['emb'],
          }),
        ],
      ).connection,
      { vector: [VECTOR_OPTION] },
    )

    expect(drift.constraints.missing).toHaveLength(1)
    expect(clean.indexes.stale).toHaveLength(0)
    expect(clean.constraints.stale).toHaveLength(0)
  })

  it('derives vector indexes from model metadata without options (NTS-447 + NTS-450 wiring)', async () => {
    const { connection } = provider([], [])

    const drift = await schemaDrift(connection)

    const vector = drift.indexes.missing.find((entry) => entry.type === 'VECTOR')

    expect(vector).toMatchObject({
      name: 'driftdoc_emb_vector',
      labelsOrTypes: ['DriftDoc'],
      properties: ['emb'],
    })
    expect(vector?.createStatement).toBe(
      'CREATE VECTOR INDEX driftdoc_emb_vector IF NOT EXISTS ' +
        "FOR (n:`DriftDoc`) ON (n.`emb`) OPTIONS { indexConfig: { `vector.dimensions`: 768, `vector.similarity_function`: 'cosine' } }",
    )
  })
})

describe('formatSchemaDiff (NTS-450)', () => {
  const entry = (overrides: Partial<SchemaDriftEntry>): SchemaDriftEntry => ({
    name: 'person_email_unique',
    type: 'UNIQUE',
    labelsOrTypes: ['Person'],
    properties: ['email'],
    ...overrides,
  })

  it('renders each group with the object, its location and the fix statement', () => {
    const drift: SchemaDrift = {
      constraints: {
        missing: [
          entry({
            createStatement:
              'CREATE CONSTRAINT person_email_unique IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS UNIQUE',
          }),
        ],
        stale: [
          entry({
            name: 'person_old_unique',
            dropStatement: 'DROP CONSTRAINT person_old_unique IF EXISTS',
          }),
        ],
        mismatched: [
          entry({
            name: 'person_email_index',
            type: 'INDEX',
            createStatement:
              'CREATE INDEX person_email_index IF NOT EXISTS FOR (n:`Person`) ON (n.`email`)',
            dropStatement: 'DROP CONSTRAINT person_email_index IF EXISTS',
          }),
        ],
      },
      indexes: {
        missing: [
          entry({
            name: 'movie_emb_vector',
            type: 'VECTOR',
            labelsOrTypes: ['Movie'],
            properties: ['emb'],
            createStatement:
              "CREATE VECTOR INDEX movie_emb_vector IF NOT EXISTS FOR (n:`Movie`) ON (n.`emb`) OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } }",
          }),
        ],
        stale: [],
        mismatched: [],
      },
    }

    const report = formatSchemaDrift(drift)

    expect(report).toContain('missing (2) — declared but not installed:')
    expect(report).toContain('  - UNIQUE person_email_unique on :Person (email)')
    expect(report).toContain(
      '      fix: CREATE CONSTRAINT person_email_unique IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS UNIQUE',
    )
    expect(report).toContain('  - VECTOR movie_emb_vector on :Movie (emb)')

    expect(report).toContain('stale (1) — installed but not declared:')
    expect(report).toContain(
      '      fix (requires dropStale: true): DROP CONSTRAINT person_old_unique IF EXISTS',
    )

    expect(report).toContain('mismatched (1) — installed definition differs from the declaration:')
    expect(report).toContain(
      '      fix: CREATE INDEX person_email_index IF NOT EXISTS FOR (n:`Person`) ON (n.`email`)',
    )
    expect(report).toContain('      drop first: DROP CONSTRAINT person_email_index IF EXISTS')
  })

  it('omits empty groups and reports a clean database in one line', () => {
    const empty = { missing: [], stale: [], mismatched: [] }

    expect(formatSchemaDrift({ constraints: empty, indexes: empty })).toBe(
      'no schema drift: the declared schema matches the database',
    )

    const onlyStale = formatSchemaDrift({
      constraints: empty,
      indexes: {
        ...empty,
        stale: [
          entry({
            name: 'old_index',
            type: 'RANGE',
            dropStatement: 'DROP INDEX old_index IF EXISTS',
          }),
        ],
      },
    })

    expect(onlyStale).not.toContain('missing')
    expect(onlyStale).toContain('stale (1)')
    expect(onlyStale).toContain('DROP INDEX old_index IF EXISTS')
  })
})

describe('applySchemaDiff (NTS-450)', () => {
  const drift = (): SchemaDrift => ({
    constraints: {
      missing: [
        {
          name: 'person_email_unique',
          type: 'UNIQUE',
          labelsOrTypes: ['Person'],
          properties: ['email'],
          createStatement:
            'CREATE CONSTRAINT person_email_unique IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS UNIQUE',
        },
      ],
      stale: [
        {
          name: 'person_old_unique',
          type: 'UNIQUE',
          labelsOrTypes: ['Person'],
          properties: ['email'],
          dropStatement: 'DROP CONSTRAINT person_old_unique IF EXISTS',
        },
      ],
      mismatched: [
        {
          name: 'person_email_index',
          type: 'INDEX',
          labelsOrTypes: ['Person'],
          properties: ['email'],
          createStatement:
            'CREATE INDEX person_email_index IF NOT EXISTS FOR (n:`Person`) ON (n.`email`)',
          dropStatement: 'DROP CONSTRAINT person_email_index IF EXISTS',
        },
      ],
    },
    indexes: {
      missing: [
        {
          name: 'movie_emb_vector',
          type: 'VECTOR',
          labelsOrTypes: ['Movie'],
          properties: ['emb'],
          createStatement:
            'CREATE VECTOR INDEX movie_emb_vector IF NOT EXISTS FOR (n:`Movie`) ON (n.`emb`)',
        },
      ],
      stale: [
        {
          name: 'old_index',
          type: 'RANGE',
          labelsOrTypes: ['Movie'],
          properties: ['title'],
          dropStatement: 'DROP INDEX old_index IF EXISTS',
        },
      ],
      mismatched: [],
    },
  })

  it('applies only missing objects by default — stale and mismatched are left alone', async () => {
    const { connection, statements } = provider([], [])

    const results = await applySchemaDrift(connection, drift())

    expect(statements).toEqual([
      'CREATE CONSTRAINT person_email_unique IF NOT EXISTS FOR (n:`Person`) REQUIRE n.`email` IS UNIQUE',
      'CREATE VECTOR INDEX movie_emb_vector IF NOT EXISTS FOR (n:`Movie`) ON (n.`emb`)',
    ])
    expect(results.every((result) => result.success && result.action === 'CREATE')).toBe(true)
  })

  it('drops stale objects only with dropStale: true', async () => {
    const { connection, statements } = provider([], [])

    const results = await applySchemaDrift(connection, drift(), { dropStale: true })

    expect(statements).toContain('DROP CONSTRAINT person_old_unique IF EXISTS')
    expect(statements).toContain('DROP INDEX old_index IF EXISTS')
    // mismatched objects are never applied: resolving one is drop + re-create
    expect(statements).not.toContain(
      'CREATE INDEX person_email_index IF NOT EXISTS FOR (n:`Person`) ON (n.`email`)',
    )
    expect(statements).not.toContain('DROP CONSTRAINT person_email_index IF EXISTS')
    expect(results.filter((result) => result.action === 'DROP')).toHaveLength(2)
  })

  it('reports per-statement failures instead of throwing', async () => {
    const connection = {
      run: async (statement: string) => {
        if (statement.includes('VECTOR')) {
          throw new Error('unsupported index')
        }

        return { records: [] }
      },
    } as unknown as ConnectionProvider

    const results = await applySchemaDrift(connection, drift())

    expect(results).toHaveLength(2)
    const vector = results.find((result) => result.type === 'VECTOR')

    expect(vector?.success).toBe(false)
    expect(vector?.error).toBeInstanceOf(Error)
    expect(results.find((result) => result.type === 'UNIQUE')?.success).toBe(true)
  })
})
