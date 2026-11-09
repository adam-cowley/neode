import { NeodeError } from '../errors/index.js'
import type { Newable } from '../meta/newable.js'
// Import Direction from its leaf module: the query barrel pulls the eager
// utilities, which pull the metamodel back in (dependency cycle)
import { Direction } from '../query/direction.js'
import type { PropertySchema } from './property-schema.js'

/**
How many edges a relationship may hold from one node (NTS-161): `one`
(exactly one — enforced as at-most-one at write time), `zeroOrOne`
(at most one, none is fine) or `many` (unrestricted — the default).
Read paths are untouched: cardinality is a write-time guard.
*/
export type RelationshipCardinality = 'one' | 'zeroOrOne' | 'many'

export class RelationshipPropertySchema {
  static fromPropertySchema(original: PropertySchema): RelationshipPropertySchema {
    const cloned = new RelationshipPropertySchema(original.getKey())

    return cloned
  }

  private readonly key: string
  private type!: string
  private direction!: Direction
  private target: Newable | undefined

  /**
  A target provider for forward-referenced classes: the arrow thunk the
  user wrote, resolved on first getTarget() — the target class may be
  declared later in the file, inside its temporal dead zone at registration
  */
  private targetProvider: (() => Newable) | undefined
  private many!: boolean
  private eager = false

  /**
  Per-relationship cascade (delete-time default): deleting a node deletes
  the nodes reached through this relationship, recursively. The delete's
  explicit options win — `{ cascade: true }` cascades every relationship,
  `{ cascade: false }` cascades none
  */
  private isCascade = false

  /**
  Explicitly declared cardinality (NTS-161), or undefined — derived from
  the many flag when not declared
  */
  private cardinality: RelationshipCardinality | undefined

  /**
  Free-text explanation emitted by the agent ontology (NTS-445)
  */
  private description: string | undefined

  constructor(key: string) {
    this.key = key
  }

  getKey(): string {
    return this.key
  }

  setType(type: string): void {
    this.type = type
  }

  getType(): string {
    return this.type
  }

  setDirection(direction: Direction): void {
    this.direction = direction
  }

  getDirection(): Direction {
    return this.direction
  }

  setTarget(target: Newable | (() => Newable)): void {
    // An arrow thunk has no prototype — store it for deferred resolution
    // instead of calling it during registration (the target class may be
    // declared later in the file, inside its temporal dead zone)
    if (isClassConstructor(target)) {
      this.target = target
    } else {
      this.targetProvider = target
    }
  }

  getTarget(): Newable {
    if (this.targetProvider) {
      const provider = this.targetProvider

      this.targetProvider = undefined
      this.target = provider()
    }

    if (this.target === undefined) {
      throw new NeodeError(
        `Relationship "${this.key}" has no target — declare its target class or factory before use`,
      )
    }

    return this.target
  }

  setMany(isMany: boolean): void {
    this.many = isMany
  }

  getMany(): boolean {
    return this.many
  }

  setCardinality(cardinality: RelationshipCardinality): void {
    this.cardinality = cardinality
  }

  /**
  The declared cardinality, or the one implied by the many flag — a
  relationship declared without a cardinality keeps today's shape: many
  for @OneToMany, one for @OneToOne (NTS-161)
  */
  getCardinality(): RelationshipCardinality {
    return this.cardinality ?? (this.many ? 'many' : 'one')
  }

  setEager(isEager: boolean): void {
    this.eager = isEager
  }

  getEager(): boolean {
    return this.eager
  }

  setCascade(isCascade: boolean): void {
    this.isCascade = isCascade
  }

  getCascade(): boolean {
    return this.isCascade
  }

  setDescription(description: string): void {
    this.description = description
  }

  getDescription(): string | undefined {
    return this.description
  }

  toString(relationshipAlias = ''): string {
    return `${this.direction === Direction.INCOMING ? '<' : ''}-[${relationshipAlias}:${this.type}]-${this.direction === Direction.OUTGOING ? '>' : ''}`
  }
}

/**
True for a class constructor rather than an arrow thunk: constructors carry
a prototype, arrow functions do not
*/
function isClassConstructor(value: Newable | (() => Newable)): value is Newable {
  return 'prototype' in value
}
