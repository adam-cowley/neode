#!/usr/bin/env node
/*
neode-generate — generate neode model definitions from a live Neo4j
database (NTS-164). Wraps the neode.generateModels() facade method, which
is the primary (agent-friendly) surface — this CLI only connects, prints
and writes.

Usage:
  neode-generate --uri bolt://localhost:7687 --username neo4j --password secret \
    [--database neo4j] [--sample 100] [--labels Person,Movie] [--out dir]

Default (dry-run): prints the generated definitions to stdout.
--out dir: writes models.ts (decorated classes) and schema.ts (map
schemas) into the directory instead.
*/
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { auth, driver as createDriver } from 'neo4j-driver'

import Neode from '../index.js'
import { parseGenerateArguments, usageText } from './arguments.js'

async function main(): Promise<number> {
  const parsed = parseGenerateArguments(process.argv.slice(2))

  if (parsed.error !== undefined || parsed.arguments === undefined) {
    process.stderr.write(`${parsed.error ?? 'Invalid arguments'}\n\n${usageText()}\n`)

    return 1
  }

  const cliArguments = parsed.arguments
  const driver = createDriver(
    cliArguments.uri,
    auth.basic(cliArguments.username, cliArguments.password),
  )

  const neode = Neode.forDriver(driver, cliArguments.database)

  try {
    const result = await neode.generateModels({
      sampleSize: cliArguments.sampleSize,
      ...(cliArguments.labels !== undefined && { labels: cliArguments.labels }),
    })

    for (const warning of result.warnings) {
      process.stderr.write(`warning: ${warning}\n`)
    }

    if (result.models.length === 0) {
      process.stderr.write('No node labels with data found — nothing to generate.\n')

      return 1
    }

    if (cliArguments.out === undefined) {
      process.stdout.write(result.typescript)
      process.stdout.write('\n// ---- map schema ----\n\n')
      process.stdout.write(result.mapSchema)

      return 0
    }

    mkdirSync(cliArguments.out, { recursive: true })

    const models = path.join(cliArguments.out, 'models.ts')
    const schema = path.join(cliArguments.out, 'schema.ts')

    writeFileSync(models, result.typescript)
    writeFileSync(schema, result.mapSchema)

    process.stdout.write(
      `Wrote ${String(result.models.length)} model(s):\n  ${models}\n  ${schema}\n`,
    )

    return 0
  } finally {
    await driver.close()
  }
}

async function run(): Promise<void> {
  try {
    process.exitCode = await main()
  } catch (error) {
    process.stderr.write(
      `neode-generate: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}

// run() never rejects (its catch sets the exit code); `void` marks the
// deliberate fire-and-forget
void run()
