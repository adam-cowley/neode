/**
Read-model projections (NTS-135/136/137/138): declarative read models
composed into a single RETURN projection per read — one Cypher query,
no N+1.
*/
export { projectionNode, hasProjectedProperties } from './projection.js'
export { hydrateProjection } from './hydrate.js'
export { ProjectionService } from './projection.service.js'
