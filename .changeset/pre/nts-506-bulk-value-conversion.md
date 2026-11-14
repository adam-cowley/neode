---
'neode': patch
---

Fixes BulkService skipping the property-value conversion layer (NTS-506): `createMany`/`mergeMany` rows now run every declared property through the same `convertPropertyValue` pass the single-create path uses, so `@Point` objects (`{ latitude, longitude }` → driver Point, SRID 4326), `@Date`/`@DateTime`/`@Duration` values and the other typed conversions are value-identical between bulk and single writes. Previously bulk rows were validated but written raw, failing with `InvalidPropertyType` on typed properties.
