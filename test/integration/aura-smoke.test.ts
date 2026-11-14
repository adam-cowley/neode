import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NodeEntity, Property, Uuid } from '../../src/decorators'
import { openBackend, type TestBackend } from './support/backend'
import { provisionAuraInstance, destroyAuraInstance, isAuraConfigured } from './support/aura'

// Per-file fixture: the decorator registry is global per module
@NodeEntity()
class AuraSmokePerson {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  @Property({ type: 'integer' })
  age!: number
}

/**
 * Aura smoke (NTS-651): provisions a REAL AuraDB instance in beforeAll,
 * runs the read/write/schema smoke against it, destroys it in afterAll —
 * nothing outlives the run.
 *
 * Skipped unless AURA_CLIENT_ID + AURA_CLIENT_SECRET + AURA_PROJECT_ID are
 * set. Run with: AURA_CLIENT_ID=… AURA_CLIENT_SECRET=… AURA_PROJECT_ID=… pnpm test:aura
 * (the instance password exists only in memory — never logged, never written).
 */
describe.skipIf(!isAuraConfigured())('Aura smoke: provision → smoke → destroy', () => {
  let instance:
    | {
        instanceId: string
        uri: string
        username: string
        password: string
        defaultDatabase: string
      }
    | undefined
  let backend: TestBackend

  beforeAll(async () => {
    try {
      instance = await provisionAuraInstance()
    } catch (error) {
      // Belt and braces: a provision failure must never orphan an instance
      if (instance) {
        await destroyAuraInstance(instance.instanceId).catch(() => {})
      }
      throw error
    }
    // The backend selector stays an env var (the harness's design); the
    // provisioned credentials are passed as values — never staged through
    // the environment
    process.env.OGM_TEST_BACKEND = 'neo4j'
    backend = await openBackend({
      uri: instance.uri,
      username: instance.username,
      password: instance.password,
      database: instance.defaultDatabase,
    })
  }, 1_200_000)

  afterAll(async () => {
    await backend?.close()
    if (instance) {
      await destroyAuraInstance(instance.instanceId)
    }
  }, 600_000)

  it('installs schema, bulk-writes, reads with equality and operator filters, paginates, updates, deletes, drops schema', async () => {
    const { neode, connection } = backend

    // Schema install lands on the Aura instance
    const installed = await neode.installSchema()
    expect(installed.length).toBeGreaterThan(0)
    const showConstraints = await connection.run('SHOW CONSTRAINTS')
    expect(showConstraints.records.length).toBeGreaterThan(0)

    // Bulk write (UNWIND chunks) on a real Aura server
    await neode.createMany(AuraSmokePerson, [
      { name: 'Ada', age: 36 },
      { name: 'Grace', age: 45 },
      { name: 'Edsger', age: 72 },
      { name: 'Barbara', age: 28 },
      { name: 'Alan', age: 41 },
    ])

    // Equality filter
    const ada = await neode.get(AuraSmokePerson, { name: 'Ada' })
    expect(ada).toHaveLength(1)
    expect(ada[0].age).toBe(36)

    // Operator filter (the NTS-646 typed tier, end-to-end on Aura)
    const overForty = await neode.get(AuraSmokePerson, { age: { gte: 40 } })
    expect(new Set(overForty.map((person) => person.name))).toEqual(
      new Set(['Grace', 'Edsger', 'Alan']),
    )

    // Pagination + count
    const page = await neode.paginate(AuraSmokePerson, {}, { page: 1, limit: 2 })
    expect(page.total).toBe(5)
    expect(page.items).toHaveLength(2)

    // Update persists
    ada[0].age = 37
    await ada[0].save()
    const reRead = await neode.get(AuraSmokePerson, { name: 'Ada' })
    expect(reRead[0].age).toBe(37)

    // Delete drops the count
    await neode.delete(ada[0])
    const afterDelete = await neode.findManyAndCount(AuraSmokePerson, {})
    expect(afterDelete.total).toBe(4)

    // Schema drop leaves the instance clean
    await neode.dropSchema()
    const constraintsAfterDrop = await connection.run('SHOW CONSTRAINTS')
    expect(constraintsAfterDrop.records.length).toBe(0)
  }, 120_000)
})
