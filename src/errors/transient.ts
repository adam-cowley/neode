import { NeodeError } from './neode-error.js'

/**
A transient failure (`Neo.TransientError.*` codes, or the driver's /
engine's own `retryable` verdict): retrying the operation may succeed.
`isRetryable` is baked in by the code classification — a TransientError is
only ever created for a retryable failure.
*/
export class TransientError extends NeodeError {
  readonly isRetryable = true
  readonly code: string | undefined

  constructor(message: string, code?: string, options?: ErrorOptions) {
    super(message, options)

    this.code = code
    this.name = 'TransientError'
  }
}
