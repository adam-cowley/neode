---
'neode': patch
---

Driver result normalisation now converts the Integer fields inside temporal and spatial values (`Point.srid`, `Duration.seconds`, `Time.nanosecond`, …) to plain numbers, matching how property integers are treated. On Bolt backends a deserialised `Point` used to surface `srid: Integer{…}` to consumers while the embedded engine returned a number — reads of the same data produced different shapes per backend. Values carrying no Integer fields pass through with their reference untouched.
