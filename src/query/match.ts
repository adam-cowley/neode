import type { Property } from './property.js'
import { quoteLabels } from './quote.js'

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

    const labels: string | string[] =
      typeof this.labels === 'string' || Array.isArray(this.labels) ? this.labels : []

    const label = labels.length > 0 ? `:${quoteLabels(labels)}` : ''

    let properties = ''

    if (this.properties.length > 0) {
      properties = ` { ${this.properties.map((property) => property.toInlineString()).join(', ')} }`
    }

    return `(${alias}${label}${properties})`
  }
}
