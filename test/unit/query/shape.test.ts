// support/backend first: it initialises neode.service, breaking the
// utils <-> neode.service circular init that would otherwise surface
// when this file's service imports are evaluated first.
import { defineModel } from '../../../src/meta/map-schema'
import type { GraphNode, GraphRelationship, QueryRecord } from '../../../src/driver/types'
import {
  shapeEdgeRows,
  shapeNodeRows,
  shapeProjectionRows,
  shapeScoredRows,
} from '../../../src/services/query/shape'
import { getModel } from '../../../src/meta'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

const ShapePerson = defineModel('ShapePerson', {
  id: { type: 'uuid', primary: true },
  name: { type: 'string' },
})

function row(values: Record<string, unknown>): QueryRecord {
  return {
    get: (key: string) => values[key],
    has: (key: string) => key in values,
    keys: Object.keys(values),
  }
}

function node(properties: Record<string, unknown> = {}): GraphNode {
  return { elementId: '4:0:1', labels: ['ShapePerson'], properties }
}

function edge(properties: Record<string, unknown> = {}): GraphRelationship {
  return {
    elementId: '5:0:1',
    type: 'HAS_PET',
    startElementId: '4:0:1',
    endElementId: '4:0:2',
    properties,
  }
}

// ---------------------------------------------------------------------------

describe('shapeNodeRows', () => {
  it('hydrates the alias column into entities', () => {
    const rows = shapeNodeRows(
      [row({ this: node({ name: 'Adam' }) })],
      getModel(ShapePerson),
      ShapePerson,
      'this',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toBeInstanceOf(ShapePerson)
  })

  it('throws a TypeError on a non-node column', () => {
    expect(() =>
      shapeNodeRows([row({ this: 'not-a-node' })], getModel(ShapePerson), ShapePerson, 'this'),
    ).toThrow(TypeError)
  })
})

describe('shapeProjectionRows', () => {
  it('throws a TypeError on a non-map column', () => {
    expect(() =>
      shapeProjectionRows([row({ this: 42 })], getModel(ShapePerson), ShapePerson, 'this'),
    ).toThrow(TypeError)
  })
})

describe('shapeEdgeRows', () => {
  it('pairs the hydrated node with the traversed edge', () => {
    const rows = shapeEdgeRows(
      [row({ node: node({ name: 'Adam' }), edge: edge({ role: 'Neo' }) })],
      getModel(ShapePerson),
      ShapePerson,
      'node',
      'edge',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].node).toBeInstanceOf(ShapePerson)
    expect(rows[0].edge).toEqual(edge({ role: 'Neo' }))
  })

  it('throws a TypeError on a non-relationship edge column', () => {
    expect(() =>
      shapeEdgeRows(
        [row({ node: node(), edge: 'not-an-edge' })],
        getModel(ShapePerson),
        ShapePerson,
        'node',
        'edge',
      ),
    ).toThrow(TypeError)
  })
})

describe('shapeScoredRows', () => {
  it('zips each hydrated entity with its row score, in order', () => {
    const scored = shapeScoredRows(
      [
        row({ node: node({ name: 'A' }), score: 2.5 }),
        row({ node: node({ name: 'B' }), score: 1 }),
      ],
      ShapePerson,
      'node',
    )

    expect(scored).toHaveLength(2)
    expect(scored[0]?.score).toBe(2.5)
    expect(scored[1]?.score).toBe(1)
    expect(scored[0]?.entity).toBeInstanceOf(ShapePerson)
  })

  it('skips rows without a node value under the alias', () => {
    expect(shapeScoredRows([row({ score: 9 })], ShapePerson, 'node')).toEqual([])
  })

  it('aligns scores around rows without a node value mid-stream', () => {
    // A row whose alias column holds no graph node is skipped by BOTH
    // filters — the surviving rows keep their own scores
    const scored = shapeScoredRows(
      [
        row({ node: node({ name: 'A' }), score: 2.5 }),
        row({ node: null, score: 99 }),
        row({ node: node({ name: 'B' }), score: 1 }),
      ],
      ShapePerson,
      'node',
    )

    expect(scored).toHaveLength(2)
    expect(scored[0]?.score).toBe(2.5)
    expect(scored[1]?.score).toBe(1)
  })
})
