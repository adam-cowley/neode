import { describe, expect, it, vi } from 'vitest'
import {
  EndNode,
  NodeEntity,
  Number,
  OneToMany,
  OneToOne,
  Property,
  RelationshipEntity,
  StartNode,
  String,
  Uuid,
} from '../../src/decorators'
import { defineModel } from '../../src/meta/map-schema'
import type { ConnectionProvider } from '../../src/driver/types'
import { Direction } from '../../src/query/direction'
import {
  GraphTypeService,
  deriveGraphType,
  deriveGraphTypeElementsOnly,
  graphTypeAddStatement,
  graphTypeAlterStatement,
  graphTypeConstraintName,
  graphTypeDropStatement,
  graphTypeSetStatement,
} from '../../src/services/schema/graph-type.service'

/**
 * Graph type derivation + statements (NTS-548).
 *
 * Syntax note: `ALTER CURRENT GRAPH TYPE SET` replaces the database's
 * existing graph type and constraints — there is no IF NOT EXISTS here.
 */

// ---- Fixtures (per-file: decorator registry is global per module registry) --
// Declaration order matters: OneToOne/StartNode resolve their target thunk
// when the class decorator replays the registrations

@NodeEntity()
class GtMovie {
  @String()
  title!: string
}

@RelationshipEntity()
class GtRating {
  @Property({ type: 'int' })
  stars!: number

  @StartNode(() => GtMovie)
  source!: GtMovie

  @EndNode(() => GtMovie)
  target!: GtMovie
}

@NodeEntity()
class GtPerson {
  @Uuid({ primary: true })
  id!: string

  @String({ required: true })
  name!: string

  @String({ array: true })
  aliases!: string[]

  // NUMBER has no single Cypher type (spans INTEGER + FLOAT) — skipped
  @Number()
  score!: number

  @OneToOne({ type: 'GT_RATED', target: () => GtRating, direction: Direction.OUTGOING })
  rated!: GtRating

  @OneToOne({ type: 'GT_KNOWS', target: () => GtMovie, direction: Direction.INCOMING })
  knownBy!: GtMovie

  @OneToMany(() => GtMovie, 'GT_SEES', Direction.BOTH)
  sees!: GtMovie[]
}

@NodeEntity({ labels: ['GtEmployee', 'GtResident'] })
class GtEmployee {
  @String({ required: true })
  email!: string
}

// No properties, no implied labels: not a valid element type on its own
@NodeEntity()
class GtBare {}

// Same identifying label as GtMovie: first model wins
defineModel('GtMovieClone', {
  labels: ['GtMovie'],
  name: { type: 'string' },
})

// ---- Statement builders (pure) ---------------------------------------------

describe('graphTypeSetStatement', () => {
  it('renders element types with implied labels and property flags', () => {
    expect(
      graphTypeSetStatement({
        nodes: [
          {
            label: 'Person',
            implies: ['Resident'],
            properties: [
              { name: 'id', type: 'STRING', nullable: false },
              { name: 'name', type: 'STRING' },
              { name: 'health', type: 'STRING', unique: true },
              { name: 'tags', type: 'LIST<STRING NOT NULL>' },
            ],
          },
          { label: 'City', properties: [{ name: 'name', type: 'STRING', nullable: false }] },
        ],
        relationships: [
          {
            type: 'LIVES_IN',
            source: 'Resident',
            target: 'City',
            properties: [{ name: 'since', type: 'DATE', nullable: false }],
          },
        ],
      }),
    ).toBe(
      'ALTER CURRENT GRAPH TYPE SET {' +
        '(:`Person` => :`Resident` {' +
        '`id` :: STRING NOT NULL, `name` :: STRING, `health` :: STRING IS UNIQUE, ' +
        '`tags` :: LIST<STRING NOT NULL>' +
        '}), ' +
        '(:`City` => {`name` :: STRING NOT NULL}), ' +
        '(:`Resident`)-[:`LIVES_IN` => {`since` :: DATE NOT NULL}]->(:`City`)}',
    )
  })

  it('renders an empty graph type set as a TypeError', () => {
    expect(() => graphTypeSetStatement({ nodes: [] })).toThrow(TypeError)
  })
})

describe('graphTypeDropStatement', () => {
  it('drops element types by identifying label/relationship type', () => {
    expect(
      graphTypeDropStatement({
        nodes: [{ label: 'Person' }, { label: 'City' }],
        relationships: [{ type: 'LIVES_IN' }],
      }),
    ).toBe('ALTER CURRENT GRAPH TYPE DROP {(:`Person` =>), (:`City` =>), ()-[:`LIVES_IN` =>]->()}')
  })
})

// ---- Derivation from the registered models ----------------------------------

