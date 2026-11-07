# Watch or Not — decorator API example

The same Watch or Not app as `examples/models`, expressed with neode-ogm's
**decorator API**: model classes with `@NodeEntity` / `@Property` /
`@OneToMany` instead of map definitions loaded from a directory.

## Running it

```bash
# from the neode-ogm repo root: build the library first
npm run build

# then in this folder
npm install
cp .env.example .env   # add your Neo4j credentials

npm run workflow       # the standalone workflow (works on an empty database)
npm start              # the Watch or Not web app on :3000
```

This folder is TypeScript: `npm run build` compiles with
`experimentalDecorators` + `emitDecoratorMetadata` (the canonical consumer
setup) into `dist/`, then the compiled JS runs against the library build at
`../../dist`.

## The shape of it

`models.ts` defines `Movie`, `Person`, `Actor`, `Director` and `Genre` as
decorated classes:

```ts
@NodeEntity({ labels: ['Movie', 'Person'] })
export class Director {
  @InternalId() _id!: string

  @Property({ type: 'string', index: true })
  name!: string

  @OneToMany(() => Movie, 'DIRECTED', Direction.OUTGOING)
  directed!: Movie[]
}
```

Things the decorator API makes you decide that the map API resolved for you:

- **Registration** — decorated classes self-register on import, so there is
  no `withDirectory()` / `.with()` step. Merge/find calls take the class:
  `neode.mergeOn(Movie, { title: 'Adulthood' }, { ... })`.
- **Ordering** — decorator factories run at class-decoration time, so a
  relationship's target class must exist first. The one unavoidable cycle
  (Movie's inverse `director` view of `DIRECTED`) is registered through the
  metamodel directly — see the bottom of `models.ts`.
- **Relationship properties** — character names are set through
  `actor.relateTo(movie, 'acts_in', { name: 'Sam' })` (the same as the map
  example; relationship properties are written, not validated).

## What changed from `examples/models`

|                  | models (map API)          | decorators (this app)               |
| ---------------- | ------------------------- | ----------------------------------- |
| Model definition | `models/*.js` map objects | `models.ts` decorated classes       |
| Registration     | `.withDirectory(...)`     | import the classes                  |
| Facade calls     | `neode.model('Movie')`    | the class itself                    |
| Compile step     | none (plain JS)           | `tsc` with `experimentalDecorators` |

Everything else — routes, views, the Cypher, the workflow — is the same app.
