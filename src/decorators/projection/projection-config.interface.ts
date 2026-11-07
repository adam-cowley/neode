import type { Newable } from '../../meta/newable.js'
import type { Direction } from '../../query/index.js'

/**
Direction accepted in any spelling ('out' / 'in' / 'both', or a Direction)
*/
export type ProjectionDirection = Direction | 'in' | 'out' | 'both'

/**
NTS-135 — config for @RelatedOne / @RelatedMany.

`fields` omitted → full-entity eager loading (target resolved from
`target()` or design:type, like @OneToOne). With `fields`, the result is a
plain read-only DTO projected from the named field subset.
*/
export interface RelatedConfig {
  /**
  Relationship type, e.g. 'IN_COURSE'
  */
  type: string
  direction?: ProjectionDirection
  /**
  Field subset to project; omit for full-entity eager loading
  */
  fields?: string[]
  /**
  Target entity; resolved from design:type when omitted (full-entity form)
  */
  target?: () => Newable
}

/**
NTS-136 — config for @RelationshipCount. `where` uses `node` as the
variable convention for the target node, e.g. 'NOT node:OptionalLesson'.
The relationship type may pipe multiple types: 'HAS_MODULE|HAS_LESSON'.
*/
export interface RelationshipCountConfig {
  type: string
  direction?: ProjectionDirection
  /**
  Target label filter (labels of the counted node)
  */
  target?: () => Newable
  where?: string
  minHops?: number
  maxHops?: number
}

/**
NTS-137 — config for @RelationshipExists. Same `where` convention as
@RelationshipCount.
*/
export interface RelationshipExistsConfig {
  type: string
  direction?: ProjectionDirection
  where?: string
}
