/*
neode — the neode CLI. Subcommand dispatcher: each subcommand lives in
src/bin/commands/, exports an argv => exit-code runner and a usage text,
and registers in the COMMANDS table (NTS-679). The `neode` bin entry is a
thin bootstrap over runNeode(); tests import dispatch.ts directly.
*/
import { usageText } from './arguments.js'
import { runGenerate } from './commands/generate.js'

const COMMANDS: Record<string, { run: (argv: string[]) => Promise<number>; usage: () => string }> =
  {
    generate: { run: runGenerate, usage: usageText },
  }

const TOP_LEVEL_USAGE = [
  'Usage: neode <command> [arguments]',
  '',
  'Commands:',
  '  generate   Generate neode model definitions from a live Neo4j database',
  '',
  "Run 'neode help <command>' for a command's arguments.",
].join('\n')

export async function runNeode(argv: string[]): Promise<number> {
  const [command, ...rest] = argv

  if (command === undefined) {
    process.stderr.write(`${TOP_LEVEL_USAGE}\n`)

    return 1
  }

  if (['help', '--help', '-h'].includes(command)) {
    const target = rest[0]

    if (target === undefined) {
      process.stdout.write(`${TOP_LEVEL_USAGE}\n`)

      return 0
    }

    const known = COMMANDS[target]

    if (known === undefined) {
      process.stderr.write(`Unknown command: ${target}\n\n${TOP_LEVEL_USAGE}\n`)

      return 1
    }

    process.stdout.write(`${known.usage()}\n`)

    return 0
  }

  const known = COMMANDS[command]

  if (known === undefined) {
    process.stderr.write(`Unknown command: ${command}\n\n${TOP_LEVEL_USAGE}\n`)

    return 1
  }

  return known.run(rest)
}
