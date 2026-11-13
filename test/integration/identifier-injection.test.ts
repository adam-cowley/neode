import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { NodeEntity, Property } from '../../src/decorators'
import { NeodeError } from '../../src/errors'
import { Repository } from '../../src/repository'
import { openBackend, type TestBackend } from './support/backend'

// NTS-573 — hostile strings reach the database as quoted identifiers or
// not at all; they never execute as Cypher.

@NodeEntity()
class InjectionItem {
  @Property({ type: 'string', unique: true }) sku: string
  @Property({ type: 'string' }) name: string
}

describe('identifier injection (NTS-573)', () => {
  let backend: TestBackend
  let items: Repository<InjectionItem>

  beforeAll(async () => {
    backend = await openBackend()
    items = backend.neode.getRepository(InjectionItem)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('upsert stores a hostile undeclared key as a property name and deletes nothing', async () => {
    const hostile = 'name} DETACH DELETE x //'

    await items.upsert({ sku: 'victim', name: 'keep me' })
    await items.upsert({ sku: 'a', name: 'A', [hostile]: 'payload' })

    const result = await backend.connection.run(
      'MATCH (n:InjectionItem) RETURN count(n) AS total, count(n[$hostile]) AS hostile',
      { hostile },
    )

    expect(result.records[0]?.get('total')).toBe(2)
    expect(result.records[0]?.get('hostile')).toBe(1)
  })

  it('rejects a hostile order direction and quotes a hostile order field', async () => {
    await items.upsert({ sku: 'a', name: 'A' })

    await expect(
      items.findAll({}, { order: { name: 'ASC; MATCH (x) DETACH DELETE x //' } }),
    ).rejects.toThrow(NeodeError)

    // Quoted: a nonexistent property sorts as null, it does not execute
    await expect(items.findAll({}, { order: 'name} DETACH DELETE x //' })).resolves.toHaveLength(1)
    expect(await items.findAll()).toHaveLength(1)
  })

  it('quotes a hostile where() key into a nonexistent property (NTS-675)', async () => {
    await items.upsert({ sku: 'a', name: 'A' })

    const { Builder } = await import('../../src/query')

    // Quoted: the hostile key becomes a quoted identifier — on every
    // engine an undefined variable reference, so the statement fails
    // closed (never executes) and the row survives
    const built = new Builder()
      .match('n', 'InjectionItem')
      .where('name} DETACH DELETE x //', 'payload')
      .where('n.name', 'A')
      .return('n')
      .build()

    expect(built.query).toContain('`name} DETACH DELETE x //` =')
    await expect(backend.connection.run(built.query, built.params)).rejects.toThrow()
    expect(await items.findAll()).toHaveLength(1)
  })
})
