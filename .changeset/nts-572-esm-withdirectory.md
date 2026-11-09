---
'neode': patch
---

Fixes `withDirectory()` throwing `ReferenceError: __filename is not defined` for ESM consumers (the `dist/index.mjs` build). It now resolves modules with `createRequire(import.meta.url)`; tsdown shims `import.meta.url` in the CJS build, so both formats work. The built ESM and CJS entry points, `fromEnv` export and `neode-generate` bin are now covered by dist-level package tests.
