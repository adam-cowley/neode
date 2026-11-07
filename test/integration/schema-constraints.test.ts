// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import { SchemaService } from '../../src/services/schema/schema.service'
import { inspectSchema } from '../../src/services/schema/inspect.service'
import { NodeEntity, InternalId, Uuid, Property } from '../../src/decorators'
import { ConstraintViolationError } from '../../src/errors'
import { Repository } from '../../src/repository'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class SyncEvent {
  @InternalId()
  _id!: string

  @Uuid({ primary: true })
  id!: string

  // composite unique: the array lists the FULL composite (NTS-140)
  @Property({ type: 'string', unique: ['eventId', 'email'] })
  eventId: string

  @Property({ type: 'string' })
  email!: string

  // composite index (NTS-140)
  @Property({ type: 'string', index: ['city', 'region'] })
  city!: string

  @Property({ type: 'string' })
  region!: string

  // property-type constraint (NTS-141)
  @Property({ type: 'string', typed: true })
  title!: string

  // read-side coalesce (NTS-139)
  @Property({ type: 'string', coalesce: 'public' })
  visibility!: string
}

void SyncEvent

const COMPOSITE_UNIQUE = 'syncevent_eventid_email_unique'
const COMPOSITE_INDEX = 'syncevent_city_region_index'
const TITLE_PROPERTY_TYPE = 'syncevent_title_property_type'

async function installedConstraints(
  backend: TestBackend,
): Promise<Map<string, { type: string; properties: string[] }>> {
  const result = await backend.connection.run('SHOW CONSTRAINTS', {}, 'READ')

  return new Map(
    result.records.map((record) => [
      record.get('name') as string,
      {
        type: (record.get('type') as string) || '',
        properties: (record.get('properties') as string[]) || [],
      },
    ]),
  )
}

async function installedIndexes(backend: TestBackend): Promise<string[]> {
  const result = await backend.connection.run('SHOW INDEXES', {}, 'READ')

  return result.records.map((record) => record.get('name') as string)
}

describe('composite + property-type schema sync (NTS-140/141)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.neode.dropSchema()
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('installs and drops composite unique/index and property-type objects under deterministic names', async () => {
    if (!backend.capabilities.constraints) {
      return
    }

    // The service flag governs Enterprise-only DDL (property types). The
    // capability probe knows per backend whether that DDL is supported —
    // Community servers reject it, the embedded engine accepts it.
    const enterprise = backend.capabilities.propertyTypes
    const results = await new SchemaService(backend.connection, enterprise).create()

    for (const result of results) {
      expect(result.success).toBe(true)
    }

    const constraints = await installedConstraints(backend)
    const composite = constraints.get(COMPOSITE_UNIQUE)

    expect(composite).toBeDefined()
    expect(composite!.properties).toEqual(['eventId', 'email'])
    if (enterprise) {
      expect(constraints.get(TITLE_PROPERTY_TYPE)).toBeDefined()
    }
    expect(await installedIndexes(backend)).toContain(COMPOSITE_INDEX)

    // ...and drop() reverses install()
    await new SchemaService(backend.connection, enterprise).drop()

    const afterDrop = await installedConstraints(backend)

    expect(afterDrop.has(COMPOSITE_UNIQUE)).toBe(false)
    expect(afterDrop.has(TITLE_PROPERTY_TYPE)).toBe(false)
    expect(await installedIndexes(backend)).not.toContain(COMPOSITE_INDEX)
  })

  it('enforces composite uniqueness across the pair, not per property', async () => {
    // Relate accepts composite DDL but does not enforce it — the probe
    // requires end-to-end enforcement, so this runs on real Neo4j only
    if (!backend.capabilities.compositeConstraints) {
      return
    }

    await new SchemaService(backend.connection).create()

    // The constraint is the engine's concern: drive it directly (the OGM
    // save path merges on primary key / single unique properties, which
    // a composite does not provide)
    await backend.connection.run(
      "CREATE (n:SyncEvent { id: '1', eventId: 'e-1', email: 'a@x.io' })",
      {},
      'WRITE',
    )

    await expect(
      backend.connection.run(
        "CREATE (n:SyncEvent { id: '2', eventId: 'e-1', email: 'a@x.io' })",
        {},
        'WRITE',
      ),
    ).rejects.toBeInstanceOf(ConstraintViolationError)

    // reusing a single property of the composite is fine
    await expect(
      backend.connection.run(
        "CREATE (n:SyncEvent { id: '3', eventId: 'e-2', email: 'a@x.io' })",
        {},
        'WRITE',
      ),
    ).resolves.toBeDefined()
  })

  it('installs a property-type constraint from the declared type', async () => {
    if (!backend.capabilities.propertyTypes) {
      return
    }

    const results = await new SchemaService(backend.connection, true).create()

    for (const result of results) {
      expect(result.success).toBe(true)
    }

    const typed = (await installedConstraints(backend)).get(TITLE_PROPERTY_TYPE)

    expect(typed).toBeDefined()
    expect(typed!.type).toBe('NODE_PROPERTY_TYPE')
  })

  it('reports no drift once installed, and drift after drop', async () => {
    if (!backend.capabilities.propertyTypes || !backend.capabilities.constraints) {
      return
    }

    await new SchemaService(backend.connection, true).create()

    const report = await inspectSchema(backend.connection, { enterprise: true })

    expect(report.constraints.missing).not.toContain(COMPOSITE_UNIQUE)
    expect(report.constraints.missing).not.toContain(TITLE_PROPERTY_TYPE)
    expect(report.indexes.missing).not.toContain(COMPOSITE_INDEX)

    await new SchemaService(backend.connection, true).drop()

    const after = await inspectSchema(backend.connection, { enterprise: true })

    expect(after.constraints.missing).toContain(COMPOSITE_UNIQUE)
    expect(after.constraints.missing).toContain(TITLE_PROPERTY_TYPE)
    expect(after.indexes.missing).toContain(COMPOSITE_INDEX)
  })
})

describe('hydration defaults end-to-end (NTS-139)', () => {
  let backend: TestBackend
  let events: Repository<SyncEvent>

  beforeAll(async () => {
    backend = await openBackend()
    events = backend.neode.getRepository(SyncEvent)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('applies the coalesce fallback when a stored property is absent', async () => {
    const event = new SyncEvent()
    event.eventId = 'e-1'
    event.email = 'a@x.io'

    const saved = await events.save(event)

    // the node has no visibility property in the graph — the read-side
    // coalesce fills it in, and absent optionals read as undefined
    const found = await events.find(saved.id)

    expect(found).toBeDefined()
    expect(found!.visibility).toBe('public')
    expect(found!.title).toBeUndefined()
    expect(found!.city).toBeUndefined()
  })
})
