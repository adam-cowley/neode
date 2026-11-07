/**
A reference to an entity class (constructor), e.g. `Person`.

Deliberately looser than TypeScript's `Newable`, which
demands every static Object method.
*/
export type Newable = new (...arguments_: never[]) => unknown
