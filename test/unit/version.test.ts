import { describe, expect, it, vi } from 'vitest'
import { MergeService } from '../../src/services/query/merge.service'
import { UpdateService } from '../../src/services/query/update.service'
import { buildCreateQuery, buildMergeQuery } from '../../src/services/query/bulk.service'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'
import { getModel } from '../../src/meta'
import { NodeEntity, Number, Version } from '../../src/decorators'
import { defineModel } from '../../src/meta/map-schema'
import { NeodeError, OptimisticLockError, classifyError, isTransientError } from '../../src/errors'
import type { Runner } from '../../src/driver/types'

function schemaWith(
  properties: {
    key: string
    type: PropertyType
    primary?: boolean
    unique?: boolean
    version?: boolean
  }[],
): EntitySchema {
  const schema = new EntitySchema()

  schema.setLabels(['Thing'])

  for (const { key, type, primary, unique, version } of properties) {
    schema.addProperty(key)
    schema.getProperty(key).setType(type)

    if (primary) {
      schema.getProperty(key).setPrimaryKey(true)
    }

    if (unique) {
      schema.getProperty(key).setUnique(true)
    }

    if (version) {
      schema.getProperty(key).setVersion(true)
    }
  }

  return schema
}

/**
A runner whose first run resolves a record (a matched guard / merge) and
whose further behaviour the test overrides
*/
const runner = (): Runner =>
  ({
    run: vi.fn(() =>
      Promise.resolve({
        records: [
          {
            get: (key: string) => (key === '__id' ? '4:unit:ver' : undefined),
            has: (key: string) => key === '__id',
            keys: ['__id'],
          },
        ],
        summary: { counters: {} },
      }),
    ),
  }) as unknown as Runner

describe('@Version registration (NTS-158)', () => {
  it('registers the version flag and stacks with a type decorator', () => {
    @NodeEntity()
    class Locked {
      @Number()
      @Version()
      version: unknown
    }

    const schema = getModel(Locked)

    expect(schema.getProperty('version').isVersion()).toBe(true)
    expect(schema.getProperty('version').getType()).toBe(PropertyType.NUMBER)
  })

  it('accepts the config key on the map API and never treats it as a validation rule', () => {
    const Generated = defineModel('VersionedMapThing', {
      name: { type: 'string', unique: true },
      version: { type: 'number', version: true },
    })

    const schema = getModel(Generated)

    expect(schema.getProperty('version').isVersion()).toBe(true)
    expect(schema.getProperty('version').getRules()['version']).toBeUndefined()
  })
})

