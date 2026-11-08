/**
Deprecation runtime warnings (NTS-163): a deprecated API that is still
callable logs a warning naming its replacement, once per API per process —
a decorator fires at class-definition time, so per-hit warnings would spam
every model definition.
*/
const warned = new Set<string>()

export function warnDeprecated(api: string, replacement: string): void {
  if (warned.has(api)) {
    return
  }
  warned.add(api)
  console.warn(
    `[neode] DEPRECATED: ${api} — use ${replacement} instead. Check the docs for the version you have installed: this package is pre-1.0 and its API churns.`,
  )
}
