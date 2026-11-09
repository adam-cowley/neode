import type { Builder } from '../../query/index.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { assertFilterName } from '../../meta/entity/entity-schema.js'
import { THIS_NODE } from '../../constants.js'
import { quote } from '../../query/quote.js'

/**
The reserved name of the built-in @SoftDelete read filter (NTS-162):
`withoutFilters: ['softDelete']` disables it per query, exactly like a
declared filter.
*/
export const SOFT_DELETE_FILTER = 'softDelete'

/**
The reserved withoutFilters entry that disables EVERY named filter for the
query — the write paths' internal re-hydration (save / create / merge use
FindByIdService to re-read the row they just wrote) must find rows the
current filter view hides. Filters are a read policy; writes never read
through them.
*/
export const WITHOUT_ALL_FILTERS = '*'

/**
Per-query filter options, accepted by every filtered read (NTS-162):

- `withoutFilters` — disable named filters for this query only; each name is
  independent (disabling one leaves the others active, EF named-filter model).
  `softDelete` names the built-in @SoftDelete filter.
- `includeDeleted` — the NTS-510 soft-delete opt back in (equivalent to
  withoutFilters: ['softDelete']).
*/
export interface ReadFilterOptions {
  withoutFilters?: string[] | undefined
  includeDeleted?: boolean | undefined
}

/**
Filter params are process-global, like the model registry: setFilterParams
binds a named value every parameterised filter reads at composition time.

shortcut: on the hand-written statements (keyset pagination) the param
names `cursor`, `cursorId` and `filter_<property>` are reserved — a filter
sharing one would overwrite the statement's own bindings.
*/
const filterParameters = new Map<string, unknown>()

/**
Set the parameter a named filter's `where` references as `$name`
(`setFilterParams('tenant', 'acme')` for `where: 'node.tenantId = $tenant'`).
Values are bound as query parameters — they never render into the query text.
*/
// eslint-disable-next-line unicorn/name-replacements -- setFilterParams is the NTS-162 API name (Linear issue), matching the TypeORM-style surface
export function setFilterParams(name: string, value: unknown): void {
  assertFilterName(name)

  if (value === undefined) {
    filterParameters.delete(name)
  } else {
    filterParameters.set(name, value)
  }
}

/**
Clear every filter param (test hygiene — the store is global).
*/
// eslint-disable-next-line unicorn/name-replacements -- clearFilterParams pairs with setFilterParams
export function clearFilterParams(): void {
  filterParameters.clear()
}

/**
The named read filters active for one query, soft delete included as the
reserved `softDelete` filter (NTS-510 label check — labels-as-state,
NTS-128: a soft-deleted node carries the swapped label, so excluding it is
a label predicate, never a property comparison).

`alias` is the variable the filtered node is bound to in the statement being
composed — the read root (`this`) or the related node inside a comprehension.
*/
export function readFilterClauses(
  schema: EntitySchema,
  alias: string,
  options: ReadFilterOptions = {},
): { clauses: string[]; parameters: Record<string, unknown> } {
  const without = new Set(options.withoutFilters)

  if (without.has(WITHOUT_ALL_FILTERS)) {
    return { clauses: [], parameters: {} }
  }

  if (options.includeDeleted === true) {
    without.add(SOFT_DELETE_FILTER)
  }

  const clauses: string[] = []
  const parameters: Record<string, unknown> = {}

  const softDelete = schema.getSoftDelete()

  if (softDelete !== undefined && !without.has(SOFT_DELETE_FILTER)) {
    clauses.push(`NOT ${alias}:${quote(softDelete.label)}`)
  }

  for (const filter of schema.getFilters()) {
    if (filter.default === false || without.has(filter.name)) {
      continue
    }

    if (filter.where !== undefined && filter.where !== '') {
      // `node` is the documented variable convention of a filter's where —
      // rewritten to the filtered node's actual variable here. Values in
      // string literals would be rewritten too: pass them as parameters.
      // The replacer function keeps `$` in the alias out of replacement
      // pattern semantics; the parens keep a top-level OR in the fragment
      // from escaping the AND-join.
      clauses.push(`(${filter.where.replaceAll(/\bnode\b/g, () => alias)})`)
    }

    if (filterParameters.has(filter.name)) {
      parameters[filter.name] = filterParameters.get(filter.name)
    }
  }

  return { clauses, parameters }
}

/**
Apply the schema's named read filters to a builder (NTS-162) — THE one
composition point every read path shares: root reads (find / get / all /
paginate / search / knn / projections / repository reads) compose the root
alias, pattern comprehensions over relations compose the related node's
alias. Nothing else may hand-roll a filter predicate.
*/
export function applyReadFilters(
  builder: Builder,
  schema: EntitySchema,
  options: ReadFilterOptions = {},
  alias: string = THIS_NODE,
): void {
  const { clauses, parameters } = readFilterClauses(schema, alias, options)

  for (const clause of clauses) {
    builder.whereRaw(clause)
  }

  for (const [name, value] of Object.entries(parameters)) {
    builder.param(name, value)
  }
}

/**
The raw WHERE fragment for the read paths that write their statements by
hand (keyset pagination, full-text search, kNN): the active clauses joined
with AND, plus the parameters to merge into the statement's parameters.
*/
export function readFilterFragment(
  schema: EntitySchema,
  alias: string,
  options: ReadFilterOptions = {},
): { fragment: string | undefined; parameters: Record<string, unknown> } {
  const { clauses, parameters } = readFilterClauses(schema, alias, options)

  return { fragment: clauses.length > 0 ? clauses.join(' AND ') : undefined, parameters }
}
