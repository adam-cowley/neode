// NTS-582 — lifecycle events and afterSave observers fire only after the
// transaction commits: never for rolled-back or retried work.
import { NodeEntity, Primary, Property } from '../../src/decorators'
import { EventType } from '../../src/common/events'
import { clearObservers, observe } from '../../src/observers'
import { testId } from '../../src/testing/index.js'
import { openBackend, type TestBackend } from './support/backend'

@NodeEntity()
class EventedPerson {
  @Primary()
  @Property({ type: 'string' })
  name!: string
}

describe('transaction events fire after commit — integration (NTS-582)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    clearObservers()
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('facade create() inside transaction() emits and observes only after commit', async () => {
    const { neode } = backend
    const name = testId('events-commit')
    const log: string[] = []

    neode.on(EventType.NODE_CREATED, () => log.push('event'))
    observe(EventedPerson, { afterSave: () => void log.push('afterSave') })

    await neode.transaction(async () => {
      await neode.create(EventedPerson, { name })

      log.push('inside')
    })

    expect(log).toEqual(['inside', 'event', 'afterSave'])
  })

  it('emits nothing when the transaction rolls back', async () => {
    const { neode } = backend
    const name = testId('events-rollback')
    const events = vi.fn()
    const afterSave = vi.fn()

    neode.on(EventType.NODE_CREATED, events)
    observe(EventedPerson, { afterSave })

    await expect(
      neode.transaction(async () => {
        await neode.create(EventedPerson, { name })

        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(events).not.toHaveBeenCalled()
    expect(afterSave).not.toHaveBeenCalled()
  })

  it('a transaction handle flushes events on commit()', async () => {
    const { neode } = backend
    const name = testId('events-handle')
    const events = vi.fn()

    neode.on(EventType.NODE_CREATED, events)

    const tx = await neode.openWriteTransaction()

    const entity = new EventedPerson()

    entity.name = name

    await tx.save(entity)

    expect(events).not.toHaveBeenCalled()

    await tx.commit()

    expect(events).toHaveBeenCalledTimes(1)
  })
})
