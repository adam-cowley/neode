import { NeodeError } from './neode-error.js'

/**
Levenshtein edit distance between two strings (small DP — candidate lists
are schema-sized, no early exit needed).
*/
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current: number[] = []

  for (let row = 1; row <= a.length; row++) {
    current = [row]

    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      )
    }

    previous = current
  }

  return previous[b.length] ?? 0
}

/**
The closest candidate within edit distance 2 of the input (case folding
counts as distance 0 — a case typo still suggests), or undefined when
nothing is close enough. Never suggests for very short inputs.
*/
export function suggestionFor(input: string, candidates: string[]): string | undefined {
  const folded = input.toLowerCase()

  let best: { candidate: string; distance: number } | undefined

  for (const candidate of candidates) {
    const distance = editDistance(folded, candidate.toLowerCase())

    if (best === undefined || distance < best.distance) {
      best = { candidate, distance }
    }
  }

  return best !== undefined && best.distance <= 2 && best.distance <= folded.length
    ? best.candidate
    : undefined
}

/**
The house-rule error for a property name the model does not declare
(NTS-442): what failed (the unknown key), where (the model), why (no such
property, with a did-you-mean when one is close) and the fix — with every
defined property listed so the caller can pick without round-tripping.
*/
export function unknownPropertyError(
  modelName: string,
  key: string,
  definedProperties: string[],
): NeodeError {
  const suggestion = suggestionFor(key, definedProperties)

  // why: the guess when one is near, the miss otherwise
  const why =
    suggestion === undefined
      ? ' — no similar property is declared.'
      : ` — did you mean "${suggestion}"?`

  const declared =
    definedProperties.length > 0
      ? ` Defined properties: ${definedProperties.join(', ')}.`
      : ' The model declares no properties yet.'

  const fix =
    suggestion === undefined
      ? 'Use one of the defined properties, or declare it on the model.'
      : `Fix the spelling, or declare "${key}" on the model.`

  return new NeodeError(`Unknown property "${key}" on model "${modelName}"${why}${declared} ${fix}`)
}
