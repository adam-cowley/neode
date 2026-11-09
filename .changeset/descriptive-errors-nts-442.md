---
'neode': minor
---

Descriptive, fix-suggesting errors everywhere (NTS-442 — house rule): every error the library throws is a `NeodeError` naming what failed, where, why, and the suggested fix — unknown property/relationship keys suggest the closest declared name ("did you mean") and list the defined ones, connect failures carry the connection-config fix, unique violations name the fix (`merge()` or change the value), and all remaining bare `Error` throws are typed. Driver failures keep carrying the failing statement with REDACTED parameters (keys and shapes, never values).