describe('optimistic locking on the write paths (NTS-158)', () => {
  it('save() without merge criteria stamps version 0 into the CREATE pattern', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, schema)

    const [createStatement, createParams] = vi.mocked(mockRunner.run).mock.calls[0]!

    // A plain literal is parameterised into the CREATE pattern
    expect(createStatement).toContain('version: $this_version')
    expect(createParams).toMatchObject({ this_version: 0 })
  })

  it('save() merge stamps version 0 on create and bumps on match', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, schema)

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain('ON CREATE SET this.version = 0')
    expect(statement).toContain('ON MATCH SET this.version = coalesce(this.version, 0) + 1')
  })

  it('save() as a nested relationship-target write never bumps the match path (no cascade)', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, schema, undefined, { nested: true })

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    // A genuinely created target still starts at 0...
    expect(statement).toContain('ON CREATE SET this.version = 0')
    // ...but nobody else's write bumps it (SDN issue 2604 lesson)
    expect(statement).not.toContain('ON MATCH SET')
  })

  it('save() on an instance carrying its hydrated version guards and bumps once', async () => {
    const schema = schemaWith([
      { key: '_id', type: PropertyType.INTERNAL_ID },
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ _id: '4:unit:ver', name: 'Rex', version: 3 }, schema)

    const [guard, merge] = vi.mocked(mockRunner.run).mock.calls.map(([statement]) => statement)

    // Guard statement: match by elementId AND the expected version, bump atomically
    expect(guard).toContain('this.version = $expectedVersion')
    expect(guard).toContain('SET this.version = coalesce(this.version, 0) + 1')

    // The merge no longer bumps — the guard did
    expect(merge).toContain('ON CREATE SET this.version = 0')
    expect(merge).not.toContain('ON MATCH SET this.version')
  })

  it('save() throws OptimisticLockError when the guard matches zero rows', async () => {
    const schema = schemaWith([
      { key: '_id', type: PropertyType.INTERNAL_ID },
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const mockRunner = runner()

    vi.mocked(mockRunner.run).mockResolvedValueOnce({
      records: [],
      summary: { counters: {} },
    } as never)

    await expect(
      new MergeService(mockRunner).save({ _id: '4:unit:ver', name: 'Rex', version: 3 }, schema),
    ).rejects.toThrow(OptimisticLockError)

    // The failed guard aborts the save: no merge statement follows
    expect(vi.mocked(mockRunner.run).mock.calls).toHaveLength(1)
  })

  it('save() without a hydrated version skips the guard but still bumps', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, schema)

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).not.toContain('expectedVersion')
    expect(statement).toContain('ON MATCH SET this.version = coalesce(this.version, 0) + 1')
  })

  it('update() guards on the hydrated version and bumps by exactly 1', async () => {
    const schema = schemaWith([
      { key: 'id', type: PropertyType.STRING, primary: true },
      { key: 'name', type: PropertyType.STRING },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const mockRunner = runner()

    await new UpdateService(mockRunner).update(
      schema,
      { id: 'unit-1', version: 3 },
      { version: 99, name: 'Ada' }, // explicitly provided version is library-managed: dropped
    )

    const [statement, params] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain('this.version = $expectedVersion')
    expect(statement).toContain('SET this.version = coalesce(this.version, 0) + 1')
    expect(params).toMatchObject({ expectedVersion: 3 })
    expect(JSON.stringify(params)).not.toContain('99')
  })

  it('update() throws OptimisticLockError when zero rows match the guard', async () => {
    const schema = schemaWith([
      { key: 'id', type: PropertyType.STRING, primary: true },
      { key: 'name', type: PropertyType.STRING },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const mockRunner = runner()

    vi.mocked(mockRunner.run).mockResolvedValueOnce({
      records: [],
      summary: { counters: {} },
    } as never)

    await expect(
      new UpdateService(mockRunner).update(schema, { id: 'unit-1', version: 3 }, { name: 'Ada' }),
    ).rejects.toThrow(OptimisticLockError)
  })

  it('update() without a version property renders no guard and no bump', async () => {
    const schema = schemaWith([
      { key: 'id', type: PropertyType.STRING, primary: true },
      { key: 'name', type: PropertyType.STRING },
    ])

    const mockRunner = runner()

    await new UpdateService(mockRunner).update(schema, { id: 'unit-1' }, { name: 'Ada' })

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).not.toContain('version')
  })
})

describe('bulk version stamps (NTS-158)', () => {
  it('createMany stamps created rows with 0 unless the row carries a version', () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING },
      { key: 'version', type: PropertyType.ANY, version: true },
    ])

    const query = buildCreateQuery(['Thing'], ['this.version = coalesce(row.version, 0)'])

    expect(query).toContain('SET this += row, this.version = coalesce(row.version, 0)')
    expect(schema.getProperty('version').isVersion()).toBe(true)
  })

  it('mergeMany bumps matched rows and stamps created rows', () => {
    const query = buildMergeQuery(
      ['Thing'],
      ['name'],
      ['this.version = coalesce(row.version, 0)'],
      [],
      ['this.version = coalesce(this.version, 0) + 1'],
    )

    expect(query).toContain('ON CREATE SET this.version = coalesce(row.version, 0)')
    expect(query).toContain('ON MATCH SET this.version = coalesce(this.version, 0) + 1')
  })
})

describe('OptimisticLockError (NTS-158)', () => {
  it('is a typed NeodeError with a stable name and reload-and-retry guidance', async () => {
    const error = new OptimisticLockError('LockedThing')

    expect(error).toBeInstanceOf(NeodeError)
    expect(error.name).toBe('OptimisticLockError')
    expect(error.message).toContain('Reload the entity and retry')
  })

  it('is never classified as a transient retry', () => {
    const error = new OptimisticLockError('LockedThing')

    expect(classifyError(error)).toBe(error)
    expect(isTransientError(error)).toBe(false)
  })
})
