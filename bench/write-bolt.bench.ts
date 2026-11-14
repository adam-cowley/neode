/**
Write-path benchmark: neode vs raw Cypher over the neo4j-driver (Bolt) path —
the path production users run.

Strategies, each writing the same deterministic rows at 300 / 3,000 / 30,000:

  - neode.create()  per row          (full pipeline: validation, defaults, hooks)
  - neode.createMany()               (bulk UNWIND, 1000-row chunks — NTS-597)
  - neode.merge()   per row          (MERGE on the model's merge fields)
  - neode.mergeMany()                (bulk MERGE UNWIND, 1000-row chunks)
  - raw driver CREATE per row        (single-row autocommit baseline)
  - raw driver UNWIND                (one batch statement for all rows)

Each bench writes all N rows exactly once (one tinybench sample) — the
recorded `mean` is the wall-clock of the whole N-row write. Statement counts
are captured separately (QUERY_EXECUTED for neode strategies, explicit run
counters for the raw baseline) and written to
bench/results/write-bolt-latest.json on every teardown.

vitest bench mode runs NO hooks (vitest#5075) — per-bench setup/teardown use
tinybench's own setup/teardown options, and the container is reaped by
testcontainers' Ryuk when the process exits.

Run manually (needs Docker, NOT part of the default vitest gate):

  ./node_modules/.bin/vitest bench --project unit bench/write-bolt.bench.ts

NEO4J_IMAGE picks the container image (default neo4j:5-community).
*/
import { bench, describe } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import neo4j from 'neo4j-driver'
import { Neo4jContainer } from '@testcontainers/neo4j'
import type { StartedNeo4jContainer } from '@testcontainers/neo4j'
import type { Driver, Session } from 'neo4j-driver'
import { Neode } from '../src/neode.service'
import { Neo4jConnectionProvider } from '../src/driver/neo4j-connection-provider.js'
import { defineModel } from '../src/meta/map-schema'
import { EventType } from '../src/common/events'

// One write of all N rows per bench — no warmup, no repeats: the recorded
// mean is the wall-clock of the full N-row write
const ONE_SHOT = { time: 0, iterations: 1, warmupTime: 0, warmupIterations: 0 }

const SCALES = [300, 3_000, 30_000] as const
const IMAGE = process.env.NEO4J_IMAGE || 'neo4j:5-community'
const PASSWORD = process.env.NEO4J_PASSWORD || 'ogm-test-password'
const LABEL = 'BenchWriteUser'

const BenchWriteUser = defineModel(LABEL, {
    id: { type: 'string', primary: true },
    name: 'string',
    email: 'string',
    counter: 'number',
})

interface Row {
    id: string
    name: string
    email: string
    counter: number
}

// ---- Deterministic fixtures, generated before anything is timed ------------

const fixtures = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
        id: `bench-write-${i}`,
        name: `User ${i}`,
        email: `bench-write-${i}@example.com`,
        counter: i,
    }))

const ROWS = fixtures(Math.max(...SCALES))
const rowsOf = (n: number): Row[] => ROWS.slice(0, n)

// ---- Statement counting ------------------------------------------------------
// neode strategies: QUERY_EXECUTED fires once per statement through the
// instance's connection. Raw strategies bypass neode — the body bumps its own
// counter per driver run. Counting is only active inside measured().

const counts: Record<string, number> = {}
let activeKey: string | undefined

async function measured(key: string, run: () => Promise<void>): Promise<void> {
    activeKey = key
    counts[key] = 0

    try {
        await run()
    } finally {
        activeKey = undefined
    }
}

const bump = (): void => {
    if (activeKey !== undefined) {
        counts[activeKey] = (counts[activeKey] ?? 0) + 1
    }
}

// ---- Container + handles, started once on the first bench's setup -----------

let container: StartedNeo4jContainer | undefined
let driver: Driver | undefined
let session: Session | undefined
let neode: Neode | undefined
let started: Promise<void> | undefined

async function ensureStarted(): Promise<void> {
    if (started === undefined) {
        started = (async () => {
            container = await new Neo4jContainer(IMAGE).withPassword(PASSWORD).start()

            const driver_ = neo4j.driver(container.getBoltUri(), neo4j.auth.basic('neo4j', PASSWORD))
            await driver_.getServerInfo()

            driver = driver_
            session = driver_.session()

            const neode_ = new Neode(new Neo4jConnectionProvider(driver_, 'neo4j'))
            await neode_.installSchema()
            neode = neode_

            neode_.on(EventType.QUERY_EXECUTED, () => {
                if (activeKey !== undefined) {
                    counts[activeKey] = (counts[activeKey] ?? 0) + 1
                }
            })
        })()
    }

    await started
}

async function clearGraph(): Promise<void> {
    await session?.run(`MATCH (n:${LABEL}) DETACH DELETE n`)
}

function writeRecord(): void {
    const record = {
        date: new Date().toISOString(),
        neo4jImage: IMAGE,
        node: process.version,
        statementsPerWrite: { ...counts },
    }

    const resultsDir = resolve(__dirname, 'results')
    mkdirSync(resultsDir, { recursive: true })
    writeFileSync(resolve(resultsDir, 'write-bolt-latest.json'), JSON.stringify(record, null, 2))
}

describe(`neode write path vs raw Cypher — Neo4j testcontainer (${IMAGE})`, () => {
    for (const scale of SCALES) {
        const rows = rowsOf(scale)

        describe(`${scale} rows`, () => {
            // Untimed (tinybench setup, vitest bench runs no hooks): one empty
            // graph per bench, so repeated ids never collide and merge()
            // always creates
            const benchOptions = {
                ...ONE_SHOT,
                setup: async () => {
                    await ensureStarted()
                    await clearGraph()
                },
                teardown: async () => {
                    writeRecord()
                },
            }

            bench('neode.create() per row', async () => {
                await measured(`neode.create() per row @ ${scale}`, async () => {
                    for (const row of rows) {
                        await neode?.create(BenchWriteUser, row)
                    }
                })
            }, benchOptions)

            bench('neode.createMany() — UNWIND, 1000-row chunks', async () => {
                await measured(`neode.createMany() @ ${scale}`, async () => {
                    await neode?.createMany(BenchWriteUser, rows)
                })
            }, benchOptions)

            bench('neode.merge() per row', async () => {
                await measured(`neode.merge() per row @ ${scale}`, async () => {
                    for (const row of rows) {
                        await neode?.merge(BenchWriteUser, row)
                    }
                })
            }, benchOptions)

            bench('neode.mergeMany() — MERGE UNWIND, 1000-row chunks', async () => {
                await measured(`neode.mergeMany() @ ${scale}`, async () => {
                    await neode?.mergeMany(BenchWriteUser, rows)
                })
            }, benchOptions)

            bench('raw driver — CREATE per row', async () => {
                await measured(`raw CREATE per row @ ${scale}`, async () => {
                    for (const row of rows) {
                        await session?.run(
                            `CREATE (:${LABEL} { id: $id, name: $name, email: $email, counter: $counter })`,
                            row,
                        )
                        bump()
                    }
                })
            }, benchOptions)

            bench('raw driver — one UNWIND batch', async () => {
                await measured(`raw UNWIND @ ${scale}`, async () => {
                    await session?.run(
                        `UNWIND $rows AS row CREATE (:${LABEL} { id: row.id, name: row.name, email: row.email, counter: row.counter })`,
                        { rows },
                    )
                    bump()
                })
            }, benchOptions)
        })
    }
})
