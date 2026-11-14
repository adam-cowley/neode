/**
Generate the agent-facing docs at the package root from the source tree:
public exports + their JSDoc, the schema-definition interface fields, and
the agent-ontology API. Emits llms.txt, llms-full.txt, AGENTS.md, the
per-page markdown under docs/agent/ (one page per area, linked from
llms.txt) and the skills pack at skills/neode/SKILL.md.

Usage: jiti scripts/generate-agent-docs.ts [--check]

  (no flags)  regenerate the files in place (docs/agent/ is fully generated:
              stale pages are removed)
  --check     do not write; exit 1 if regeneration would change any file
              (CI staleness check)
*/
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

export interface ExtractedSymbol {
  name: string
  kind: string
  /** Path relative to src/ */
  file: string
  /** Flattened JSDoc text, '' when the symbol has none */
  summary: string
}

export interface Area {
  name: string
  blurb: string
  symbols: ExtractedSymbol[]
}

export interface InterfaceField {
  name: string
  type: string
  optional: boolean
  description: string
}

export interface ExtractedDocs {
  areas: Area[]
  /** Keyed by interface name (PropertyDefinition, RelationshipDefinition, SchemaDefinition) */
  schemaFields: Record<string, InterfaceField[]>
}

interface AreaDef {
  name: string
  blurb: string
  test: (rel: string) => boolean
}

const AREAS: AreaDef[] = [
  {
    name: 'Model definition',
    blurb:
      'Decorators and the map-based defineModel API for declaring nodes, properties and relationships.',
    test: (rel) =>
      /^(decorators|meta)\//.test(rel) ||
      /^neode\.(service|interface)/.test(rel) ||
      /^entity-methods/.test(rel),
  },
  {
    name: 'Querying',
    blurb:
      'Query builder, repositories, raw Cypher, transactions, hydration, drivers and read-model projections.',
    test: (rel) =>
      /^(query|driver|repository|projection|services\/query)\//.test(rel) ||
      /^(hydrate|collection|serialise|transaction|common)/.test(rel),
  },
  {
    name: 'Schema management',
    blurb:
      'Indexes, constraints, full-text and vector indexes, schema inspection and drift workflow.',
    test: (rel) => rel.startsWith('services/schema/'),
  },
  {
    name: 'Testing & ops',
    blurb:
      'wipe()/testId() test utilities, factory seeding, connectivity checks and Cypher-script helpers.',
    test: (rel) => /^(testing|ops)\//.test(rel) || rel.startsWith('services/factory'),
  },
  {
    name: 'Errors',
    blurb:
      'Typed error taxonomy and driver-error classification. House rule (NTS-442): every error names what failed, where, why, and suggests the fix — `<what failed> in <where> — <why>. <suggested fix>`, with did-you-mean suggestions for near-miss keys. Driver failures carry the failing statement with REDACTED parameters (keys and shapes, never values); ValidationError lists every failing property, not just the first.',
    test: (rel) => rel.startsWith('errors/') || /(^|\/)errors?\./.test(rel),
  },
]

const CORE_DEF: AreaDef = {
  name: 'Core',
  blurb: 'Collection, serialisation and other shared exports.',
  test: () => true,
}

const areaFor = (rel: string): AreaDef => AREAS.find((area) => area.test(rel)) ?? CORE_DEF

/** The main default export is not re-exported by name, so seed it manually */
const MANUAL_PUBLIC = ['Neode']

/** Every name exported from src/index.ts, following `export *` re-export chains. */
function publicNames(indexFile: string): Set<string> {
  const names = new Set<string>(MANUAL_PUBLIC)

  const visit = (file: string, depth: number): void => {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement)) continue
      const specifier =
        statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined
      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text)
          if (element.propertyName !== undefined) names.add(element.propertyName.text)
        }
      } else if (statement.exportClause === undefined && specifier !== undefined && depth > 0) {
        const target = specifier.replace(/\.js$/, '.ts')
        const resolved = path.resolve(path.dirname(file), target)
        if (fs.existsSync(resolved)) visit(resolved, depth - 1)
      }
    }
  }

  visit(indexFile, 4)
  return names
}

/** Flatten a JSDoc node's comment (string or rich-node array) to plain text. */
function flattenComment(comment: unknown): string {
  if (comment === undefined || comment === null) return ''
  if (typeof comment === 'string') return comment
  if (Array.isArray(comment)) return comment.map(flattenComment).join('')
  const node = comment as { text?: string; comment?: unknown; getText?(sf: ts.SourceFile): string }
  if (typeof node.text === 'string') return node.text
  if (node.comment !== undefined) return flattenComment(node.comment)
  return ''
}

function jsdocSummary(node: ts.Node): string {
  const jsDoc = (node as { jsDoc?: ts.JSDoc[] }).jsDoc
  if (jsDoc === undefined || jsDoc.length === 0) return ''
  const text = flattenComment(jsDoc[0]?.comment)
  return text.replace(/\s+/g, ' ').trim()
}

const KIND_NAMES: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.ClassDeclaration]: 'class',
  [ts.SyntaxKind.FunctionDeclaration]: 'function',
  [ts.SyntaxKind.InterfaceDeclaration]: 'interface',
  [ts.SyntaxKind.TypeAliasDeclaration]: 'type',
  [ts.SyntaxKind.EnumDeclaration]: 'enum',
  [ts.SyntaxKind.VariableStatement]: 'const',
}

