/**
A label predicate: `alias:Label` (several labels require all of them),
shared by `whereLabel` (`WHERE n:Completed`) and `orderByLabel`
(`ORDER BY n:Completed DESC`).
*/
import { quoteLabels } from './quote.js'

export class LabelPredicate {
  private negative = false
  private readonly alias: string
  private readonly labels: string | string[]

  constructor(alias: string, labels: string | string[], isNegative = false) {
    this.alias = alias
    this.labels = labels
    this.negative = isNegative
  }

  setNegative(): void {
    this.negative = true
  }

  toString(): string {
    const prefix = this.negative ? 'NOT ' : ''

    return `${prefix}${this.alias}:${quoteLabels(this.labels)}`
  }
}
