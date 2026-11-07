/**
Base class of the typed error taxonomy (NTS-129). Typed errors are
produced by `classifyError`, which wraps the raw driver/engine error —
the original is preserved as `cause`.
*/
export class NeodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)

    this.name = 'NeodeError'
  }
}
