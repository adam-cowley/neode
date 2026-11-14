#!/usr/bin/env node
/*
neode — the neode CLI bin entry. The dispatcher (and every subcommand's
logic) lives in dispatch.ts / commands/ — this file only bootstraps.
*/
import { runNeode } from './dispatch.js'

// runNeode resolves to an exit code and never rejects (the catch sets the
// exit code); `void` marks the deliberate fire-and-forget
void runNeode(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`neode: ${error instanceof Error ? error.message : String(error)}\n`)

    process.exitCode = 1
  })
