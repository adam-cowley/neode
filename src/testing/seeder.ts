import type { Neode } from '../neode.service.js'

/**
Base class for seeders (NTS-167): `runSeeders()` calls seed() once per
seeder, in order. Write idempotently inside seed() — `neode.mergeOn(model,
match, set)` or `neode.merge(model, properties)` MERGE on the node's merge
fields — so rerunning the runner updates instead of duplicating.
*/
export abstract class Seeder {
  abstract seed(neode: Neode): Promise<void>
}

/**
Run seeders in order against one Neode instance.
*/
export async function runSeeders(neode: Neode, seeders: Seeder[]): Promise<void> {
  for (const seeder of seeders) {
    await seeder.seed(neode)
  }
}
