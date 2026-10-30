# Third-Party Notices

## ipa-dict — General American (`en_US`)

- Project: `open-dict-data/ipa-dict`
- Pinned commit: `972cd67dd5f96bc5660e28070cde26e3928abcd7`
- Bundled file: `app/data/ipa/en_US.txt`
- SHA-256: `2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67`
- Local measurement: 125,927 rows and 125,927 unique case-normalized headwords.
- Repository license: MIT, copyright © 2016 dohliam; retained in `app/data/licenses/ipa-dict-LICENSE.txt`.
- Data lineage: the upstream credits state that English (US) is based on a modified `cmudict-ipa`, with stress markers added using `syllabify`.

## cmudict-ipa

- Project: `lingz/cmudict-ipa`
- Pinned reviewed commit: `629483e9a7fa5b9ff11bb83e3fda6dcc25c5c511`
- License: MIT, copyright © 2016 Lingliang Zhang; retained in `app/data/licenses/cmudict-ipa-LICENSE.txt`.
- Role: IPA conversion upstream of the bundled `ipa-dict` US English data; its data is not separately bundled.

## CMU Pronouncing Dictionary

- Project: `cmusphinx/cmudict`
- Pinned reviewed commit: `74790861f652b15e4ac49015a90074ad62a27690`
- License: Carnegie Mellon redistribution terms (BSD-style), copyright © 1993–2015 Carnegie Mellon University; retained verbatim in `app/data/licenses/CMUdict-LICENSE.txt`.
- Role: original North American pronunciation source in the attribution chain; its ARPAbet data is not separately bundled.

The licenses are not interchangeable: the two MIT notices and CMUdict's separate redistribution terms are retained independently. SceneLingo performs no network lookup or user-data upload when querying IPA.
