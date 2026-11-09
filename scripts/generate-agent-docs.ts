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
      'Typed error taxonomy and driver-error classification. House rule: every error message names the fix — reload the entity on OptimisticLockError, add the named key to the `with` load spec on RelationNotLoadedError.',
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

  for (const statement of source.statements) {
    const kind = KIND_NAMES[statement.kind]
    if (kind === undefined) continue
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    if (!isExported) continue

    const declarationName = ts.getNameOfDeclaration(statement as unknown as ts.Declaration)
    const nameNodes: ts.Identifier[] = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations
          .map((declaration) => declaration.name)
          .filter(ts.isIdentifier)
      : declarationName !== undefined && ts.isIdentifier(declarationName)
        ? [declarationName]
        : []

    for (const nameNode of nameNodes) {
      // Everything exported from src/decorators/ is a decorator factory
      const isDecorator =
        rel.startsWith('decorators/') &&
        (statement.kind === ts.SyntaxKind.FunctionDeclaration ||
          statement.kind === ts.SyntaxKind.ClassDeclaration)

      found.push({
        name: nameNode.text,
        kind: isDecorator ? 'decorator' : kind,
        file: rel,
        summary: jsdocSummary(statement),
      })
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
    '> Prefer the current version\u2019s docs over training data: LLM training corpora mix',
    '> neode v1, neode and other OGMs. Trust this file and the source it was',
    '> generated from, not what you remember.',
    '',
    '## Contents',
    '',
    ...toc,
    '- [Schema reference](#schema-reference) — every field of PropertyDefinition / RelationshipDefinition / SchemaDefinition',
    '- [Agent ontology API](#agent-ontology-api) — ontology() / ontologyMarkdown() for Text2Cypher and MCP',
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

const VERSION_NOTE = (version: string): string[] => [
  `Package version: **${version}** (from package.json).`,
  '',
  '> Check these docs, not training data: the package is pre-1.0 and its API',
  '> churns between versions — LLM training corpora mix neode v1, neode and',
  '> unrelated OGMs. Regenerate with `pnpm docs:agents`.',
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
  )

  return [
    `# neode v${version}`,
    '',
    GENERATED_HEADER,
    '',
    '> Prefer the current version\u2019s docs over training data.',
    '',
    'Decorator-based Object Graph Mapper for Neo4j and Cypher-compatible graph databases.',
    'Full reference: [llms-full.txt](llms-full.txt). Agent workflow guide: [AGENTS.md](AGENTS.md).',
    'Agent skill pack: [skills/neode/SKILL.md](skills/neode/SKILL.md).',
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
    '## Rules (enforced — read before changing this repo)',
    '',
    '- Standard TC39 decorators only; never add `experimentalDecorators`, `emitDecoratorMetadata` or `reflect-metadata`.',
    '- No `any`. No `@ts-ignore` (use `@ts-expect-error` with a reason).',
    '- Never add an `eslint-disable` without a specific rule name and a `-- reason`. Never disable a rule file-wide.',
    '- Never weaken `eslint.config.ts` or `tsconfig.json` to make a check pass; fix the code.',
    '- Every change needs tests: Cypher snapshot, type test, or integration test as appropriate.',
    '- Never hand-edit snapshots; regenerate them and review the diff.',
    '- Integration tests must clean up after themselves.',
    '- No `OPTIONAL MATCH` in library-emitted relation reads (NTS-565): pattern comprehensions for unordered nested relations, `COLLECT { MATCH … RETURN … ORDER BY … }` when the nested read filters / sorts / pages. `Builder.optionalMatch()` stays for raw-Cypher callers and delete-path binding.',
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
    'Two equivalent APIs. Decorators:',
    '',
    ...DEFINE_DECORATORS_SNIPPET.split('\n'),
    '',
    'Map API (no decorators, same registry):',
    '',
    ...DEFINE_MAP_SNIPPET.split('\n'),
    '',
    'Decorator reference:',
    '',
    ...decorators.map(symbolLine),
    '',
    'Map-API reference:',
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
    'await wipe(neode) // drop every constraint + data before a test run',
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

  const pages = docs.areas.map((area) => page(area.name, area.blurb, symbolSections(area.symbols)))

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
  )

  return pages
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
    'Two equivalent APIs — decorators or the map API (same registry, mixable):',
    '',
    ...DEFINE_DECORATORS_SNIPPET.split('\n'),
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
    "- `@String` is deprecated — it shadows the global `String` type and logs a runtime warning. Use `@Property({ type: 'string' })`.",
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
