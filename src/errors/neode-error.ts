/**
Base class of the typed error taxonomy (NTS-129). Typed errors are
produced by `classifyError`, which wraps the raw driver/engine error —
the original is preserved as `cause`.

House rule (NTS-442): every error names what failed, where, why, and
suggests the fix — `<what failed> in <where> — <why>. <suggested fix>`.
Driver failures carry the failing statement with REDACTED parameters
(`redactParameters` — keys and shapes, never values).
*/
export class NeodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)

    this.name = 'NeodeError'
  }
}
