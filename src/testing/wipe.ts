import type { Runner } from '../driver/types.js'

/** A Runner, or any facade exposing one (e.g. Neode — matched structurally
to avoid importing the service here). */
export type WipeTarget = Runner | { getRunner(): Runner }

/**
Wipe the database clean for a test run: DETACH DELETE every node, reset
the graph type to empty (NTS-550 — graph-type-derived constraints only go
with the type; Enterprise servers only, best-effort), then drop every
constraint and index the database currently has.

Standalone on purpose — SchemaService derives DROP statements from the
registered models, while wipe() discovers them from the database itself
(small duplication of its statement shapes, accepted).

Index drops are best-effort: built-in indexes (e.g. the token lookup
store on real servers) cannot be dropped and are ignored. Constraint
drops are best-effort too: on servers that had a graph type installed,
SHOW CONSTRAINTS lists graph-type-derived constraints whose DROP
CONSTRAINT may fail even after the reset.
*/
export async function wipe(target: WipeTarget): Promise<void> {
  const runner = resolveRunner(target)

  await runner.run('MATCH (n) DETACH DELETE n')

  try {
    // `ALTER CURRENT GRAPH TYPE SET { }` is the documented full reset —
    // it drops the graph type and every constraint it enforced
    await runner.run('ALTER CURRENT GRAPH TYPE SET { }')
  } catch {
    // Community / pre-2026.02 servers have no graph types
  }

  const constraints = await runner.run('SHOW CONSTRAINTS')

  for (const record of constraints.records) {
    const name = record.get('name')

    try {
      await runner.run(`DROP CONSTRAINT \`${String(name)}\` IF EXISTS`)
    } catch {
      // Graph-type-owned constraints may refuse a standalone drop
    }
  }

  const indexes = await runner.run('SHOW INDEXES')

  for (const record of indexes.records) {
    const name = record.get('name')

    try {
      await runner.run(`DROP INDEX \`${String(name)}\` IF EXISTS`)
    } catch {
      // Built-in / system indexes cannot be dropped
    }
  }
}

function resolveRunner(target: WipeTarget): Runner {
  return 'getRunner' in target ? target.getRunner() : target
}
