/**
A raw pattern fragment for a Statement's MATCH pattern (NTS-658): the
channel for pattern forms the Match / Relationship classes cannot render —
`shortestPath((a)-[:TYPE]-(b))`. The Builder composes the fragment from
Relationship renderings (types, directions and degrees keep their usual
quoting and validation); callers never hand it arbitrary text.
*/
export class PathPattern {
  private readonly pattern: string

  constructor(pattern: string) {
    this.pattern = pattern
  }

  toString(): string {
    return this.pattern
  }
}
