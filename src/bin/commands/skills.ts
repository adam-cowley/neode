/*
neode skills — install the agent skills shipped with the neode package
into a project, where agent harnesses that read the SKILL.md convention
(OpenCode, Claude Code, …) pick them up. `add` copies skills/<name>/
from the installed package; `list` shows what is available and what is
already installed (NTS-680).
*/
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// Package root via Node package self-reference ('neode/package.json' from
// inside the package resolves to this package) — robust to where the
// bundler puts the command code, which file-relative paths are not
const require = createRequire(import.meta.url)
const PACKAGE_ROOT = path.dirname(require.resolve('neode/package.json'))

// The two SKILL.md conventions that matter today; --target overrides both
const DEFAULT_TARGETS = ['.opencode/skill', '.claude/skills']

const USAGE = [
  'Usage: neode skills add [<skill> ...] [--target <dir>]',
  '       neode skills list [--target <dir>]',
  '',
  'Installs the agent skills shipped with the neode package into a project.',
  'Without skill names, add installs every skill (idempotent: overwrite).',
  'Without --target, both .opencode/skill and .claude/skills are written;',
  '--target <dir> writes to that directory instead (created if missing).',
].join('\n')

/**
Skill directories shipped with the package (a directory holding SKILL.md)
*/
function availableSkills(): string[] {
  const root = path.join(PACKAGE_ROOT, 'skills')

  return existsSync(root)
    ? readdirSync(root).filter((name) => existsSync(path.join(root, name, 'SKILL.md')))
    : []
}

/**
Skill names already present in a target directory
*/
function installedSkills(target: string): string[] {
  return existsSync(target)
    ? readdirSync(target).filter((name) => existsSync(path.join(target, name, 'SKILL.md')))
    : []
}

/**
Parse the shared argument tail of add/list: skill names plus at most one
--target <dir>
*/
function parseSkillArguments(argv: string[]): { names: string[]; target?: string; error?: string } {
  const names: string[] = []
  let target: string | undefined

  let index = 0

  while (index < argv.length) {
    const argument = argv[index]

    if (argument === undefined) {
      break
    }

    if (argument !== '--target') {
      names.push(argument)
      index += 1

      continue
    }

    if (target !== undefined) {
      return { names, error: '--target given more than once' }
    }

    const value = argv[index + 1]

    if (value === undefined) {
      return { names, error: 'Missing value for --target' }
    }

    target = value
    index += 2
  }

  return target === undefined ? { names } : { names, target }
}

function skillTargets(parsed: { target?: string }): string[] {
  return parsed.target === undefined ? DEFAULT_TARGETS : [parsed.target]
}

export function runSkillsAdd(argv: string[]): number {
  const parsed = parseSkillArguments(argv)

  if (parsed.error !== undefined) {
    process.stderr.write(`neode skills add: ${parsed.error}\n\n${USAGE}\n`)

    return 1
  }

  const available = availableSkills()
  const wanted = parsed.names.length === 0 ? available : parsed.names
  const unknown = wanted.filter((name) => !available.includes(name))

  if (unknown.length > 0) {
    process.stderr.write(
      `neode skills add: unknown skill(s): ${unknown.join(', ')} — available: ${available.join(', ')}\n`,
    )

    return 1
  }

  for (const name of wanted) {
    for (const target of skillTargets(parsed)) {
      const destination = path.join(target, name)

      mkdirSync(destination, { recursive: true })
      cpSync(path.join(PACKAGE_ROOT, 'skills', name), destination, { recursive: true })

      process.stdout.write(`Installed ${name} -> ${destination}\n`)
    }
  }

  const written = wanted.length * skillTargets(parsed).length

  process.stdout.write(`Wrote ${String(written)} skill directory(s)\n`)

  return 0
}

export function runSkillsList(argv: string[]): number {
  const parsed = parseSkillArguments(argv)

  if (parsed.error !== undefined) {
    process.stderr.write(`neode skills list: ${parsed.error}\n\n${USAGE}\n`)

    return 1
  }

  process.stdout.write(`Available: ${availableSkills().join(', ')}\n`)

  for (const target of skillTargets(parsed)) {
    const installed = installedSkills(target)

    process.stdout.write(
      `Installed (${target}): ${installed.length === 0 ? '(none)' : installed.join(', ')}\n`,
    )
  }

  return 0
}

export function runSkills(argv: string[]): number {
  const [subcommand, ...rest] = argv

  if (subcommand === undefined) {
    process.stderr.write(`${USAGE}\n`)

    return 1
  }

  if (['help', '--help', '-h'].includes(subcommand)) {
    process.stdout.write(`${USAGE}\n`)

    return 0
  }

  if (subcommand === 'list') {
    return runSkillsList(rest)
  }

  if (subcommand === 'add') {
    return runSkillsAdd(rest)
  }

  process.stderr.write(
    `neode skills: unknown command "${subcommand}" — expected add or list\n\n${USAGE}\n`,
  )

  return 1
}

export function skillsUsageText(): string {
  return USAGE
}
