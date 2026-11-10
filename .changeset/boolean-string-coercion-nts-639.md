---
'neode': patch
---
Boolean properties now coerce string forms through value conversion (NTS-639): `'true'`/`'false'` (trimmed, case-insensitive) convert to booleans — the last file-importable scalar that didn't absorb its string form (`'30'` → 30, ISO strings → temporals). Unparseable forms (`'yes'`, `1`) pass through untouched for validation to report, so error shapes on validate-first paths (create, createMany) are unchanged.
