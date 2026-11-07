/**
Direction of a relationship pattern.

Accepts the legacy case-insensitive 'IN' / 'OUT' / 'BOTH' spellings
anywhere a direction is taken.
*/
export const Direction = {
  INCOMING: 'INCOMING',
  OUTGOING: 'OUTGOING',
  BOTH: 'BOTH',
} as const

export type Direction = (typeof Direction)[keyof typeof Direction]

/**
Normalise a direction given in any supported spelling to a Direction.
Unknown values fall back to BOTH (the most permissive direction),
matching neode's behaviour of never throwing on a bad direction.
*/
export function toDirection(value: string | undefined | null): Direction {
  if (value === undefined || value === null || value === '') {
    return Direction.BOTH
  }

  switch (value.toUpperCase()) {
    case Direction.INCOMING:
    case 'IN': {
      return Direction.INCOMING
    }

    case Direction.OUTGOING:
    case 'OUT': {
      return Direction.OUTGOING
    }

    default: {
      return Direction.BOTH
    }
  }
}
