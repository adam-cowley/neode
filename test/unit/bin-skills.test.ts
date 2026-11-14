import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runSkills } from '../../src/bin/commands/skills'

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

const SHIPPED_SKILLS = new URL('../../skills', import.meta.url).pathname

describe('runSkills', () => {
  const directories: string[] = []

  function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'neode-skills-'))

    directories.push(directory)

    return directory
  }

  afterEach(() => {
    vi.restoreAllMocks()

    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('installs every shipped skill into both default targets when no names are given', async () => {
    const project = temporaryDirectory()
    const { stdout, stderr } = captureStreams()

    process.chdir(project)

    expect(await runSkills(['add'])).toBe(0)

    for (const target of ['.opencode/skill', '.claude/skills']) {
      for (const skill of readdirSync(SHIPPED_SKILLS)) {
        expect(existsSync(path.join(project, target, skill, 'SKILL.md'))).toBe(true)
      }
    }

    expect(stderr).toEqual([])
  })

  it('installs a named skill into --target and reports what it wrote', async () => {
    const project = temporaryDirectory()
    const target = path.join(project, 'skills')
    const { stdout } = captureStreams()

    expect(await runSkills(['add', 'neode-audit', '--target', target])).toBe(0)

    expect(existsSync(path.join(target, 'neode-audit', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(target, 'neode'))).toBe(false)
    expect(stdout.join('')).toContain(
      `Installed neode-audit -> ${path.join(target, 'neode-audit')}`,
    )
  })

  it('is idempotent — re-running add overwrites in place', async () => {
    const target = path.join(temporaryDirectory(), 'skills')
    const { stdout } = captureStreams()

    await runSkills(['add', 'neode', '--target', target])
    expect(await runSkills(['add', 'neode', '--target', target])).toBe(0)

    expect(readFileSync(path.join(target, 'neode', 'SKILL.md'), 'utf8')).toEqual(
      readFileSync(path.join(SHIPPED_SKILLS, 'neode/SKILL.md'), 'utf8'),
    )
    expect(stdout.join('').match(/Installed neode/g)).toHaveLength(2)
  })

  it('rejects unknown skill names with the available list', async () => {
    const project = temporaryDirectory()
    const { stderr } = captureStreams()

    process.chdir(project)

    expect(await runSkills(['add', 'bogus'])).toBe(1)
    expect(existsSync(path.join(project, '.opencode'))).toBe(false)
    expect(stderr.join('')).toContain('unknown skill(s): bogus')
    expect(stderr.join('')).toContain('available: neode, neode-audit, neode-model')
  })

  it('lists available and installed skills', async () => {
    const project = temporaryDirectory()
    const { stdout } = captureStreams()

    process.chdir(project)
    await runSkills(['add', 'neode-model', '--target', path.join(project, '.claude/skills')])

    expect(await runSkills(['list'])).toBe(0)

    const output = stdout.join('')

    expect(output).toContain('Available: neode, neode-audit, neode-model')
    expect(output).toContain('Installed (.claude/skills): neode-model')
  })

  it('prints usage and exits 1 with no subcommand, and rejects unknown subcommands', async () => {
    const { stdout, stderr } = captureStreams()

    expect(await runSkills([])).toBe(1)
    expect(stderr.join('')).toContain('Usage: neode skills')

    expect(await runSkills(['bogus'])).toBe(1)
    expect(stderr.join('')).toContain('unknown command "bogus"')
    expect(stdout).toEqual([])
  })
})
