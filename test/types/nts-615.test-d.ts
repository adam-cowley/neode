/**
Type-level tests for NTS-615 — the `options` third argument on create() /
update() (eager relationship creation) resolves, and the legacy
`database` string third argument keeps compiling on both:

- `create(C, properties, { relate: { team: savedTeam } })`
- `create(C, properties, 'database')` (legacy, unchanged)
- `update(entity, properties, { relate: { team: savedTeam } })`
- `update(entity, properties, 'database')` (legacy, unchanged)

Run with `pnpm test:types`.
*/
import { describe, expectTypeOf, it } from 'vitest'
import { NodeEntity, OneToMany, Property, Uuid } from '../../src/decorators/index.js'
import { Direction } from '../../src/query/index.js'
import type { Neode } from '../../src/neode.service.js'

@NodeEntity()
class N615Team {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string
}

@NodeEntity()
class N615Person {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => N615Team, 'PART_OF', Direction.OUTGOING)
  team!: N615Team
}

describe('NTS-615: create()/update() eager-relate option types', () => {
  // The stubs are synchronous no-ops — the calls below are never awaited,
  // only their static types are asserted
  const neode = {
    create: () => undefined,
    update: () => undefined,
  } as unknown as Neode

  it('the options object and the legacy database string both compile', () => {
    const team = new N615Team()

    expectTypeOf(neode.create(N615Person, { name: 'Adam' })).toEqualTypeOf<Promise<N615Person>>()
    expectTypeOf(neode.create(N615Person, { name: 'Adam' }, { relate: { team } })).toEqualTypeOf<
      Promise<N615Person>
    >()
    expectTypeOf(neode.create(N615Person, { name: 'Adam' }, 'database')).toEqualTypeOf<
      Promise<N615Person>
    >()
    expectTypeOf(
      neode.update(new N615Person(), { name: 'Adam' }, { relate: { team } }),
    ).toEqualTypeOf<Promise<N615Person | undefined>>()
    expectTypeOf(neode.update(new N615Person(), { name: 'Adam' }, 'database')).toEqualTypeOf<
      Promise<N615Person | undefined>
    >()
  })
})
