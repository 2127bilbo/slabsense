# TAG-trained grading models — design

**Date:** 2026-09-12
**Status:** approved in conversation, awaiting written review
**Scope:** build a labeled Pokémon card dataset from TAG Grading's public DIG reports, train specialized vision models for corners, edges, surface defects, and grade rollup, serve them from a hosted GPU inference API, and wire that into SlabSense as a new grade path. The vision LLM keeps card identification and report writing; it no longer decides the grade on this path.

## 1. Goals

1. A dataset of roughly 27,000 TAG-graded cards with every field and image TAG publishes per cert, stored in a cloud bucket with a single manifest, resumable to pull and verifiable for completeness.
2. Four independently measurable grading components, each with a fixed metric on a held-out test split reported per grade:
   - corners: predicted angle / fill / fray scores per corner
   - edges: predicted fill / fray scores per edge
   - surface: detected defect boxes with type and deduction
   - centering: measured border ratios (classic CV, validated against TAG)
   plus a rollup from subscores to TAG total and grade.
3. One inference endpoint returning JSON in the unified grading output schema (`GRADING_OUTPUT_SCHEMA.md`), callable from the existing Vercel API the same way Replicate is called today.
4. A phone-photo evaluation set from test users so the TAG-scan-to-phone gap is a measured number.

### Non-goals (this spec)

- A card-reading (OCR / identification) model. Planned extension; the schema's `cardInfo` block is already the slot for it.
- Fine-tuning a vision-language model end to end.
- Replacing the manual centering tool. Auto-centering is an additive option with manual override.
- Non-Pokémon or non-English cards. The existing `is_english` filter in the proxy stays the rule.
- On-device inference.

## 2. Decisions locked in conversation

| Question | Decision |
|---|---|
| Image storage | Backblaze B2 (S3-compatible API). Local disk holds only the manifest, SQLite raw store, and small samples. Chosen 2026-09-12 for ~$4/month storage at 650 GB and free egress up to 3x stored volume per month. |
| Serving | One Python inference service on a serverless GPU host. Modal first; RunPod Serverless or Replicate are drop-in alternatives. |
| Role in app | Models measure, LLM reads and explains. Trained models produce subscores and defects; existing `gradingEngine.js` and company offsets produce grades; Claude/Gemini identify the card and write the summary from the model output. |
| Dataset composition | Every cert at grade 5.5 and below plus all 10 PRISTINE (~15,000). Grades 6 through 10 capped at 1,500 each, stratified across eras (~12,000). |
| Model structure | Four separate small models plus a tabular rollup. No multi-task network. |
| Training venue | Rented GPU (A100 class) for full runs; the local RTX 4070 Super (12 GB) for smoke runs on samples. |

## 3. What TAG publishes per cert (verified 2026-09-12)

Two authenticated GET calls per cert, both AES-encrypted with the keys already in `scripts/Tag scraper/tag_proxy.py`:

- `/graded-cards/public/detail/{cert}` — card identity, grade, total score, 8 centering distance-to-edge values, `dingsJSON` (summary counts + ding list with side, type, location, x/y, width/height, crop URL), deskewed front/back URLs, slab image URLs, surface (raking light) image URLs, annotated surface image URLs, image width/height.
- `/graded-cards/public/score/{cert}?includeAnnotation=true` — rollup scores (centering, corners, edges, surface), size score, card dimensions in inches; per corner (8): angle / fill / fray scores, fill and fray pixel counts, measured angle, 550×550 PNG crop URL; per edge (8): fill / fray scores, pixel counts, strip PNG crop URL (~3300×550 or 550×5000); `surfaceFrontData` / `surfaceBackData` with `annotations.markers[]`, each marker carrying `typeName`, `top/left/width/height` in the annotated image's pixel space (`annotations.width/height`), `scoreDeduction`, `Source` (Manual / automatic), `location`.

