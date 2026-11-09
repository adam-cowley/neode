---
'neode': patch
---
Stabilise offset pagination with an `elementId(this)` order tiebreaker, make cursor pagination exclude null keys deterministically instead of silently stopping, return eager relationships in cursor mode exactly as offset mode does, and reserve the filter names `cursor`, `cursorId` and `filter_*`.
