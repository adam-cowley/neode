import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { ConnectionProvider, QueryRecord } from '../../src/driver/types'
import { parseGenerateArguments } from '../../src/bin/arguments'
import { NeodeError } from '../../src/errors/index.js'
import {
  assignClassNames,
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
  keys: ['properties'],
  get: () => properties,
  has: (key) => key === 'properties',
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

/**
 * Type-check generated decorated output against a stub of the neode
 * decorator surface (standard TC39 decorators), returning diagnostics and
 * the parsed top-level statements.
 */
const NEODE_STUB = `
type Field = (value: undefined, context: ClassFieldDecoratorContext) => void
export function NodeEntity(config?: { labels?: string[] }): (value: Function, context: ClassDecoratorContext) => void
export function Property(config: { type: string; array?: boolean; primary?: boolean }): Field
export function RelatedOne(config: { type: string; direction: string; target: () => unknown }): Field
export function RelatedMany(config: { type: string; direction: string; target: () => unknown }): Field
`

function compileGenerated(source: string): {
  diagnostics: string[]
  statements: ts.Statement[]
} {
  const files = new Map([
    ['/generated.ts', source],
    [
      '/neode.d.ts',
      `declare module 'neode' {${NEODE_STUB.replaceAll('export function', 'function')}}`,
    ],
  ])
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    types: [],
    skipLibCheck: true,
    lib: ['lib.es2022.d.ts'],
  }
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile } = host

  host.fileExists = (name) => files.has(name) || fileExists(name)
  host.readFile = (name) => files.get(name) ?? readFile(name)
  host.getSourceFile = (name, languageVersion) => {
    const text = files.get(name)

    return text === undefined
      ? getSourceFile(name, languageVersion)
      : ts.createSourceFile(name, text, languageVersion)
  }

  const program = ts.createProgram(['/generated.ts', '/neode.d.ts'], options, host)
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  const statements = [...(program.getSourceFile('/generated.ts')?.statements ?? [])]

  return { diagnostics, statements }
}

