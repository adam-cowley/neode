---
'neode': minor
---

Load spec — the `with` option on find / findAll / all (NTS-560): request a non-eager relationship in a specific read, with per-relation query control, in one statement. `neode.find(Customer, id, { with: { orders: (relation) => relation.orderBy('orderDate', 'DESC').limit(20) } })` returns the customer with exactly the newest-20 orders hydrated; `with: { orders: true }` loads them all. The relation callback receives a restricted view (`where` / `orderBy` / `limit` / `skip` — bare property names, no return/writes/segments); unknown keys are rejected at compile time when the model type is known and throw a NeodeError naming the model and key at runtime. Requested keys materialize as own properties through the regular eager hydration path, so they count as loaded for strict relation access (loaded-and-empty renders `[]`).

Deviation from the pattern-comprehension sketch: a decorated relation renders as a per-relation `CALL { WITH this MATCH (this)-[...]-(node) … WITH node ORDER BY … SKIP/LIMIT RETURN collect(node { projection }) AS <key>_loaded }` subquery collected into the same RETURN — pattern comprehensions cannot carry ORDER BY / LIMIT. One statement and hydrated entities, as contracted. Flat relations to node models only: a callback on a relationship-entity target throws. `Builder` gains `withSkip()` to complete the NTS-477 WITH-carried trim.
