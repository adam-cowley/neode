---
'neode': patch
---

Builder: `return()`-based helpers — `countSubquery()`, `collectSubquery()` and `return()` itself — now lazily open a statement segment, so they work on a fresh builder with no preceding `match()`/`statement()` call (e.g. a standalone `RETURN COUNT { MATCH … } AS found` probe) instead of throwing "Builder has no open statement".
