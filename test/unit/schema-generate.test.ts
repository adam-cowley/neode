import { describe, expect, it } from 'vitest'
import type { ConnectionProvider, QueryRecord } from '../../src/driver/types'
import { parseGenerateArguments } from '../../src/bin/arguments'
import { NeodeError } from '../../src/errors/index.js'
import {
  buildModel,
  generateModels,
  inferProperty,
  type GeneratedModel,
  type RelationshipWalkRow,
  renderDecoratedModels,
  renderMapModels,
} from '../../src/services/schema/generate.service'

/**
 * Model generation from an existing graph (NTS-164): type inference from
 * sampled values, primary-key suggestion, relationship walks and the
 * rendered output styles — all without a database (fake provider).
 */

const sample = (properties: Record<string, unknown>): QueryRecord => ({
  keys: ['n'],
  get: () => ({ elementId: '1', labels: ['Person'], properties }),
  has: (key) => key === 'n',
})

const record = (values: Record<string, unknown>): QueryRecord => ({
  keys: Object.keys(values),
  get: (key) => values[key],
  has: (key) => key in values,
})

/** Provider answering the labels / constraints / sample / walk statements */
function provider(fixtures: {
  labels: string[]
  constraints?: QueryRecord[]
  samples: Record<string, unknown[]> // label -> node property maps
  walks?: Record<string, Record<string, unknown>[]>
}): ConnectionProvider {
  return {
    run: async (statement: string) => {
      if (statement === 'CALL db.labels()') {
        return { records: fixtures.labels.map((label) => record({ label })) }
      }

      if (statement === 'SHOW CONSTRAINTS') {
        return { records: fixtures.constraints ?? [] }
      }

      const label = /MATCH \(n:`([^`]+)`\)/.exec(statement)?.[1] ?? ''
      const rows = fixtures.samples[label] ?? []

      if (statement.includes('-[r]->(m)')) {
        return { records: fixtures.walks?.[label] ?? [] }
      }

      return { records: rows.map(sample) }
    },
  } as unknown as ConnectionProvider
}

const walk = (values: Record<string, unknown>): RelationshipWalkRow => ({
  type: values['type'] ?? '',
  targetLabels: values['targetLabels'] ?? [],
  count: values['count'] ?? 0,
  sources: values['sources'] ?? 0,
})

describe('inferProperty', () => {
  it('infers the type from observed values and never marks required', () => {
    expect(inferProperty('Person', 'name', ['Ada', 'Grace'])).toEqual({ type: 'string' })
    expect(inferProperty('Person', 'age', [36, 40])).toEqual({ type: 'number' })
    expect(inferProperty('Person', 'active', [true, false])).toEqual({ type: 'boolean' })
    expect(inferProperty('Person', 'tags', [['a', 'b']])).toEqual({ type: 'string', array: true })
  })

  it('returns undefined for properties the sample never observed', () => {
    expect(inferProperty('Person', 'ghost', [])).toBeUndefined()
    expect(inferProperty('Person', 'ghost', [undefined, null])).toBeUndefined()
  })

  it('throws the descriptive mixed-type error naming label, property and both types', () => {
    expect(() => inferProperty('Person', 'salary', [100, 'lots'])).toThrow(NeodeError)
    expect(() => inferProperty('Person', 'salary', [100, 'lots'])).toThrow(
      /:Person[\s\S]*"salary"[\s\S]*number, string/,
    )
  })
})

describe('buildModel', () => {
  it('puts the primary key first with primary: true, the rest alphabetical', () => {
    const model = buildModel(
      'Person',
      [
        { name: 'Ada', id: '1', age: 36 },
        { name: 'Grace', id: '2' },
      ],
      [],
      'id',
      new Set(['Person']),
    )

    expect(model?.primaryKey).toBe('id')
    expect(Object.keys(model?.schema ?? {})).toEqual(['id', 'age', 'name'])
    expect(model?.schema['id']).toEqual({ type: 'string', primary: true })
    // name absent from one sampled node: optional, never required
    expect(model?.schema['name']).toEqual({ type: 'string' })
  })

  it('renders relationships as relatedMany over one from the sampled out-degree', () => {
    const model = buildModel(
      'Person',
      [{ id: '1' }],
      [
        walk({ type: 'ACTED_IN', targetLabels: ['Movie'], count: 4, sources: 2 }),
        walk({ type: 'OWNS', targetLabels: ['Pet'], count: 1, sources: 1 }),
      ],
      'id',
      new Set(['Person', 'Movie', 'Pet']),
    )

    expect(model?.schema['ACTED_IN']).toEqual({
      type: 'relatedMany',
      relationship: 'ACTED_IN',
      direction: 'out',
      target: 'Movie',
    })
    expect(model?.schema['OWNS']).toEqual({
      type: 'relatedOne',
      relationship: 'OWNS',
      direction: 'out',
      target: 'Pet',
    })
  })

  it('skips relationships whose target label is not generated', () => {
    const model = buildModel(
      'Person',
      [{ id: '1' }],
      [walk({ type: 'ACTED_IN', targetLabels: ['Movie'], count: 1, sources: 1 })],
      'id',
      new Set(['Person']),
    )

    expect(model?.relationships).toEqual([])
    expect(model?.schema['ACTED_IN']).toBeUndefined()
  })

  it('rejects two relationship types mapping to one property key', () => {
    expect(() =>
      buildModel(
        'Person',
        [{ id: '1' }],
        [
          walk({ type: 'has-jobs', targetLabels: ['Pet'], count: 1, sources: 1 }),
          walk({ type: 'hasJobs', targetLabels: ['Pet'], count: 1, sources: 1 }),
        ],
        'id',
        new Set(['Person', 'Pet']),
      ),
    ).toThrow(/has-jobs.*hasJobs.*property key "hasJobs"/s)
  })

  it('rejects a relationship colliding with an observed property of the same key', () => {
    expect(() =>
      buildModel(
        'Person',
        [{ id: '1', OWNS: 'thing' }],
        [walk({ type: 'OWNS', targetLabels: ['Pet'], count: 1, sources: 1 })],
        'id',
        new Set(['Person', 'Pet']),
      ),
    ).toThrow(/relationship "OWNS" maps to the property key "OWNS", taken by a property/)
  })
})

describe('renderers', () => {
  const models: GeneratedModel[] = [
    buildModel(
      'Person',
      [{ id: '1', name: 'Ada' }],
      [walk({ type: 'ACTED_IN', targetLabels: ['Movie'], count: 2, sources: 1 })],
      'id',
      new Set(['Person', 'Movie']),
    ),
    buildModel('Movie', [{ id: 'm1', title: 'Solaris' }], [], 'id', new Set(['Person', 'Movie'])),
  ].filter((model) => model !== undefined)

  it('renders decorated classes in the documented shape', () => {
    const typescript = renderDecoratedModels(models)

    expect(typescript).toContain("import { NodeEntity, Property, RelatedMany } from 'neode'")
    expect(typescript).toContain('@NodeEntity()')
    expect(typescript).toContain("@Property({ type: 'string', primary: true }) id?: string")
    expect(typescript).toContain("@Property({ type: 'string' }) name?: string")
    expect(typescript).toContain(
      "@RelatedMany({ type: 'ACTED_IN', direction: 'out', target: () => Movie }) ACTED_IN?: Movie[]",
    )
    expect(typescript).toContain('export class Movie {')
  })

  it('renders map schemas in the documented shape', () => {
    const mapSchema = renderMapModels(models)

    expect(mapSchema).toContain("import { defineModel } from 'neode'")
    expect(mapSchema).toContain("defineModel('Person', {")
    expect(mapSchema).toContain("id: { type: 'string', primary: true }")
    expect(mapSchema).toContain(
      "ACTED_IN: { type: 'relatedMany', relationship: 'ACTED_IN', direction: 'out', target: 'Movie' }",
    )
    expect(mapSchema).toContain("title: { type: 'string' }")
  })
})

describe('generateModels (fake provider)', () => {
  it('walks labels, samples, relationships and constraints end to end', async () => {
    const connection = provider({
      labels: ['Person', 'Empty'],
      constraints: [
        record({
          name: 'person_id_unique',
          type: 'UNIQUE',
          labelsOrTypes: ['Person'],
          properties: ['id'],
        }),
      ],
      samples: {
        Person: [{ id: '1', name: 'Ada' }, { id: '2' }],
        Empty: [],
      },
      walks: {
        Person: [record({ type: 'KNOWS', labels: ['Person'], rels: 3, sources: 1 })],
      },
    })

    const result = await generateModels(connection)

    expect(result.models.map((model) => model.label)).toEqual(['Person'])
    expect(result.models[0]?.primaryKey).toBe('id')
    expect(result.models[0]?.schema['KNOWS']).toMatchObject({ target: 'Person' })
    expect(result.typescript).toContain('export class Person')
    expect(result.mapSchema).toContain("defineModel('Person'")
  })
})

describe('parseGenerateArgs', () => {
  // Environment fallbacks would leak into the assertions otherwise
  const env = { ...process.env }

  const withoutEnv = (run: () => void): void => {
    for (const key of ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD']) {
      delete process.env[key]
    }

    try {
      run()
    } finally {
      Object.assign(process.env, env)
    }
  }

  it('parses flags with env fallbacks', () => {
    const previous = {
      uri: process.env['NEO4J_URI'],
      username: process.env['NEO4J_USERNAME'],
      password: process.env['NEO4J_PASSWORD'],
    }

    process.env['NEO4J_URI'] = 'bolt://env:7687'
    process.env['NEO4J_USERNAME'] = 'env-user'
    process.env['NEO4J_PASSWORD'] = 'env-pass'

    try {
      const parsed = parseGenerateArguments(['--labels', 'Person, Movie', '--sample', '5'])

      expect(parsed.error).toBeUndefined()
      expect(parsed.arguments?.uri).toBe('bolt://env:7687')
      expect(parsed.arguments?.username).toBe('env-user')
      expect(parsed.arguments?.labels).toEqual(['Person', 'Movie'])
      expect(parsed.arguments?.sampleSize).toBe(5)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('rejects missing connection details and unknown flags', () => {
    withoutEnv(() => {
      expect(parseGenerateArguments([]).error).toMatch(/--uri/)

      expect(
        parseGenerateArguments(['--uri', 'bolt://x', '--username', 'n', '--password', 'p', '--wat'])
          .error,
      ).toMatch(/--wat/)

      expect(
        parseGenerateArguments([
          '--uri',
          'bolt://x',
          '--username',
          'n',
          '--password',
          'p',
          '--sample',
          '0',
        ]).error,
      ).toMatch(/--sample/)
    })
  })
})
