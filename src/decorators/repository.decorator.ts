import type { Newable } from '../meta/newable.js'
import { registerRepository, type RepositoryConstructor } from '../meta/repositories.js'

/**
Register a custom Repository subclass for an entity (TypeORM parity):

  @EntityRepository(Person)
  class PeopleRepository extends Repository<Person> { ... }

The constructor is stored and instances are created with
(neode, entity, database?) when the repository is resolved.
*/
export function EntityRepository(
  entity: Newable | undefined,
): (repository: RepositoryConstructor, context: ClassDecoratorContext) => void {
  if (entity === undefined) {
    throw new Error('@EntityRepository requires an entity class to link the repository to')
  }

  return function (repository: RepositoryConstructor): void {
    registerRepository(entity, repository)
  }
}
