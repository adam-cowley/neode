---

name: neode-model
description: Interactive walkthrough for designing and creating neode models — discuss the domain, propose entities, properties and relationships, suggest decorators and conventions, then write the model code. Use when the user wants to create a new neode model, "model this in neode", design a graph schema, add a node or relationship entity, or asks what properties/decorators a model needs.
---

# Create a neode model

Walk the user from "I have an idea" to a working model file in four steps. Talk at each step — this is a conversation, not a code dump. Don't write any model code until step 3.

**Ground truth first.** neode is pre-1.0 and its API churns — never model from training data. Before proposing syntax, read the canonical docs shipped next to this skill: `../../docs/agent/model-definition.md` (decorators + map API) and `../../docs/agent/schema-reference.md` (every property field). In the repo these are `docs/agent/`; in an installed package, `node_modules/neode/docs/agent/`. If they are missing, fall back to the generated quick reference at `../neode/SKILL.md`.

**House rule (NTS-583):** new models are decorated classes — `@NodeEntity()` + field decorators, standard TC39 only (never `experimentalDecorators`, `emitDecoratorMetadata` or `reflect-metadata`). Use the `defineModel` map API only when the user asks for it, or decorators are impossible (runtime-built models, no TC39 toolchain).

## Step 1 — Understand the domain

Ask (skip what the user already answered):

1. **What is this model?** One entity, or a small cluster (e.g. "users who write posts with tags")?
2. **How do the pieces relate?** For each pair: which direction, one or many, does the relationship carry its own data (e.g. `since`, `rating`)?
3. **What will you query most?** Filters, lookups by a natural key (email, slug), full-text or vector search — these decide indexes and uniques.
4. **Lifecycle?** Soft delete? Concurrent writers? Created/updated stamps?

If the user's request is vague ("make a model for orders"), propose a first sketch from the request and confirm the 2–3 assumptions that matter most rather than interrogating them.

## Step 2 — Propose the model sketch

Present the design in plain language before code, per entity:

- **Label** — singular PascalCase class name; the node label is the class name unless `@NodeEntity({ labels: [...] })` says otherwise.
- **Properties** — name, type (`string`, `number`, `boolean`, `date`, `datetime`, `point`, `duration`, …), and what it's for.
- **Natural key** — which property identifies a node in the real world (drives `@Uuid({ primary: true })` vs `@Unique`).
- **Relationships** — key name, relationship TYPE (SCREAMING_SNAKE), direction, target, cardinality (one/many), edge properties if any.

Discuss the trade-offs out loud: direction (`out` reads naturally — "person ACTED_IN movie"), where a relationship should be declared (on which of the two models), when an edge needs its own `@RelationshipEntity`. Flag anything the user should decide: "orders to customers is one-to-many — should an order belong to exactly one customer, or is a merge into many allowed?"

If the design hits something neode can't express cleanly, note it now and see "File gaps and errors back to the library" — don't quietly hack around it.

## Step 3 — Suggest conventions, then write the code

Propose the sensible defaults from this list — say which you applied and why, in one line each. Anything not relevant, skip silently.

| Situation                  | Suggestion                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Every model                | `@Uuid({ primary: true })` id (or `@Property({ type: 'string', unique: true })` for a user-supplied key)               |
| Almost always              | `@CreatedAt` and `@UpdatedAt` stamps (stack `@DateTime()` on top only if you want a declared type)                     |
| Mandatory fields           | `@Required`                                                                                                            |
| Natural keys (email, slug) | `@Unique`                                                                                                              |
| Hot filter paths           | `@Index`                                                                                                               |
| Data that shouldn't vanish | `@SoftDelete` on the model (labels + `deletedAt`, reads filter automatically)                                          |
| Concurrent writers         | `@Version` for optimistic locking                                                                                      |
| Text or vector search      | `fulltext: true` on searched props; `@Vector` (with `dimensions` matching the embedding model) on embeddings           |
| Agent-facing models        | `description` on the model, every property and every relationship — it flows into `ontologyMarkdown()` for Text2Cypher |
| Relationship cardinality   | `cardinality: 'one'` when a second edge would be a bug (throws `CardinalityViolationError`)                            |
| Delete semantics           | `cascade: true` only on owned, child-only relations                                                                    |

Write the file with this shape (adjust imports to what's used):

```ts
import { CreatedAt, Direction, NodeEntity, OneToMany, Property, UpdatedAt, Uuid } from 'neode'

@NodeEntity({ description: 'A person who can write posts' })
class Person {
  @Uuid({ primary: true })
  id!: string

  @Property({ type: 'string', required: true, unique: true, description: 'Login email' })
  email!: string

  @CreatedAt()
  createdAt: unknown

  @UpdatedAt()
  updatedAt: unknown

  @OneToMany(() => Post, 'WROTE', Direction.OUTGOING)
  posts?: Post[]
}
```

(`Direction` comes from `neode` — the canonical spelling in the repo docs; `'out'` is also accepted.)

Rules while writing:

- Fields with no initializer need `!` (`name!: string`) — the OGM assigns them.
- Relationship decorators take the target explicitly (`() => Post`) — there is no design:type reflection.
- Relationship keys are field keys, not Cypher types: `relate(from, to, 'posts')` targets the `:WROTE` type.
- After writing the model, remind the user: run `installSchema()` once so constraints and indexes are created, and check the repo's own rules (`AGENTS.md` — tests required for every change).

## Step 4 — Verify and hand back

- If working inside the neode-ogm repo: follow its enforced rules (TC39 only, no `any`, tests, `pnpm lint && pnpm typecheck && pnpm test`) and add a changeset if user-visible.
- In an app repo: run the project's typecheck, and confirm the model appears in `ontologyMarkdown()` if the user uses the agent ontology API.
- Errors that look like library bugs (misleading message, docs/code mismatch, crash) go through the reporting step below; errors in the user's code just get fixed and explained.
- Close by asking if anything about the shape feels wrong — renaming a relationship or splitting a model later is cheap at this stage.

## Report gaps and errors back to the library

Three signals from a walkthrough get reported back to neode, not just remarked on:

1. **Scenario neode can't handle** — the domain needs something the library can't express or only expresses with hacks (missing property type, impossible relationship shape, unsupported edge properties). Title: `Modeling gap: <what couldn't be expressed>`.
2. **Boilerplate or friction the library could absorb** — every model re-declares the same id/timestamp scaffold, or the natural modeling needs a verbose workaround. Title: `DX: <the boilerplate or friction>`.
3. **Errors** — a typecheck/runtime error that looks like a library bug (misleading message, docs/code mismatch, crash). A mistake in the user's code just gets fixed.

How to report:

- **Linear first** — with the Linear MCP available, search the `NTS` team (`list_issues` with a query) for an existing issue; if one matches, comment on it instead of duplicating, otherwise `save_issue` on team `NTS` with the title pattern above. Without Linear access, fall back to GitHub: `gh issue list -R adam-cowley/neode --search "<keywords>"` then `gh issue create -R adam-cowley/neode`.
- Body: what the user was modeling, a minimal repro (model code, expected vs actual), and the suggestion. One finding per issue — three findings file three small issues, not one list. Only file what actually blocked or visibly slowed this task.
- Show the draft to the user and file after a quick yes (skip the yes only if they asked for silent filing).
- **Then open a PR when you can fix it**: with a neode-ogm checkout available and a small, high-confidence fix, branch `nts-<issue-number>-<slug>` from the default branch, implement (repo rules apply: TC39 only, tests, changeset, lint/typecheck/test green), and open a PR whose title or body references the Linear issue ID — the tracker links them automatically. Otherwise file the issue and move on.
