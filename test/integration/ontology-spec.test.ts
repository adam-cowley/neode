// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { GraphModelEditor, GraphSpec } from '@neo4j/ontology-graph-spec'
import { openBackend, TestBackend } from './support/backend'
import { defineModel } from '../../src/meta/map-schema'
import { ontologySpecToSchemas } from '../../src/meta/ontology-spec'
import { MOVIES_SHORTHAND } from '../fixtures/ontology-spec-movies'

/**
Ontology Graph Spec round-trip (NTS-683): the spec's example movies
document → the mapper's map schemas → defineModel() → installSchema() →
no drift on the mapped labels on a clean database.
*/

const LABELS = ['Actor', 'Movie']

const onMappedLabels = (labelsOrTypes: string[]): boolean =>
  labelsOrTypes.some((label) => LABELS.includes(label))

describe('ontology spec round-trip (NTS-683)', () => {
  let backend: TestBackend

  beforeAll(async () => {
    backend = await openBackend()
  })

  afterAll(async () => {
    // Clean up after ourselves: drop what installSchema created, delete any
    // data written against the mapped models
    await backend.neode.dropSchema().catch(() => undefined)
    await backend.connection
      .run('MATCH (n) WHERE n:Actor OR n:Movie DETACH DELETE n')
      .catch(() => undefined)

    await backend.close()
  })

  it('registers the mapped schemas, installs them and reports no drift', async () => {
    const model = GraphSpec.Json.decodeFromString(JSON.stringify(MOVIES_SHORTHAND))
    const schemas = ontologySpecToSchemas(GraphModelEditor.plain(model))

    expect(Object.keys(schemas).sort()).toEqual(['Actor', 'Movie'])

    for (const [name, schema] of Object.entries(schemas)) {
      defineModel(name, schema)
    }

    const installed = await backend.neode.installSchema()

    expect(installed.every((entry) => entry.success)).toBe(true)

    // id properties carry unique: true (the spec's KEY constraints) — the
    // uniqueness constraints must be installed and drift-free
    const drift = await backend.neode.schemaDiff()

    expect(
      drift.constraints.missing.filter((entry) => onMappedLabels(entry.labelsOrTypes)),
    ).toEqual([])
    expect(drift.constraints.stale.filter((entry) => onMappedLabels(entry.labelsOrTypes))).toEqual(
      [],
    )
    expect(
      drift.constraints.mismatched.filter((entry) => onMappedLabels(entry.labelsOrTypes)),
    ).toEqual([])
    expect(drift.indexes.missing.filter((entry) => onMappedLabels(entry.labelsOrTypes))).toEqual([])
    expect(drift.indexes.stale.filter((entry) => onMappedLabels(entry.labelsOrTypes))).toEqual([])
  })
})
