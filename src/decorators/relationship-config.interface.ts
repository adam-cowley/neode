import type { Newable } from '../meta/newable.js'
import type { Direction } from '../query/index.js'

export interface RelationshipConfig {
  type: string
  /**
  Factory returning the related entity class. Required: standard (TC39)
  decorators have no design:type reflection to infer it.
  */
  target: () => Newable
  direction: Direction
  eager?: boolean
  /**
  Per-relationship cascade: deleting a node also deletes the nodes reached
  through this relationship, recursively. Unannotated relationships
  survive unless the delete call opts in with `{ cascade: true }`.
  */
  cascade?: boolean
  /**
  Free-text explanation of the relationship for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
}
