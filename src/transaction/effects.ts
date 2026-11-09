/**
A side effect of a write (lifecycle event, afterSave/afterDelete observer)
that must only be observed once the transaction that produced it committed.
*/
export type CommitEffect = () => void | Promise<void>

/**
Buffer of commit-deferred effects (NTS-582). Effects queue while the
transaction is open; `flush()` runs them in order after a successful
commit, `discard()` drops them on rollback or before a retry attempt.
*/
export class EffectBuffer {
  private effects: CommitEffect[] = []

  defer(effect: CommitEffect): void {
    this.effects.push(effect)
  }

  discard(): void {
    this.effects = []
  }

  async flush(): Promise<void> {
    const pending = this.effects

    this.effects = []

    for (const effect of pending) {
      await effect()
    }
  }
}
