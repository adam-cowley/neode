/**
 * Keeps docs/migration-guide.md honest: every 1.0-side code snippet line in
 * the guide must appear in the type-checked mirror
 * test/types/migration-guide-snippets.test-d.ts, so snippets cannot rot —
 * edit a snippet in the guide and its mirror together.
 *
 * Legacy (0.4.9) blocks are skipped: they show the OLD API on purpose.
 * A block counts as legacy when its first non-empty line mentions 0.4.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const GUIDE = new URL('../../docs/migration-guide.md', import.meta.url)
const MIRROR = new URL('../types/migration-guide-snippets.test-d.ts', import.meta.url)

function normalize(line: string): string {
  return line
    .replace(/\/\/.*$/u, '')
    .replace(/^export /u, '')
    .trim()
}

function codeLines(source: string): string[] {
  return source
    .split('\n')
    .map(normalize)
    .filter((line) => line.length > 0 && !line.startsWith('import '))
}

function typescriptBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```typescript\r?\n([\s\S]*?)```/gu)].map((match) => match[1] ?? '')
}

function isLegacyBlock(block: string): boolean {
  // The guide's convention: a 0.4-only snippet starts with this comment, so
  // prose mentions of "0.4" elsewhere never misclassify a 1.0 block
  const firstLine = block.split('\n').find((line) => line.trim().length > 0) ?? ''

  return firstLine.trim().startsWith('// neode 0.4')
}

describe('docs/migration-guide.md snippets', () => {
  const guide = readFileSync(GUIDE, 'utf8')
  const mirror = readFileSync(MIRROR, 'utf8')
  const blocks = typescriptBlocks(guide)

  it('has 1.0 snippets to check', () => {
    expect(blocks.length).toBeGreaterThan(10)
    expect(blocks.filter((block) => isLegacyBlock(block)).length).toBeGreaterThan(0)
  })

  it('every 1.0 snippet line appears in the type-checked mirror', () => {
    const tested = new Set(codeLines(mirror))
    const missing: string[] = []

    for (const [index, block] of blocks.entries()) {
      if (isLegacyBlock(block)) {
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

  it('names the package neode everywhere', () => {
    expect(guide).not.toMatch(/@neode\//u)
    expect(guide).not.toMatch(/neode-ogm/u)
    expect(guide).not.toMatch(/neode@beta/u)

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
