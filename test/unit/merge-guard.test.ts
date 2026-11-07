import { describe, expect, it, vi } from 'vitest'
import { MergeService } from '../../src/services/query/merge.service'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'
import type { Runner } from '../../src/driver/types'

function schemaWith(
  properties: { key: string; type: PropertyType; unique?: boolean }[],
): EntitySchema {
  const schema = new EntitySchema()

  schema.setLabels(['Thing'])

  for (const { key, type, unique } of properties) {
    schema.addProperty(key)
    schema.getProperty(key).setType(type)

    if (unique) {
      schema.getProperty(key).setUnique(true)
    }
  }

  return schema
}

const runner = (): Runner => ({
  run: vi.fn((statement: string) => {
    // CREATE paths read the new node's elementId back off __id
    if (statement.startsWith('CREATE')) {
      return Promise.resolve({
        records: [
          {
            get: (key: string) => (key === '__id' ? '4:unit:create' : undefined),
            has: (key: string) => key === '__id',
            keys: ['__id'],
          },
        ],
      })
    }

    return Promise.resolve({ records: [] })
  }),
})

describe('MergeService.save() without merge criteria', () => {
  it('creates a new node when no primary key or unique property is set', async () => {
    const schema = schemaWith([{ key: 'name', type: PropertyType.STRING }])
    const mockRunner = runner()

    const service = new MergeService(mockRunner)

    // No pk, no unique fields: a bare MERGE (this:Thing) would match and
    // overwrite an arbitrary existing node — save() must CREATE instead
    const result = await service.save({ name: 'Rex' }, schema)

    expect(result.created).toBe(true)
    expect(typeof result.elementId).toBe('string')

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain('CREATE')
    expect(statement).not.toContain('MERGE')
  })

  it('reports created: false when the merge matched an existing node', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'age', type: PropertyType.NUMBER },
    ])

    const mockRunner = runner()

    vi.mocked(mockRunner.run).mockResolvedValue({
      records: [
        {
          get: (key: string) => (key === '__id' ? '4:unit:1' : undefined),
          has: (key: string) => key === '__id',
          keys: ['__id'],
        },
      ],
      // No counters: the merge matched, created nothing
    })

    const service = new MergeService(mockRunner)

    const result = await service.save({ name: 'Rex', age: 3 }, schema)

    expect(result.created).toBe(false)
    expect(mockRunner.run).toHaveBeenCalledTimes(1)
  })
})
