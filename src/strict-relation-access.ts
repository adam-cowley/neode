/**
Strict relation access (NTS-155): when enabled, reading a relationship
property that the load spec did not request off a hydrated entity throws
RelationNotLoadedError instead of returning undefined.

Module-level on purpose — hydration never sees the Neode instance (the
same limit that gives the entity instance methods their default-Neode
holder). shortcut: last-writer-wins across every instance in the process;
a per-instance switch needs the flag threaded through hydration.
*/
const holder: { isStrict: boolean } = { isStrict: false }

/**
Enable or disable strict relation access. Off by default: neode-style code
relies on reading an unloaded relationship as `undefined` — flip it on
once every relationship you read is in the load spec (or eager).
*/
export function setStrictRelationAccess(isStrict: boolean): void {
  holder.isStrict = isStrict
}

export function isStrictRelationAccess(): boolean {
  return holder.isStrict
}
