/*
Parse the `neode generate` CLI arguments (unit tested). Environment
fallbacks match the library's NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD
spellings.
*/

export interface GenerateCliArguments {
  uri: string
  username: string
  password: string
  database?: string
  sampleSize: number
  labels?: string[]
  out?: string
}

export interface ParsedGenerateArguments {
  arguments?: GenerateCliArguments
  error?: string
}

const USAGE = [
  'Usage: neode generate --uri bolt://localhost:7687 --username neo4j --password secret',
  '                      [--database neo4j] [--sample 100] [--labels Person,Movie] [--out dir]',
  '',
  'Generates neode model definitions (decorated classes + map schemas) from the',
  'graph. Without --out the definitions print to stdout; with --out they are',
  'written as models.ts and schema.ts into the directory.',
].join('\n')

export function usageText(): string {
  return USAGE
}

const KNOWN_FLAGS = new Set([
  '--uri',
  '--username',
  '--password',
  '--database',
  '--sample',
  '--labels',
  '--out',
])

export function parseGenerateArguments(argv: string[]): ParsedGenerateArguments {
  const flags: Record<string, string> = {}

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]

    if (flag === undefined || value === undefined) {
      return { error: `Missing value for ${flag ?? '(end of arguments)'}` }
    }

    flags[flag] = value
  }

  const uri = flags['--uri'] ?? process.env['NEO4J_URI'] ?? ''
  const username = flags['--username'] ?? process.env['NEO4J_USERNAME'] ?? ''
  const password = flags['--password'] ?? process.env['NEO4J_PASSWORD'] ?? ''

  const missing = Object.entries({ '--uri': uri, '--username': username, '--password': password })
    .filter(([, value]) => value === '')
    .map(([name]) => name)

  if (missing.length > 0) {
    return {
      error: `Missing required ${missing.join(', ')} (or NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD)`,
    }
  }

  const sampleSize = flags['--sample'] === undefined ? 100 : Number(flags['--sample'])

  if (!Number.isFinite(sampleSize) || sampleSize < 1) {
    return { error: `--sample must be a positive number, got "${flags['--sample'] ?? ''}"` }
  }

  const unknown = Object.keys(flags).filter((flag) => !KNOWN_FLAGS.has(flag))

  if (unknown.length > 0) {
    return { error: `Unknown flag(s): ${unknown.join(', ')}\n\n${USAGE}` }
  }

  return {
    arguments: {
      uri,
      username,
      password,
      ...(flags['--database'] !== undefined && { database: flags['--database'] }),
      sampleSize,
      ...(flags['--labels'] !== undefined && {
        labels: flags['--labels']
          .split(',')
          .map((label) => label.trim())
          .filter((label) => label !== ''),
      }),
      ...(flags['--out'] !== undefined && { out: flags['--out'] }),
    },
  }
}
