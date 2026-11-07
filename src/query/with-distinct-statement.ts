export class WithDistinctStatement {
  private readonly variables: string[]

  constructor(variables: string[]) {
    this.variables = variables
  }

  toString(): string {
    return `WITH DISTINCT ${this.variables.join(', ')}`
  }
}
