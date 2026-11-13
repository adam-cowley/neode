/**
Validation error — port of neode's ValidationError.

Shape: an `issues` array with one entry per failed check — neode's own
shape (path, rule, message; NTS-676: the rules are named in neode's
vocabulary, Zod stays an implementation detail) — and the original
`input` object. All issues are collected (≙ Joi's abortEarly: false).
*/
export const ERROR_VALIDATION = 'ERROR_VALIDATION'

/**
One failed check: `rule` is the neode rule name — `required`, `type` or
`format` for the base checks, otherwise the config rule that failed
(`email`, `min`, `valid`, …)
*/
export interface ValidationIssue {
  message: string
  path: (string | number)[]
  rule: string
}

export class ValidationError extends Error {
  readonly issues: ValidationIssue[]
  readonly input: Record<string, unknown>

  constructor(issues: ValidationIssue[], input: Record<string, unknown>) {
    const keys = [
      ...new Set(issues.map((issue) => issue.path[0]).filter((key) => key !== undefined)),
    ]

    // NTS-446: the message carries every failing property with its rule
    // and reason — not just the names — so an agent can fix all of them
    // in one pass. The structured list stays in `issues`.
    const rendered = issues
      .map((issue) => `"${String(issue.path[0] ?? '<root>')}" (${issue.rule}): ${issue.message}`)
      .join('; ')

    super(
      keys.length > 0
        ? `Validation failed on ${String(keys.length)} propert${keys.length === 1 ? 'y' : 'ies'} — ` +
            `${rendered} [${ERROR_VALIDATION}]`
        : `${ERROR_VALIDATION}: ${rendered}`,
    )

    this.name = 'ValidationError'
    this.issues = issues
    this.input = input
  }
}
