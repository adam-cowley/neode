import { describe, expect, it, vi } from 'vitest'
import { MergeService } from '../../src/services/query/merge.service'
import { UpdateService } from '../../src/services/query/update.service'
import {
  buildCreateQuery,
  buildMergeQuery,
  BulkService,
} from '../../src/services/query/bulk.service'
import { EntitySchema } from '../../src/meta/entity/entity-schema'
import { PropertyType } from '../../src/meta/property-schema'
import type { TimestampFormat } from '../../src/meta/property-schema'
import { getModel } from '../../src/meta'
import { CreatedAt, DateTime, NodeEntity, UpdatedAt } from '../../src/decorators'
import { defineModel } from '../../src/meta/map-schema'
import type { Runner } from '../../src/driver/types'

function schemaWith(
  properties: {
    key: string
    type: PropertyType
    primary?: boolean
    unique?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    timestampFormat?: TimestampFormat
  }[],
): EntitySchema {
  const schema = new EntitySchema()

  schema.setLabels(['Thing'])

  for (const { key, type, primary, unique, createdAt, updatedAt, timestampFormat } of properties) {
    schema.addProperty(key)
    schema.getProperty(key).setType(type)

    if (primary) {
      schema.getProperty(key).setPrimaryKey(true)
    }

    if (unique) {
      schema.getProperty(key).setUnique(true)
    }

    if (createdAt) {
      schema.getProperty(key).setCreatedAt(true)
    }

    if (updatedAt) {
      schema.getProperty(key).setUpdatedAt(true)
    }

    if (timestampFormat) {
      schema.getProperty(key).setTimestampFormat(timestampFormat)
    }
  }

  return schema
}

const runner = (): Runner =>
  ({
    run: vi.fn(() =>
      Promise.resolve({
        records: [
          {
            get: (key: string) => (key === '__id' ? '4:unit:ts' : undefined),
            has: (key: string) => key === '__id',
            keys: ['__id'],
          },
        ],
        // Counters report a created node: the ON CREATE SET stamps apply
        summary: { counters: { nodesCreated: 1 } },
      }),
    ),
  }) as unknown as Runner

describe('@CreatedAt / @UpdatedAt registration (NTS-165)', () => {
  it('registers the timestamp flags and stacks with a type decorator', () => {
    @NodeEntity()
    class Timestamped {
      @DateTime()
      @CreatedAt()
      createdAt: unknown

      @UpdatedAt()
      updatedAt: unknown
    }

    const schema = getModel(Timestamped)

    expect(schema.getProperty('createdAt').isCreatedAt()).toBe(true)
    expect(schema.getProperty('createdAt').getType()).toBe(PropertyType.DATETIME)
    expect(schema.getProperty('updatedAt').isUpdatedAt()).toBe(true)
  })

  it('accepts the config keys on the map API and never treats them as validation rules', () => {
    const Generated = defineModel('TimestampedMapThing', {
      name: { type: 'string', unique: true },
      createdAt: { type: 'datetime', createdAt: true },
      updatedAt: { type: 'datetime', updatedAt: true },
    })

    const schema = getModel(Generated)

    expect(schema.getProperty('createdAt').isCreatedAt()).toBe(true)
    expect(schema.getProperty('updatedAt').isUpdatedAt()).toBe(true)
    expect(schema.getProperty('createdAt').getRules()['createdAt']).toBeUndefined()
    expect(schema.getProperty('updatedAt').getRules()['updatedAt']).toBeUndefined()
  })

  it('registers the iso-string stamp format (NTS-612) and never treats it as a validation rule', () => {
    @NodeEntity()
    class IsoStamped {
      @CreatedAt({ format: 'iso-string' })
      createdAt: unknown

      @UpdatedAt({ format: 'iso-string' })
      updatedAt: unknown
    }

    const schema = getModel(IsoStamped)

    expect(schema.getProperty('createdAt').getTimestampFormat()).toBe('iso-string')
    expect(schema.getProperty('updatedAt').getTimestampFormat()).toBe('iso-string')
    expect(schema.getProperty('createdAt').getRules()['timestampFormat']).toBeUndefined()
    expect(schema.getProperty('updatedAt').getRules()['timestampFormat']).toBeUndefined()
  })

  it('defaults the stamp format to datetime (NTS-612)', () => {
    @NodeEntity()
    class DefaultStamped {
      @UpdatedAt()
      updatedAt: unknown
    }

    expect(getModel(DefaultStamped).getProperty('updatedAt').getTimestampFormat()).toBe('datetime')
  })
})

