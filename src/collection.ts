import { toJson } from './serialise.js'

/**
An iterable wrapper over an array of entities (parity with neode's
Collection): reads like an array, serialises through toJson().
*/
export class Collection<T> {
  /**
  Build a Collection from any iterable
  */
  static from<T>(values: Iterable<T>): Collection<T> {
    return new Collection([...values])
  }

  private readonly values: T[]

  constructor(values: T[] = []) {
    this.values = values
  }

  get length(): number {
    return this.values.length
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.values.values()
  }

  get(index: number): T | undefined {
    return this.values[index]
  }

  first(): T | undefined {
    return this.values[0]
  }

  map<U>(function_: (value: T, index: number, array: T[]) => U): U[] {
    return this.values.map((value, index, array) => function_(value, index, array))
  }

  find(isMatch: (value: T, index: number, array: T[]) => boolean): T | undefined {
    return this.values.find((value, index, array) => isMatch(value, index, array))
  }

  forEach(function_: (value: T, index: number, array: T[]) => void): void {
    for (const [index, value] of this.values.entries()) {
      function_(value, index, this.values)
    }
  }

  toJson(): unknown[] {
    return this.values.map((value) => toJson(value))
  }
}