The current scraper (`tag_scraper.py`, `flatten_card`) keeps roughly a third of this and discards every per-corner, per-edge, and marker field. The new pipeline stores both raw responses verbatim.

Grade availability in the browse cache (`tag_cache.json`, 353,877 certs): grades 1–5.5 total ~15,200; 10P = 218; 6 = 7,903; 6.5 = 6,607; 7 = 10,929; 7.5 = 13,121; 8 = 23,493; 8.5 = 40,474; 9 = 131,988; 10 = 102,428. Era split: 1999–2003 = 52k, 2004–2010 = 25k, 2011–2016 = 15k, 2017–2022 = 69k, 2023+ = 193k.

## 4. Architecture

```
tag_cache.json ──► sample ──► certs.parquet
                                 │
                         fetch (detail+score) ──► raw.sqlite  (verbatim JSON per cert)
                                 │
                         download (24 files/card) ──► bucket://tag-dataset/{cert}/...
                                 │                        │
                         verify ◄────────────────────────┘
                                 │
                         build ──► manifest.parquet, corners.parquet, edges.parquet,
                                    surface.parquet, splits.parquet
                                 │
        ┌──────────────┬─────────┴──────────┬──────────────┐
    train corners  train edges        train surface    fit rollup      (rented GPU)
        └──────────────┴────────┬───────────┴──────────────┘
                          weights/  ──► inference container (Modal)
                                              │
     Vercel api/deep-analyze ──► POST /grade ─┘ ──► gradingEngine.js ──► company grades
                                                     │
                                          Claude: identify card + write summary
```

## 5. Data acquisition — `scripts/tag-dataset/`

A Python package (Python 3.11, plain venv) with a single CLI entry point and a shared config file (bucket credentials, rate limit, paths). Every command is idempotent and resumable.

### 5.1 `sample`
- Input: `tag_cache.json`.
- Applies the composition rule in §2. For capped grades, allocate the 1,500 across the five eras proportionally to availability with a floor of 150 per era where available, then random within era with a fixed seed.
- Skips grade `VA` (variant/authentic only) and any cert already in `raw.sqlite`.
- Output: `certs.parquet` with columns `cert, grade_label, grade_num, era, year, brand, set, card_name, card_number, variation`.

### 5.2 `fetch`
- For each cert not yet in `raw.sqlite`: call detail then score, using the signing and decryption functions lifted from `tag_proxy.py` into `tagapi.py`.
- Store `detail_json`, `score_json`, `fetched_at`, `http_status`, `error` in table `raw(cert PRIMARY KEY, ...)`.
- Rate limit: configurable, default 4 requests/second total, worker pool of 8 with backoff on 429/5xx (1s, 4s, 16s, then park in `failures`).
- Certs returning 403 or 404 are recorded and never retried automatically.

### 5.3 `download`
- Reads `raw.sqlite`; for each cert computes the file list:
  `front.jpg, back.jpg, sfx_front.jpg, sfx_back.jpg, sfx_front_annotated.jpg, sfx_back_annotated.jpg, corner_{F,B}{TL,TR,BL,BR}.png (8), edge_{F,B}{T,B,L,R}.png (8), ding_{n}.jpg (per ding)`.
  Slab photos and 1×1 thumbnails are not downloaded.
- Uploads to `s3://<bucket>/tag-dataset/{cert}/{file}` via streaming (no full local copy). Concurrency 16, retries 3, then `failures`.
- Records each landed file in table `files(cert, name, url, bytes, sha256, uploaded_at)`.
- Expected volume: ~24 MB/card, ~650 GB total.

### 5.4 `verify`
- Recomputes the expected file list from `raw.sqlite`, compares to `files` and to a bucket `HEAD` per object, and writes `missing.parquet`. `download --retry-missing` consumes it.
- Prints per-grade completeness so the 62-missing-crops situation from the pilot is visible immediately.

