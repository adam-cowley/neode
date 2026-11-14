import { afterEach, describe, expect, it, vi } from 'vitest'

import { runNeode } from '../../src/bin/dispatch'

describe('runNeode (subcommand dispatcher)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function captureStreams(): { stdout: string[]; stderr: string[] } {
    const stdout: string[] = []
    const stderr: string[] = []

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))

      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))

      return true
    })

    return { stdout, stderr }
  }

  it('prints top-level usage on stderr and exits 1 without arguments', async () => {
    const { stdout, stderr } = captureStreams()

    expect(await runNeode([])).toBe(1)
    expect(stderr.join('')).toContain('Usage: neode <command>')
    expect(stdout).toEqual([])
  })

  it('prints top-level usage on stdout and exits 0 for help', async () => {
    const { stdout, stderr } = captureStreams()

    expect(await runNeode(['help'])).toBe(0)
    expect(await runNeode(['--help'])).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('')).toContain('Usage: neode <command>')
  })

  it('prints a command usage for help <command>', async () => {
    const { stdout, stderr } = captureStreams()

    expect(await runNeode(['help', 'generate'])).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('')).toContain('Usage: neode generate')
  })

  it('rejects unknown commands with exit 1', async () => {
    const { stdout, stderr } = captureStreams()

    expect(await runNeode(['bogus'])).toBe(1)
    expect(stderr.join('')).toContain('Unknown command: bogus')
    expect(stderr.join('')).toContain('Usage: neode <command>')
    expect(stdout).toEqual([])
  })
})
