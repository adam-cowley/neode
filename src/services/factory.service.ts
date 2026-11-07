import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { EntitySchema as EntitySchemaClass } from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { Newable } from '../meta/newable.js'
import { getModelByName, unknownDefinitionError } from '../meta/map-schema.js'
import type { Neode } from '../neode.service.js'
import type { PropertySchema } from '../meta/property-schema.js'
import { isConstructorOf, isRecord } from './type-guards.js'
import { NeodeError } from '../errors/index.js'

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
around it.
*/
export class FactoryBuilder<T extends object = Record<string, unknown>> {
  private readonly neode: Neode

  private readonly newable: Newable

  private readonly schema: EntitySchema

  private total: number | undefined

  private readonly withs: { relationshipName: string; spec: FactoryWithSpec }[] = []

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

  private async createOne(
    overrides: Record<string, unknown>,
    uniques: PropertySchema[],
    used: Map<string, Set<unknown>>,
  ): Promise<T> {
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

    // resolveConstructor guarantees a constructor; the guard names the
    // constructed type for the generic create call
    const constructor = this.newable

    if (!isConstructorOf<T>(constructor)) {
      throw new TypeError('The factory model is not a constructor')
    }

    return this.neode.create<T>(constructor, properties)
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

    // resolveConstructor guarantees a constructor; the guard names the
    // constructed type for the generic relate call
    const constructor = this.newable

    if (!isConstructorOf<T>(constructor)) {
      throw new TypeError('The factory model is not a constructor')
    }

    for (let n = 0; n < spec.count; n++) {
      const properties =
        typeof spec.properties === 'function' ? spec.properties(n) : spec.properties

      const created: unknown = await this.neode.create(target, properties)

      if (!isRecord(created)) {
        throw new TypeError('The factory created a non-object entity')
      }

      await this.neode.relate(constructor, instance, created, relationshipName)
    }
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
  Create the seeded instance(s) — a single hydrated instance without
  `.count(n)`, an array with it. Explicit `overrides` win over fake
  values and schema defaults and are validated like any create().
  */
  async create(overrides: Record<string, unknown> = {}): Promise<T | T[]> {
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
    // object untouched while createOne consumes overrides row by row.
    const rowOverrides: Record<string, unknown> = { ...overrides }

    const instances: T[] = []

    for (let index = 0; index < total; index++) {
      instances.push(await this.createOne(rowOverrides, uniques, used))
    }

    for (const instance of instances) {
      for (const { relationshipName, spec } of this.withs) {
        await this.seedRelationships(instance, relationshipName, spec)
      }
    }

    if (this.total === undefined) {
      const first = instances[0]

      if (first === undefined) {
        throw new NeodeError('The factory created no instance')
      }

      return first
    }

    return instances
  }
}
