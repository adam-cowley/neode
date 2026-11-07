import { Direction } from '../../../src/query'
import {
  EAGER_ID,
  EAGER_LABELS,
  EAGER_TYPE,
  MAX_EAGER_DEPTH,
  eagerNode,
  eagerPattern,
  eagerRelationship,
} from '../../../src/query/eager-utilities.js'
import { getModel, mergeRelationshipProperty } from '../../../src/meta'
import { NodeEntity, OneToMany, RelationshipEntity } from '../../../src/decorators'

/**
 * Collapse the multi-line map projections the same way neode's
 * EagerUtils.spec.js does: newlines gone, runs of whitespace collapsed.
 */
const normalise = (pattern: string): string => pattern.replace(/\n/g, '').replace(/\s\s/g, '')

@NodeEntity()
class Movie {}

@NodeEntity()
class Person {
  @OneToMany(() => Movie, 'ACTED_IN', Direction.OUTGOING, true)
  movies: Movie[]
}

@RelationshipEntity()
class Directed {}

// A target class that is never registered in the metamodel
class Unregistered {}

@NodeEntity()
class LooseEnd {}

@NodeEntity()
class EagerUtilTest {
  @OneToMany(() => Person, 'ACTED_IN', Direction.INCOMING, true)
  actorNodes: Person[]

  @OneToMany(() => Directed, 'ACTED_IN', Direction.INCOMING, true)
  actorRels: Directed[]

  @OneToMany(() => Person, 'SHOULD_BE_IGNORED', Direction.INCOMING)
  nonEager: Person[]
}

// Singular relationships: @OneToOne resolves its target from design:type
// metadata, which the vitest transform does not emit for test files, so the
// singular fixtures are registered through the metamodel directly (the same
// registry entry point the decorators themselves call).
mergeRelationshipProperty(
  EagerUtilTest,
  'directorNode',
  'DIRECTED',
  Person,
  Direction.INCOMING,
  false,
  true,
)
mergeRelationshipProperty(
  EagerUtilTest,
  'directorRel',
  'DIRECTED',
  Directed,
  Direction.INCOMING,
  false,
  true,
)
mergeRelationshipProperty(
  LooseEnd,
  'mystery',
  'UNKNOWN',
  Unregistered,
  Direction.OUTGOING,
  false,
  true,
)

