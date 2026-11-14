/**
 * Keeps docs/api-reference.md honest (NTS-648): every code snippet line in
 * the doc must appear in the type-checked mirrors
 * test/types/api-reference-snippets.test-d.ts and
 * test/types/api-reference-import-surface.test-d.ts, so snippets cannot rot
 * silently — edit a snippet in the doc and its mirror together.
 *
 * Skipped blocks are the doc's option-elided signature listings
 * (`neode.save<T>(entity: T, database?): Promise<T>` and friends): they are
 * pseudo-code by design, not valid TypeScript. Each is fingerprinted by its
 * full content, so any edit to a skipped block still fails this suite and
 * forces a re-triage.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DOC = new URL('../../docs/api-reference.md', import.meta.url)
const MIRRORS = [
  new URL('../types/api-reference-snippets.test-d.ts', import.meta.url),
  new URL('../types/api-reference-import-surface.test-d.ts', import.meta.url),
]

/** The doc's signature listings: pseudo-code, fingerprinted by full content. */
const SIGNATURE_BLOCKS: Array<{ fingerprint: string; reason: string }> = [
  {
    fingerprint: 'ce3ab8d50e12421f',
    reason: 'the @OneToMany positional-form illustration (pseudo-args)',
  },
  { fingerprint: 'c8fe33ebcabaeb65', reason: 'facade construction signatures' },
  { fingerprint: 'ade76fd67dbb869d', reason: 'CRUD signature listing (option-elided pseudo-code)' },
  { fingerprint: '5b0d467be8cc6ae9', reason: 'cypher/batch signature listing' },
  { fingerprint: 'dcb271c8e5167f99', reason: 'rest-of-facade signature listing' },
  { fingerprint: '4b1c36f21ad911e0', reason: 'schema-drift calls with option-elided pseudo-args' },
  {
    fingerprint: '848551cfd1861de5',
    reason: 'hydrate/hydrateFirst/toCollection signature listing',
  },
  { fingerprint: '41ce3df0d8effa9b', reason: 'jsonSafe/jsonSafeRecord signature listing' },
  { fingerprint: '78297591d74dc655', reason: 'instrumentConnectionProvider signature listing' },
  { fingerprint: 'b5ea27367f2f6a5f', reason: 'search/knn/toFulltextQuery signature listing' },
  { fingerprint: '31b9655458a9d98d', reason: 'index-service constructor signatures' },
  {
    fingerprint: 'c387e950fdc0ffb5',
    reason: 'index-definition shapes (name?: string in an object literal)',
  },
  {
    fingerprint: '1e309c186ec70178',
    reason: 'ProjectionService calls with option-elided pseudo-args',
  },
  { fingerprint: '9478374e57a471bf', reason: 'bulk/paginate calls with option-elided pseudo-args' },
  { fingerprint: '8dd9262d4b67e8df', reason: 'ops calls with option-elided pseudo-args' },
]

function normalize(line: string): string {
  return line
    .replace(/\/\/.*$/u, '')
    .trim()
    .replace(/^\/\* … \*\/\s*/u, '')
    .replace(/^export /u, '')
    .replace(/^type /u, '')
    .trim()
}

function codeLines(source: string): string[] {
  return source
    .split('\n')
    .map(normalize)
    .filter((line) => line.length > 0 && !line.startsWith('import ') && !line.startsWith('} from '))
}

/** Extract fenced typescript blocks; blockquote markers (`> `) stripped. */
function typescriptBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```typescript\r?\n([\s\S]*?)```/gu)].map((match) =>
    (match[1] ?? '')
      .split('\n')
      .map((line) => line.replace(/^> ?/u, ''))
      .join('\n'),
  )
}

/** Stable content fingerprint of a snippet block (16 hex chars). */
function fingerprint(block: string): string {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)
}

describe('docs/api-reference.md snippets', () => {
  const doc = readFileSync(DOC, 'utf8')
  const blocks = typescriptBlocks(doc)
  const mirror = MIRRORS.map((mirror) => readFileSync(mirror, 'utf8')).join('\n')
  const tested = new Set(codeLines(mirror))
  const docFingerprints = new Set(blocks.map((block) => fingerprint(block)))
  const skipped = new Set(SIGNATURE_BLOCKS.map((block) => block.fingerprint))

  it('has snippets to check', () => {
    expect(blocks.length).toBeGreaterThan(40)
  })

  it('every compilable snippet line appears in the type-checked mirrors', () => {
    const missing: string[] = []

    for (const [index, block] of blocks.entries()) {
      if (skipped.has(fingerprint(block))) {
        continue
      }

      for (const line of codeLines(block)) {
        if (!tested.has(line)) {
          missing.push(`block ${index + 1}: ${line}`)
        }
      }
    }

    expect(missing).toEqual([])
  })

  it('every skip entry still points at an unchanged doc block', () => {
    const stale = SIGNATURE_BLOCKS.filter((block) => !docFingerprints.has(block.fingerprint))

    expect(stale.map((block) => block.reason)).toEqual([])
  })

  it('names the package neode in every snippet import', () => {
    for (const block of blocks) {
      for (const line of block.split('\n')) {
        const from = /from\s+'([^']+)'/u.exec(line)

        if (from?.[1]) {
          expect(['neode', 'neo4j-driver']).toContain(from[1])
        }
      }
    }
  })
})
