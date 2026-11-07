import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { EntitySchema as EntitySchemaClass } from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { Newable } from '../meta/newable.js'
import { getModelByName, unknownDefinitionError } from '../meta/map-schema.js'
import type { Neode } from '../neode.service.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { isConstructorOf, isRecord, type ConstructorOf } from './type-guards.js'
import { NeodeError } from '../errors/index.js'
import { applyFakeValues } from './write-utilities.js'
import { getValueOrDefault } from '../utilities.js'

/**
Fake-invocation cap when retrying a unique property's `fake` for a
distinct value within one batch (NTS-444)
*/
const MAX_FAKE_ATTEMPTS = 1000

/**
Options for one `.with()` call on a factory builder (NTS-444)
*/
export interface FactoryWithSpec {
  /**
  Number of target nodes to create and relate, per created instance
  */
  count: number
  /**
  Properties for each target node: a static map, or a function of the
  target's index within the batch
  */
  properties?: Record<string, unknown> | ((index: number) => Record<string, unknown>)
}

/**
Resolve a factory target to a registered model constructor: a model
name looks up the map-defined registry (`defineModel` / `model()`),
a decorated class passes through as-is
*/
function resolveConstructor(model: string | Newable): Newable {
  if (typeof model !== 'string') {
    return model
  }

  const found = getModelByName(model)

  if (found === undefined) {
    throw new NeodeError(unknownDefinitionError(model))
  }

  return found
}

/**
Chainable factory builder (NTS-444): seed fake data through the library's
normal create/relate services, so validation, defaults, timestamps and
relationship logic all apply.

	neode.factory('User')
		.count(10)
		.with('posts', { count: 2, properties: { title: 'Seeded' } })
		.create({ role: 'admin' })

Precedence on create: explicit value > `default` > `fake`. Unique
properties with a `fake` generator are retried until the values are
distinct within one batch (app-level check) — across runs the user's
fake fn must be DB-safe (e.g. random UUIDs). An override on a unique
property applies to the first row; later rows fake distinct values
around it. `.make()` resolves the same properties but returns unsaved
instances; `.has(otherFactory, relationshipName)` composes another
factory's output onto every created instance through the explicit
relate path.
*/
export class FactoryBuilder<T extends object = Record<string, unknown>> {
  private readonly neode: Neode

  private readonly newable: Newable

  private readonly schema: EntitySchema

  private total: number | undefined

  private readonly withs: { relationshipName: string; spec: FactoryWithSpec }[] = []

  private readonly hasBuilders: { relationshipName: string; child: FactoryBuilder<object> }[] = []

  constructor(neode: Neode, model: string | Newable) {
    this.neode = neode
    this.newable = resolveConstructor(model)

    const schema = getModel(this.newable)

    if (!(schema instanceof EntitySchemaClass)) {
      const name = typeof this.newable === 'function' ? this.newable.name : 'unknown'

      throw new NeodeError(
        `Couldn't find a model for "${name}". Register the model via model() or a decorator first.`,
      )
    }

    this.schema = schema
  }

  /**
  The constructor narrowed to the factory's model type (the registry
  stores constructors as bare Newable)
  */
  private typedConstructor(): ConstructorOf<T> {
    if (!isConstructorOf<T>(this.newable)) {
      throw new TypeError('The factory model is not a constructor')
    }

    return this.newable
  }

