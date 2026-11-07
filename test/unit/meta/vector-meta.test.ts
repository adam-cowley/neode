import { describe, expect, it } from 'vitest'
import { getModel } from '../../../src/meta'
import { defineModel } from '../../../src/meta/map-schema'
import { Property, Vector } from '../../../src/decorators'
import { vectorIndexDefinitionsForLabel } from '../../../src/services/schema/schema.service'
import { createVectorStatement, vectorIndexName } from '../../../src/services/schema/vector.service'
import type { PropertySchema } from '../../../src/meta/property-schema'

/**
 * Vector property metadata (NTS-447): the config flows from the @Vector
 * decorator and the map API into the model metadata, and the schema sync
 * derives VectorIndexDefinitions from it (statement generation itself is
 * covered by the vector.service tests / integration suite).
 */

// ---- Fixtures (per-file: decorator registry is global per module registry) --

class VectorDoc {
  @Property({ type: 'float', array: true })
  @Vector({ dimensions: 3, similarityFunction: 'euclidean' })
  emb: number[]

  @Vector({ dimensions: 1536 })
  embedding: number[]
}

const MappedDoc = defineModel('VectorMetaMappedDoc', {
  emb: { type: 'float', array: true, vector: { dimensions: 3 } },
})

// ---------------------------------------------------------------------------

describe('vector property metadata (NTS-447)', () => {
  it('registers the vector config from the @Vector decorator', () => {
    const schema = getModel(VectorDoc)

    expect(schema.getProperty('emb').getVector()).toEqual({
      dimensions: 3,
      similarityFunction: 'euclidean',
    })
  })

  it('defaults the similarity function when omitted', () => {
    const schema = getModel(VectorDoc)

    expect(schema.getProperty('embedding').getVector()).toEqual({ dimensions: 1536 })
  })

  it('keeps the stacked type decorator intact', () => {
    const schema = getModel(VectorDoc)

    expect(schema.getProperty('emb').isArray()).toBe(true)
  })

  it('registers the vector config from the map API', () => {
    const property: PropertySchema = getModel(MappedDoc).getProperty('emb')

    expect(property.getVector()).toEqual({ dimensions: 3 })
  })

  it('derives a VectorIndexDefinition per vector property, named by vectorIndexName', () => {
    const properties = getModel(VectorDoc).getProperties()
    const definitions = vectorIndexDefinitionsForLabel('VectorDoc', properties)

    expect(definitions).toEqual([
      {
        label: 'VectorDoc',
        property: 'emb',
        dimensions: 3,
        similarityFunction: 'euclidean',
      },
      {
        label: 'VectorDoc',
        property: 'embedding',
        dimensions: 1536,
      },
    ])

    expect(definitions.map(vectorIndexName)).toEqual([
      'vectordoc_emb_vector',
      'vectordoc_embedding_vector',
    ])
  })

  it('renders the create statement from the derived definition (cosine default)', () => {
    const [definition] = vectorIndexDefinitionsForLabel(
      'VectorDoc',
      getModel(MappedDoc).getProperties(),
    )

    expect(createVectorStatement(definition)).toBe(
      'CREATE VECTOR INDEX vectordoc_emb_vector IF NOT EXISTS ' +
        'FOR (n:`VectorDoc`) ON (n.`emb`) ' +
        "OPTIONS { indexConfig: { `vector.dimensions`: 3, `vector.similarity_function`: 'cosine' } }",
    )
  })

  it('derives nothing for models without vector properties', () => {
    const Plain = defineModel('VectorMetaPlainDoc', { title: 'string' })

    expect(
      vectorIndexDefinitionsForLabel('VectorMetaPlainDoc', getModel(Plain).getProperties()),
    ).toEqual([])
  })
})
