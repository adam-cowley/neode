# 0001 — Standard TC39 decorators; tsdown for the dual build

**Status:** accepted (Phase 3)

## Decision

1. **Standard (TC39) decorators only.** `experimentalDecorators`,
   `emitDecoratorMetadata`, `reflect-metadata` and the SWC Vitest transform
   are removed. Decorators compile natively under TypeScript 5.9+,
   esbuild/Vitest and tsdown/oxc.
2. **Build with tsdown** (ESM + CJS + dts, target ES2022). The spike test
   (`test/package/decorators.dist.test.ts`) imports the **built dist** in
   both module systems and round-trips a decorated model. tsdown works; the
   tsup fallback was not needed.
3. **Registration protocol:** field decorators no longer receive the class,
   so each decorator queues a registration closure into `context.metadata`
   (`src/decorators/registrations.ts`); the entity's class decorator
   (`@NodeEntity` / `@RelationshipEntity`) replays them with the real
   constructor. A lazy replay in `getModel`/`mergeModel` covers bare classes
   where the runtime attaches `Symbol.metadata` (tsc does; esbuild only after
   the class decorator returns — class decorators MUST read
   `context.metadata` directly, not the constructor).

## Consequences

- **`target` is required** on relationship decorators (`@OneToOne`,
  `@RelatedOne`, `@RelatedMany` without `fields`) — the `design:type`
  reflection is gone. Self-referential and swc-hidden property types no
  longer break, because there is no reflection to get them wrong.
- **Entities require a class decorator.** Bare classes with field decorators
  register lazily on first `getModel`/`mergeModel` (engines that attach the
  metadata), but the supported path is decorating the class.
- Decorated fields need definite assignment (`name!: string`) — esbuild
  erases initializer-less property declarations (and their decorators)
  entirely.
- No runtime dependency on `reflect-metadata`; the package no longer pulls
  it for consumers.

## Verified

- `test/package/decorators.dist.test.ts` — ESM + CJS dist, Node 24 (20/22
  covered by the Phase 6 CI matrix).
- Full suite green after the conversion (unit 720, integration 239).
