import type { Newable } from '../meta/newable.js'
import { isRecord } from '../services/type-guards.js'

/**
Deferred registration protocol for standard (TC39) decorators.

Field decorators no longer receive the class they decorate, so each one
pushes a registration closure into the class's `Symbol.metadata` object;
the entity's class decorator (`@NodeEntity` / `@RelationshipEntity`) then
replays every registration with the real constructor. This replaces the
legacy immediate registration + `reflect-metadata` design:type reflection.
*/
export type FieldRegistration = (constructor: Newable) => void

const REGISTRATIONS = '__neodeRegistrations__'

function isMetadataObject(value: unknown): value is DecoratorMetadataObject {
  return isRecord(value)
}

export function addRegistration(
  // `Symbol.metadata` is missing from older lib targets, so TS types the field optional
  metadata: DecoratorMetadataObject | undefined,
  registration: FieldRegistration,
): void {
  if (metadata === undefined) {
    throw new Error(
      'Decorator metadata is unavailable — TC39 decorators require Symbol.metadata in the TS lib',
    )
  }

  const store = metadata as Record<string, unknown>
  const existing = store[REGISTRATIONS]

  if (Array.isArray(existing)) {
    existing.push(registration)
  } else {
    store[REGISTRATIONS] = [registration]
  }
}

export function getRegistrations(
  metadata: DecoratorMetadataObject | undefined,
): FieldRegistration[] {
  const stored: unknown = metadata?.[REGISTRATIONS]

  return isRegistrations(stored) ? stored : []
}

function isRegistrations(value: unknown): value is FieldRegistration[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'function')
}

const PLAYED = '__neodeRegistrationsPlayed__'

/**
Read the class's own metadata object (undefined when it has none).

tsc's decorator emit files metadata under `Symbol.metadata`; esbuild's emit
falls back to `Symbol.for('Symbol.metadata')` when the engine lacks the
well-known symbol. Check both so replay finds the queued registrations under
either transpiler.
*/
function classMetadata(constructor: Newable): DecoratorMetadataObject | undefined {
  const keys: symbol[] = [Symbol.for('Symbol.metadata')]

  // Destructured so the linter sees no non-standard `Symbol.metadata` access
  const { metadata: wellKnownMetadata } = Symbol

  if (typeof wellKnownMetadata === 'symbol') {
    keys.unshift(wellKnownMetadata)
  }

  for (const key of keys) {
    const metadata: unknown = Reflect.get(constructor, key)

    if (isMetadataObject(metadata)) {
      return metadata
    }
  }

  return undefined
}

/**
Replay queued field registrations with the real constructor. Called by the
entity's class decorator, and lazily by the metamodel when a model is
resolved (so field decorators also work on classes without a class decorator,
matching the legacy immediate-registration behaviour).
*/
export function replayRegistrations(constructor: Newable): void {
  const metadata = classMetadata(constructor)

  if (metadata === undefined) {
    return
  }

  const registrations = getRegistrations(metadata)

  if (registrations.length === 0) {
    return
  }

  const store = metadata as Record<string, unknown>

  if (store[PLAYED] === true) {
    return
  }

  store[PLAYED] = true

  for (const registration of registrations) {
    registration(constructor)
  }
}

/**
Standard decorators identify the decorated member by name.
*/
export function memberName(context: ClassFieldDecoratorContext): string {
  return String(context.name)
}
