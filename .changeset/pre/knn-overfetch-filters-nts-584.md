---
'neode': patch
---
kNN searches over-fetch past the index's top-k when named read filters apply, so soft-deleted or other-tenant neighbours no longer shrink results below k, and the filtered SEARCH-clause form now references the MATCH variable (it previously referenced the undefined `node` alias and always fell back to the procedure).
