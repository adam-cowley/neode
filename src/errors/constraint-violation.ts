import { NeodeError } from './neode-error.js'

/**
A unique-constraint violation, raised on `merge()`/`create()` flows that
race an existing node. `label`/`property` are parsed from the database
message when it names them (Neo4j does; the embedded Relate engine only
names the constraint), and stay undefined otherwise.
*/
export class ConstraintViolationError extends NeodeError {
  readonly label: string | undefined
  readonly property: string | undefined

  constructor(
    message: string,
    label: string | undefined,
    property: string | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options)

    this.label = label
    this.property = property
    this.name = 'ConstraintViolationError'
  }
}
