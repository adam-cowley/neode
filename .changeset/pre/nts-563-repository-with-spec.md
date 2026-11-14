---
'neode': minor
---
feat(repository): with-spec eager loading at the Repository level (NTS-563)

`Repository` is now generic over the model constructor (closing the
NTS-154 ceiling): `neode.getRepository(Person)` keeps `typeof Person`, so
`find` / `findAll` check their `with` load spec against the model's
`neodeRelationships` phantom static — nested levels included, property
and unknown keys rejected at compile time (the Repository surface never
had the loose legacy overloads) — and the returns narrow:
`findAll({}, { with: { pets: { toys: true } } })` resolves to
`(Person & { pets: (Pet & { toys: Toy[] })[] })[]`. Runtime is the same
single-statement load-spec rendering the facade paths use, with order /
limit / skip / withoutFilters composing (NTS-162). Custom repositories
(`@EntityRepository`, plain `Repository<T>` annotations) keep the
fallback-tier spec. Findings: docs/decisions/0002-typing-eager-loads.md.