  /**
  Overrides as a string-keyed map: the generic model type carries no
  index signature, so property access below keys by definition key
  */
  private toRows(overrides: Partial<T>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(overrides))
  }

  /**
  Resolve one row's properties: explicit override > schema default >
  fake, with unique-fake generators pre-checked for distinctness within
  the batch. Consumes `overrides` entries for unique properties so the
  override applies to the first row only.
  */
  private resolveProperties(
    overrides: Record<string, unknown>,
    uniques: PropertySchema[],
    used: Map<string, Set<unknown>>,
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = { ...overrides }

    for (const property of uniques) {
      const key = property.getKey()
      const fake = property.getFake()

      if (typeof fake !== 'function') {
        continue
      }

      // The override applies to the first row only — consume it so later
      // rows fake distinct values around the seeded used set
      if (properties[key] !== undefined) {
        overrides[key] = undefined

        continue
      }

      const seen = used.get(key) ?? new Set<unknown>()

      let value: unknown
      let attempts = 0

      do {
        value = fake()

        if (++attempts > MAX_FAKE_ATTEMPTS) {
          throw new NeodeError(
            `The fake() generator for unique property "${key}" did not produce a distinct value after ${String(
              MAX_FAKE_ATTEMPTS,
            )} attempts`,
          )
        }
      } while (seen.has(value))

      seen.add(value)
      used.set(key, seen)
      properties[key] = value
    }

    return properties
  }

  private async createOne(properties: Record<string, unknown>): Promise<T> {
    return this.neode.create<T>(this.typedConstructor(), properties)
  }

  private makeOne(overrides: Record<string, unknown>): T {
    const properties = { ...overrides }

    // make() resolves every value the write path would resolve: fakes for
    // properties neither the overrides nor a default set, then schema
    // defaults (read at CREATE time, never stored on the model)
    applyFakeValues(this.schema, properties)

    for (const property of this.schema.getProperties()) {
      const key = property.getKey()

      if (properties[key] !== undefined) {
        continue
      }

      const value = getValueOrDefault(properties, property, this.schema)

      if (value !== undefined) {
        properties[key] = value
      }
    }

    const constructed = new (this.typedConstructor())()

    Object.assign(constructed, properties)

    return constructed
  }

  private async seedRelationships(
    instance: T,
    relationshipName: string,
    spec: FactoryWithSpec,
  ): Promise<void> {
    if (!this.schema.hasRelationship(relationshipName)) {
      throw new NeodeError(
        `Unknown relationship "${relationshipName}" on ${this.schema.getLabels().join(':') || 'entity'}`,
      )
    }

    const relationship = this.schema.getRelationship(relationshipName)

    const target = relationship.getTarget()

    if (typeof target !== 'function') {
      throw new TypeError(
        `Couldn't find a model for the target of relationship "${relationshipName}"`,
      )
    }

    for (let n = 0; n < spec.count; n++) {
      const properties =
        typeof spec.properties === 'function' ? spec.properties(n) : spec.properties

      const created: unknown = await this.neode.create(target, properties)

      if (!isRecord(created)) {
        throw new TypeError('The factory created a non-object entity')
      }

      await this.neode.relate(this.newable, instance, created, relationshipName)
    }
  }

  /**
  Run a composed child factory for one parent instance and relate every
  created child through the explicit relate path (MERGE) — no
  graph-walking save.
  */
  private async seedHasRelationships(
    instance: T,
    child: FactoryBuilder<object>,
    relationshipName: string,
  ): Promise<void> {
    // The child builder's rows, created through its own count/with/has
    // configuration — instances() always resolves to an array
    const children = await child.instances({}, true)

    for (const childInstance of children) {
      await this.neode.relate(this.newable, instance, childInstance, relationshipName)
    }
  }

  /**
  The one instance of a no-count() run — create/make unwrap their array
  to a single entity when count() was never chained
  */
  private firstRow(rows: T[]): T {
    const first = rows[0]

    if (first === undefined) {
      throw new NeodeError('The factory created no instance')
    }

    return first
  }

  /**
  Shared create/make core: resolve each row's properties, then either
  persist through create (with relationship seeding) or construct
  unsaved. Always resolves to the full row array; create()/make() unwrap.
  */
  private async instances(
    overrides: Record<string, unknown>,
    shouldPersist: boolean,
  ): Promise<T[]> {
    const total = this.total ?? 1

    // Unique properties with a fake generator: pre-generate distinct values
    // for the batch (app-level check — the fake fn must still be DB-safe
    // across runs). Explicit overrides always win; they apply to every row,
    // so overriding a unique property across a multi-row batch is a caller error.
    const uniques = this.schema
      .getProperties()
      .filter((property) => property.isUnique() && typeof property.getFake() === 'function')

    // An override on a unique property occupies its value before row 1
    const used = new Map<string, Set<unknown>>(
      uniques
        .filter((property) => overrides[property.getKey()] !== undefined)
        .map((property) => [property.getKey(), new Set([overrides[property.getKey()]])]),
    )

    // Unique+fake overrides apply to the FIRST row; later rows fake
    // distinct values around the used set. The copy keeps the caller's
    // object untouched while resolveProperties consumes overrides row by row.
    const rowOverrides: Record<string, unknown> = { ...overrides }

    const made: T[] = []

    for (let index = 0; index < total; index++) {
      const properties = this.resolveProperties(rowOverrides, uniques, used)

      made.push(shouldPersist ? await this.createOne(properties) : this.makeOne(properties))
    }

    if (shouldPersist) {
      for (const instance of made) {
        for (const { relationshipName, spec } of this.withs) {
          await this.seedRelationships(instance, relationshipName, spec)
        }

        for (const { relationshipName, child } of this.hasBuilders) {
          await this.seedHasRelationships(instance, child, relationshipName)
        }
      }
    }

    return made
  }

  /**
  Seed `n` instances — `.create()` then resolves to an array
  */
  count(count: number): this {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new NeodeError('count() requires a positive integer')
    }

    this.total = count

    return this
  }

  /**
  Seed `count` factory-created target nodes over the relationship named
  by its definition key, relating each to every created instance.
  Chainable; multiple `.with()` calls are allowed.
  */
  with(relationshipName: string, spec: FactoryWithSpec): this {
    if (!Number.isSafeInteger(spec.count) || spec.count < 0) {
      throw new NeodeError(`with() requires a non-negative integer count for "${relationshipName}"`)
    }

    this.withs.push({ relationshipName, spec })

    return this
  }

  /**
  Compose another factory onto every created instance: the child factory
  runs once per parent instance (its own `.count()`, `.with()` and
  overrides included) and every created child is related to the parent
  over the relationship named by its definition key. Chainable; multiple
  `.has()` calls are allowed.
  */
  has<C extends object>(child: FactoryBuilder<C>, relationshipName: string): this {
    this.hasBuilders.push({ relationshipName, child })

    return this
  }

  /**
  Build the seeded instance(s) WITHOUT saving them — a single instance
  without `.count(n)`, an array with it. Overrides win over schema
  defaults and fake generators, exactly like create(). Relationship
  seeding (with/has) needs saved nodes, so make() rejects it.
  */
  async make(overrides: Partial<T> = {}): Promise<T | T[]> {
    if (this.withs.length > 0 || this.hasBuilders.length > 0) {
      throw new NeodeError(
        'make() returns unsaved instances and cannot seed relationships — use create()',
      )
    }

    const made = await this.instances(this.toRows(overrides), false)

    return this.total === undefined ? this.firstRow(made) : made
  }

  /**
  Create the seeded instance(s) — a single hydrated instance without
  `.count(n)`, an array with it. Explicit `overrides` win over fake
  values and schema defaults and are validated like any create().
  */
  async create(overrides: Partial<T> = {}): Promise<T | T[]> {
    const made = await this.instances(this.toRows(overrides), true)

    return this.total === undefined ? this.firstRow(made) : made
  }
}