describe('deriveGraphType', () => {
  const graphType = deriveGraphType()

  it('derives node element types from node models only', () => {
    const labels = graphType.nodes.map((node) => node.label)

    expect(labels).toContain('GtPerson')
    expect(labels).toContain('GtMovie')
    expect(labels).toContain('GtEmployee')
    // no implied labels + no mappable properties: not a valid element type
    expect(labels).not.toContain('GtBare')
    // relationship entities contribute properties, not element types
    expect(labels).not.toContain('GtRating')
  })

  it('first label identifies, the rest are implied', () => {
    const employee = graphType.nodes.find((node) => node.label === 'GtEmployee')

    expect(employee?.implies).toEqual(['GtResident'])
    expect(employee?.properties).toEqual([{ name: 'email', type: 'STRING', nullable: false }])
  })

  it('maps property types, skipping those without a Cypher equivalent', () => {
    const person = graphType.nodes.find((node) => node.label === 'GtPerson')

    expect(person?.properties).toEqual([
      { name: 'name', type: 'STRING', nullable: false },
      { name: 'aliases', type: 'LIST<STRING NOT NULL>' },
    ])

    // NTS-549 — the @Uuid({ primary: true }) uniqueness is hoisted into a
    // named constraint item instead of an inline IS UNIQUE
    expect(graphType.constraints).toContainEqual({
      labelOrType: 'GtPerson',
      relationship: false,
      properties: ['id'],
      kind: 'UNIQUE',
    })
  })

  it('derives relationship element types with resolved ends and entity properties', () => {
    const types = graphType.relationships?.map((relationship) => relationship.type) ?? []

    expect(types).toContain('GT_RATED')
    expect(types).toContain('GT_KNOWS')
    expect(types).toContain('GT_SEES')

    // OUTGOING against a relationship entity: far end from @EndNode,
    // properties from the entity's own mappable properties
    expect(graphType.relationships?.find((r) => r.type === 'GT_RATED')).toEqual({
      type: 'GT_RATED',
      source: 'GtPerson',
      target: 'GtMovie',
      properties: [{ name: 'stars', type: 'INTEGER' }],
    })

    // INCOMING: the element type points from the far end to this model
    expect(graphType.relationships?.find((r) => r.type === 'GT_KNOWS')).toEqual({
      type: 'GT_KNOWS',
      source: 'GtMovie',
      target: 'GtPerson',
    })

    // BOTH: ends stay unpinned — pinning one would forbid the other direction
    expect(graphType.relationships?.find((r) => r.type === 'GT_SEES')).toEqual({
      type: 'GT_SEES',
    })
  })

  it('first model wins on a duplicate identifying label', () => {
    const movie = graphType.nodes.find((node) => node.label === 'GtMovie')

    // GtMovieClone's `name` property must not leak into GtMovie
    expect(movie?.properties).toEqual([{ name: 'title', type: 'STRING' }])
  })

  it('renders a complete statement from the derived definition', () => {
    const statement = graphTypeSetStatement(graphType)

    expect(statement.startsWith('ALTER CURRENT GRAPH TYPE SET {')).toBe(true)
    expect(statement).toContain('(:`GtEmployee` => :`GtResident` {`email` :: STRING NOT NULL})')
    expect(statement).toContain('()-[:`GT_SEES` =>]->()')

    // NTS-549 — hoisted uniqueness renders as a named CONSTRAINT item with
    // the deterministic <label>_<prop>_unique name
    expect(statement).toContain(
      'CONSTRAINT `gtperson_id_unique` FOR (n:`GtPerson`) REQUIRE (n.`id`) IS UNIQUE',
    )
  })

  it('drops named constraint items alongside the element types (NTS-549)', () => {
    // Dropping an element type removes its dependent constraints but
    // LEAVES its uniqueness/key ones — those only go by name
    const statement = graphTypeDropStatement(graphType)

    expect(statement).toContain('CONSTRAINT `gtperson_id_unique`')
    expect(statement).toContain('(:`GtPerson` =>)')
  })
})

// ---- Named constraints + non-identifying labels (NTS-549) --------------------

