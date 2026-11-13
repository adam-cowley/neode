---
'neode': patch
---

neode-generate: omit reserved-key properties (labels / description / filters) from generated map schemas — defineModel() skips those keys when registering properties, so emitting them produced models where the property silently did not exist. The generator now leaves them out of schema.ts and reports a warning naming the model; the decorated-class output keeps every property (NTS-678).
