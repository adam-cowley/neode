import type { Newable } from '../meta/newable.js'
import type {
  ClaimConflictPolicy,
  RelationshipCardinality,
} from '../meta/relationship-property-schema.js'
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
  /**
  Write-time cardinality (NTS-161): `one` (the default for @OneToOne) and
  `zeroOrOne` allow at most one edge — a second relate() throws
  CardinalityViolationError. `many` is unrestricted.
  */
  cardinality?: RelationshipCardinality
  /**
  DB-enforced inverse cardinality (NTS-663): names a `@Unique` property on
  the TARGET model that neode's write paths keep pointed at this node's
  primary key. The target's uniqueness constraint (installed by
  installSchema()) rejects a second node claiming the same target — a
  one-to-one enforced by the database, not just the write-time guard.
  Requires cardinality `one` / `zeroOrOne`.
  */
  enforce?: string
  /**
  What relate() does when the target is already claimed by a different
  source (NTS-663): 'refuse' (default) matches zero rows and resolves
  undefined; 'detach' deletes the other claimant's edges in the same
  statement so the claim moves; 'throw' raises NeodeError naming the
  current claimant. Requires `enforce`.
  */
  claimConflict?: ClaimConflictPolicy
}
