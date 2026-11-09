import { NeodeError } from '../../errors/index.js'

/**
A limit must be a positive integer. A limit of 0 (often a computed
`page * size`) silently becoming "no limit" is the most dangerous
direction a limit can fail in — every read path rejects it up front
(NTS-606), the same contract PaginateService applies.
*/
export function requireLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) {
    throw new NeodeError(`limit must be a positive integer, received ${String(limit)}`)
  }

  return limit
}
