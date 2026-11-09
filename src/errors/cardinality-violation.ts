import { NeodeError } from './neode-error.js'

/**
Raised when a write would give a relationship more edges than its declared
cardinality allows (NTS-161): relating a second edge onto a `one` /
`zeroOrOne` relationship — through relate(), a multi-target save, or
syncEdges — names the relationship, the violated cardinality and the fix.
Detach the existing edge first (or use syncEdges, which detaches for you),
or change the declaration to `many`.
*/
export class CardinalityViolationError extends NeodeError {
  constructor(relationshipKey: string, cardinality: string, edgeCount: number) {
    super(
      `Cardinality violation on relationship "${relationshipKey}": declared cardinality ` +
        `'${cardinality}' allows at most one edge, but the write would produce ${String(edgeCount)}. ` +
        'Detach the existing edge first (or use syncEdges, which detaches for you), ' +
        "or change the declaration to 'many'.",
    )

    this.name = 'CardinalityViolationError'
  }
}
