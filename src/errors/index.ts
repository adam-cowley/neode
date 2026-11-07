// Typed error taxonomy (NTS-129): classifyError maps raw driver/engine
// errors (neo4j-driver's Neo4jError, the Relate client's RelateError) to
// these types; unknown errors pass through untouched.

export { classifyError, isTransientError } from './classify.js'
export { ConstraintViolationError } from './constraint-violation.js'
export { NeodeError } from './neode-error.js'
export { OptimisticLockError } from './optimistic-lock.js'
export { RelationNotLoadedError } from './relation-not-loaded.js'
export { redactParameters, withQueryContext } from './query-error.js'
export { TransientError } from './transient.js'
