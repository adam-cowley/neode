import type { Property } from './property.js'

export class Match {
  private readonly alias: string | undefined
  private readonly labels: string | string[] | false = false
  private readonly properties: Property[] = []

  constructor(
    alias?: string,
    labels: string | string[] | false = false,
    properties: Property[] = [],
  ) {
    this.alias = alias
    this.labels = labels
    this.properties = properties
  }

  toString(): string {
    const alias = this.alias ?? ''

    let label = ''

    if (Array.isArray(this.labels)) {
      label = this.labels.length > 0 ? `:${this.labels.join(':')}` : ''
    } else if (typeof this.labels === 'string' && this.labels.length > 0) {
      label = `:${this.labels}`
    }

    let properties = ''

    if (this.properties.length > 0) {
      properties = ` { ${this.properties.map((property) => property.toInlineString()).join(', ')} }`
    }

    return `(${alias}${label}${properties})`
  }
}
