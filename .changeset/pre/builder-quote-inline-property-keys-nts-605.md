---
'neode': patch
---

Builder: backtick-quote non-identifier property keys in inline patterns and SET references (NTS-605). A property key such as `x}) RETURN n //` no longer breaks out of the `{ … }` pattern map (or a `n.key` SET target), and hyphenated keys render as valid Cypher — property values remain bound as parameters.
