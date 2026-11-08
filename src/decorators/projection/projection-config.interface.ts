import type { Newable } from '../../meta/newable.js'
import type { Direction } from '../../query/index.js'

/**
Direction accepted in any spelling ('out' / 'in' / 'both', or a Direction)
*/
export type ProjectionDirection = Direction | 'in' | 'out' | 'both'

/**
NTS-547 — one hop of a @RelatedOne / @RelatedMany multi-hop `path`.
`direction` defaults to BOTH; `target` label-filters the hop's end node
(intermediate hops only need it for filtering — the LAST hop ends at the
property's `target()`).
*/
export interface RelatedPathHop {
  type: string
  direction?: ProjectionDirection
  target?: () => Newable
}

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
NTS-547 — config for @RelatedOne / @RelatedMany with a multi-hop `path`:
the declarative version of "entities reached through a chain of
relationships" (e.g. products co-ordered with this one). `fields` is
required — path reads support the projected (fields-subset) form only.
`target()` is the LAST hop's end; when given, `fields` is type-checked
against it and the final node is label-filtered.
*/
export interface PathRelatedConfig {
  /**
  The hops, in traversal order from the annotated node
  */
  path: RelatedPathHop[]
  /**
  Field subset to project from the final node
  */
  fields: string[]
  /**
  Target entity of the final hop — checks `fields` and label-filters the end
  */
  target?: () => Newable
}

/**
Checked form of `PathRelatedConfig`: `fields` must be keys of the final
hop's target instance type.
*/
export interface CheckedPathRelatedConfig<T extends object> {
  path: RelatedPathHop[]
  target: () => new (...arguments_: never[]) => T
  fields: (keyof T & string)[]
}

/**
Implementation-facing union of every @RelatedOne / @RelatedMany config
shape — all fields optional so the decorator body reads one shape without
assertions. Not part of the public API.
*/
export interface AnyRelatedConfig {
  type?: string
  direction?: ProjectionDirection
  path?: RelatedPathHop[]
  fields?: string[]
  target?: (() => Newable) | undefined
}

/**
Checked form of `RelatedConfig` for the @RelatedOne / @RelatedMany
overloads that carry a `target()`: `fields` must be keys of the target's
instance type, so a typo is a compile error instead of a field silently
missing from the projection.
*/
export interface CheckedRelatedConfig<T extends object> {
  /**
  Relationship type, e.g. 'IN_COURSE'
  */
  type: string
  direction?: ProjectionDirection
  /**
  Target entity — `fields` is checked against its instance type
  */
  target: () => new (...arguments_: never[]) => T
  /**
  Field subset to project; omit for full-entity eager loading
  */
  fields?: (keyof T & string)[]
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
