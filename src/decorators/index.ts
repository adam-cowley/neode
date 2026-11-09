// Node Entities
export { NodeEntity } from './node/node-entity.decorator.js'

export { InternalId } from './internal-id.decorator.js'

export { Primary } from './node/primary.decorator.js'
export { Uuid } from './node/uuid.decorator.js'
// @deprecated Use @Property({ type: 'string' }) instead
// eslint-disable-next-line @typescript-eslint/no-deprecated -- re-exporting the deprecated @String on purpose: the legacy decorator stays exported for compatibility
export { String } from './node/string.decorator.js'
export { Number } from './node/number.decorator.js'
export { OneToOne } from './node/one-to-one.decorator.js'
export { OneToMany } from './node/one-to-many.decorator.js'

// Properties
export { Property } from './property.decorator.js'
export { Boolean } from './node/boolean.decorator.js'
export { Float } from './node/float.decorator.js'
export { Date } from './node/date.decorator.js'
export { Time } from './node/time.decorator.js'
export { DateTime } from './node/date-time.decorator.js'
export { LocalTime } from './node/local-time.decorator.js'
export { LocalDateTime } from './node/local-date-time.decorator.js'
export { Point } from './node/point.decorator.js'
export { Duration } from './node/duration.decorator.js'

// Property Options
export { Default } from './node/default.decorator.js'
export { OnCreateSet } from './node/on-create-set.decorator.js'
export { OnMatchSet } from './node/on-match-set.decorator.js'
export { CreatedAt } from './node/created-at.decorator.js'
export { UpdatedAt } from './node/updated-at.decorator.js'
export { Version } from './node/version.decorator.js'
export { SoftDelete } from './node/soft-delete.decorator.js'
export { Filter } from './node/filter.decorator.js'
export { Index } from './node/index.decorator.js'
export { Unique } from './node/unique.decorator.js'
export { Required } from './node/required.decorator.js'
export { Hidden } from './node/hidden.decorator.js'
export { Protected } from './node/protected.decorator.js'
export { Readonly } from './node/readonly.decorator.js'
export { Vector } from './node/vector.decorator.js'
export { Derived } from './node/derived.decorator.js'

// Relationship Entities
export { RelationshipEntity } from './relationship/relationship-entity.decorator.js'

export { StartNode } from './relationship/start-node.decorator.js'
export { EndNode } from './relationship/end-node.decorator.js'
export { OtherNode } from './relationship/other-node.decorator.js'

// Read-model projections (NTS-135/136/137/138)
export { RelatedOne } from './projection/related-one.decorator.js'
export { RelatedMany } from './projection/related-many.decorator.js'
export { RelationshipCount } from './projection/relationship-count.decorator.js'
export { RelationshipExists } from './projection/relationship-exists.decorator.js'
export { LabelPresent } from './projection/label-present.decorator.js'
export { Computed } from './projection/computed.decorator.js'
export { Expression } from './projection/expression.decorator.js'
export type {
  RelatedConfig,
  RelationshipCountConfig,
  RelationshipExistsConfig,
  ProjectionDirection,
} from './projection/projection-config.interface.js'

// Repositories
export { EntityRepository } from './repository.decorator.js'
