// The backend import loads neode.service first, resolving the module cycles
// before anything below is evaluated
import { openBackend, TestBackend } from './support/backend'
import { EventType, QueryExecutedEvent } from '../../src/common/events'
import { InternalId, NodeEntity, String, Uuid } from '../../src/decorators'

@NodeEntity()
class EventPerson {
  @InternalId()
  _id: string

  @Uuid({ primary: true })
  id: string

  @String()
  name: string

  static create(name: string): EventPerson {
    const person = new EventPerson()
    person.name = name

    return person
  }
}

describe('query:executed lifecycle event', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('emits for raw queries with cypher, params, duration and database', async () => {
    const events: QueryExecutedEvent[] = []
    backend.neode.on(EventType.QUERY_EXECUTED, (event) => events.push(event as QueryExecutedEvent))

    await backend.neode.cypher('RETURN $x AS x', { x: 1 }, { database: 'neo4j' })

    expect(events).toHaveLength(1)
    expect(events[0].cypher).toBe('RETURN $x AS x')
    expect(events[0].params).toEqual({ x: 1 })
    // The default database name — the only one that exists everywhere
    // (Community containers ship just `neo4j`; Relate ignores the name)
    expect(events[0].database).toBe('neo4j')
    expect(typeof events[0].duration).toBe('number')
    expect(events[0].duration).toBeGreaterThanOrEqual(0)
  })

  it('emits for every statement of a service-driven flow (save)', async () => {
    const events: QueryExecutedEvent[] = []
    backend.neode.on(EventType.QUERY_EXECUTED, (event) => events.push(event as QueryExecutedEvent))

    await backend.neode.save(EventPerson.create('Adam'))

    // save() runs at least a MERGE and a re-find, every one inside the
    // open transaction must be reported by the shared chokepoint
    expect(events.length).toBeGreaterThanOrEqual(2)
    events.forEach((event) => {
      expect(typeof event.cypher).toBe('string')
      expect(event.cypher.length).toBeGreaterThan(0)
      expect(typeof event.duration).toBe('number')
    })
  })

  it('off() unsubscribes', async () => {
    let called = false
    const handler = (): void => {
      called = true
    }

    backend.neode.on(EventType.QUERY_EXECUTED, handler)
    backend.neode.off(EventType.QUERY_EXECUTED, handler)

    await backend.neode.cypher('RETURN 1 AS one')

    expect(called).toBe(false)
  })
})
