import { describe, expect, it } from 'vitest'
import { NodeEntity, OneToMany, Primary, Property } from '../../../src/decorators'
import { Direction } from '../../../src/query'
import { getModel } from '../../../src/meta/index.js'
import { NeodeError } from '../../../src/errors/index'
import { SyncService } from '../../../src/services/query/sync.service'
import type { Runner } from '../../../src/driver/types'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Nts579Tag {
  @Primary()
  @Property({ type: 'string' })
  slug!: string
}

@NodeEntity()
class Nts579Post {
  @Primary()
  @Property({ type: 'string' })
  id!: string

  @OneToMany(() => Nts579Tag, 'TAGGED', Direction.OUTGOING)
  tags!: Nts579Tag[]
}

interface Statement {
  query: string
  params: Record<string, unknown> | undefined
}

/**
A scripted runner: records every statement and answers each with the
rows the responder returns for it
*/
function scriptedRunner(respond: (statement: Statement) => Record<string, unknown>[]): {
  runner: Runner
  statements: Statement[]
} {
  const statements: Statement[] = []

  const runner: Runner = {
    run: (query, params) => {
      const statement = { query, params }

      statements.push(statement)

      const rows = respond(statement)

      return Promise.resolve({
        records: rows.map((row) => ({
          get: (key: string) => row[key],
          has: (key: string) => key in row,
          keys: Object.keys(row),
        })),
      })
    },
  }

  return { runner, statements }
}

const tag = (slug: string): Nts579Tag => Object.assign(new Nts579Tag(), { slug })

const post = (): Nts579Post => Object.assign(new Nts579Post(), { id: 'p1' })

const sync = async (runner: Runner, targets: Nts579Tag[]) => {
  const schema = getModel(Nts579Post)!

  return new SyncService(runner).sync(schema, post(), schema.getRelationship('tags'), targets)
}

describe('syncEdges Cypher shape (NTS-579)', () => {
  it('resolves every target by label-constrained lookup before the edge scan', async () => {
    const { runner, statements } = scriptedRunner((statement) => {
      if (statement.query.includes('AS targetId')) {
        return [{ targetId: 'tag-1' }]
      }

      return [{ relId: 'rel-1', otherId: 'tag-1' }]
    })

    const result = await sync(runner, [tag('a')])

    expect(result).toEqual({ attached: 0, detached: 0 })
    expect(statements[0]?.query).toContain('MATCH (to:Nts579Tag')
    expect(statements[0]?.query).toContain('elementId(to) AS targetId')
    expect(statements[1]?.query).toContain('elementId(rel) AS relId')
    expect(statements[1]?.query).toContain('elementId(other) AS otherId')
    // A no-op sync issues no write statement
    expect(statements.some((statement) => /MERGE|DELETE/.test(statement.query))).toBe(false)
  })

  it('anchors the detach scan on the from-node, not every edge of the type', async () => {
    const { runner, statements } = scriptedRunner((statement) => {
      if (statement.query.includes('AS targetId')) {
        return [{ targetId: 'tag-2' }]
      }

      if (statement.query.includes('AS relId') && !statement.query.includes('MERGE')) {
        return [{ relId: 'rel-1', otherId: 'tag-1' }]
      }

      return [{ relId: 'rel-2' }]
    })

    const result = await sync(runner, [tag('b')])

    expect(result).toEqual({ attached: 1, detached: 1 })

    const detach = statements.find((statement) => statement.query.includes('DELETE'))

    expect(detach?.query).toContain('MATCH (from:Nts579Post')
    expect(detach?.query).toContain('-[rel:`TAGGED`]->()')
    expect(detach?.query).toContain('elementId(rel) IN $relIds')
    expect(detach?.query).not.toContain('from_node')
    expect(detach?.params?.['relIds']).toEqual(['rel-1'])
  })

  it('relates by the resolved elementId with a label-constrained target match', async () => {
    const { runner, statements } = scriptedRunner((statement) => {
      if (statement.query.includes('AS targetId')) {
        return [{ targetId: 'tag-9' }]
      }

      if (statement.query.includes('MERGE')) {
        return [{ relId: 'rel-9' }]
      }

      return []
    })

    await sync(runner, [tag('z')])

    const relate = statements.find((statement) => statement.query.includes('MERGE'))

    expect(relate?.query).toContain('MATCH (to:Nts579Tag)')
    expect(relate?.query).toContain('elementId(to) = $where_to_id')
    expect(relate?.params?.['where_to_id']).toBe('tag-9')
  })

  it('a missing target fails before any write, naming it and the fix', async () => {
    const { runner, statements } = scriptedRunner((statement) =>
      statement.query.includes('AS targetId') && statement.params?.['to_slug'] === 'a'
        ? [{ targetId: 'tag-1' }]
        : [],
    )

    const attempt = sync(runner, [tag('a'), tag('ghost')])

    await expect(attempt).rejects.toBeInstanceOf(NeodeError)
    await expect(attempt).rejects.toThrow(/Nts579Tag with slug = ghost/)
    await expect(attempt).rejects.toThrow(/Save the missing targets first/)
    expect(statements.some((statement) => /MERGE|DELETE/.test(statement.query))).toBe(false)
  })

  it('counts only statements that attached a row', async () => {
    const { runner } = scriptedRunner((statement) => {
      if (statement.query.includes('AS targetId')) {
        return [{ targetId: 'tag-1' }]
      }

      return []
    })

    expect(await sync(runner, [tag('a')])).toEqual({ attached: 0, detached: 0 })
  })
})
