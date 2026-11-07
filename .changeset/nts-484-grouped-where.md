---

## 'neode': minor

Query Builder: new `whereGroup(callback)` builds a parenthesised group of where conditions, e.g. `(n.name = $x OR (n.age > $y AND n.age < $z))` — the shapes flat AND/OR connectors cannot express because AND binds tighter than OR (NTS-484).
