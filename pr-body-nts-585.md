fix(schema): quote identifiers in labels, projections, cursor orderBy and DDL (NTS-585)

Follow-ups to the Cypher identifier injection fix in NTS-573 (https://linear.app/neo4j/issue/NTS-573), closing the remaining places where caller-controlled identifiers reached statements unescaped: https://linear.app/neo4j/issue/NTS-585

## What changed

1. **Node labels** (`src/query/match.ts`, `src/query/label-predicate.ts`, `labelPattern` in `src/services/query/bulk.service.ts`) were rendered raw into `MATCH (n:Label)`, `WHERE n:Label`, `ORDER BY n:Label` and bulk `CREATE`/`MERGE` patterns. All three emitting points now route through a new idempotent `quoteLabel` / `quoteLabels` helper in `src/query/quote.ts`:
   - plain identifiers keep their readable rendering (`Person` → `Person` — no existing statement changes),
   - already backtick-quoted labels pass through unchanged (`\`My Label\``stays`\`My Label\`` — double-quoting is impossible, asserted by tests),
   - anything else is escaped with backtick doubling (`My Label` → `` `My Label` ``, `X} DETACH DELETE x //` → quoted).
   - the colon-joined string form keeps working (`'A:B'` → two labels); a colon inside a quoted identifier is not a separator.
2. **Keyset cursor `orderBy`** (`src/services/query/paginate.service.ts`) was only checked against declared schema properties — declared-but-unsafe keys (hyphens, spaces) still broke the statement. The cursor comparison and `ORDER BY` now go through the shared `propertyReference`/`safeKey` helpers from NTS-573, as do the filter keys interpolated into the same hand-written statement. Undeclared keys are still rejected with the same error.
3. **`withinDistance()` `locationProperty`** (`src/services/query/within-distance.service.ts`) is escaped the same way in both the `point.distance(...)` predicate and the distance `ORDER BY`.
4. **Read-filter `node` alias rewrite** (`src/services/query/filters.ts`) used `\bnode\b` over the whole fragment, which also rewrote `x.node` property names, `$node` parameter names, `:node` labels and `'node'` string literals. The rewrite is now token-precise and syntactically aware (`rewriteFilterAlias`): whole-word `node` only, string literals and backtick identifiers copied verbatim, and a `node` preceded by `.` / `$` / `:` left alone.
5. **Projection `fields` / `expression`** (`src/projection/projection.ts`): field-subset names and projection entry keys are quoted with `safeKey` (NTS-573 approach), so `@RelatedOne({ fields: ['first-name'] })` and hyphenated projection keys no longer break. The `@Expression` value itself stays raw by design — it is the decorator's documented raw-Cypher escape hatch (NTS-138); only its projection key is escaped.
6. **DDL names** (`src/services/schema/schema-objects.ts`, `src/services/schema/drift.service.ts`): constraint / index names interpolated into `CREATE ... IF NOT EXISTS` / `DROP ... IF EXISTS` statements — including `object.name` straight from `SHOW` output in the drift drop paths — are quoted with `safeKey` (plain generated names keep their readable rendering, matching the existing test expectations; hostile names from a shared database are escaped). This matches the wipe path, which already backtick-quoted these names.

## Testing

- New unit suite `test/unit/identifier-escaping-nts-585.test.ts` (17 tests) covering every item: helper idempotency, hostile-label escaping through `match()` / `create()` / `merge()` / `whereLabel` / `orderByLabel` / bulk `labelPattern`, cursor `orderBy` with a hyphenated declared key (and rejection of undeclared keys), `withinDistance()` location escaping, the precise `node` rewrite (properties, params, labels, literals, word boundaries), projection keys/fields, and DDL/drift statement quoting.
- All existing unit suites pass unchanged — no emitted Cypher changed for previously-valid inputs.
- Full gate: `pnpm lint && pnpm typecheck && pnpm test` (174 files, 1789 passed) plus `pnpm build` in the pre-push hook.
