import { describe, expect, it } from 'vitest'
import {
  createFulltextStatement,
  dropFulltextStatement,
  fulltextIndexName,
} from '../../src/services/schema/fulltext.service'
import {
  createVectorStatement,
  dropVectorStatement,
  vectorIndexName,
} from '../../src/services/schema/vector.service'
import { declaredSchemaObjects } from '../../src/services/schema/inspect.service'
import { mergeModel } from '../../src/meta'
import { defineModel } from '../../src/meta/map-schema'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { ConnectionProvider, QueryOutput, TransactionHandle } from '../../src/driver/types'
import { Neode } from '../../src/neode.service'
import { ConstraintType } from '../../src/services/schema/schema.service'

describe('fulltext index statements', () => {
  const def = { label: 'Movie', properties: ['title', 'plot'] }

  it('names the index deterministically from the label and properties', () => {
    expect(fulltextIndexName(def)).toBe('movie_plot_title_fulltext_fb2ce53c')
    expect(fulltextIndexName({ ...def, name: 'custom' })).toBe('custom')
  })

  it('renders a CREATE FULLTEXT INDEX statement with an IF NOT EXISTS guard', () => {
    expect(createFulltextStatement(def)).toBe(
      'CREATE FULLTEXT INDEX movie_plot_title_fulltext_fb2ce53c IF NOT EXISTS ' +
        'FOR (n:`Movie`) ON EACH [n.`title`, n.`plot`]',
    )
  })

  it('renders a DROP FULLTEXT INDEX statement with an IF EXISTS guard', () => {
    expect(dropFulltextStatement(fulltextIndexName(def))).toBe(
      'DROP FULLTEXT INDEX movie_plot_title_fulltext_fb2ce53c IF EXISTS',
    )
  })

  it('rejects definitions without properties', () => {
    expect(() => createFulltextStatement({ label: 'Movie', properties: [] })).toThrow(TypeError)
  })
})

describe('declarative fulltext via installSchema (NTS-436)', () => {
  class RecordingProvider implements ConnectionProvider {
    readonly statements: string[] = []

    async run(statement: string): Promise<QueryOutput> {
      this.statements.push(statement)

      return { records: [] }
    }

    async beginTransaction(): Promise<TransactionHandle> {
      return {
        run: async (statement: string) => {
          this.statements.push(statement)

          return { records: [] }
        },
        commit: async () => {},
        rollback: async () => {},
      }
    }

    async edition(): Promise<'community'> {
      return 'community'
    }

    async close(): Promise<void> {}
  }

  // Map API on purpose: proves the SchemaDefinition wiring (fulltext?: boolean)
  // reaches the same install/drop path the decorators drive
  defineModel('FulltextCourse', {
    description: 'A course',
    title: { type: 'string', fulltext: true },
    blurb: { type: 'string', fulltext: true },
  })

  it('groups the fulltext properties into ONE index on installSchema', async () => {
    const neode = new Neode(new RecordingProvider())

    const results = await neode.installSchema()
    const fulltext = results.filter((result) => result.type === ConstraintType.FULLTEXT)

    expect(fulltext).toHaveLength(1)
    expect(fulltext[0]?.statement).toBe(
      'CREATE FULLTEXT INDEX fulltextcourse_blurb_title_fulltext_97601a37 IF NOT EXISTS ' +
        'FOR (n:`FulltextCourse`) ON EACH [n.`title`, n.`blurb`]',
    )
  })

  it('reverses the index on dropSchema', async () => {
    const neode = new Neode(new RecordingProvider())

    const results = await neode.dropSchema()
    const fulltext = results.filter((result) => result.type === ConstraintType.FULLTEXT)

    expect(fulltext).toHaveLength(1)
    expect(fulltext[0]?.statement).toBe(
      'DROP FULLTEXT INDEX fulltextcourse_blurb_title_fulltext_97601a37 IF EXISTS',
    )
  })
})

