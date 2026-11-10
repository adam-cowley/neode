---
'neode': patch
---

docs: add `pnpm docs:site` — static docs site built from the existing markdown and `examples/cookbook` scripts (NTS-603). Each page ships as HTML plus a markdown copy for agents, with `llms.txt` / `llms-full.txt` at the site root. Output is gitignored under `docs-site/`.
