/**
Runtime type guards shared by the service/projection/transaction layers.

The metamodel getters (`getModel`, `getEntity`, `getTarget`, …) declare
non-nullable results but return undefined for unregistered models — these
guards are the checked edge the strict no-assertion rule requires.
*/
import type { GraphRelationship, GraphNode } from '../driver/types.js'
import type { Newable } from '../meta/newable.js'

/**
A constructor of the given model type
*/
export type ConstructorOf<T> = new (...arguments_: never[]) => T

/**
True for a plain object value (property maps, node projection maps).
Arrays are not records.
*/
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
True for a list of entities (the array form of a `relate` target). A
user-defined guard: Array.isArray's built-in `any[]` guard would let the
`any` leak into the eager-relate call (NTS-615).
*/
export function isObjectArray(value: object | object[]): value is object[] {
  return Array.isArray(value)
}

/**
True for a driver node value or an eager projection map — the two shapes
`hydrateNode` understands (both are plain objects carrying node data).
*/
export function isNodeLike(value: unknown): value is GraphNode | Record<string, unknown> {
  return isRecord(value)
}

/**
True for a constructor of the given model type. The runtime check is
function-ness; the type parameter names the constructed type (the
metamodel stores constructors as bare `Newable`).
*/
export function isConstructorOf<T>(value: unknown): value is ConstructorOf<T> {
  return typeof value === 'function'
}

/**
The constructor of an entity instance (its class), or undefined when the
value is not an object.
*/
export function constructorOf(entity: unknown): Newable | undefined {
  if (!isRecord(entity)) {
    return undefined
  }

  const constructor: unknown = entity.constructor

  return isConstructorOf<unknown>(constructor) ? constructor : undefined
}

/**
True for a driver relationship value in the normalized shape.
*/
export function isGraphRelationship(value: unknown): value is GraphRelationship {
  return (
    isRecord(value) &&
    typeof value['elementId'] === 'string' &&
    typeof value['type'] === 'string' &&
    typeof value['startElementId'] === 'string' &&
    typeof value['endElementId'] === 'string' &&
    isRecord(value['properties'])
  )
}

/**
True for a driver node value in the normalized shape.
*/
export function isGraphNode(value: unknown): value is GraphNode {
  return isRecord(value) && typeof value['elementId'] === 'string' && isRecord(value['properties'])
}
