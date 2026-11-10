---
'neode': patch
---

@OneToMany accepts the config-object form (NTS-623):
`@OneToMany(() => Person, 'ACTED_IN', { direction: 'out', eager: true })` —
the shape the README documents and the other rich decorators
(@OneToOne, the projections) already use — instead of crashing at
relate() time with the config object stored as the direction. The
positional form is unchanged.
