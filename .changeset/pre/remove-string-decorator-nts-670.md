---
'neode': major
---

1.0 API sweep (NTS-670): the deprecated `@String` decorator is removed — declare string properties with `@Property({ type: 'string' })`. `@String` shadowed the global `String` type, which is why `@Property` was always the recommended form. The `setDeprecationWarnings()` export went with it: `@String` was the only deprecated surface left, so the NTS-163 warning machinery has nothing left to warn about. With this change no `@deprecated` surface ships in the stable major.
