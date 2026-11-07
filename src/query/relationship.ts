import { Direction, toDirection } from './direction.js'

export class Relationship {
  private readonly direction: Direction
  private readonly type: string | string[] | undefined
  private readonly alias: string | undefined
  private readonly traversals: number | string | undefined

  constructor(
    type: string | string[] | undefined,
    direction: string | undefined,
    alias?: string,
    traversals?: number | string,
  ) {
    this.type = type
    this.alias = alias
    this.traversals = traversals
    this.direction = toDirection(direction)
  }

  toString(): string {
    const directionIn = this.direction === Direction.INCOMING ? '<' : ''
    const directionOut = this.direction === Direction.OUTGOING ? '>' : ''
    const alias = this.alias ?? ''

    let type: string = Array.isArray(this.type) ? this.type.join('`|`') : (this.type ?? '')

    if (type !== '') {
      type = `:\`${type}\``
    }

    const traversals = this.traversals === undefined ? '' : `*${String(this.traversals)}`

    const hasContents = type !== '' || alias !== '' || this.traversals !== undefined

    const pattern = hasContents ? `[${alias}${type}${traversals}]` : ''

    return `${directionIn}-${pattern}-${directionOut}`
  }
}
