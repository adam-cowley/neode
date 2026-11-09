---
'neode': patch
---
@Version can no longer be bypassed (NTS-580): an untracked `save()` (DTO) carrying a version now guards on it and conflicts when stale, instead of writing the instance value back over the bump; the guard runs after validation / derived / embeddings so a failed save never leaves the version bumped; `repository.patch` rejects the primary key, version, @CreatedAt, readonly and protected properties with a fix-suggesting error; `mergeMany` no longer lets a row override a matched node's version, createdAt, readonly or protected values (create-only); `increment` stamps @UpdatedAt and bumps @Version. Not done: `increment` does not recompute @Derived properties that use the counter as a source, and the version check remains a separate statement ahead of the MERGE.