describe('server-side timestamps on the write paths (NTS-165)', () => {
  it('save() without merge criteria stamps datetime() into the CREATE pattern', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING },
      { key: 'createdAt', type: PropertyType.ANY, createdAt: true },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, schema)

    const [createStatement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(createStatement).toContain('CREATE (this:Thing')
    expect(createStatement).toContain('createdAt: datetime()')
    expect(createStatement).toContain('updatedAt: datetime()')
  })

  it('save() merge stamps createdAt on create and updatedAt on every write', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'createdAt', type: PropertyType.ANY, createdAt: true },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, schema)

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain(
      'ON CREATE SET this.createdAt = datetime(), this.updatedAt = datetime()',
    )
    expect(statement).toContain('ON MATCH SET this.updatedAt = datetime()')
  })

  it('save() merge with an empty dirty set writes no timestamps (NTS-157 no-op guard)', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'createdAt', type: PropertyType.ANY, createdAt: true },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, schema, new Set())

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).not.toContain('ON CREATE SET')
    expect(statement).not.toContain('ON MATCH SET')
  })

  it('mergeOn stamps createdAt on create and updatedAt on every write', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'createdAt', type: PropertyType.ANY, createdAt: true },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).mergeOn(schema, { name: 'Rex' }, { name: 'Rex' })

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain(
      'ON CREATE SET this.createdAt = datetime(), this.updatedAt = datetime()',
    )
    expect(statement).toContain('ON MATCH SET this.updatedAt = datetime()')
  })

  it('update() stamps updatedAt and never rewrites createdAt', async () => {
    const schema = schemaWith([
      { key: 'id', type: PropertyType.STRING, primary: true },
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'createdAt', type: PropertyType.ANY, createdAt: true },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true },
    ])

    const mockRunner = runner()

    await new UpdateService(mockRunner).update(
      schema,
      { id: 'unit-1', name: 'Rex' },
      { name: 'Ada' },
    )

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain('this.updatedAt = datetime()')
    expect(statement).not.toContain('this.createdAt')
  })

  it('update() leaves an explicitly provided updatedAt alone', async () => {
    const schema = schemaWith([
      { key: 'id', type: PropertyType.STRING, primary: true },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true },
    ])

    const mockRunner = runner()

    await new UpdateService(mockRunner).update(schema, { id: 'unit-1' }, { updatedAt: 'explicit' })

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).not.toContain('datetime()')
  })
})

describe('bulk timestamps (NTS-165)', () => {
  it('createMany coalesces the row value with the server clock', () => {
    const query = buildCreateQuery(
      ['Thing'],
      [
        'this.createdAt = coalesce(row.createdAt, datetime())',
        'this.updatedAt = coalesce(row.updatedAt, datetime())',
      ],
    )

    expect(query).toContain('SET this += row, this.createdAt = coalesce(row.createdAt, datetime())')
    expect(query).toContain('this.updatedAt = coalesce(row.updatedAt, datetime())')
  })

  it('mergeMany stamps createdAt on create and updatedAt on every row', () => {
    const query = buildMergeQuery(
      ['Thing'],
      ['name'],
      ['this.createdAt = coalesce(row.createdAt, datetime())'],
      ['this.updatedAt = coalesce(row.updatedAt, datetime())'],
    )

    expect(query).toContain('ON CREATE SET this.createdAt = coalesce(row.createdAt, datetime())')
    expect(query).toContain('SET this += row, this.updatedAt = coalesce(row.updatedAt, datetime())')
  })

  it('buildCreateQuery without stamps is unchanged', () => {
    expect(buildCreateQuery(['Thing'])).toBe(
      'UNWIND $rows AS row\nCREATE (this:Thing)\nSET this += row\nRETURN this',
    )
  })
})

describe("iso-string stamp format renders toString(datetime()) (NTS-612, { format: 'iso-string' })", () => {
  const BulkIso = defineModel('Nts612BulkIsoThing', {
    id: { type: 'string', primary: true },
    name: { type: 'string' },
    createdAt: { type: 'datetime', createdAt: true, timestampFormat: 'iso-string' },
    updatedAt: { type: 'datetime', updatedAt: true, timestampFormat: 'iso-string' },
  })

  const isoSchemaWith = (): EntitySchema =>
    schemaWith([
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'createdAt', type: PropertyType.ANY, createdAt: true, timestampFormat: 'iso-string' },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true, timestampFormat: 'iso-string' },
    ])

  it('save() without merge criteria stamps toString(datetime()) into the CREATE pattern', async () => {
    const schema = schemaWith([
      { key: 'name', type: PropertyType.STRING },
      { key: 'createdAt', type: PropertyType.ANY, createdAt: true, timestampFormat: 'iso-string' },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true, timestampFormat: 'iso-string' },
    ])

    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, schema)

    const [createStatement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(createStatement).toContain('createdAt: toString(datetime())')
    expect(createStatement).toContain('updatedAt: toString(datetime())')
  })

  it('save() merge stamps toString(datetime()) on create and on match', async () => {
    const mockRunner = runner()

    await new MergeService(mockRunner).save({ name: 'Rex' }, isoSchemaWith())

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain(
      'ON CREATE SET this.createdAt = toString(datetime()), this.updatedAt = toString(datetime())',
    )
    expect(statement).toContain('ON MATCH SET this.updatedAt = toString(datetime())')
  })

  it('update() stamps toString(datetime()) and never rewrites createdAt', async () => {
    const schema = schemaWith([
      { key: 'id', type: PropertyType.STRING, primary: true },
      { key: 'name', type: PropertyType.STRING, unique: true },
      { key: 'createdAt', type: PropertyType.ANY, createdAt: true, timestampFormat: 'iso-string' },
      { key: 'updatedAt', type: PropertyType.ANY, updatedAt: true, timestampFormat: 'iso-string' },
    ])

    const mockRunner = runner()

    await new UpdateService(mockRunner).update(
      schema,
      { id: 'unit-1', name: 'Rex' },
      { name: 'Ada' },
    )

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain('this.updatedAt = toString(datetime())')
    expect(statement).not.toContain('this.createdAt')
  })

  it('bulk createMany coalesces the row value with toString(datetime())', async () => {
    const mockRunner = runner()

    await new BulkService(mockRunner).createMany(BulkIso, getModel(BulkIso)!, [
      { id: 'row-1', name: 'A' },
    ])

    const [statement] = vi.mocked(mockRunner.run).mock.calls[0]!

    expect(statement).toContain('coalesce(row.createdAt, toString(datetime()))')
    expect(statement).toContain('coalesce(row.updatedAt, toString(datetime()))')
  })
})
