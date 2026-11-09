---
'neode': minor
---
Curate the public export set (NTS-600): the package root now exports exactly the documented API — the `Neode` facade, decorators, `Repository`, `Builder`, map-API config helpers, the typed error taxonomy and the functions the guides teach — while everything else (graph-type and model-generation machinery, load-spec plumbing, registry/service internals, never-documented option types) moves to an in-repo internal module and out of the type surface; the pre-1.0 type surface narrowed to the documented API. Runtime behaviour is unchanged.
