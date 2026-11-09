import { describe, expect, it, vi } from 'vitest'
import { warnDeprecated } from '../../src/deprecate'

describe('warnDeprecated', () => {
  it('warns once per API, naming the replacement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      warnDeprecated('@String', "@Property({ type: 'string' })")
      warnDeprecated('@String', "@Property({ type: 'string' })")
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('@String')
      expect(String(warn.mock.calls[0]?.[0])).toContain("@Property({ type: 'string' })")
    } finally {
      warn.mockRestore()
    }
  })
})

describe('@String deprecation warning', () => {
  it('fires once at decorator-application time, naming the replacement', async () => {
    // Fresh module graph: the warn-once set is module state
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const decorators = await import('../../src/decorators/index.js')
      class First {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- the test exercises the deprecated decorator's runtime warning on purpose
        @decorators.String()
        name!: string
      }
      class Second {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- the test exercises the deprecated decorator's runtime warning on purpose
        @decorators.String()
        name!: string
      }

      expect(warn).toHaveBeenCalledTimes(1)
      const message = String(warn.mock.calls[0]?.[0])
      expect(message).toContain('@String')
      expect(message).toContain("@Property({ type: 'string' })")
      expect(new First().name).toBeUndefined()
      expect(new Second().name).toBeUndefined()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('setDeprecationWarnings (NTS-599)', () => {
  it('silences deprecation warnings with no console output', async () => {
    // Fresh module graph: the warn-once set is module state
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { setDeprecationWarnings, warnDeprecated } = await import('../../src/deprecate')

      setDeprecationWarnings(false)
      warnDeprecated('@String', "@Property({ type: 'string' })")

      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('does not consume the warn-once slot while silenced: re-enabling warns once', async () => {
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { setDeprecationWarnings, warnDeprecated } = await import('../../src/deprecate')

      setDeprecationWarnings(false)
      warnDeprecated('@String', "@Property({ type: 'string' })")

      setDeprecationWarnings(true)
      warnDeprecated('@String', "@Property({ type: 'string' })")
      warnDeprecated('@String', "@Property({ type: 'string' })")

      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
