---
'neode': minor
---

REST API router generated from the model definitions, behind the
`neode/express` subpath: `app.use('/api', router(neode))` mounts
paginated list / get / create / update / delete for every registered
node model, with errors mapped onto HTTP statuses (422 validation,
409 constraint conflict and optimistic lock), equality filters and
ordering from query parameters, and a self-describing ontology index
at the router root. Express is an optional peer dependency — the core
package stays framework-free, and the handlers live framework-neutral
in `src/rest` for future framework subpaths.
