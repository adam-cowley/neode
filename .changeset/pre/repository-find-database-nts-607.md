---
'neode': patch
---
`Repository.find(id, options)` keeps the repository's pinned database when options are passed (NTS-607): the options path previously forwarded the bag without merging the repository's database, so a repository constructed for a secondary database silently read the facade default as soon as any option (e.g. `withoutFilters`) was passed. An explicit `options.database` still wins.
