import { Direction, toDirection } from './direction.js'
import type { Property } from './property.js'

export class Relationship {
  private readonly direction: Direction
  private readonly type: string | string[] | undefined
  private readonly alias: string | undefined
  private readonly traversals: number | string | undefined
  private readonly properties: Property[]

  constructor(
    type: string | string[] | undefined,
    direction: string | undefined,
    alias?: string,
    traversals?: number | string,
    properties: Property[] = [],
  ) {
    this.type = type
    this.alias = alias
    this.traversals = traversals
    this.properties = properties
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

    let properties = ''

    if (this.properties.length > 0) {
      properties = ` { ${this.properties.map((property) => property.toInlineString()).join(', ')} }`
    }

    const hasContents =
      type !== '' || alias !== '' || this.traversals !== undefined || this.properties.length > 0

    const pattern = hasContents ? `[${alias}${type}${traversals}${properties}]` : ''

    return `${directionIn}-${pattern}-${directionOut}`
  }
}
