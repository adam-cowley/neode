---
'neode': patch
---
`syncEdges()` verifies every target exists before detaching anything (a missing target now throws a `NeodeError` listing it and leaves existing edges intact), matches edges by elementId so driver Integer keys keep their edge properties and a same-key node of another label no longer counts as matched, anchors the detach on the from-node, and reports a truthful `attached` count (NTS-579)
