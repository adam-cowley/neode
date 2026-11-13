---
'neode': patch
---
Variable-length traversal hops now dedupe to distinct-node sets (`RETURN DISTINCT`, distinct counts), cap open-ended `*1..` ranges at the new `MAX_TRAVERSE_DEPTH` (overridable per traversal with `maxDepth()`), and apply the hop target's read filters to mid-path nodes.
