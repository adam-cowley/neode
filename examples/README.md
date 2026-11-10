# neode-ogm examples

Two ports of [adam-cowley/neode-example](https://github.com/adam-cowley/neode-example)
("Watch or Not"), one per definition API:

- **[`models/`](./models)** — the map-based schema API: `models/*.js` plain
  objects, loaded with `withDirectory()`. Plain JS, no compile step.
- **[`decorators/`](./decorators)** — the decorator API: `@NodeEntity` /
  `@Property` / `@OneToMany` model classes in TypeScript.

Both are the same app (same routes, views and Cypher); pick the folder whose
definition style matches yours. Build the library first (`npm run build` at
the repo root), then see each folder's README.

- **[`cookbook/`](./cookbook)** — one small self-contained script per
  capability (CRUD, relationships, eager loading and read models,
  validation, schema sync, full-text + vector search, runAll and
  transactions, multi-database, server startup). They import `neode` the
  way your app would, run against a dev database, and are compile-checked
  by the repo's `tsc --noEmit` so they can't drift from the API.
