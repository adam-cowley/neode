---
'neode': patch
---

Fix the `prepare` script: it sat at the top level of package.json instead of under `scripts`, so it never ran and git-dependency installs shipped without `dist/`. It now runs `husky || true && tsdown` (the husky step is tolerated when absent). `watch` now runs `tsdown --watch`, and `Neode` is also exported by name (`import { Neode } from 'neode'`) alongside the default export.