### 5.5 Migration of the pilot
- The existing 507 certs are re-fetched through `fetch` (they are cheap) so the raw store is uniform. The old `training.json`, `results1.json`, and `dig info/` folders are left untouched.

## 6. Dataset build — `build` and `stats`

### 6.1 Outputs (all parquet, in `data/` locally and mirrored to the bucket)
- `manifest.parquet` — one row per card: cert, uuid, grade_label, grade_num (1–10; 10P encoded as 10 with `is_pristine=true`), era, year, brand, set, card_name, card_number, score_total, rollup_centering, rollup_corners, rollup_edges, rollup_surface, score_size, card_w_in, card_h_in, 8 centering DTE values, image_w, image_h, bucket paths for the 6 full images.
- `corners.parquet` — 8 rows per card: cert, side, corner, score_angle, score_fill, score_fray, fill_px, fray_px, angle_deg, crop_path.
- `edges.parquet` — 8 rows per card: cert, side, edge, score_fill, score_fray, fill_px, fray_px, crop_path.
- `surface.parquet` — one row per annotation marker: cert, side, marker_id, type_name, x, y, w, h (fractions of the annotated image, origin top-left), score_deduction, source, location. Dings from `dingsJSON` that have width/height and no matching marker are appended with `source="ding"`.
- `splits.parquet` — cert, split ∈ {train, val, test}; 80/10/10, stratified by (grade_label, era), assigned per card so all crops of a card share a split. Seeded. Test is written once and frozen.

### 6.2 `stats`
Prints: cards per grade per split, crops per split, marker count per type, files missing per grade, label ranges and nulls (e.g. back-corner angle scores are null on some certs), and the duplicate-cert check from the pilot.

## 7. Models — `training/`

Shared: PyTorch 2.x, `timm` backbones, AMP, data read directly from the bucket with a local disk cache, Weights & Biases or plain CSV logging, one `train_<task>.py` per model and one `eval_<task>.py` that writes a per-grade metrics table for the test split.

| Model | Architecture | Input | Output | Params / weights | Train VRAM | Metric |
|---|---|---|---|---|---|---|
| Corners | ConvNeXt-Tiny + 3-output head | 550² crop resized to 384, side flag | angle, fill, fray on 0–1000 | ~28M / ~110 MB | ~8 GB @ bs 32 | MAE per score, per grade |
| Edges | ConvNeXt-Tiny + 2-output head | strip resized to 1024×192 (rotated so long axis is horizontal) | fill, fray | ~28M / ~110 MB | ~8 GB | MAE per score |
| Surface | YOLOv8-m fine-tune | 1280 long side; trained on `sfx_*` images, `front/back` as augmentation | boxes + type + deduction (regression head on the box) | ~26M / ~52 MB | ~20 GB @ bs 8 | precision / recall / mAP50 by type; deduction MAE |
| Centering | classic CV (border + art-frame detection) on deskewed image | full image | 4 DTE values per side → L/R and T/B ratios | none | none | MAE in px vs TAG DTE; ratio error |
| Rollup | LightGBM | subscores + defect summary | score_total and grade_label | < 1 MB | CPU | exact-grade acc, within-0.5 acc, vs `gradingEngine.js` on same inputs |

Training plan per model: smoke run on 500 cards locally, full run on rented A100, evaluation table, then freeze weights into `weights/<task>/<version>/`. Order: corners, edges, centering, surface, rollup. Rough full-run times on one A100: corners and edges 1–2 h each, surface 6–10 h, rollup < 1 min.

Surface type mapping to the engine's keys (`ENGINE_WIRING.md`): FrameMarker_ESW_CSW → EDGE or CORNER by location; Bend / Wrinkle / Crease → CREASE; Scratch → SCRATCH; Dent → DENT; Pit → PIT; Print line / ink → PRINT_DEFECT; Stain / water → STAIN; Tear / missing stock → TEAR; play wear / scuffing / other → PLAY_WEAR. The full mapping table is produced by `stats` from observed `typeName` values and committed as `training/type_map.json`.

