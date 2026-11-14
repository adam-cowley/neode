---
'neode': patch
---

Docs: every code snippet in docs/api-reference.md is now compiled in CI (NTS-648) — snippets that did not type-check against the real API were fixed (definite-assignment assertions, `Direction` constants in the traverse examples, annotated `ConnectionProvider`/`EntityMethods` signatures, a `ValidationError` narrowing in the validation example). `DetachResult` is now exported from the package root, as referenced by the documented `EntityMethods.detachFrom` signature.
