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
  Free-text explanation of the relationship for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
}
