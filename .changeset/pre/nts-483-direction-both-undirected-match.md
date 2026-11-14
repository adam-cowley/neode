---
'neode': minor
---
Direction BOTH is now an undirected match: relationship patterns render `-[:TYPE]-` (no arrows), matching relationships of the type in either direction. Write paths (relate, create, save) reject BOTH with a descriptive error — undirected relationships are match-only, since Neo4j cannot create one; set direction OUTGOING or INCOMING to write (NTS-483).