describe('hostile graph names (NTS-577)', () => {
  const labels = [
    'X; process.exit()//',
    'a\\',
    'line\nbreak',
    'My-Label',
    'Property',
    'NodeEntity',
    'RelatedOne',
    'RelatedMany',
    'Object',
    'class',
    'A-B',
    'AB',
    'sep\u2028\u2029x',
    "it's",
  ]

  const hostileProperties = {
    id: '1',
    'k\\': 'a',
    'new\nline': 'b',
    'cr\rkey': 'c',
    'sep\u2028key': 'd',
    "quo'te": 'e',
    'a-b': 'f',
    '1st': 'g',
    __proto__: undefined,
  }

  const build = (): { models: GeneratedModel[]; warnings: string[] } => {
    const generated = new Set(labels)
    const classNames = assignClassNames(labels)
    const warnings: string[] = []
    const models = labels
      .map((label) =>
        buildModel(
          label,
          [{ ...hostileProperties, ['constructor']: 'x' }],
          labels
            .filter((target) => target !== label)
            .map((target, index) =>
              walk({
                type: `rel-${String(index)}`,
                targetLabels: [target],
                count: index % 2 === 0 ? 3 : 1,
                sources: 1,
              }),
            ),
          'id',
          generated,
          warnings,
          classNames,
        ),
      )
      .filter((model) => model !== undefined)

    return { models, warnings }
  }

  it('renders decorated output that type-checks with only imports and classes', () => {
    const { models } = build()
    const { diagnostics, statements } = compileGenerated(renderDecoratedModels(models))

    expect(diagnostics).toEqual([])
    expect(
      statements.every(
        (statement) => ts.isImportDeclaration(statement) || ts.isClassDeclaration(statement),
      ),
    ).toBe(true)
    expect(statements.filter(ts.isClassDeclaration)).toHaveLength(labels.length)
  }, 30_000)

  it('assigns unique, valid, non-reserved class names deterministically', () => {
    const names = assignClassNames(labels)
    const forward = [...names.values()]

    expect(new Set(forward).size).toBe(labels.length)
    expect(names.get('AB')).toBe('AB')
    expect(names.get('A-B')).toBe('AB_2')
    expect(names.get('Property')).toBe('Property_2')
    expect(names.get('class')).toBe('class_2')
    expect(names.get('Object')).toBe('Object_2')
    expect(names.get('My-Label')).toBe('MyLabel')
    expect(Object.fromEntries(assignClassNames([...labels].reverse()))).toEqual(
      Object.fromEntries(names),
    )
  })

  it('emits the target class name, never the raw label, in relationship declarations', () => {
    const { models } = build()
    const typescript = renderDecoratedModels(models)

    expect(typescript).not.toContain('process.exit()//]')
    expect(typescript).toContain('target: () => AB_2')
    expect(typescript).toContain('target: () => Property_2')
    expect(typescript).not.toMatch(/target: \(\) => [^A-Za-z_$]/)
    expect(models[0]?.relationships.every((relationship) => relationship.target !== '')).toBe(true)
  })

  it('escapes names as string literals and keeps map output parseable', () => {
    const { models } = build()
    const map = renderMapModels(models)
    const transpiled = ts.transpileModule(map, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    })
    const parsed = ts.createSourceFile('map.ts', map, ts.ScriptTarget.ES2022)

    expect(
      (transpiled.diagnostics ?? []).map((item) =>
        ts.flattenDiagnosticMessageText(item.messageText, ' '),
      ),
    ).toEqual([])
    expect(
      parsed.statements.every(
        (statement) => ts.isImportDeclaration(statement) || ts.isExpressionStatement(statement),
      ),
    ).toBe(true)
    expect(map).toContain("'k\\\\'")
    expect(map).toContain("'new\\nline'")
    expect(map).toContain("'sep\\u2028key'")
  })

  it('skips undeclarable keys with warnings instead of throwing', () => {
    const { models, warnings } = build()

    expect(warnings.some((warning) => warning.includes('"constructor"'))).toBe(true)
    expect(
      models.every(
        (model) =>
          !('constructor' in model.properties && Object.hasOwn(model.properties, 'constructor')),
      ),
    ).toBe(true)
  })
})

describe('conflicts as warnings (NTS-577)', () => {
  it('collects type conflicts and relationship clashes, keeping the rest of the model', async () => {
    const connection = provider({
      labels: ['Person', 'Pet'],
      samples: {
        Person: [
          { id: '1', salary: 100, OWNS: 'x' },
          { id: '2', salary: 'lots' },
        ],
        Pet: [{ id: 'p' }],
      },
      walks: {
        Person: [record({ type: 'OWNS', labels: ['Pet'], rels: 1, sources: 1 })],
      },
    })

    const result = await generateModels(connection)

    expect(result.models.map((model) => model.label)).toEqual(['Person', 'Pet'])
    expect(result.models[0]?.schema['salary']).toBeUndefined()
    expect(result.models[0]?.schema['id']).toBeDefined()
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings.join('\n')).toMatch(/"salary"/)
    expect(result.warnings.join('\n')).toMatch(/relationship "OWNS"/)
  })

  it('samples before walking: LIMIT precedes the relationship match, bounded and parameterised', async () => {
    const statements: { statement: string; parameters: unknown }[] = []
    const base = provider({ labels: ['Person'], samples: { Person: [{ id: '1' }] } })
    const connection = {
      run: (statement: string, parameters: unknown, mode: unknown) => {
        statements.push({ statement, parameters })

        return (base.run as (...arguments_: unknown[]) => Promise<unknown>)(
          statement,
          parameters,
          mode,
        )
      },
    } as unknown as ConnectionProvider

    await generateModels(connection, { sampleSize: 7 })

    const walkStatement = statements.find((entry) => entry.statement.includes('-[r]->'))

    expect(walkStatement?.statement).toMatch(/WITH n LIMIT 7 MATCH \(n\)-\[r\]->\(m\)/)
    expect(walkStatement?.statement).not.toContain('$limit')
    expect(statements.some((entry) => /RETURN n\b/.test(entry.statement))).toBe(false)
  })
})