function walkSymbols(source: ts.SourceFile, rel: string): ExtractedSymbol[] {
  const found: ExtractedSymbol[] = []

  const emit = (publicName: string, statement: ts.Statement, kind: string): void => {
    // Everything exported from src/decorators/ is a decorator factory
    const isDecorator =
      rel.startsWith('decorators/') &&
      (statement.kind === ts.SyntaxKind.FunctionDeclaration ||
        statement.kind === ts.SyntaxKind.ClassDeclaration)

    found.push({
      name: publicName,
      kind: isDecorator ? 'decorator' : kind,
      file: rel,
      summary: jsdocSummary(statement),
    })
  }

  const declarationNames = (statement: ts.Statement): ts.Identifier[] => {
    const declarationName = ts.getNameOfDeclaration(statement as unknown as ts.Declaration)
    return ts.isVariableStatement(statement)
      ? statement.declarationList.declarations
          .map((declaration) => declaration.name)
          .filter(ts.isIdentifier)
      : declarationName !== undefined && ts.isIdentifier(declarationName)
        ? [declarationName]
        : []
  }

  // Pass 1 — inline-exported declarations; unexported locals recorded for
  // pass 2 (the JSDoc lives on the local, the public name is the alias)
  const locals = new Map<string, { statement: ts.Statement; kind: string }>()

  for (const statement of source.statements) {
    const kind = KIND_NAMES[statement.kind]
    if (kind === undefined) continue
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false

    for (const nameNode of declarationNames(statement)) {
      if (isExported) {
        emit(nameNode.text, statement, kind)
      } else {
        locals.set(nameNode.text, { statement, kind })
      }
    }
  }

  // Pass 2 — local export lists (`export { local as alias }`): keyed by the
  // exported alias, which is the name publicNames() and the package index use
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier !== undefined ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue
    }

    for (const element of statement.exportClause.elements) {
      const localName =
        element.propertyName !== undefined ? element.propertyName.text : element.name.text
      const local = locals.get(localName)

      if (local !== undefined) {
        emit(element.name.text, local.statement, local.kind)
      }
    }
  }

  return found
}

/** Collect the fields of one interface declaration from a source file. */
function extractInterface(source: ts.SourceFile, name: string): InterfaceField[] {
  const fields: InterfaceField[] = []

  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== name) continue
    for (const member of statement.members) {
      if (ts.isPropertySignature(member) && member.name !== undefined) {
        const memberName = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(source)
        fields.push({
          name: memberName,
          type: member.type?.getText(source).replace(/\s+/g, ' ') ?? 'unknown',
          optional: member.questionToken !== undefined,
          description: jsdocSummary(member),
        })
      } else if (ts.isIndexSignatureDeclaration(member)) {
        fields.push({
          name: '[key: string]',
          type: member.type?.getText(source).replace(/\s+/g, ' ') ?? 'unknown',
          optional: false,
          description: jsdocSummary(member),
        })
      }
    }
  }

  return fields
}

const SCHEMA_INTERFACES = ['PropertyDefinition', 'RelationshipDefinition', 'SchemaDefinition']
const SCHEMA_FILE = 'meta/schema-definition.interface.ts'

