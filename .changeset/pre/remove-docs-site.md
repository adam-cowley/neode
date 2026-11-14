---
'neode': patch
---

Remove the static docs-site generator (`pnpm docs:site`, `scripts/build-docs-site.ts`, the `marked` devDeps) — website code does not belong in the library repo. The markdown it rendered stays; docs sites live in their own repos.
