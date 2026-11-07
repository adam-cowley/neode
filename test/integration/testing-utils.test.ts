/**
 * NTS-146 — consumer test utilities: wipe() and testId().
 *
 * wipe() is exercised against the embedded backend, including the Relate
 * quirks it must survive: SHOW CONSTRAINTS / SHOW INDEXES / DETACH DELETE
 * all work there.
 */
import { describe, expect, it } from 'vitest'

import { openBackend, TestBackend } from './support/backend'

import { wipe } from '../../src/testing/wipe'

describe('wipe', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    await backend.close()
  })

  const countNodes = async (): Promise<number> => {
    const result = await backend.connection.run('MATCH (n) RETURN count(n) AS count', {}, 'READ')

    return result.records[0].get('count') as number
  }

  it('detach-deletes every node and relationship', async () => {
    await backend.connection.run(
      'CREATE (:WipePerson {name: "a"})-[:KNOWS]->(:WipePerson {name: "b"})',
    )
    await backend.connection.run('CREATE (:WipeThing {name: "t"})')

    expect(await countNodes()).toBe(3)

    await wipe(backend.connection)

    expect(await countNodes()).toBe(0)
  })

  it('accepts a Neode facade as well as a raw runner', async () => {
    await backend.connection.run('CREATE (:WipePerson {name: "a"})')

    await wipe(backend.neode)

    expect(await countNodes()).toBe(0)
  })

  it('drops every constraint and index it finds', async () => {
    if (!backend.capabilities.constraints) {
      return
    }

    await backend.connection.run(
      'CREATE CONSTRAINT wipe_person_email_unique IF NOT EXISTS ' +
        'FOR (n:WipePerson) REQUIRE n.email IS UNIQUE',
    )
    await backend.connection.run(
      'CREATE INDEX wipe_person_email_index IF NOT EXISTS FOR (n:WipePerson) ON (n.email)',
    )

    await wipe(backend.connection)

    const constraints = await backend.connection.run('SHOW CONSTRAINTS', {}, 'READ')
    const indexes = await backend.connection.run('SHOW INDEXES', {}, 'READ')

    const constraintNames = constraints.records.map((record) => record.get('name'))
    const indexNames = indexes.records.map((record) => record.get('name'))

    expect(constraintNames).not.toContain('wipe_person_email_unique')
    expect(indexNames).not.toContain('wipe_person_email_index')
  })

  it('leaves an already-empty database untouched (idempotent)', async () => {
    await wipe(backend.connection)
    await wipe(backend.connection)

    expect(await countNodes()).toBe(0)
  })
})
