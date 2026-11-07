export class WithStatement {
  private readonly variables: string[]

  constructor(variables: string[]) {
    this.variables = variables
  }

  toString(): string {
    return `WITH ${this.variables.join(', ')}`
  }
}
