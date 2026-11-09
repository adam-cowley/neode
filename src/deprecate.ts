/**
Deprecation runtime warnings (NTS-163): a deprecated API that is still
callable logs a warning naming its replacement, once per API per process —
a decorator fires at class-definition time, so per-hit warnings would spam
every model definition.
*/
const warned = new Set<string>()

// Module-level like setStrictRelationAccess — deprecation warnings fire at
// class-definition time, outside any Neode instance, so the switch is
// process-wide by nature. shortcut: last-writer-wins across the process;
// there is no per-instance notion of "defining a model".
const holder = { silenced: false }

/**
Enable or disable the deprecation warnings (NTS-599). On by default —
pass `false` to silence them (e.g. in test output or CLIs that define
deprecated-decorator models); pass `true` to turn them back on. An API
whose warning was suppressed while silenced still warns once after
re-enabling — silence never consumes the warn-once slot.
*/
export function setDeprecationWarnings(isEnabled: boolean): void {
  holder.silenced = !isEnabled
}

export function warnDeprecated(api: string, replacement: string): void {
  if (holder.silenced || warned.has(api)) {
    return
  }
  warned.add(api)
  console.warn(
    `[neode] DEPRECATED: ${api} — use ${replacement} instead. Check the docs for the version you have installed: this package is pre-1.0 and its API churns.`,
  )
}
