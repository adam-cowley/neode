export class WhereRaw {
  private readonly statement: string

  constructor(statement: string) {
    this.statement = statement
  }

  toString(): string {
    return this.statement
  }
}
