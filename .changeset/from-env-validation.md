---
"neode": patch
---

`fromEnv` ignores non-numeric `NEO4J_*` numeric settings (with a warning) instead of passing `NaN` to the driver, and trims whitespace and empty entries in `NEO4J_TRUSTED_CERTIFICATES`.