describe('graph type constraint items (NTS-549)', () => {
  it('renders user-declared constraints on non-identifying labels', () => {
    const statement = graphTypeSetStatement({
      nodes: [
        { label: 'Pet', implies: ['Animal'], properties: [{ name: 'name', type: 'STRING' }] },
      ],
      constraints: [
        // Animal is only an implied label here — derivation cannot constrain it
        { name: 'animal_id', labelOrType: 'Animal', properties: ['id'], kind: 'UNIQUE' },
        { name: 'pet_name_key', labelOrType: 'Pet', properties: ['name'], kind: 'KEY' },
      ],
    })

    expect(statement).toContain(
      'CONSTRAINT `animal_id` FOR (n:`Animal`) REQUIRE (n.`id`) IS UNIQUE',
    )
    expect(statement).toContain('CONSTRAINT `pet_name_key` FOR (n:`Pet`) REQUIRE (n.`name`) IS KEY')
  })

  it('renders constraints on relationship types and existence/type kinds', () => {
    const statement = graphTypeSetStatement({
      nodes: [{ label: 'City', properties: [{ name: 'name', type: 'STRING' }] }],
      relationships: [{ type: 'STAYED_IN', properties: [{ name: 'endDate', type: 'DATE' }] }],
      constraints: [
        {
          labelOrType: 'STAYED_IN',
          relationship: true,
          properties: ['startDate'],
          kind: 'EXISTS',
        },
        {
          name: 'stayed_type',
          labelOrType: 'STAYED_IN',
          relationship: true,
          properties: ['endDate'],
          kind: 'TYPE',
          type: 'DATE',
        },
      ],
    })

    expect(statement).toContain(
      'CONSTRAINT `stayed_in_startdate_exists` FOR ()-[r:`STAYED_IN`]->() REQUIRE (r.`startDate`) IS NOT NULL',
    )
    expect(statement).toContain(
      'CONSTRAINT `stayed_type` FOR ()-[r:`STAYED_IN`]->() REQUIRE (r.`endDate`) IS :: DATE',
    )
  })

  it('generates a deterministic name when none is given', () => {
    expect(
      graphTypeConstraintName({ labelOrType: 'Person', properties: ['ssn'], kind: 'KEY' }),
    ).toBe('person_ssn_key')
  })

  it('rejects existence/type constraints over more than one property', () => {
    expect(() =>
      graphTypeSetStatement({
        nodes: [{ label: 'City' }],
        constraints: [{ labelOrType: 'City', properties: ['a', 'b'], kind: 'EXISTS' }],
      }),
    ).toThrow(TypeError)
  })
})

// ---- Composite REQUIRE constraints (NTS-552) ---------------------------------

describe('composite REQUIRE constraints (NTS-552)', () => {
  it('derives composite uniques as named REQUIRE ... IS UNIQUE items', () => {
    @NodeEntity()
    class Nts552Unique {
      @Property({ type: 'string' })
      name!: string

      // array form: composite unique over exactly these properties
      @Property({ type: 'string', unique: ['name', 'email'] })
      email!: string
    }

    const derived = deriveGraphType()
    const node = derived.nodes.find((n) => n.label === 'Nts552Unique')

    // The property map carries both properties without inline flags
    expect(node?.properties?.map((p) => p.name)).toEqual(['name', 'email'])

    expect(derived.constraints).toContainEqual({
      labelOrType: 'Nts552Unique',
      relationship: false,
      properties: ['name', 'email'],
      kind: 'UNIQUE',
    })

    expect(graphTypeSetStatement(derived)).toContain(
      'CONSTRAINT `nts552unique_name_email_unique` FOR (n:`Nts552Unique`) REQUIRE (n.`name`, n.`email`) IS UNIQUE',
    )
  })

  it('maps composite indexes to REQUIRE ... IS KEY (a graph type enforces, not indexes)', () => {
    @NodeEntity()
    class Nts552Key {
      @Property({ type: 'number', index: ['code', 'region'] })
      code!: number
    }

    expect(deriveGraphType().constraints).toContainEqual({
      labelOrType: 'Nts552Key',
      relationship: false,
      properties: ['code', 'region'],
      kind: 'KEY',
    })
  })

  it('deduplicates groups declared on more than one of their properties', () => {
    @NodeEntity()
    class Nts552Shared {
      @Property({ type: 'string', unique: ['a', 'b'] })
      a!: string

      @Property({ type: 'string', unique: ['a', 'b'] })
      b!: string
    }

    expect(
      deriveGraphType().constraints?.filter((c) => c.labelOrType === 'Nts552Shared'),
    ).toHaveLength(1)
  })

  it('derives composite REQUIRE items from relationship entities', () => {
    @RelationshipEntity()
    class Nts552Rated {
      @Property({ type: 'int', unique: ['stars', 'day'] })
      stars!: number

      @StartNode(() => GtMovie)
      source!: GtMovie

      @EndNode(() => GtMovie)
      target!: GtMovie
    }

    // The entity's properties join the element type of a declaration that
    // targets it — standalone relationship entities derive nothing
    @NodeEntity()
    class Nts552Rater {
      @OneToOne({ type: 'NTS552_RATED', target: () => Nts552Rated, direction: Direction.OUTGOING })
      rated!: Nts552Rated
    }

    expect(deriveGraphType().constraints).toContainEqual({
      labelOrType: 'NTS552_RATED',
      relationship: true,
      properties: ['stars', 'day'],
      kind: 'UNIQUE',
    })
  })
})