describe('vector index statements', () => {
  const def = { label: 'Movie', property: 'emb', dimensions: 1536 }

  it('names the index deterministically from the label and property', () => {
    expect(vectorIndexName(def)).toBe('movie_emb_vector_30fc1ec8')
    expect(vectorIndexName({ ...def, name: 'custom' })).toBe('custom')
  })

  it('defaults the similarity function to cosine', () => {
    expect(createVectorStatement(def)).toBe(
      'CREATE VECTOR INDEX movie_emb_vector_30fc1ec8 IF NOT EXISTS ' +
        "FOR (n:`Movie`) ON (n.`emb`) OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } }",
    )
  })

  it('accepts a configured similarity function', () => {
    expect(createVectorStatement({ ...def, similarityFunction: 'euclidean' })).toContain(
      "`vector.similarity_function`: 'euclidean'",
    )
  })

  it('renders a DROP VECTOR INDEX statement with an IF EXISTS guard', () => {
    expect(dropVectorStatement(vectorIndexName(def))).toBe(
      'DROP VECTOR INDEX movie_emb_vector_30fc1ec8 IF EXISTS',
    )
  })

  it('rejects invalid dimensions and similarity functions', () => {
    expect(() => createVectorStatement({ ...def, dimensions: 0 })).toThrow(TypeError)
    expect(() => createVectorStatement({ ...def, dimensions: 1.5 })).toThrow(TypeError)
    expect(() => createVectorStatement({ ...def, similarityFunction: 'dot' as never })).toThrow(
      TypeError,
    )
  })
})

describe('declaredSchemaObjects', () => {
  class InspectPerson {
    static __ogmUnitFixture?: void
  }

  it('derives the declared set from the registered models', () => {
    const schema: EntitySchema = mergeModel(InspectPerson)

    schema.setLabels(['Person'])
    schema.addProperty('name')
    schema.getProperty('name').setUnique()
    schema.addProperty('email')
    schema.getProperty('email').setIndex()

    const declared = declaredSchemaObjects()

    expect(declared.constraints).toEqual(
      expect.arrayContaining([
        {
          name: 'person_name_unique_bf021514',
          type: 'UNIQUE',
          labelsOrTypes: ['Person'],
          properties: ['name'],
        },
      ]),
    )
    expect(declared.indexes).toEqual(
      expect.arrayContaining([
        {
          name: 'person_email_index_a08ed6c6',
          type: 'INDEX',
          labelsOrTypes: ['Person'],
          properties: ['email'],
        },
      ]),
    )
  })

  it('includes fulltext and vector definitions as indexes', () => {
    const declared = declaredSchemaObjects({
      fulltext: [{ label: 'Movie', properties: ['title', 'plot'] }],
      vector: [{ label: 'Movie', property: 'emb', dimensions: 1536 }],
    })

    expect(declared.indexes).toEqual(
      expect.arrayContaining([
        {
          name: 'movie_plot_title_fulltext_fb2ce53c',
          type: 'FULLTEXT',
          labelsOrTypes: ['Movie'],
          properties: ['title', 'plot'],
        },
        {
          name: 'movie_emb_vector_30fc1ec8',
          type: 'VECTOR',
          labelsOrTypes: ['Movie'],
          properties: ['emb'],
        },
      ]),
    )
  })

  it('only includes existence constraints in enterprise mode', () => {
    class InspectContract {}

    const schema: EntitySchema = mergeModel(InspectContract)

    schema.setLabels(['Contract'])
    schema.addProperty('body')
    schema.getProperty('body').setExists()

    expect(
      declaredSchemaObjects().constraints.every((c) => c.name !== 'contract_body_exists_721ee413'),
    ).toBe(true)
    expect(declaredSchemaObjects({ enterprise: true }).constraints).toEqual(
      expect.arrayContaining([
        {
          name: 'contract_body_exists_721ee413',
          type: 'EXISTS',
          labelsOrTypes: ['Contract'],
          properties: ['body'],
        },
      ]),
    )
  })
})
