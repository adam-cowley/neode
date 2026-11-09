// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { openBackend, TestBackend } from './support/backend'
import { defineModel } from '../../src'

/**
 * Database introspector round-trip (NTS-164): seed a small graph →
 * generateModels() → the map-schema definitions register through
 * defineModel() → installSchema() → no drift on the generated labels.
 *
 * The Nts164* prefixes seed-and-scope the fixtures: integration backends
 * are shared (other writers install their own schema), so generation is
 * scoped with the `labels` option and drift assertions only look at
 * entries on the generated labels.
 */

const LABELS = ['Nts164Person', 'Nts164Movie']

const onGeneratedLabels = (labelsOrTypes: string[]): boolean =>
  labelsOrTypes.some((label) => label.startsWith('Nts164'))

describe('generateModels round-trip', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    // Clean up after ourselves (unique prefixes; other writers share the DB)
    await backend.connection.run(
      `MATCH (n) WHERE n:\`Nts164Person\` OR n:\`Nts164Movie\` OR n:\`Nts164Mixed\` DETACH DELETE n`,
    )
    await backend.connection
      .run('DROP CONSTRAINT nts164person_id_unique IF EXISTS')
      .catch(() => undefined)

    await backend.close()
  })

  it('generates both definition styles from the seeded graph and round-trips schema-free', async () => {
    const createdAt = backend.capabilities.temporals ? ', createdAt: datetime()' : ''

    await backend.connection.run(
      'CREATE CONSTRAINT nts164person_id_unique IF NOT EXISTS ' +
        'FOR (n:`Nts164Person`) REQUIRE n.id IS UNIQUE',
    )
    await backend.connection.run(
      "CREATE (p1:`Nts164Person` {id: 'p1', name: 'Ada', age: 36, active: true" +
        createdAt +
        '}) ' +
        "CREATE (p2:`Nts164Person` {id: 'p2', age: 40}) " +
        "CREATE (m1:`Nts164Movie` {id: 'm1', title: 'Solaris'}) " +
        "CREATE (m2:`Nts164Movie` {id: 'm2', title: 'Stalker'}) " +
        'CREATE (p1)-[:NTS164_ACTED_IN]->(m1) ' +
        'CREATE (p1)-[:NTS164_ACTED_IN]->(m2) ' +
        'CREATE (p2)-[:NTS164_ACTED_IN]->(m1)',
    )

    const result = await backend.neode.generateModels({ labels: LABELS })

    // Person: types inferred from the sample, id the primary-key suggestion,
    // name optional (absent from one sampled node)
    const person = result.models.find((model) => model.label === 'Nts164Person')

    expect(person?.primaryKey).toBe('id')
    expect(person?.schema['id']).toEqual({ type: 'string', primary: true })
    expect(person?.schema['name']).toEqual({ type: 'string' })
    expect(person?.schema['age']).toEqual({ type: 'number' })
    expect(person?.schema['active']).toEqual({ type: 'boolean' })

    if (backend.capabilities.temporals) {
      expect(person?.schema['createdAt']).toEqual({ type: 'datetime' })
    }

    // 3 relationships over 2 source nodes → relatedMany
    expect(person?.schema['NTS164_ACTED_IN']).toEqual({
      type: 'relatedMany',
      relationship: 'NTS164_ACTED_IN',
      direction: 'out',
      target: 'Nts164Movie',
    })

    const movie = result.models.find((model) => model.label === 'Nts164Movie')

    expect(movie?.schema['title']).toEqual({ type: 'string' })

    // The decorated output teaches the documented shapes
    expect(result.typescript).toContain('@NodeEntity()')
    expect(result.typescript).toContain("@Property({ type: 'string', primary: true }) id?: string")
    expect(result.typescript).toContain(
      "@RelatedMany({ type: 'NTS164_ACTED_IN', direction: 'out', target: () => Nts164Movie }) NTS164_ACTED_IN?: Nts164Movie[]",
    )
    expect(result.mapSchema).toContain("defineModel('Nts164Person', {")

    // Register the generated definitions and install their schema
    for (const model of result.models) {
      defineModel(model.label, model.schema)
    }

    const installed = await backend.neode.installSchema()

    expect(installed.every((entry) => entry.success)).toBe(true)

    // The round-trip: generate → register → installSchema → no drift on
    // the generated labels (nothing re-declared under a second name)
    const drift = await backend.neode.schemaDiff()

    expect(
      drift.constraints.missing.filter((entry) => onGeneratedLabels(entry.labelsOrTypes)),
    ).toEqual([])
    expect(
      drift.constraints.stale.filter((entry) => onGeneratedLabels(entry.labelsOrTypes)),
    ).toEqual([])
    expect(
      drift.constraints.mismatched.filter((entry) => onGeneratedLabels(entry.labelsOrTypes)),
    ).toEqual([])
    expect(drift.indexes.missing.filter((entry) => onGeneratedLabels(entry.labelsOrTypes))).toEqual(
      [],
    )
    expect(drift.indexes.stale.filter((entry) => onGeneratedLabels(entry.labelsOrTypes))).toEqual(
      [],
    )
  })

  it('reports sampled type conflicts as warnings instead of aborting generation', async () => {
    await backend.connection.run(
      "CREATE (:Nts164Mixed {id: 'a', n: 'text'}) CREATE (:Nts164Mixed {id: 'b', n: 42})",
    )

    const result = await backend.neode.generateModels({ labels: ['Nts164Mixed'] })

    expect(result.models.map((model) => model.label)).toEqual(['Nts164Mixed'])
    expect(result.models[0]?.schema['n']).toBeUndefined()
    expect(result.models[0]?.schema['id']).toEqual({ type: 'string' })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(
      /Nts164Mixed[\s\S]*"n"[\s\S]*(number, string|string, number)/,
    )
  })

  it('samples a bounded number of nodes and walks relationships from the sample only', async () => {
    await backend.connection.run(
      `UNWIND range(1, 20) AS i
       CREATE (s:Nts577Source {id: toString(i)})-[:POINTS_AT]->(:Nts577Target {id: toString(i)})`,
    )

    try {
      const result = await backend.neode.generateModels({
        labels: ['Nts577Source', 'Nts577Target'],
        sampleSize: 5,
      })

      const source = result.models.find((model) => model.label === 'Nts577Source')

      expect(source?.properties['id']).toEqual({ type: 'string' })
      expect(source?.relationships).toEqual([
        expect.objectContaining({
          relationship: 'POINTS_AT',
          target: 'Nts577Target',
          targetClassName: 'Nts577Target',
          many: false,
        }),
      ])
      expect(result.warnings).toEqual([])
    } finally {
      await backend.connection.run(
        'MATCH (n) WHERE n:`Nts577Source` OR n:`Nts577Target` DETACH DELETE n',
      )
    }
  })
})
