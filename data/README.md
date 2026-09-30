# Data

`registry.json` is a copy of the World Model Registry, version 2, last verified 2026-09-29, taken from
https://rishsadh.com/world-model-registry/registry.json on 2026-09-30. `snapshot.json` records the
source, the dates and the SHA-256 of the copy, and a test fails if the two disagree.

The registry is maintained by Rish Sadh and published at https://github.com/rishsadh/world-model-registry.
Its data is licensed CC BY 4.0. Cite it as:

    Rish Sadh, "World Model Registry", version 2, 2026-09-29. https://rishsadh.com/world-model-registry. DOI 10.5281/zenodo.22653071. Data CC BY 4.0.

Every clause, figure and price in the file is quoted from a vendor's own page, with the date it was read.
This repo does not add to it, correct it or re-read the vendor pages. To correct an entry, open a pull
request on the registry repo, not here. To refresh the copy in this repo, run `node bin/cli.mjs update`.

`liveness.json` is this repo's own record. It says whether each source link in the registry answered on
the day `verify` ran. A live link does not mean the quoted text is still on the page.
