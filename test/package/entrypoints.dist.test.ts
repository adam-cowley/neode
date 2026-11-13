/**
 * NTS-572: the built dist must work for ESM and CJS consumers alike.
 * `withDirectory` used `createRequire(__filename)`, which threw a
 * ReferenceError in the ESM build. These tests import the BUILT output —
 * not src — and exercise the entry points that differ between formats.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import EsmNeode, { fromEnv, getModelByName } from '../../dist/index.mjs'

const require = createRequire(import.meta.url)
const cjs = require('../../dist/index.cjs') as typeof import('../../dist/index.mjs')
const distDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist')

let directory: string

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'neode-dist-models-'))

  // The scanned files are loaded with require(), so they are CommonJS
  writeFileSync(path.join(directory, 'package.json'), '{ "type": "commonjs" }')
  writeFileSync(
    path.join(directory, 'DistDirEsm.js'),
    "module.exports = { id: { type: 'string', primary: true }, name: 'string' };",
  )
  writeFileSync(
    path.join(directory, 'DistDirCjs.js'),
    "module.exports = { id: { type: 'string', primary: true }, name: 'string' };",
  )
  // Non-model files are ignored
  writeFileSync(path.join(directory, 'readme.txt'), 'not a model')
})

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('built dist: withDirectory', () => {
  it('registers models from a directory in the ESM build', () => {
    const neode = new EsmNeode({} as never).withDirectory(directory)

    expect(getModelByName('DistDirEsm')).toBeDefined()
  })

  it('registers models from a directory in the CJS build', () => {
    const neode = new cjs.default({} as never).withDirectory(directory)

    expect(cjs.getModelByName('DistDirCjs')).toBeDefined()
  })
})

describe('built dist: entry point shape', () => {
  it('exposes fromEnv in both builds', () => {
    expect(typeof fromEnv).toBe('function')
    expect(typeof cjs.fromEnv).toBe('function')
  })

  it('exposes the Neode class as the default export of both builds', () => {
    expect(typeof EsmNeode).toBe('function')
    expect(typeof cjs.default).toBe('function')
    expect(cjs.default.name).toBe(EsmNeode.name)
  })
})

describe('built dist: neode/express subpath', () => {
  it('exposes the router factory in the ESM build', async () => {
    const expressEntry = await import('../../dist/express/index.mjs')

    expect(typeof expressEntry.router).toBe('function')
  })

  it('exposes the router factory in the CJS build', () => {
    const expressEntry = require('../../dist/express/index.cjs') as {
      router: unknown
    }

    expect(typeof expressEntry.router).toBe('function')
  })
})

describe('built dist: neode bin', () => {
  for (const extension of ['mjs', 'cjs']) {
    it(`prints top-level usage and exits 1 without arguments (${extension})`, () => {
      const result = spawnSync(
        process.execPath,
        [path.join(distDirectory, `bin/neode.${extension}`)],
        {
          encoding: 'utf8',
        },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Usage: neode')
    })

    it(`prints the generate usage and exits 1 when generate has no arguments (${extension})`, () => {
      const result = spawnSync(
        process.execPath,
        [path.join(distDirectory, `bin/neode.${extension}`), 'generate'],
        { encoding: 'utf8' },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Usage: neode generate')
    })

    it(`rejects unknown commands (${extension})`, () => {
      const result = spawnSync(
        process.execPath,
        [path.join(distDirectory, `bin/neode.${extension}`), 'bogus'],
        { encoding: 'utf8' },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Unknown command: bogus')
      expect(result.stderr).toContain('Usage: neode')
    })

    it(`lists the shipped skills (${extension})`, () => {
      const result = spawnSync(
        process.execPath,
        [path.join(distDirectory, `bin/neode.${extension}`), 'skills', 'list'],
        { encoding: 'utf8' },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Available: neode, neode-audit, neode-model')
    })

    it(`installs a skill into --target (${extension})`, () => {
      const target = mkdtempSync(path.join(tmpdir(), 'neode-bin-skills-'))
      const result = spawnSync(
        process.execPath,
        [
          path.join(distDirectory, `bin/neode.${extension}`),
          'skills',
          'add',
          'neode-model',
          '--target',
          target,
        ],
        { encoding: 'utf8' },
      )

      expect(result.status).toBe(0)
      expect(existsSync(path.join(target, 'neode-model', 'SKILL.md'))).toBe(true)

      rmSync(target, { recursive: true, force: true })
    })
  }
})
