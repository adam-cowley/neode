import { GraphModelEditor, GraphSpec } from '@neo4j/ontology-graph-spec'
import { getModel } from '../../../src/meta'
import { defineModel, getModelByName } from '../../../src/meta/map-schema'
import { ontologySpecToSchemas } from '../../../src/meta/ontology-spec'
import { RelationshipDefinition } from '../../../src/meta/schema-definition.interface'
import { MOVIES_LONGHAND, MOVIES_SHORTHAND } from '../../fixtures/ontology-spec-movies'

/** Decode a spec document with the SDK and bridge it to the plain-JS shape the mapper reads. */
function decode(document: object): ReturnType<typeof ontologySpecToSchemas> {
  const model = GraphSpec.Json.decodeFromString(JSON.stringify(document))

  return ontologySpecToSchemas(GraphModelEditor.plain(model))
}

describe('ontologySpecToSchemas (NTS-683)', () => {
  it('maps the spec example movies document (shorthand form) to model schemas', () => {
    const schemas = decode(MOVIES_SHORTHAND)

    // Nodes → models, keyed by the spec node id
    expect(Object.keys(schemas).sort()).toEqual(['Actor', 'Movie'])

    const actor = schemas['Actor']!
    expect(actor.labels).toEqual(['Actor'])
    expect(actor.description).toEqual('A person who performs in films.')

    // key: true → KEY constraint → unique + required
    expect(actor['id']).toEqual({ type: 'string', unique: true, required: true })
    // must_exist: true → EXISTS constraint → required
    expect(actor['name']).toEqual({
      type: 'string',
      required: true,
      description: 'Full name.',
    })
    expect(actor['born']).toEqual({ type: 'integer' })
    // LIST<STRING> → array
    expect(actor['tags']).toEqual({ type: 'string', array: true })

    const movie = schemas['Movie']!
    expect(movie.labels).toEqual(['Movie'])
    expect(movie['released']).toEqual({ type: 'datetime' })
    expect(movie['rating']).toEqual({ type: 'float', unique: true })
    // one_of is dropped (declare neode's `valid` rule by hand)
    expect(movie['genre']).toEqual({ type: 'string' })
  })

  it('maps the spec example movies document (longhand inline flags) identically', () => {
    const schemas = decode(MOVIES_LONGHAND)

    const actor = schemas['Actor']!
    expect(actor.labels).toEqual(['Actor'])
    expect(actor['id']).toEqual({ type: 'string', unique: true })
    expect(actor['name']).toEqual({ type: 'string' })

    const movie = schemas['Movie']!
    expect(movie['id']).toEqual({ type: 'string', unique: true })
  })

  it('derives relationship entries with direction from from/to, on both endpoint models', () => {
    const schemas = decode(MOVIES_SHORTHAND)

    expect(schemas['Actor']!['ACTED_IN']).toEqual({
      type: 'relationships',
      relationship: 'ACTED_IN',
      direction: 'out',
      target: 'Movie',
      description: 'An actor appeared in a film.',
      properties: { roles: { type: 'string' } },
    })

    // The inverse end, from the same spec relationship
    expect(schemas['Movie']!['ACTED_IN']).toEqual({
      type: 'relationships',
      relationship: 'ACTED_IN',
      direction: 'in',
      target: 'Actor',
      description: 'An actor appeared in a film.',
      properties: { roles: { type: 'string' } },
    })
  })

  it('derives cardinality from the endpoint counts', () => {
    const schemas = decode({
      schema: 'https://neo4j.com/docs/ontology-graph-spec/1.1.0/schema.json',
      version: '1',
      id: 'counts',
      nodes: {
        A: { label: 'A', properties: { id: { type: 'STRING' } } },
        B: { label: 'B', properties: { id: { type: 'STRING' } } },
        C: { label: 'C', properties: { id: { type: 'STRING' } } },
      },
      relationships: {
        // 0..1 from A's view → relationship + zeroOrOne; 1..1 from B's → one
        HAS: {
          type: 'HAS',
          from: { node: 'A', label: 'A', min_count: 0, max_count: 1 },
          to: { node: 'B', label: 'B', min_count: 1, max_count: 1 },
        },
        UNBOUNDED: {
          type: 'UNBOUNDED',
          from: { node: 'A', label: 'A' },
          to: { node: 'C', label: 'C' },
        },
      },
    })

    expect(schemas['A']!['HAS']).toMatchObject({
      type: 'relationship',
      cardinality: 'zeroOrOne',
      direction: 'out',
      target: 'B',
    })
    expect(schemas['B']!['HAS']).toMatchObject({
      type: 'relationship',
      cardinality: 'one',
      direction: 'in',
      target: 'A',
    })
    expect(schemas['A']!['UNBOUNDED']).toMatchObject({ type: 'relationships', direction: 'out' })
    expect((schemas['A']!['UNBOUNDED'] as RelationshipDefinition).cardinality).toBeUndefined()
  })

  it('maps range and fulltext indexes and drops the kinds neode cannot declare', () => {
    const schemas = decode({
      schema: 'https://neo4j.com/docs/ontology-graph-spec/1.1.0/schema.json',
      version: '1',
      id: 'indexes',
      nodes: {
        Book: {
          label: 'Book',
          properties: {
            isbn: { type: 'STRING' },
            title: { type: 'STRING' },
            subtitle: { type: 'STRING' },
            summary: { type: 'STRING' },
            cover: { type: 'POINT' },
          },
          extensions: {
            custom: {},
            indexes: {
              single: { type: 'RANGE', labels: ['Book'], properties: ['isbn'] },
              composite: { type: 'RANGE', labels: ['Book'], properties: ['title', 'subtitle'] },
              blurb: { type: 'FULLTEXT', labels: ['Book'], properties: ['summary'] },
              coverIdx: { type: 'POINT', labels: ['Book'], properties: ['cover'] },
              plain: { type: 'TEXT', labels: ['Book'], properties: ['title'] },
              lookup: { type: 'LOOKUP', labels: ['Book'], properties: ['isbn'] },
            },
          },
        },
      },
      relationships: {},
    })

    const book = schemas['Book']!
    expect(book['isbn']).toEqual({ type: 'string', index: true })
    // Composite range index: declared on the first covered property
    expect(book['title']).toEqual({ type: 'string', index: ['title', 'subtitle'] })
    expect(book['summary']).toEqual({ type: 'string', fulltext: true })
    // TEXT / POINT / VECTOR / LOOKUP have no map-API counterpart
    expect(book['cover']).toEqual({ type: 'point' })
  })

  it('falls back to the node id for the label and anchors relationship entries per endpoint', () => {
    const schemas = decode({
      schema: 'https://neo4j.com/docs/ontology-graph-spec/1.1.0/schema.json',
      version: '1',
      id: 'dangling',
      nodes: {
        // No labels block: the node id is the identity label
        Widget: { properties: { id: { type: 'STRING' } } },
        Gadget: { properties: { id: { type: 'STRING' } } },
      },
      relationships: {
        // Target names no node of the model: the entry stays (the spec's own
        // validator reports the dangling reference), anchored on Widget
        LINKS: {
          type: 'LINKS',
          from: { node: 'Widget', label: 'Widget' },
          to: { node: 'Ghost', label: 'Ghost' },
        },
        // Source names no node of the model: nowhere to anchor the entry
        ORPHANED: {
          type: 'ORPHANED',
          from: { node: 'Ghost', label: 'Ghost' },
          to: { node: 'Gadget', label: 'Gadget' },
        },
      },
    })

    expect(schemas['Widget']!.labels).toEqual(['Widget'])
    expect(schemas['Widget']!['LINKS']).toMatchObject({ relationship: 'LINKS', target: 'Ghost' })
    // The in-end anchors on Gadget (which exists); only the Ghost end is dropped
    expect(schemas['Gadget']!['ORPHANED']).toMatchObject({ direction: 'in', target: 'Ghost' })
    expect(schemas['Ghost']).toBeUndefined()
  })

  it('maps unknown spec types to any (plain-model input — the SDK rejects them at decode)', () => {
    // Handed a plain model directly: the mapper is pure, and a type the type
    // table does not know falls back to any
    const schemas = ontologySpecToSchemas({
      nodes: {
        T: { labels: { identifier: 'T' }, properties: { mystery: { type: 'CRYSTAL BALL' } } },
      },
    })

    expect(schemas['T']!['mystery']).toEqual({ type: 'any' })
  })

  it('maps every spec type the table declares, unknown types to any', () => {
    const schemas = decode({
      schema: 'https://neo4j.com/docs/ontology-graph-spec/1.1.0/schema.json',
      version: '1',
      id: 'types',
      nodes: {
        T: {
          label: 'T',
          properties: {
            s: { type: 'STRING' },
            b: { type: 'BOOLEAN' },
            i: { type: 'INTEGER16' },
            f: { type: 'FLOAT32' },
            d: { type: 'DATE' },
            dt: { type: 'ZONED DATETIME' },
            ldt: { type: 'LOCAL DATETIME' },
            lt: { type: 'LOCAL TIME' },
            zt: { type: 'ZONED TIME' },
            dur: { type: 'DURATION' },
            p: { type: 'POINT' },
            u: { type: 'UUID' },
            a: { type: 'ANY' },
            v: { type: 'VECTOR<FLOAT>' },
            vi: { type: 'VECTOR<INTEGER8>' },
            la: { type: 'LIST<BOOLEAN>' },
          },
        },
      },
      relationships: {},
    })

    expect(schemas['T']).toEqual({
      labels: ['T'],
      s: { type: 'string' },
      b: { type: 'boolean' },
      i: { type: 'integer' },
      f: { type: 'float' },
      d: { type: 'date' },
      dt: { type: 'datetime' },
      ldt: { type: 'localdatetime' },
      lt: { type: 'localtime' },
      zt: { type: 'time' },
      dur: { type: 'duration' },
      p: { type: 'point' },
      u: { type: 'uuid' },
      a: { type: 'any' },
      v: { type: 'float', array: true },
      vi: { type: 'integer', array: true },
      la: { type: 'boolean', array: true },
    })
  })

  it('registers the mapped schemas through defineModel()', () => {
    const schemas = decode(MOVIES_SHORTHAND)

    for (const [name, schema] of Object.entries(schemas)) {
      defineModel(name, schema)
    }

    const actor = getModelByName('Actor')
    expect(actor).toBeDefined()
    expect(getModel(actor!).getLabels()).toEqual(['Actor'])
    expect(getModel(actor!).hasProperty('name')).toBe(true)
    expect(getModel(actor!).hasRelationship('ACTED_IN')).toBe(true)
    expect(getModelByName('Movie')).toBeDefined()
  })
})