## 8. Serving — `inference/`

- One container image: PyTorch, the four weight files, `type_map.json`, and the centering CV code. Built from `inference/Dockerfile`, deployed with `inference/modal_app.py`.
- `POST /grade` body: `{ front: <url|base64>, back: <url|base64|null>, cardType, options }`. Returns the unified schema blocks it owns: `centering` (`source: "auto"`), `defects` (items with `x, y, width, height` as % of card, `type`, `severity` bucketed from predicted deduction, `deduction`), `subgrades` (eight keys, 0–100 mapped from TAG 0–1000), `overall` from the rollup, `meta.modelVersions`. `cardInfo`, `summary`, and `companyGrades` are left null for the caller to fill.
- `POST /centering` returns only the centering block, for the manual tool's auto-fill.
- Auth: a shared secret header set in Vercel env. Target warm latency: ≤ 2 s front+back on an A10G/T4.

## 9. App integration

- `gradePath: "model"` added to the schema's enum. A new `api/model-grade.js` mirroring the shape of `api/deep-analyze-v2.js` calls `/grade`, passes the result through `gradeCard()` for company grades, then asks Claude for `cardInfo` and `summary` with the model output in the prompt. The LLM is not given a "grade this card" instruction on this path.
- Centering tool: an "Auto" button calls `/centering` and fills the four ratios; the user can still drag. `centering.source` records which was used.
- Scan record: `subgrades` JSON and `raw_score` are populated from the model path exactly as from the other paths.

## 10. Phone dataset

- `scripts/tag-dataset/export_phone.py`: pulls test users' `scans` rows with `front_image_path` / `back_image_path`, the manual centering JSON, and any `card_name/card_number` from Supabase (service role, read-only), and downloads the images from the `card-images` bucket into `s3://<bucket>/phone-dataset/{scan_id}/`.
- A hand-maintained `phone_pairs.csv` links `scan_id → cert` for cards the testers own that are also TAG graded. Those rows get TAG labels joined in.
- Use: (a) evaluation report "TAG scan vs phone photo" per model, (b) a short fine-tune pass with the phone rows added to train at higher weight, evaluated on a held-out phone subset.

## 11. Error handling and data hygiene

- Every stage writes to SQLite/parquet and never mutates raw responses; re-running any stage is safe.
- Failed certs and files are tracked in `failures` with reason; `verify` is the only path that re-queues.
- Nulls in TAG scores (observed: back-corner angle) are kept as null and masked in the loss, not imputed.
- Duplicate certs are impossible by primary key.
- `test` split is never read by any `train_*.py`; enforced by the loader refusing `split == "test"` unless `--final-eval` is set.

## 12. Testing

- Unit: `sample` composition rule on a synthetic cache; `tagapi` decrypt against a recorded fixture; `build` coordinate conversion (marker px → card fraction) against a hand-checked cert; splits stratification and per-card integrity.
- Integration: end-to-end on 20 certs into a scratch bucket prefix; `verify` must report zero missing.
- Model: each `eval_*.py` produces a per-grade table; a run is accepted only if it beats the previous version on the frozen test split.
- App: `gradingEngine.test.js` must still pass; a fixture response from `/grade` runs through the model path and produces a schema-valid report.

## 13. Sequencing

1. Data acquisition package + pilot re-fetch (this spec's first implementation plan).
2. Dataset build, stats, splits.
3. Corners and edges training and evaluation.
4. Centering CV and validation.
5. Surface detector.
6. Rollup and comparison against the rule engine.
7. Inference service.
8. App integration.
9. Phone export, gap report, fine-tune pass.

Each step gets its own implementation plan under `docs/superpowers/plans/`.

## 14. Open items

- Bucket region: pick the B2 region closest to the GPU host when step 1 starts (US West or US East).
- TAG terms of use for bulk access: the user to check before step 1 runs at full scale; the pipeline's rate limit is set conservatively regardless.
