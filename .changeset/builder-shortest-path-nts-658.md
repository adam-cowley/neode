---
'neode': minor
---
Builder path patterns (NTS-658): `shortestPath(variable, from, to, { relationship?, direction?, degrees? })` renders `MATCH p = shortestPath((a)-[:TYPE]-(b))` legs for path-finding reads (the pinned multi-hop pattern stays expressible through match()/relationship()/to()/asPath()), and `expr` gains `nodes()`, `relationships()` and `type()` helpers so path variables project in RETURN (`[n IN expr.nodes('p') | n.name]`).