// ---- ADD / ALTER verbs (NTS-551) ---------------------------------------------

describe('graphTypeAddStatement / graphTypeAlterStatement (NTS-551)', () => {
  it('renders ADD with element types and constraint items', () => {
    expect(
      graphTypeAddStatement({
        nodes: [{ label: 'Company', properties: [{ name: 'name', type: 'STRING' }] }],
        relationships: [
          {
            type: 'WORKS_FOR',
            source: 'Person',
            target: 'Company',
            properties: [{ name: 'role', type: 'STRING' }],
          },
        ],
        constraints: [
          { name: 'company_key', labelOrType: 'Company', properties: ['name'], kind: 'KEY' },
        ],
      }),
    ).toBe(
      'ALTER CURRENT GRAPH TYPE ADD {' +
        '(:`Company` => {`name` :: STRING}), ' +
        '(:`Person`)-[:`WORKS_FOR` => {`role` :: STRING}]->(:`Company`), ' +
        'CONSTRAINT `company_key` FOR (n:`Company`) REQUIRE (n.`name`) IS KEY}',
    )
  })

  it('renders ALTER with element types only', () => {
    expect(
      graphTypeAlterStatement({
        nodes: [
          {
            label: 'Robot',
            implies: ['Machine'],
            properties: [{ name: 'id', type: 'INTEGER', nullable: false }],
          },
        ],
        relationships: [
          {
            type: 'LIVES_IN',
            source: 'Resident',
            target: 'City',
            properties: [{ name: 'since', type: 'ANY', nullable: false }],
          },
        ],
      }),
    ).toBe(
      'ALTER CURRENT GRAPH TYPE ALTER {' +
        '(:`Robot` => :`Machine` {`id` :: INTEGER NOT NULL}), ' +
        '(:`Resident`)-[:`LIVES_IN` => {`since` :: ANY NOT NULL}]->(:`City`)}',
    )
  })

  it('ALTER rejects constraint items and uniqueness flags', () => {
    expect(() =>
      graphTypeAlterStatement({
        nodes: [{ label: 'City' }],
        constraints: [{ labelOrType: 'City', properties: ['name'], kind: 'KEY' }],
      }),
    ).toThrow(/cannot include constraint items/i)

    expect(() =>
      graphTypeAlterStatement({
        nodes: [{ label: 'City', properties: [{ name: 'name', type: 'STRING', unique: true }] }],
      }),
    ).toThrow(/cannot include key\/uniqueness/i)
  })

  it('ALTER of the derived definition strips the hoisted constraints (they remain unchanged)', () => {
    const statement = graphTypeAlterStatement(deriveGraphTypeElementsOnly())

    expect(statement.startsWith('ALTER CURRENT GRAPH TYPE ALTER {')).toBe(true)
    expect(statement).not.toContain('CONSTRAINT')
    expect(statement).not.toContain('IS UNIQUE')
  })

  it('ADD/ALTER of an empty definition throws', () => {
    expect(() => graphTypeAddStatement({ nodes: [] })).toThrow(TypeError)
    expect(() => graphTypeAlterStatement({ nodes: [] })).toThrow(TypeError)
  })
})

// ---- Service (enterprise gating + result reporting) -------------------------

describe('GraphTypeService', () => {
  const stubConnection = (): ConnectionProvider =>
    ({
      run: vi.fn(async () => ({ records: [] })),
    }) as unknown as ConnectionProvider

  it('reports a failed result without running on Community Edition', async () => {
    const connection = stubConnection()
    const results = await new GraphTypeService(connection, false).create()

    expect(results).toHaveLength(1)
    expect(results[0]?.success).toBe(false)
    expect(results[0]?.error?.message).toContain('Enterprise')
    expect(connection.run).not.toHaveBeenCalled()
  })

  it('runs one SET statement on Enterprise Edition', async () => {
    const connection = stubConnection()
    const results = await new GraphTypeService(connection, true).create()

    expect(connection.run).toHaveBeenCalledTimes(1)
    expect(results[0]?.success).toBe(true)
    expect(results[0]?.type).toBe('GRAPH_TYPE')
    expect(results[0]?.statement.startsWith('ALTER CURRENT GRAPH TYPE SET {')).toBe(true)
  })

  it('runs one DROP statement', async () => {
    const connection = stubConnection()
    const results = await new GraphTypeService(connection, true).drop()

    expect(results[0]?.success).toBe(true)
    expect(results[0]?.statement.startsWith('ALTER CURRENT GRAPH TYPE DROP {')).toBe(true)
  })
})