describe('Query/EagerUtils', () => {
  describe('constants', () => {
    it('exposes the neode constant values', () => {
      expect(EAGER_ID).toBe('__EAGER_ID__')
      expect(EAGER_LABELS).toBe('__EAGER_LABELS__')
      expect(EAGER_TYPE).toBe('__EAGER_TYPE__')
      expect(MAX_EAGER_DEPTH).toBe(3)
    })
  })

  describe('eagerPattern', () => {
    it('builds a pattern for a singular node relationship and appends [0]', () => {
      const rel = getModel(EagerUtilTest).getRelationship('directorNode')
      const output = normalise(eagerPattern(1, 'this', rel))

      expect(output).toBe(
        'directorNode: [ (this)<-[this_directorNode_rel:`DIRECTED`]-(this_directorNode_node:Person) |this_directorNode_node { .*,__EAGER_ID__: elementId(this_directorNode_node),__EAGER_LABELS__: labels(this_directorNode_node),movies: [ (this_directorNode_node)-[this_directorNode_node_movies_rel:`ACTED_IN`]->(this_directorNode_node_movies_node:Movie) |this_directorNode_node_movies_node { .*,__EAGER_ID__: elementId(this_directorNode_node_movies_node),__EAGER_LABELS__: labels(this_directorNode_node_movies_node)} ]} ][0]',
      )
    })

    it('builds a pattern for a plural node relationship without [0]', () => {
      const rel = getModel(EagerUtilTest).getRelationship('actorNodes')
      const output = normalise(eagerPattern(1, 'this', rel))

      expect(output).toBe(
        'actorNodes: [ (this)<-[this_actorNodes_rel:`ACTED_IN`]-(this_actorNodes_node:Person) |this_actorNodes_node { .*,__EAGER_ID__: elementId(this_actorNodes_node),__EAGER_LABELS__: labels(this_actorNodes_node),movies: [ (this_actorNodes_node)-[this_actorNodes_node_movies_rel:`ACTED_IN`]->(this_actorNodes_node_movies_node:Movie) |this_actorNodes_node_movies_node { .*,__EAGER_ID__: elementId(this_actorNodes_node_movies_node),__EAGER_LABELS__: labels(this_actorNodes_node_movies_node)} ]} ]',
      )
    })

    it('builds a pattern for a singular relationship entity and appends [0]', () => {
      const rel = getModel(EagerUtilTest).getRelationship('directorRel')
      const output = normalise(eagerPattern(1, 'this', rel))

      expect(output).toBe(
        'directorRel: [ (this)<-[this_directorRel_rel:`DIRECTED`]-(this_directorRel_node) |this_directorRel_rel { .*,__EAGER_ID__: elementId(this_directorRel_rel),__EAGER_TYPE__: type(this_directorRel_rel),directorRel:this_directorRel_node { .*,__EAGER_ID__: elementId(this_directorRel_node),__EAGER_LABELS__: labels(this_directorRel_node)}} ][0]',
      )
    })

    it('builds a pattern for a plural relationship entity without [0]', () => {
      const rel = getModel(EagerUtilTest).getRelationship('actorRels')
      const output = normalise(eagerPattern(1, 'this', rel))

      expect(output).toBe(
        'actorRels: [ (this)<-[this_actorRels_rel:`ACTED_IN`]-(this_actorRels_node) |this_actorRels_rel { .*,__EAGER_ID__: elementId(this_actorRels_rel),__EAGER_TYPE__: type(this_actorRels_rel),actorRels:this_actorRels_node { .*,__EAGER_ID__: elementId(this_actorRels_node),__EAGER_LABELS__: labels(this_actorRels_node)}} ]',
      )
    })

    it('builds a bare map projection when the target schema is unknown', () => {
      const rel = getModel(LooseEnd).getRelationship('mystery')

      // The target class is not registered: no nested eager fields,
      // and the node variable carries no label
      const output = normalise(eagerPattern(1, 'this', rel))

      expect(output).toBe(
        'mystery: [ (this)-[this_mystery_rel:`UNKNOWN`]->(this_mystery_node) |this_mystery_node { .*,__EAGER_ID__: elementId(this_mystery_node),__EAGER_LABELS__: labels(this_mystery_node)} ][0]',
      )
    })
  })

  describe('eagerNode', () => {
    const schema = getModel(EagerUtilTest)
    const pattern = normalise(eagerNode(1, 'this', schema))

    it('should request properties, id and labels for a node', () => {
      expect(pattern).toContain(
        ' this { .*,__EAGER_ID__: elementId(this),__EAGER_LABELS__: labels(this)',
      )
    })

    it('should request an eager singular node', () => {
      expect(pattern).toContain(
        'directorNode: [ (this)<-[this_directorNode_rel:`DIRECTED`]-(this_directorNode_node:Person) |this_directorNode_node { .*,__EAGER_ID__: elementId(this_directorNode_node)',
      )
    })

    it('should request eager plural nodes', () => {
      expect(pattern).toContain(
        'actorNodes: [ (this)<-[this_actorNodes_rel:`ACTED_IN`]-(this_actorNodes_node:Person) |this_actorNodes_node { .*,__EAGER_ID__: elementId(this_actorNodes_node)',
      )
    })

    it('should request an eager relationship entity with its type', () => {
      expect(pattern).toContain(
        'directorRel: [ (this)<-[this_directorRel_rel:`DIRECTED`]-(this_directorRel_node) |this_directorRel_rel { .*,__EAGER_ID__: elementId(this_directorRel_rel),__EAGER_TYPE__: type(this_directorRel_rel)',
      )
    })

    it('should request eager relationship entities', () => {
      expect(pattern).toContain(
        'actorRels: [ (this)<-[this_actorRels_rel:`ACTED_IN`]-(this_actorRels_node) |this_actorRels_rel { .*,__EAGER_ID__: elementId(this_actorRels_rel),__EAGER_TYPE__: type(this_actorRels_rel)',
      )
    })

    it('should request a nested eager statement two levels deep', () => {
      expect(pattern).toContain(
        'movies: [ (this_directorNode_node)-[this_directorNode_node_movies_rel:`ACTED_IN`]->(this_directorNode_node_movies_node:Movie) |this_directorNode_node_movies_node { .*,__EAGER_ID__: elementId(this_directorNode_node_movies_node),__EAGER_LABELS__: labels(this_directorNode_node_movies_node)} ]',
      )
    })

    it('should skip relationships that are not eager', () => {
      expect(pattern).not.toContain('SHOULD_BE_IGNORED')
    })

    it('should render a bare projection without a schema', () => {
      expect(eagerNode(0, 'this', undefined)).toBe(
        '\n this { \n.*\n,__EAGER_ID__: elementId(this)\n,__EAGER_LABELS__: labels(this)\n}',
      )
    })

    it('should stop recursion past MAX_EAGER_DEPTH', () => {
      const within = eagerNode(MAX_EAGER_DEPTH - 1, 'n', schema)
      const atMax = eagerNode(MAX_EAGER_DEPTH, 'n', schema)

      // At depth 2 the director node is still expanded one more level
      expect(within).toContain('n_directorNode_node_movies_rel')

      // At depth 3 the patterns are generated but not expanded further
      expect(atMax).toContain('n_directorNode_rel')
      expect(atMax).not.toContain('n_directorNode_node_movies')
    })
  })

  describe('eagerRelationship', () => {
    it('should project the relationship with its type and the connected node', () => {
      const output = normalise(eagerRelationship(1, 'rel', 'director', 'node', getModel(Person)))

      expect(output).toContain(' rel { .*,__EAGER_ID__: elementId(rel),__EAGER_TYPE__: type(rel)')
      expect(output).toContain(
        ',director:node { .*,__EAGER_ID__: elementId(node),__EAGER_LABELS__: labels(node)',
      )
      expect(output).toContain(
        'movies: [ (node)-[node_movies_rel:`ACTED_IN`]->(node_movies_node:Movie)',
      )
    })

    it('should render a bare node projection without a node model', () => {
      const output = normalise(eagerRelationship(1, 'rel', 'director', 'node', undefined))

      expect(output).toBe(
        ' rel { .*,__EAGER_ID__: elementId(rel),__EAGER_TYPE__: type(rel),director:node { .*,__EAGER_ID__: elementId(node),__EAGER_LABELS__: labels(node)}}',
      )
    })
  })
})
