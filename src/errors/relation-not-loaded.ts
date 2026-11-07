import { NeodeError } from './neode-error.js'

/**
Raised when strict relation access is on (setStrictRelationAccess) and a
relationship property the load spec did not request is read off a hydrated
entity (NTS-155). The message names the exact fix: request the relation in
the load spec (`with`) or load it on the instance.
*/
export class RelationNotLoadedError extends NeodeError {
  constructor(modelName: string, relationshipKey: string, options?: ErrorOptions) {
    super(
      `${modelName}.${relationshipKey} was not loaded. ` +
        `Use find(${modelName}, id, { with: { ${relationshipKey}: true } }) or ` +
        `instance.load('${relationshipKey}').`,
      options,
    )

    this.name = 'RelationNotLoadedError'
  }
}
