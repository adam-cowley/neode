/**
Validation error — port of neode's ValidationError.

Shape: a `details` array with one entry per failed check (Joi detail shape:
message, path, type), and the original `input` object. Unlike neode's
single-throw-per-check Joi call, all issues are collected (zod's
non-abortive checks ≙ Joi's abortEarly: false).
*/
export const ERROR_VALIDATION = 'ERROR_VALIDATION'

/**
One failed check, shaped like a Joi detail
*/
export interface ValidationDetail {
  message: string
  path: (string | number)[]
  type: string
}

export class ValidationError extends Error {
  readonly details: ValidationDetail[]
  readonly input: Record<string, unknown>

  /**
  The underlying zod error, for consumers that want the full issue list
  */
  readonly zodError: unknown

  constructor(details: ValidationDetail[], input: Record<string, unknown>, zodError?: unknown) {
    const keys = [
      ...new Set(details.map((detail) => detail.path[0]).filter((key) => key !== undefined)),
    ]

    // NTS-446: the message carries every failing property with its rule
    // and reason — not just the names — so an agent can fix all of them
    // in one pass. The structured list stays in `details`.
    const rendered = details
      .map(
        (detail) => `"${String(detail.path[0] ?? '<root>')}" (${detail.type}): ${detail.message}`,
      )
      .join('; ')

    super(
      keys.length > 0
        ? `Validation failed on ${String(keys.length)} propert${keys.length === 1 ? 'y' : 'ies'} — ` +
            `${rendered} [${ERROR_VALIDATION}]`
        : `${ERROR_VALIDATION}: ${rendered}`,
    )

    this.name = 'ValidationError'
    this.details = details
    this.input = input
    this.zodError = zodError
  }
}
