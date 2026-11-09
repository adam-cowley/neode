/**
The sub-builder a load spec callback receives (NTS-560): the
comprehension / subquery-legal operations only — where, orderBy, limit,
skip. No return(), no writes, no statement segments. Property names are
bare ("orderDate") — the loader prefixes them with the related node's
variable. Every method returns the view for chaining.
*/
export interface RelationQuery {
  where(...arguments_: unknown[]): RelationQuery
  orderBy(...arguments_: unknown[]): RelationQuery
  limit(limit: number): RelationQuery
  skip(skip: number): RelationQuery
}

/**
One entry of a load spec (NTS-560): a callback decorating the relation's
read. `true` (a plain request) is also accepted at the `with` key.
*/
export type LoadSpec = (relation: RelationQuery) => void

/**
The `with` load spec on find / findAll / all (NTS-560): relationship key
-> request. Keys must name relationships declared on the model — unknown
keys are rejected at compile time when the model type is known and throw
a NeodeError at runtime.
*/
export type WithSpec<T> = {
  [K in keyof T]?: true | LoadSpec
}

/**
Options for the model reads that accept a load spec (NTS-560).
*/
export interface ReadOptions<T> {
  /**
  Per-relation eager load: request a non-eager relationship (`true`) and
  optionally decorate its read (order / limit / skip / where) — rendered
  into the same RETURN projection statement, hydrated entities included
  */
  with?: WithSpec<T>
  /**
  Per-call database override (find())
  */
  database?: string
  /**
  Named read filters to disable for this query (NTS-162) — each name is
  independent; `softDelete` names the built-in @SoftDelete filter.
  */
  withoutFilters?: string[]
}
