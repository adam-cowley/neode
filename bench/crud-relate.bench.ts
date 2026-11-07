import { bench, beforeAll, describe } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import Neode from '../src/neode.service';
import { RelateConnectionProvider, requireRelateClient } from '../src/driver/relate';
import { defineModel } from '../src/meta/map-schema';

// ---- Embedded Relate engine (same loading as test/integration/support/backend.ts,
//      with the library path depth adjusted for this file's location in bench/) ---
if (!process.env.RELATE_LIB) {
    for (const profile of [ 'release', 'debug' ]) {
        const candidate = resolve(__dirname, `../../relate/target/${profile}/librelate_ffi.dylib`);

        if (existsSync(candidate)) {
            process.env.RELATE_LIB = candidate;
            break;
        }
    }
}

const client = requireRelateClient();
const database = client.Database.open(':memory:');

// Raw client connection for the hand-written Cypher baseline (autocommit)
const raw = database.connect('neo4j');

const neode = new Neode(new RelateConnectionProvider(database));

// ---- Model (same shape for raw and OGM) --------------------------------------

interface BenchCrudUserInstance {
    id?: string;
    name?: string;
    email?: string;
    counter?: number;
    _id?: string;
}

const BenchCrudUser = defineModel('BenchCrudUser', {
    id: { type: 'string', primary: true },
    name: 'string',
    email: 'string',
    counter: 'number',
});

const instance = (): BenchCrudUserInstance =>
    new (BenchCrudUser as new () => BenchCrudUserInstance)();

// ---- Pools: find/update don't consume records, so a fixed pool is cycled ------
const POOL = 50;

const rawIds: string[] = [];
const ogmIds: string[] = [];
const ogmEntities: BenchCrudUserInstance[] = [];

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${counter++}`;

beforeAll(async () => {
    for (let i = 0; i < POOL; i++) {
        const id = `raw-pool-${i}`;
        rawIds.push(id);

        await raw.queryAsync(
            'CREATE (:BenchCrudUser { id: $id, name: $name, email: $email, counter: $counter })',
            { id, name: `Raw ${i}`, email: `${id}@example.com`, counter: 0 }
        );
    }

    for (let i = 0; i < POOL; i++) {
        const entity = instance();
        entity.id = `ogm-pool-${i}`;
        entity.name = `OGM ${i}`;
        entity.email = `ogm-pool-${i}@example.com`;
        entity.counter = 0;

        ogmIds.push(entity.id);

        ogmEntities.push(await neode.save(entity) as BenchCrudUserInstance);
    }
}, 120_000);

describe('CRUD on embedded Relate — raw client vs OGM', () => {
    // find/update run before the create benches: the scans below read the
    // pre-setup graph, not one grown by the create/delete throughput runs
    describe('raw queryAsync baseline (hand-written Cypher)', () => {
        bench('findOne — MATCH by primary key', async () => {
            await raw.queryAsync('MATCH (n:BenchCrudUser { id: $id }) RETURN n', {
                id: rawIds[ counter++ % POOL ],
            });
        });

        bench('update — MATCH + SET', async () => {
            await raw.queryAsync('MATCH (n:BenchCrudUser { id: $id }) SET n.counter = $counter', {
                id: rawIds[ counter++ % POOL ],
                counter,
            });
        });

        bench('create — CREATE + RETURN', async () => {
            await raw.queryAsync(
                'CREATE (n:BenchCrudUser { id: $id, name: $name, email: $email, counter: $counter }) RETURN n',
                { id: nextId('raw-create'), name: 'Raw', email: 'raw@example.com', counter: 0 }
            );
        });

        // Delete consumes the record, so each iteration recreates what it deletes
        bench('delete — CREATE + DETACH DELETE', async () => {
            const id = nextId('raw-delete');

            await raw.queryAsync('CREATE (:BenchCrudUser { id: $id })', { id });
            await raw.queryAsync('MATCH (n:BenchCrudUser { id: $id }) DETACH DELETE n', { id });
        });
    });

    describe('OGM (neode.save/find/update/delete)', () => {
        bench('find — by primary key', async () => {
            await neode.find(BenchCrudUser, ogmIds[ counter++ % POOL ]);
        });

        bench('update — += properties + rehydrate', async () => {
            await neode.update(ogmEntities[ counter++ % POOL ], { counter });
        });

        bench('save — MERGE + rehydrate', async () => {
            const entity = instance();
            entity.id = nextId('ogm-save');
            entity.name = 'OGM';
            entity.email = 'ogm-save@example.com';
            entity.counter = 0;

            await neode.save(entity);
        });

        // Same pairing as the raw delete bench: save then delete per iteration
        bench('delete — save + delete', async () => {
            const entity = instance();
            entity.id = nextId('ogm-delete');
            entity.name = 'OGM';
            entity.email = 'ogm-delete@example.com';

            await neode.delete(await neode.save(entity));
        });
    });
});
