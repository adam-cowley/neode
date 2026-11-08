import {
  NodeEntity,
  Property,
  Primary,
  RelationshipEntity,
  OneToMany,
  Direction,
} from '../../src/index'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Country {
  @Primary()
  @Property({ type: 'string' })
  code!: string
}

@NodeEntity()
class Brewery {
  @Primary()
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => Country, 'IN', Direction.OUTGOING)
  inCountry?: unknown
}

@NodeEntity()
class Beer {
  @Primary()
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => Brewery, 'BREWED_BY', Direction.OUTGOING)
  brewedBy?: unknown
}

@NodeEntity()
class Drinker {
  @Primary()
  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => Beer, 'DRINKS', Direction.OUTGOING)
  drinks?: unknown
}

@RelationshipEntity()
class Round {
  @Property({ type: 'number' })
  pints: number
}

// ---------------------------------------------------------------------------

describe('traverse (NTS-512)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()

    const neode = backend.neode

    await neode.mergeMany(Country, [{ code: 'BE' }])
    await neode.mergeMany(Brewery, [{ name: 'Duvel' }])
    await neode.mergeMany(Beer, [{ name: 'Duvel 6.66' }, { name: 'Duvel Tripel' }])
    await neode.mergeMany(Drinker, [{ name: 'Adam' }])

    // Graph: (Drinker)-[:DRINKS]->(Beer)-[:BREWED_BY]->(Brewery)-[:IN]->(Country)
    const tx = await neode.openWriteTransaction()

    const adam = await tx.find(Drinker, 'Adam')
    const beer1 = await tx.find(Beer, 'Duvel 6.66')
    const beer2 = await tx.find(Beer, 'Duvel Tripel')
    const brewery = await tx.find(Brewery, 'Duvel')
    const belgium = await tx.find(Country, 'BE')

    await tx.relate(Drinker, adam, beer1, 'drinks')
    await tx.relate(Drinker, adam, beer2, 'drinks')
    await tx.relate(Beer, beer1, brewery, 'brewedBy')
    await tx.relate(Beer, beer2, brewery, 'brewedBy')
    await tx.relate(Brewery, brewery, belgium, 'inCountry')

    await tx.commit()
  }, 60000)

  afterAll(async () => {
    await backend.close()
  })

  it('traverses two hops and hydrates every position', async () => {
    const rows = await backend.neode
      .traverse(Drinker)
      .hop('DRINKS', Direction.OUTGOING, Beer)
      .hop('BREWED_BY', Direction.OUTGOING, Brewery)
      .run()

    expect(rows).toHaveLength(2)
    expect(rows[0]?.nodes).toHaveLength(3)

    const [, beer, brewery] = rows[0]?.nodes ?? []

    expect((beer as Beer).name).toContain('Duvel')
    expect((brewery as Brewery).name).toBe('Duvel')
  })

  it('variable degrees fan out rows', async () => {
    // Drinker -> Beer -> Brewery would be 2 fixed hops; a 1..2 variable
    // DRINKS/BREWED_BY chain fans out
    const rows = await backend.neode
      .traverse(Drinker)
      .hop('DRINKS', Direction.OUTGOING, Beer)
      .hop('BREWED_BY', Direction.OUTGOING, Brewery)
      .run()

    expect(rows.length).toBe(2)
  })

  it('filters the start node', async () => {
    const rows = await backend.neode
      .traverse(Drinker)
      .where({ name: 'Adam' })
      .hop('DRINKS', Direction.OUTGOING, Beer)
      .run()

    expect(rows).toHaveLength(2)
  })

  it('the customer-supplier question: 4 hops end to end', async () => {
    // (Drinker)-[:DRINKS]->(Beer)-[:BREWED_BY]->(Brewery)-[:IN]->(Country)
    const rows = await backend.neode
      .traverse(Drinker)
      .where({ name: 'Adam' })
      .hop('DRINKS', Direction.OUTGOING, Beer)
      .hop('BREWED_BY', Direction.OUTGOING, Brewery)
      .hop('IN', Direction.OUTGOING, Country)
      .run()

    expect(rows).toHaveLength(2)

    const country = rows[0]?.nodes[3] as Country

    expect(country.code).toBe('BE')
  })

  it('an unregistered start model throws', () => {
    class Ghost {}

    expect(() => backend.neode.traverse(Ghost as never)).toThrow()
  })

  it('aggregate mode: co-drinker beers, origin beers excluded, ranked + capped (NTS-547)', async () => {
    // Bob shares Duvel 6.66 with Adam and also drinks Duvel Velvet (Adam
    // does not). Co-drinker beers from Adam's perspective: everything
    // reachable Drinker->Beer<-Drinker->Beer MINUS beers Adam already
    // drinks — so Velvet survives with times = 1, everything else excluded.
    // (Seed before the transaction: autocommits queue behind an open tx.)
    await backend.neode.mergeMany(Drinker, [{ name: 'Bob' }])
    await backend.neode.mergeMany(Beer, [{ name: 'Duvel Velvet' }])

    const tx = await backend.neode.openWriteTransaction()

    const bob = await tx.find(Drinker, 'Bob')
    const duvel666 = await tx.find(Beer, 'Duvel 6.66')
    const velvet = await tx.find(Beer, 'Duvel Velvet')

    expect(bob).toBeDefined()
    expect(duvel666).toBeDefined()
    expect(velvet).toBeDefined()

    await tx.relate(Drinker, bob, duvel666, 'drinks')
    await tx.relate(Drinker, bob, velvet, 'drinks')
    await tx.commit()

    const rows = await backend.neode
      .traverse(Drinker)
      .where({ name: 'Adam' })
      .hop('DRINKS', Direction.OUTGOING, Beer) //  t1: beers Adam drinks
      .hop('DRINKS', Direction.INCOMING, Drinker) // t2: drinkers of those beers
      .hop('DRINKS', Direction.OUTGOING, Beer) //  t3: beers they drink
      .exclude('t0', 'DRINKS', 't3') // ...that Adam does not already drink
      .groupBy('t3')
      .countDistinct('t2', 'times')
      .orderBy('times', 'DESC')
      .limit(5)
      .runAggregates()

    expect(rows).toHaveLength(1)

    const row = rows[0] as Record<string, unknown>

    expect((row['t3'] as Beer).name).toBe('Duvel Velvet')
    expect(row['times']).toBe(1)
  })

  it('aggregate mode without a count declaration rejects', async () => {
    await expect(
      backend.neode.traverse(Drinker).hop('DRINKS', Direction.OUTGOING, Beer).runAggregates(),
    ).rejects.toThrow('countDistinct')
  })
})
