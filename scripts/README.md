# scripts/

Tooling that is not part of the shipped app. Every entry has an `npm run` alias where it is run
regularly; the rest document their own usage in the file header.

| Folder | What | Entry points |
|---|---|---|
| `card-db/` | The bucket-served card database: initial build, weekly incremental update, shard repair | `npm run cards:update`, `npm run cards:build-initial`; weekly job in `.github/workflows/card-db-update.yml` |
| `harness/` | Accuracy harnesses against TAG-graded cards: software grade, on-device models, paid path, identification, CLIP runtime parity | `npm run harness`, `npm run harness:identify`; others per file header |
| `legal/` | Renders `docs/legal/*.md` to the public pages; ownership headers; third-party NOTICE | `node scripts/legal/build-legal.mjs`, `npm run headers`, `npm run headers:check`, `npm run notice` |
| `models/` | Upload ONNX models + manifest to the models bucket; card-val set export and labelling | `npm run models:upload`, `models:export-card-val`, `models:label-card-val` |
| `storage/` | Housekeeping of grade uploads in the `card-images` bucket | `npm run storage:cleanup` |
| `drivers/` | Headless browser drivers (Playwright / Chrome) for the slab studio, label renderer, cert page and auth flow; each prints PASS/FAIL | `npm run verify:label`; `node scripts/drivers/<name>.cjs` |
| `studio/` | One-off tooling behind the engraving studio (plate window measurement, vendored-library split) | per file header |
| `tools/` | Owner's data one-offs (TAG calibration analysis, graded-reference upload) | per file header |
| `tag-dataset/` | Python package that pulls the TAG dataset to R2 (its own README and tests) | `python -m tagdataset …` |
| `fixtures/` | JSON fixtures for the drivers | — |
| `unused/` | Retired experiments kept for reference; excluded from lint and headers | — |

Local data that scripts read lives outside the repo in `../SlabSense-data` (or `SLABSENSE_DATA_DIR`):
TAG reference photos, the 18 GB card image set, `card-hashes.json`.
