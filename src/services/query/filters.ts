import { AsyncLocalStorage } from 'node:async_hooks'
import type { Builder } from '../../query/index.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import { assertFilterName } from '../../meta/entity/entity-schema.js'
import { THIS_NODE } from '../../constants.js'
import { quote } from '../../query/quote.js'
import { NeodeError } from '../../errors/index.js'

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
Filter params live in two layers (NTS-575). The ALS scope opened by
`withFilterParams` is request-local and takes precedence; the process-wide
map written by `setFilterParams` is the fallback default.

shortcut: on the hand-written statements (keyset pagination) the param
names `cursor`, `cursorId` and `filter_<property>` are reserved — a filter
sharing one would overwrite the statement's own bindings.
*/
const filterParameters = new Map<string, unknown>()

const scopedFilterParameters = new AsyncLocalStorage<ReadonlyMap<string, unknown>>()

/**
Run the work with request-scoped filter params (NTS-575). Every read the
work performs — across awaits, and isolated from concurrent callers — sees
these values, which take precedence over `setFilterParams` defaults.
Scopes nest: an inner scope overrides the outer one name by name, and a
value of `undefined` hides the outer/default value inside the scope.

```ts
await withFilterParams({ tenant: req.tenantId }, async () => {
  await Article.all()
})
```

Needs a runtime with AsyncLocalStorage (Node.js), like ambient transactions.
*/
// eslint-disable-next-line unicorn/name-replacements -- withFilterParams pairs with setFilterParams (NTS-162 API name)
export async function withFilterParams<T>(
  values: Record<string, unknown>,
  work: () => Promise<T> | T,
): Promise<T> {
  const merged = new Map(scopedFilterParameters.getStore())

  for (const [name, value] of Object.entries(values)) {
    assertFilterName(name)
    merged.set(name, value)
  }

  return scopedFilterParameters.run(merged, async () => work())
}

/**
The value a filter param resolves to right now: the ALS scope first (an
explicit `undefined` there means "unset"), then the process-wide default.
*/
function resolveFilterValue(name: string): unknown {
  const scoped = scopedFilterParameters.getStore()

  return scoped?.has(name) === true ? scoped.get(name) : filterParameters.get(name)
}

function isParameterReferenced(where: string | undefined, name: string): boolean {
  return where !== undefined && new RegExp(String.raw`\$${name}(?!\w)`).test(where)
}

/**
Set the process-wide DEFAULT for the parameter a named filter's `where`
references as `$name` (`setFilterParams('tenant', 'acme')` for
`where: 'node.tenantId = $tenant'`). Values are bound as query parameters —
they never render into the query text.

UNSAFE UNDER CONCURRENCY: the value is global to the process, so
`setFilterParams('tenant', t); await x; query` lets a concurrent request
overwrite it between the set and the read — a cross-tenant leak. Use it only
for genuinely process-wide values (single-tenant apps, scripts, tests); for
per-request values use `withFilterParams`, whose scope wins over this default.
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
Copy the string literal or backtick identifier starting at `start` (the
opening quote) verbatim, honouring backslash escapes in strings and
backtick doubling in identifiers. Stops after the matching closer, or at
the end of the fragment for an unterminated one.
*/
function copyVerbatim(source: string, start: number, closer: string): string {
  let out = source.charAt(start)
  let index = start + 1

  while (index < source.length) {
    const char = source.charAt(index)

    if (closer !== '`' && char === '\\') {
      out += char + source.charAt(index + 1)
      index += 2

      continue
    }

    if (closer === '`' && char === '`' && source.charAt(index + 1) === '`') {
      out += '``'
      index += 2

      continue
    }

    out += char
    index++

    if (char === closer) {
      return out
    }
  }

  return out
}

/**
Rewrite the documented `node` variable convention in a filter's where
fragment to the filtered node's actual alias (NTS-585). The rewrite is
precise: whole-token only (`anode` / `node2` never match), string literals
('…' / "…") and backtick identifiers are copied verbatim, and a `node`
preceded by `.` (a `x.node` property name), `$` (a `$node` parameter name)
or `:` (a `:node` label) is left alone.
*/
function rewriteFilterAlias(where: string, alias: string): string {
  let out = ''
  let index = 0

  while (index < where.length) {
    const char = where.charAt(index)

    if (['"', "'", '`'].includes(char)) {
      const literal = copyVerbatim(where, index, char)

      out += literal
      index += literal.length

      continue
    }

    // whole-word `node`, but not .node (property), $node (parameter) or
    // :node (label)
    const previous = index === 0 ? '' : where.charAt(index - 1)

    if (
      !['.', '$', ':'].includes(previous) &&
      !/\w/.test(previous) &&
      !/\w/.test(where.charAt(index + 4)) &&
      where.startsWith('node', index)
    ) {
      out += alias
      index += 4

      continue
    }

    out += char
    index++
  }

  return out
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
      // rewritten to the filtered node's actual variable here. Property
      // names (`x.node`), `$node` parameters, `:node` labels and string
      // literals are left alone (rewriteFilterAlias); values a filter
      // needs must still be passed as parameters, not literals.
      // The parens keep a top-level OR in the fragment from escaping the
      // AND-join.
      clauses.push(`(${rewriteFilterAlias(filter.where, alias)})`)
    }

    const value = resolveFilterValue(filter.name)

    if (value !== undefined) {
      parameters[filter.name] = value
    } else if (isParameterReferenced(filter.where, filter.name)) {
      // Fail closed (NTS-575): a tenant filter with no tenant must never
      // run — without the check the statement fails later with an opaque
      // driver error
      throw new NeodeError(
        `The filter '${filter.name}' references $${filter.name} but no value is set. Wrap the call in withFilterParams({ ${filter.name}: <value> }, async () => ...) (or call setFilterParams('${filter.name}', <value>) for a process-wide default), or disable the filter for this query with withoutFilters: ['${filter.name}'].`,
      )
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