/**
Core extraction: walk src/**, pull public exported symbols + JSDoc grouped
by area, and the schema-definition interface fields. Exported for unit tests.
*/
export function extractDocs(srcDir: string): ExtractedDocs {
  const publicSet = publicNames(path.join(srcDir, 'index.ts'))
  const byArea = new Map<string, ExtractedSymbol[]>(
    AREAS.map((a) => [a.name, [] as ExtractedSymbol[]]),
  )
  byArea.set(CORE_DEF.name, [])

  const files = walkDir(srcDir)
  for (const file of files) {
    const rel = path.relative(srcDir, file).split(path.sep).join('/')
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    for (const symbol of walkSymbols(source, rel)) {
      if (!publicSet.has(symbol.name)) continue
      const bucket = byArea.get(areaFor(rel).name)
      bucket?.push(symbol)
    }
  }

  const dedupe = (symbols: ExtractedSymbol[]): ExtractedSymbol[] => {
    const seen = new Map<string, ExtractedSymbol>()
    for (const symbol of symbols) if (!seen.has(symbol.name)) seen.set(symbol.name, symbol)
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  const areas = [...AREAS, CORE_DEF]
    .map((area) => ({
      name: area.name,
      blurb: area.blurb,
      symbols: dedupe(byArea.get(area.name) ?? []),
    }))
    .filter((area) => area.symbols.length > 0)

  const schemaSource = path.join(srcDir, SCHEMA_FILE)
  const parsed = ts.createSourceFile(
    schemaSource,
    fs.readFileSync(schemaSource, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const schemaFields: Record<string, InterfaceField[]> = {}
  for (const name of SCHEMA_INTERFACES) schemaFields[name] = extractInterface(parsed, name)

  return { areas, schemaFields }
}

function walkDir(dir: string): string[] {
  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath ?? dir, entry.name))
    .sort()
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

function symbolLine(symbol: ExtractedSymbol): string {
  const summary = symbol.summary === '' ? '' : ` — ${symbol.summary}`
  return `- \`${symbol.name}\` (${symbol.kind})${summary}`
}

function symbolSections(symbols: ExtractedSymbol[]): string[] {
  const lines: string[] = []
  for (const symbol of symbols) {
    lines.push(`### \`${symbol.name}\` (${symbol.kind})`, '')
    if (symbol.summary !== '') lines.push(symbol.summary, '')
    lines.push(`_source: ${symbol.file}_`, '')
  }
  return lines
}

const GENERATED_HEADER = '<!-- generated by pnpm docs:agents — do not edit by hand -->'

const ONTOLOGY_EXAMPLE = `\`\`\`ts
import { ontology, ontologyMarkdown } from 'neode'

// Ground a Text2Cypher prompt: hand the LLM the live schema, not its
// training-data memory of it.
const systemPrompt = [
  'You write Cypher against the graph described below.',
  'Only use the entities, properties and relationships listed.',
  '',
  ontologyMarkdown(),
].join('\\n')

// Or expose it over MCP as a resource / tool result:
server.resource('graph-ontology', () => ontologyMarkdown())
server.tool('describe-ontology', async () => ({ content: [{ type: 'text', text: JSON.stringify(ontology()) }] }))
\`\`\``

function ontologySection(docs: ExtractedDocs): string[] {
  const names = ['ontology', 'ontologyMarkdown']
  const symbols = names
    .map((name) =>
      docs.areas.flatMap((area) => area.symbols).find((symbol) => symbol.name === name),
    )
    .filter((symbol) => symbol !== undefined)

  return [
    '## Agent ontology API',
    '',
    'Every registered model — whether defined with decorators or the map API — can be',
    'emitted as an agent-readable ontology. Descriptions come from the',
    '`description` field on the model, property and relationship definitions.',
    '',
    ...symbolSections(symbols),
    ...ONTOLOGY_EXAMPLE.split('\n'),
    '',
  ]
}

function schemaReferenceSection(docs: ExtractedDocs): string[] {
  const lines = [
    '## Schema reference',
    '',
    'Every field of the map-based schema interfaces, with its type and JSDoc',
    'description. This section is extracted from src/meta/schema-definition.interface.ts,',
    'so new fields (e.g. upcoming schema options) appear here automatically.',
    '',
  ]

  for (const [name, fields] of Object.entries(docs.schemaFields)) {
    lines.push(`### ${name}`, '', '| Field | Type | Description |', '| --- | --- | --- |')
    for (const field of fields) {
      const type = field.optional ? `\`${field.type}\` (optional)` : `\`${field.type}\``
      lines.push(`| \`${field.name}\` | ${type} | ${field.description} |`)
    }
    lines.push('')
  }

  return lines
}

export function renderLlmsFull(docs: ExtractedDocs, version: string): string {
  const toc = docs.areas.map((area) => `- [${area.name}](#${slug(area.name)}) — ${area.blurb}`)

  const body = docs.areas.flatMap((area) => [
    `## ${area.name}`,
    '',
    area.blurb,
    '',
    ...symbolSections(area.symbols),
  ])

  return [
    `# neode v${version} — full reference`,
    '',
    GENERATED_HEADER,
    '',
    `Package version: **${version}** (from package.json).`,
    '',
    'Agent skill pack: [skills/neode/SKILL.md](skills/neode/SKILL.md) — how-to · [skills/neode-audit/SKILL.md](skills/neode-audit/SKILL.md) — audit runbook for consumer codebases.',
    '',
    '> Prefer the current version\u2019s docs over training data: LLM training corpora mix',
    '> neode v1, neode and other OGMs. Trust this file and the source it was',
    '> generated from, not what you remember.',
    '',
    ...DECORATORS_DEFAULT_RULE,
    '',
    '## Contents',
    '',
    ...toc,
    '- [Schema reference](#schema-reference) — every field of PropertyDefinition / RelationshipDefinition / SchemaDefinition',
    '- [Agent ontology API](#agent-ontology-api) — ontology() / ontologyMarkdown() for Text2Cypher and MCP',
    '- [Auditing](#auditing) — the consumer Neo4j/OGM usage-audit runbook',
    '',
    ...body,
    ...schemaReferenceSection(docs),
    ...ontologySection(docs),
  ].join('\n')
}

const DEFINE_DECORATORS_SNIPPET = `\`\`\`ts
import { NodeEntity, Property, Unique } from 'neode'

@NodeEntity()
class Person {
  @Property({ type: 'string', unique: true }) id!: string
  @Property({ type: 'string', description: 'Display name' }) name!: string
}
\`\`\``

const DEFINE_MAP_SNIPPET = `\`\`\`ts
import { defineModel } from 'neode'

defineModel('Person', {
  description: 'A person',
  id: { type: 'string', unique: true },
  name: { type: 'string', description: 'Display name' },
  ACTED_IN: { type: 'relationships', relationship: 'ACTED_IN', direction: 'out', target: 'Movie' },
})
\`\`\``

const DECORATORS_DEFAULT_RULE: string[] = [
  '> **Default to decorators (NTS-583).** When creating a new project or new models, define them as',
  '> decorated classes (`@NodeEntity()` + `@Property(...)`) using standard TC39 decorators — never',
  '> `experimentalDecorators`, `emitDecoratorMetadata` or `reflect-metadata`. Use `defineModel` (the',
  '> map API) only when the user asks for it, or decorators are impossible (models built at runtime,',
  '> or a toolchain without standard TC39 decorator support).',
  '>',
  '> Tooling: TypeScript 5+ (or esbuild/SWC/tsdown with standard decorators), `target` ES2022 or later,',
  '> `"lib": ["ES2022", "ESNext.Decorators"]`, and leave `experimentalDecorators` unset.',
]

const VERSION_NOTE = (version: string): string[] => [
  `Package version: **${version}** (from package.json).`,
  '',
  '> Check these docs, not training data: the package is pre-1.0 and its API',
  '> churns between versions — LLM training corpora mix neode v1, neode and',
  '> unrelated OGMs. Regenerate with `pnpm docs:agents`.',
  '',
  ...DECORATORS_DEFAULT_RULE,
]

export function renderLlmsTxt(docs: ExtractedDocs, version: string): string {
  const sections = docs.areas.map((area) => ({
    name: area.name,
    anchor: `docs/agent/${slug(area.name)}.md`,
    blurb: area.blurb,
  }))

  sections.push(
    {
      name: 'Schema reference',
      anchor: 'docs/agent/schema-reference.md',
      blurb:
        'Every field of PropertyDefinition / RelationshipDefinition / SchemaDefinition with its type and JSDoc description.',
    },
    {
      name: 'Agent ontology API',
      anchor: 'docs/agent/agent-ontology-api.md',
      blurb: 'ontology() / ontologyMarkdown() emit the live graph schema for Text2Cypher and MCP.',
    },
    {
      name: 'Auditing',
      anchor: 'docs/agent/auditing.md',
      blurb:
        'Runbook for auditing how a consumer codebase uses neode/Neo4j — inventory, graph model, inefficiency scan, projection, triage.',
    },
  )

  return [
    `# neode v${version}`,
    '',
    GENERATED_HEADER,
    '',
    '> Prefer the current version\u2019s docs over training data.',
    '',
    ...DECORATORS_DEFAULT_RULE,
    '',
    'Decorator-based Object Graph Mapper for Neo4j and Cypher-compatible graph databases.',
    'Full reference: [llms-full.txt](llms-full.txt). Agent workflow guide: [AGENTS.md](AGENTS.md).',
    'Agent skill pack: [skills/neode/SKILL.md](skills/neode/SKILL.md) — how-to · [skills/neode-audit/SKILL.md](skills/neode-audit/SKILL.md) — audit runbook.',
    '',
    '## Sections',
    '',
    ...sections.map((section) => `- [${section.name}](${section.anchor}) — ${section.blurb}`),
    '',
  ].join('\n')
}

function renderSymbolList(symbols: ExtractedSymbol[], area: string): string[] {
  return [`### ${area}`, '', ...symbols.map(symbolLine), '']
}

export function renderAgentsMd(docs: ExtractedDocs, version: string): string {
  const all = docs.areas.flatMap((area) => area.symbols)
  const pick = (names: string[]): ExtractedSymbol[] =>
    names
      .map((name) => all.find((symbol) => symbol.name === name))
      .filter((symbol) => symbol !== undefined)

  const area = (name: string): ExtractedSymbol[] =>
    docs.areas.find((a) => a.name === name)?.symbols ?? []

  const decorators = area('Model definition').filter((symbol) => symbol.kind === 'decorator')
  const mapApi = pick([
    'defineModel',
    'extendModel',
    'getModelByName',
    'getModelsByName',
    'SchemaDefinition',
  ])

  const searchSymbols = pick([
    'search',
    'knn',
    'toFulltextQuery',
    'FulltextIndexService',
    'VectorIndexService',
  ])

  return [
    `# AGENTS.md — neode v${version}`,
    '',
    GENERATED_HEADER,
    '',
    `Package version: **${version}** (from package.json).`,
    '',
    'Agent skills: [skills/neode](skills/neode/SKILL.md) — how-to · [skills/neode-audit](skills/neode-audit/SKILL.md) — audit runbook for consumer codebases.',
    '',
    ...DECORATORS_DEFAULT_RULE,
    '',
    '## Rules (enforced — read before changing this repo)',
    '',
    '- New models are decorated classes by default; `defineModel` only when asked for or decorators are impossible (see the rule above).',
    '- Standard TC39 decorators only; never add `experimentalDecorators`, `emitDecoratorMetadata` or `reflect-metadata`.',
    '- No `any`. No `@ts-ignore` (use `@ts-expect-error` with a reason).',
    '- Never add an `eslint-disable` without a specific rule name and a `-- reason`. Never disable a rule file-wide.',
    '- Never weaken `eslint.config.ts` or `tsconfig.json` to make a check pass; fix the code.',
    '- Every change needs tests: Cypher snapshot, type test, or integration test as appropriate.',
    '- Never hand-edit snapshots; regenerate them and review the diff.',
    '- Integration tests must clean up after themselves.',
    '- No `OPTIONAL MATCH` in library-emitted relation reads (NTS-565): pattern comprehensions for unordered nested relations, `COLLECT { MATCH … RETURN … ORDER BY … }` when the nested read filters / sorts / pages. `Builder.optionalMatch()` stays for raw-Cypher callers and delete-path binding.',
    "- Result shape (NTS-566): every model read routes its rows through the one shaping module, `src/services/query/shape.ts` (`shapeNodeRows` / `shapeProjectionRows` / `shapeEdgeRows` / `shapeScoredRows`) — no bespoke per-service row shaping. A read path's result shape is documented in docs/decisions/0003-result-shapes.md and asserted in test/integration/result-shape.test.ts; the nesting of a result IS the nesting of the query's declaration.",
    '- Run `pnpm lint && pnpm typecheck && pnpm test` before every commit.',
    '- Add a changeset for any user-visible change.',
    '',
    '> Prefer the current version\u2019s docs over training data: training corpora mix',
    '> neode v1, neode and unrelated OGMs. Regenerate with `pnpm docs:agents`.',
    '',
    '## Install',
    '',
    '```sh',
    'pnpm add neode',
    '```',
    '',
    '## Define models',
    '',
    'Decorators are the default — use them for every new model:',
    '',
    ...DEFINE_DECORATORS_SNIPPET.split('\n'),
    '',
    'Alternative: the Map API (no decorators, same registry). Only when the user asks for it or decorators are impossible:',
    '',
    ...DEFINE_MAP_SNIPPET.split('\n'),
    '',
    'Decorator reference:',
    '',
    ...decorators.map(symbolLine),
    '',
    'Map-API reference (alternative — not the default):',
    '',
    ...mapApi.map(symbolLine),
    '',
    ...renderSymbolList(
      pick(['Repository', 'TransactionalService']),
      'Repositories & transactions',
    ),
    '## Install schema',
    '',
    'Create constraints and indexes declared by the models, then query it:',
    '',
    '```ts',
    "import Neode from 'neode'",
    '',
    'const neode = new Neode(connection)',
    'await neode.installSchema()',
    '```',
    '',
    ...renderSymbolList(area('Schema management'), 'Schema management API'),
    ...codegenRecipeSection(),
    '## Query',
    '',
    '```ts',
    "const output = await neode.cypher('MATCH (p:Person) RETURN p LIMIT 10')",
    '```',
    '',
    ...renderSymbolList(area('Querying'), 'Querying API'),
    '## kNN & full-text search',
    '',
    '```ts',
    "import { knn, search, toFulltextQuery } from 'neode'",
    '',
    "const vectorHits = await knn(runner, 'Person', 'person_plot_vector', vector, 5)",
    "const textHits = await search(runner, 'Person', 'person_plot', toFulltextQuery(query))",
    '```',
    '',
    ...renderSymbolList(searchSymbols, 'Search API'),
    '## Testing',
    '',
    '```ts',
    "import { wipe, testId } from 'neode'",
    '',
    'await wipe(neode, { confirm: true }) // DESTRUCTIVE: drop every constraint + all data (local test DBs only)',
    "const name = testId('person') // unique per-run ids, safe for parallel suites",
    '```',
    '',
    ...renderSymbolList(area('Testing & ops'), 'Testing & ops API'),
    '## Errors',
    '',
    ...renderSymbolList(area('Errors'), 'Error taxonomy'),
    '## Agent ontology API',
    '',
    'Emit the live graph schema for grounding Text2Cypher prompts or MCP resources:',
    '',
    ...ONTOLOGY_EXAMPLE.split('\n'),
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Per-page markdown + skills pack
// ---------------------------------------------------------------------------

export interface DocPage {
  /** Repo-relative path, e.g. docs/agent/querying.md */
  path: string
  content: string
}

/** One generated markdown page per doc area, plus schema-reference and agent-ontology. llms.txt links to these. */
export function renderPages(docs: ExtractedDocs, version: string): DocPage[] {
  const page = (name: string, blurb: string, body: string[]): DocPage => ({
    path: `docs/agent/${slug(name)}.md`,
    content: [
      `# ${name} — neode v${version}`,
      '',
      GENERATED_HEADER,
      '',
      ...VERSION_NOTE(version),
      '',
      blurb,
      '',
      ...body,
    ].join('\n'),
  })

  const pages = docs.areas.map((area) =>
    page(
      area.name,
      area.blurb,
      // NTS-632: the raw-rows recipe rides the Querying page, below the
      // generated symbol reference. NTS-682: the adopt-an-existing-graph
      // recipe rides the Schema management page the same way.
      area.name === 'Querying'
        ? [...symbolSections(area.symbols), ...queryingRecipeSection(), ...trustBoundarySection()]
        : area.name === 'Schema management'
          ? [...symbolSections(area.symbols), ...codegenRecipeSection()]
          : symbolSections(area.symbols),
    ),
  )

  // The section renderers open with '## Name' + blank; the page title replaces that heading
  pages.push(
    page(
      'Schema reference',
      'Every field of PropertyDefinition / RelationshipDefinition / SchemaDefinition, extracted from src/meta/schema-definition.interface.ts.',
      schemaReferenceSection(docs).slice(2),
    ),
    page(
      'Agent ontology API',
      'ontology() / ontologyMarkdown() emit the live graph schema for Text2Cypher prompts and MCP resources.',
      ontologySection(docs).slice(2),
    ),
    page(
      'Auditing',
      'Runbook for auditing how a consumer codebase uses neode/Neo4j — inventory, graph model, inefficiency scan, projection, triage.',
      auditingPageSections(),
    ),
  )

  return pages
}

/**
The hand-written raw-rows recipe appended to the Querying page (NTS-632),
below the generated symbol reference.
*/
const QUERYING_RECIPE = `## Consuming raw rows — the recipe

Raw reads return QueryOutput: one QueryRecord per row (\`get\` /\`has\` /\`keys\`).
Pick the first helper that fits — none of them needs the \`.get()\`-cast plumbing.

Row maps — plain objects keyed by column, values JSON-safe:

\`\`\`ts
import { rows } from 'neode'

const output = await neode.cypher('MATCH (p:Person) RETURN p.name AS name, p.age AS age')
const people = rows<{ name: string; age: number }>(output) // [{ name: 'Adam', age: 30 }, …]
const first = rows<{ name: string }>(output)[0]?.name // the scalar pattern: one row, one value
\`\`\`

Per-query reshaping — \`recordTransformer\` maps every record before it reaches the
caller (\`cypher()\`, and the same option on \`read()\` /\`write()\`; ignored when \`hydrate\` is set):

\`\`\`ts
const output = await neode.cypher('MATCH (p:Person) RETURN p.name AS name', {}, {
  recordTransformer: (row) => ({ name: row.get('name') }),
})
output.records // the mapped rows — [{ name: 'Adam' }, …]
\`\`\`

Entities — when the row is (or contains) a node of a registered model, hydrate
instead of touching rows: \`hydrate\` /\`hydrateFirst\` /\`toCollection\` over the raw
output, or the \`hydrate\` option on \`read()\` /\`write()\` /\`cypher()\`:

\`\`\`ts
const people = await neode.read(query, { hydrate: Person }) // hydrated entities, eager columns attached
\`\`\`

Use rows()/recordTransformer for shapes the model does not project — aggregates,
ad-hoc returns, cross-model rows; use hydration when the row IS an entity. The
values of rows() are already JSON-safe; for a raw QueryRecord crossing a JSON
boundary (event payload, cache) wrap it with jsonSafeRecord(record).

Prefer one statement over id-polling: Neo4j's core benefit is pattern-matching a
whole subgraph at once. Lists load via \`with\`-specs on the root read (each with-spec
renders into the same statement, NTS-565 — no OPTIONAL MATCH), never via per-instance
\`load()\` /\`related()\` in a loop — the get-ids-then-poll anti-pattern, one traversal per
terminal. Instance loads are for one-off deep dives on a single entity:

\`\`\`ts
// the anti-pattern: one traversal per row (N+1)
const people = await neode.all(Person)
for (const person of people) {
  await person.load('orders')
}

// one with-spec read: the orders render inside the same statement
const people = await neode.getRepository(Person).findAll({}, { with: { orders: true } })
\`\`\`
`

function queryingRecipeSection(): string[] {
  return QUERYING_RECIPE.split('\n')
}

/**
The trust boundary (NTS-675): which arguments are safe for user input and
which are trusted-only. Appended to the Querying page, below the symbol
reference and the raw-rows recipe.
*/
const TRUST_BOUNDARY = `## Trust boundary — what is safe for user input

Every VALUE a query carries binds as a parameter: filters, properties,
full-text query strings, vectors — user input is safe there. Identifiers
(labels, relationship types, property keys, order directions, limits,
skips, degrees) cannot be bound: the library backtick-escapes or validates
them, so schema-declared and semi-trusted strings are safe too
(\`safeKey\` / \`quote\` / \`assertDirection\` / \`assertCount\`, all
idempotent on already-quoted input).

Raw-expression channels render VERBATIM into the statement and are
TRUSTED-INPUT ONLY — never pass user-supplied text:

- \`RawExpression\` property values, \`@Expression\` projections and the
  \`cypher\` option of \`@Derived\` — the expression must never interpolate
  data; bind values it references via \`param(name, value)\` and reference
  them as \`$name\`.
- \`expr()\` / \`caseExpr()\` compose single expressions from fragments —
  same rule for every fragment.
- \`whereRaw()\`, \`whereExists(pattern)\`, \`whereAny()\`, \`return()\`,
  \`unwind()\`, \`setExpr()\` / \`onCreateSetExpr()\` / \`onMatchSetExpr()\`,
  \`callProcedure()\`, \`call\` / \`forEach\` sub-builders, \`remove()\`,
  \`delete()\` / \`detachDelete()\` and \`orderBy()\` FIELD terms (the field
  may be any expression, so it cannot be escaped — the model-read services
  escape user order keys via \`orderTerms()\` before reaching it).
- Aliases and path variables must be plain identifiers
  (\`match\` / \`create\` / \`merge\` / \`to\` / \`relationship\` /
  \`asPath\` / \`whereId\` assert this — they cannot be escaped without
  changing meaning).
- \`runCypherScript()\` / \`splitCypherStatements()\` — the script IS
  Cypher by definition; a .cypher file on disk is trusted input.
- Schema DDL (\`createUniqueConstraint\` and friends) — labels, properties
  and index names come from the model definitions; the SchemaService
  composers backtick-quote them, the Builder DDL composes them unquoted.

Model-defined named filters (\`@Filter where\`) and \`setFilterParams\`
values are developer-declared; filter VALUES bind as parameters, and
\`withoutFilters: ['*']\` is rejected on every public read (NTS-610) — a
user-supplied string can never switch off tenancy or soft delete. The
\`neode/express\` router is a write-open surface (mount auth in front of
it) but an injection-closed one: query keys map onto DECLARED property
filters as parameters, unknown keys are dropped, \`order\` / \`sort\`
travel as OrderSpec data through the escaping order renderer, and nothing
on a request can reach \`withoutFilters\`, \`wipe()\` or any destructive
call.
`

function trustBoundarySection(): string[] {
  return TRUST_BOUNDARY.split('\n')
}

/**
The adopting-an-existing-graph recipe (NTS-682): the neode-generate CLI,
both output styles, the scaffold-then-verify workflow and the fidelity
limits of the introspector. Hand-maintained in this script (the bin and
generateModels() are not public exports the symbol walk could pick up) and
appended to the Schema management page and AGENTS.md.
*/
const CODEGEN_RECIPE = `## Adopting an existing graph

Adopting neode on a database that already holds data does not start with
hand-writing every model: introspect the live graph once, take the output
as a scaffold, hand-correct it, and verify the models against the database
from then on.

### Generate

The \`neode-generate\` CLI ships with the package (the \`bin/neode-generate\`
entry of package.json):

\`\`\`sh
neode-generate --uri bolt://localhost:7687 --username neo4j --password secret \\
  [--database neo4j] [--sample 100] [--labels Person,Movie] [--out ./src/models]
\`\`\`

| Flag | Meaning |
| --- | --- |
| \`--uri\` / \`--username\` / \`--password\` | required connection settings — \`NEO4J_URI\` / \`NEO4J_USERNAME\` / \`NEO4J_PASSWORD\` are read as fallbacks |
| \`--database\` | target database (optional) |
| \`--sample\` | nodes sampled per label for property-type inference, default 100 |
| \`--labels\` | comma-separated allow-list — scope generation to a subgraph |
| \`--out\` | write \`models.ts\` + \`schema.ts\` into the directory; without it both render to stdout |

Warnings print to stderr: conflicting members (a property whose sampled
values have mixed types, clashing relationship keys, undeclarable keys) are
LEFT OUT and reported, not fatal. A label without data produces no model.

The same walk is available in code as \`neode.generateModels({ sampleSize, labels })\`
on an instance — it is not a named export of the package root.

### The two output styles

\`models.ts\` — decorated classes:

\`\`\`ts
// Generated by neode-generate — entity models introspected from a live graph.
import { NodeEntity, Property, RelatedMany } from 'neode'

@NodeEntity()
export class Person {
  @Property({ type: 'string', primary: true }) id?: string
  @Property({ type: 'string' }) name?: string
  @RelatedMany({ type: 'ACTED_IN', direction: 'out', target: () => Movie }) actedIn?: Movie[]
}
\`\`\`

\`schema.ts\` — map schemas, the same registry and behaviour via \`defineModel()\`:

\`\`\`ts
// Generated by neode-generate — map-schema definitions introspected from a live graph.
import { defineModel } from 'neode'

defineModel('Person', {
  id: { type: 'string', primary: true },
  name: { type: 'string' },
  ACTED_IN: { type: 'relatedMany', relationship: 'ACTED_IN', direction: 'out', target: 'Movie' },
})
\`\`\`

### What the scaffold gets wrong on purpose — hand-correct these

Introspection samples data; it cannot read intent:

- **Relationships emit as read-only projections.** \`@RelatedOne\` /
  \`@RelatedMany\` (map: \`relatedOne\` / \`relatedMany\`) are eager READ
  projections — the walk cannot know which relationships a consumer writes
  through. Swap to \`@OneToOne\` / \`@OneToMany\` where the property takes writes.
- **Direction is always \`'out'\`.** The walk captures every relationship once,
  from its source label — an incoming edge appears on the other label's model.
- **Cardinality is inferred from the sampled degree** — when the sample holds
  more relationships than source nodes for a (type, target), it renders as
  many; a sparsely populated one-to-many can come out \`relatedOne\`.
- **Every property is optional.** Sampling cannot prove NOT NULL — tighten
  with \`@Required\` / \`required: true\` where the model demands it.
- **Temporal and spatial types render \`unknown\`** in the generated classes'
  TS field types. The schema-side type is precise (\`date\`, \`datetime\`,
  \`point\`, …) — declare the TS type by stacking the type decorator
  (\`@DateTime()\`, \`@Date()\`, \`@Point()\`) on the property.
- **Properties absent from the sample are missed.** A property set only on
  nodes the sample did not read does not exist in the output — raise
  \`--sample\`, or declare it by hand.

The primary key is suggested from the property of the label's uniqueness
constraint (\`primary: true\`), and constraints/indexes are deliberately NOT
re-declared — \`installSchema()\` manages them from the models, so
generate → register → \`installSchema()\` round-trips with no drift.

### Verify in CI: generate once, drift-check forever

The generated files are hand-maintained source from that first generate on —
re-running \`neode-generate\` OVERWRITES them (one-shot scaffold, no merge with
existing definitions). The ongoing verification is drift checking, not
regeneration:

\`\`\`ts
import { formatSchemaDrift } from 'neode'

const drift = await neode.schemaDiff() // the facade form of schemaDrift()
const entries = [drift.constraints, drift.indexes].flatMap((group) => [
  ...group.missing,
  ...group.stale,
  ...group.mismatched,
])

if (entries.length > 0) {
  console.error(formatSchemaDrift(drift))
  process.exitCode = 1 // drift is data, not an error — failing the run is the caller's job
}
\`\`\`

Run it in CI against a representative database: when a hand-edit to the
models or a migration on the database leaves the two disagreeing, the run
fails with the exact fix statement per entry.
`

function codegenRecipeSection(): string[] {
  return CODEGEN_RECIPE.split('\n')
}

/**
The Auditing page (NTS-635): the hand-maintained audit skill
(skills/neode-audit/SKILL.md) republished as a docs/agent page — the
runbook is not derivable from source, so the skill file is the source of
truth and the page is derived from it verbatim, minus the frontmatter and
the skill's own H1.
*/
function auditingPageSections(): string[] {
  const skillPath = path.join(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    'skills/neode-audit/SKILL.md',
  )

  const skill = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : ''

  if (skill === '') {
    return [
      '',
      '> The audit skill file (skills/neode-audit/SKILL.md) is missing — restore it to regenerate this page.',
    ]
  }

  const body = skill
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^\s*# .*\n/, '')
    .trimStart()

  return ['', ...body.split('\n'), '']
}

export function renderSkillMd(version: string): string {
  return [
    '---',
    'name: neode',
    'description: Canonical how-to for neode, the decorator-based Object Graph Mapper for Neo4j — define models, query, relate, transact; common mistakes. Use when writing or reviewing code that imports the neode package.',
    '---',
    '',
    `# neode — agent skill (v${version})`,
    '',
    GENERATED_HEADER,
    '',
    ...VERSION_NOTE(version),
    '',
    '## Define models',
    '',
    'Decorators are the default for new projects and models:',
    '',
    ...DEFINE_DECORATORS_SNIPPET.split('\n'),
    '',
    'Alternative — the map API (same registry, mixable), only when asked for or decorators are impossible:',
    '',
    ...DEFINE_MAP_SNIPPET.split('\n'),
    '',
    'Declare an agent-facing `description` on the model, its properties and its relationships — it flows into `ontologyMarkdown()` for Text2Cypher grounding.',
    '',
    '## Query',
    '',
    'Fluent builder (values are bound as parameters — they never render into the query text) or raw Cypher:',
    '',
    '```ts',
    "import { Builder } from 'neode'",
    '',
    'const rows = await neode.read(',
    `  new Builder().match('this', 'Person').where('this.name', 'Adam').return('this'),`,
    ')',
    "const raw = await neode.cypher('MATCH (p:Person) RETURN p LIMIT 10')",
    '```',
    '',
    '## Relate',
    '',
    'relate() takes the relationship KEY declared on the from-model and MERGEs the relationship (re-running never duplicates it):',
    '',
    '```ts',
    "await neode.relate(Person, adam, rex, 'pets', { since: '2024-01-01' })",
    "await neode.detach(Person, adam, rex, 'pets')",
    '```',
    '',
    '## Transact',
    '',
    'inWriteTransaction() runs a unit of work: commit on success, rollback on any throw, nothing written until commit:',
    '',
    '```ts',
    'await neode.inWriteTransaction(async (tx) => {',
    "  await tx.writeCypher('CREATE (:Tag {name: $name})', { name: 'from-transaction' })",
    '  await tx.commit()',
    '})',
    '```',
    '',
    '## Common mistakes',
    '',
    "- Relationship keys are not relationship types: `relate(from, to, 'pets')` takes the declared field key; the Cypher pattern uses the TYPE (`:OWNS`). The projection decorators take types.",
    '- Errors name the fix: on `OptimisticLockError` reload the entity and retry; on `RelationNotLoadedError` add the named key to the `with` load spec.',
    '- Pass user text through `toFulltextQuery()` before `search()` — parameter binding stops Cypher injection, not Lucene parse errors.',
    '- Standard TC39 decorators only — never `experimentalDecorators`, `emitDecoratorMetadata` or `reflect-metadata`.',
    '',
    '## Reference',
    '',
    'Full API: [llms-full.txt](../../llms-full.txt). Per-area pages, indexed by [llms.txt](../../llms.txt). AGENTS.md, this pack, llms.txt and llms-full.txt are all generated from the same source by `pnpm docs:agents` — they cannot drift apart.',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
Format generated output exactly as `biome format .` would, so the committed
bytes, the lint check and the --check staleness comparison all agree. biome
is the repo's devDependency (run via pnpm, so .bin is on PATH).
*/
function biomeFormat(content: string, filePath: string): string {
  if (!filePath.endsWith('.md')) {
    return content
  }
  const result = spawnSync('biome', ['format', `--stdin-file-path=${filePath}`], {
    input: content,
    encoding: 'utf8',
  })
  if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`biome format failed for ${filePath}: ${result.stderr}`)
  }
  return result.stdout
}

function main(): void {
  const check = process.argv.includes('--check')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  const docs = extractDocs(path.join(root, 'src'))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    version: string
  }

  const outputs: Array<[string, string]> = [
    ['llms.txt', renderLlmsTxt(docs, pkg.version)],
    ['llms-full.txt', renderLlmsFull(docs, pkg.version)],
    ['AGENTS.md', renderAgentsMd(docs, pkg.version)],
    ['skills/neode/SKILL.md', renderSkillMd(pkg.version)],
    ...renderPages(docs, pkg.version).map((page) => [page.path, page.content] as [string, string]),
  ].map(([name, content]) => [name, biomeFormat(content, name)] as [string, string])

  const pagesDir = path.join(root, 'docs/agent')
  const pagePaths = new Set(outputs.map(([rel]) => rel))

  if (check) {
    const stale = outputs.filter(([name, content]) => {
      const file = path.join(root, name)
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content
    })
    // The pages directory is fully generated: a file the generator no longer
    // emits is stale too, not just a file whose content changed
    const extras = fs.existsSync(pagesDir)
      ? fs.readdirSync(pagesDir).filter((name) => !pagePaths.has(`docs/agent/${name}`))
      : []
    if (stale.length > 0 || extras.length > 0) {
      console.error(
        `stale generated agent docs: ${[...stale.map(([name]) => name), ...extras].join(', ')} — run "pnpm docs:agents" to regenerate`,
      )
      process.exit(1)
    }
    console.log('generated agent docs are up to date')
    return
  }

  fs.rmSync(pagesDir, { recursive: true, force: true })
  for (const [name, content] of outputs) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  console.log(`generated ${outputs.map(([name]) => name).join(', ')}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
