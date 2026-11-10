/**
NTS-615: eager relationship creation on the write path — create() /
update() accept `options.relate` (relationship key -> saved target) and
relate inside the same managed transaction as the write. The captured
statements below are the Cypher contract of the new rendering: the
from-node matched by elementId (the create path relates a node it just
created, before hydration), the edge MERGEd (retries stay idempotent).
*/
import { describe, expect, it } from 'vitest'
import { Neode } from '../../src/neode.service'
import { NodeEntity, OneToMany, Property, Uuid } from '../../src/decorators'
import { Direction } from '../../src/query'
import { RelateService } from '../../src/services/query/relate.service'
import { INTERNAL_ID } from '../../src/constants'
import {
  AccessMode,
  ConnectionProvider,
  QueryOutput,
  QueryParams,
  TransactionHandle,
} from '../../src/driver/types'
import { getModel } from '../../src/meta'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class N615Team {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string
}

@NodeEntity()
class N615Person {
  @Uuid({ primary: true })
  id: string

  @Property({ type: 'string' })
  name: string

  @OneToMany(() => N615Team, 'PART_OF', Direction.OUTGOING)
  team: N615Team
}

// ---- A provider that captures every statement, autocommit or in-tx ----------

class CapturingProvider implements ConnectionProvider {
  readonly queries: string[] = []

  readonly beginDatabases: (string | undefined)[] = []

  async run(query: string): Promise<QueryOutput> {
    this.queries.push(query)

    return { records: [] }
  }

  async beginTransaction(mode?: AccessMode, database?: string): Promise<TransactionHandle> {
    this.beginDatabases.push(database)

    return {
      run: async (query: string, parameters?: QueryParams) => {
        this.queries.push(query)

        // The CREATE reads back the created node's elementId; the
        // re-hydration read needs a node-like row; the eager MERGE reads
        // the relationship (absent — the fake has no data)
        return {
          records: [
            {
              get: (name: string) =>
                name === INTERNAL_ID
                  ? 'elem-1'
                  : name === 'this'
                    ? {
                        elementId: 'elem-1',
                        labels: ['N615Person'],
                        properties: { id: 'p-1', name: 'Adam' },
                      }
                    : undefined,
            },
          ],
        } as unknown as QueryOutput
      },
      commit: async () => {},
      rollback: async () => {},
    }
  }

  async edition() {
    return 'community' as const
  }

  async close() {}
}

describe('eager relates on the write path (NTS-615)', () => {
  it('the eager edge statement matches the from-node by elementId and MERGEs the edge', async () => {
    const schema = getModel(N615Person)
    const relationship = schema.getRelationship('team')

    const target = Object.assign(new N615Team(), { id: 'team-1', name: 'Eng' })

    const queries: string[] = []

    await new RelateService({
      run: async (query: string) => {
        queries.push(query)

        return { records: [] } as unknown as QueryOutput
      },
    }).relate(schema, new N615Person(), target, relationship, {}, false, 'elem-1')

    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('MATCH (from)\nWHERE (elementId(from) = $')
    expect(queries[0]).toContain('MERGE (from)-[rel:`PART_OF`]->(to)')
  })

  it('without fromId the from-node still matches by its own identity (relate parity)', async () => {
    const schema = getModel(N615Person)
    const relationship = schema.getRelationship('team')

    const target = Object.assign(new N615Team(), { id: 'team-1', name: 'Eng' })

    const queries: string[] = []

    await new RelateService({
      run: async (query: string) => {
        queries.push(query)

        return { records: [] } as unknown as QueryOutput
      },
    }).relate(schema, Object.assign(new N615Person(), { id: 'p-1' }), target, relationship)

    expect(queries).toHaveLength(1)
    expect(queries[0]).not.toContain('elementId(from)')
    expect(queries[0]).toContain('MERGE (from)-[rel:`PART_OF`]->(to)')
  })

  it('create() renders the create and the eager edge in one transaction; the string third argument stays the database', async () => {
    const provider = new CapturingProvider()

    const neode = new Neode(provider)

    const target = Object.assign(new N615Team(), { id: 'team-1', name: 'Eng' })

    await neode.create(N615Person, { name: 'Adam' }, { relate: { team: target } }, 'graphs')

    expect(provider.beginDatabases[0]).toBe('graphs')
    expect(provider.queries.some((query) => query.startsWith('CREATE'))).toBe(true)
    expect(
      provider.queries.some((query) => query.includes('MERGE (from)-[rel:`PART_OF`]->(to)')),
    ).toBe(true)
  })

  it('a legacy string third argument on create() is still the database (no relates)', async () => {
    const provider = new CapturingProvider()

    const neode = new Neode(provider)

    await neode.create(N615Person, { name: 'Adam' }, 'graphs')

    expect(provider.beginDatabases[0]).toBe('graphs')
    expect(provider.queries.some((query) => query.includes('MERGE (from)'))).toBe(false)
  })
})
