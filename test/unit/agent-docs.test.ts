import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractDocs } from '../../scripts/generate-agent-docs.ts'

// Generator runs over src/ only (~120 small files, no node_modules)
const docs = extractDocs(fileURLToPath(new URL('../../src', import.meta.url)))

const areaSymbols = (name: string) => docs.areas.find((area) => area.name === name)?.symbols ?? []
const names = (name: string) => areaSymbols(name).map((symbol) => symbol.name)
const fields = (name: string) => docs.schemaFields[name] ?? []
const fieldNames = (name: string) => fields(name).map((field) => field.name)

describe('generate-agent-docs extraction', () => {
  it('finds the known decorators as public Model definition exports', () => {
    const model = names('Model definition')
    for (const decorator of ['NodeEntity', 'Property', 'Unique', 'Required', 'RelatedOne']) {
      expect(model).toContain(decorator)
    }

    const decorators = areaSymbols('Model definition').filter(
      (symbol) => symbol.kind === 'decorator',
    )
    expect(decorators.length).toBeGreaterThan(30)
  })

  it('extracts PropertyDefinition fields including NTS-445 description and NTS-444 fake', () => {
    const property = fieldNames('PropertyDefinition')
    expect(property).toContain('description')
    expect(property).toContain('fake')
    expect(property).toContain('unique')
    expect(property).toContain('index')
  })

  it('extracts RelationshipDefinition and SchemaDefinition fields', () => {
    expect(fieldNames('RelationshipDefinition')).toEqual(
      expect.arrayContaining(['type', 'relationship', 'direction', 'target', 'description']),
    )
    expect(fieldNames('SchemaDefinition')).toEqual(
      expect.arrayContaining(['labels', 'description']),
    )
  })

  it('carries JSDoc descriptions into schema fields', () => {
    const description = fields('PropertyDefinition').find((field) => field.name === 'description')
    expect(description?.description).toContain('ontology')
  })

  it('returns non-empty areas', () => {
    for (const area of [
      'Model definition',
      'Querying',
      'Schema management',
      'Testing & ops',
      'Errors',
    ]) {
      expect(areaSymbols(area), area).not.toHaveLength(0)
    }
  })

  it('documents the agent-ontology API', () => {
    const ontology = areaSymbols('Model definition').find(
      (symbol) => symbol.name === 'ontologyMarkdown',
    )
    expect(ontology?.summary).toContain('prompt-ready markdown')
  })
})
