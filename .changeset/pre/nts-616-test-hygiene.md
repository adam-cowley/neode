---
'neode': patch
---
Test hygiene only, no library change: the NTS-616 type-test asserted on a live promise (executing the stub at runtime); it now type-checks a never-called helper instead.
