import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  extractDocs,
  renderAgentsMd,
  renderLlmsFull,
  renderLlmsTxt,
  renderPages,
  renderSkillMd,
} from '../../scripts/generate-agent-docs.ts'

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

  it('extracts symbols exported under an alias (expr / caseExpr)', () => {
    const querying = areaSymbols('Querying')

    const expr = querying.find((symbol) => symbol.name === 'expr')
    expect(expr?.summary).toContain('Leaf Cypher expression helpers')

    const caseExpr = querying.find((symbol) => symbol.name === 'caseExpr')
    expect(caseExpr?.summary).toContain('CASE')
  })
})

describe('per-page markdown (NTS-163)', () => {
  const pages = renderPages(docs, '0.0.0-test')
  const paths = pages.map((page) => page.path)

  it('emits one page per doc area plus schema reference, ontology and auditing', () => {
    expect(paths).toEqual([
      ...docs.areas.map(
        (area) => `docs/agent/${area.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
      ),
      'docs/agent/schema-reference.md',
      'docs/agent/agent-ontology-api.md',
      'docs/agent/auditing.md',
    ])
  })

  it('version-pins every page and carries the not-training-data note', () => {
    for (const page of pages) {
      expect(page.content, page.path).toContain('v0.0.0-test')
      expect(page.content, page.path).toContain('not training data')
    }
  })

  it('every docs/agent link in llms.txt resolves to a generated page', () => {
    const llms = renderLlmsTxt(docs, '0.0.0-test')
    const links = [...llms.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1] ?? '')
    for (const link of links) {
      if (!link.startsWith('docs/agent/')) continue
      expect(paths, link).toContain(link)
    }
    expect(links).toContain('docs/agent/querying.md')
    expect(links).toContain('skills/neode/SKILL.md')
  })
})

describe('skills pack (NTS-163)', () => {
  const skill = renderSkillMd('0.0.0-test')

  it('is an installable skill: frontmatter name + description', () => {
    expect(skill.startsWith('---\nname: neode\ndescription: ')).toBe(true)
  })

  it('covers define / query / relate / transact and common mistakes', () => {
    for (const section of [
      '## Define models',
      '## Query',
      '## Relate',
      '## Transact',
      '## Common mistakes',
    ]) {
      expect(skill, section).toContain(section)
    }
  })

  it('version-pins, warns off training data, and teaches the string property form', () => {
    expect(skill).toContain('v0.0.0-test')
    expect(skill).toContain('not training data')
    // NTS-670: the deprecated @String is removed — the skill must not teach it
    expect(skill).not.toContain('@String')
  })
})

describe('decorators-first default (NTS-583)', () => {
  const outputs: Array<[string, string]> = [
    ['AGENTS.md', renderAgentsMd(docs, '0.0.0-test')],
    ['llms.txt', renderLlmsTxt(docs, '0.0.0-test')],
    ['llms-full.txt', renderLlmsFull(docs, '0.0.0-test')],
    ['SKILL.md', renderSkillMd('0.0.0-test')],
    ...renderPages(docs, '0.0.0-test').map((page) => [page.path, page.content] as [string, string]),
  ]

  it('states the decorators-default rule in every generated output', () => {
    for (const [name, content] of outputs) {
      expect(content, name).toContain('Default to decorators')
      expect(content, name).toContain('`defineModel` (the')
      expect(content, name).toContain('experimentalDecorators')
      expect(content, name).toContain('reflect-metadata')
    }
  })

  it('shows the rule before the model-definition guidance in AGENTS.md', () => {
    const agents = renderAgentsMd(docs, '0.0.0-test')
    expect(agents.indexOf('Default to decorators')).toBeLessThan(agents.indexOf('## Rules'))
    expect(agents).not.toContain('Two equivalent APIs')
  })

  it('presents the map API as the alternative, decorators first', () => {
    const skill = renderSkillMd('0.0.0-test')
    expect(skill).not.toContain('Two equivalent APIs')
    expect(skill.indexOf('@NodeEntity()')).toBeLessThan(skill.indexOf('defineModel('))
    expect(skill).toContain('Alternative')
  })
})
