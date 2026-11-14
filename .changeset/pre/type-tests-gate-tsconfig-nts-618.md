---
'neode': patch
---
Test tooling only, no library change: `pnpm test:types` now runs the gate's `tsc --noEmit` before vitest's typecheck runner, so a type test can no longer look green under vitest while the pre-push gate rejects it (NTS-618).
