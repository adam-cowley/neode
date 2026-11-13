---
'neode': patch
---

withDirectory() (NTS-665): verified that a module default-exporting a decorated class cannot double-register — the scan refused it all along, but with a generic "did not export a schema definition" TypeError. The refusal is now a descriptive NeodeError naming the actual incompatibility and the fix (withDirectory() registers map-schema modules only; a decorated class self-registers on import, so import it explicitly), pinned by tests: the class case registers nothing under the file name, and a decorated model self-registering under its class name coexists with map modules loaded beside it. The api-reference's withDirectory row documents the restriction.
