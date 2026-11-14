---
'neode': minor
---

generateModels(): emit `unique` / `index` / `exists` flags from installed constraints and indexes, name-guarded to the neode-managed `schemaObjectName(label, [key], type)` naming. The unique-constraint property now carries `unique: true` alongside `primary: true`, neode-named range indexes emit `index: true`, and on Enterprise a neode-named EXISTS constraint emits `exists: true` — so a fresh database bootstrapped from generated models keeps the source graph's constraints and `merge()` races stay guarded. Hand-named constraints and indexes emit nothing (re-declaring them under neode's name would create a second constraint over the same label+property and fail at apply time), and the introspected-database round-trip stays drift-free (NTS-681).
