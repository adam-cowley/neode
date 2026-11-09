import type { Newable } from './newable.js'
import type { INeode } from '../neode.interface.js'
import { Repository } from '../repository/index.js'
import { NeodeError } from '../errors/index.js'

/**
A (custom) repository class, registered per entity. Instances are created
with (neode, entity, database?) at resolution time — never stored.
*/
export type RepositoryConstructor = new (
  neode: INeode,
  entity: Newable,
  database?: string,
) => Repository<unknown>

const repositories = new Map<Newable, RepositoryConstructor>()

function isRepositoryConstructor(value: unknown): value is RepositoryConstructor {
  return typeof value === 'function'
}

export function registerRepository(
  entity: Newable,
  repository: Repository<unknown> | RepositoryConstructor,
): void {
  // An instance is accepted for convenience: its constructor is stored
  if (isRepositoryConstructor(repository)) {
    repositories.set(entity, repository)

    return
  }

  const constructor: unknown = repository.constructor

  if (!isRepositoryConstructor(constructor)) {
    throw new NeodeError('Registered repository must be a class or a Repository instance')
  }

  repositories.set(entity, constructor)
}

export function getRepository(entity: Newable): RepositoryConstructor | undefined {
  return repositories.get(entity)
}

/**
Resolution point for repositories: the custom repository registered for
the entity (constructed with the given neode and entity), or the default
Repository. Generic over the model CONSTRUCTOR (NTS-563): the resolved
repository keeps the constructor type, so the `with` load spec of find /
findAll is map-checked and the returns narrow — a plain-annotated
`Repository<Entity>` keeps the fallback-tier spec.
*/
export function resolveRepository<C extends Newable>(
  neode: INeode,
  entity: C,
  database?: string,
): Repository<InstanceType<C>, C> {
  const Custom = repositories.get(entity)

  if (Custom === undefined) {
    return new Repository<InstanceType<C>, C>(neode, entity, database)
  }

  const repository: Repository<unknown> = new Custom(neode, entity, database)

  // The registry keys on the entity class, so the instance constructs this
  // Entity — the map cannot carry that correlation through its type
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the map erases the entity/repository generic correlation; the lookup above re-establishes it
  return repository as Repository<InstanceType<C>, C>
}
