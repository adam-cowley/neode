/**
 * The built entry exposes `Neode` both as the default and as a named export,
 * in the ESM and CJS builds alike (NTS-571).
 */
import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

import Default, { Neode } from '../../dist/index.mjs'

const require = createRequire(import.meta.url)
const cjs = require('../../dist/index.cjs') as {
  Neode: unknown
  default: unknown
}

describe('built dist: Neode entry exports', () => {
  it('ESM named export is the default export', () => {
    expect(Neode).toBeDefined()
    expect(Neode).toBe(Default)
  })

  it('CJS exposes both Neode and default', () => {
    expect(cjs.Neode).toBeDefined()
    expect(cjs.default).toBe(cjs.Neode)
  })
})
