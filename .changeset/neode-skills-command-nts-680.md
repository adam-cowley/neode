---
'neode': patch
---

New `neode skills` CLI command: `neode skills add [<skill> ...] [--target <dir>]` installs the agent skills shipped with the package (`neode`, `neode-audit`, `neode-model`) into a project — by default both `.opencode/skill` and `.claude/skills`, idempotent on re-run — and `neode skills list` shows what is available versus installed (NTS-680).
