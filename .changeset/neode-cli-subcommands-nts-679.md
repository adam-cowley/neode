---
'neode': patch
---

The CLI is now a single `neode` bin with subcommands: `neode generate …` replaces the `neode-generate` bin with identical flags and behaviour. `neode` without arguments prints top-level usage, `neode help [command]` prints usage per command, and unknown commands exit 1 with the usage. Further subcommands slot into `src/bin/commands/` (NTS-679).
