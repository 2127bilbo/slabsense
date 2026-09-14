# Card database shards + identification bake-off — Design

**Date:** 2026-09-14
**Status:** approved in chat, spec for implementation planning
**Background:** identification review (this session, recorded below) and
`docs/SOFTWARE_GRADE_REVIEW_2026-09-13.md` for the harness conventions.

## 1. Why

Card identification is weak. Measured 2026-09-14 on 100 TAG studio photos with the app's exact
matcher logic: top-1 correct (name and number) 49/100, correct card anywhere in top 5 66/100,
84 labeled "high confidence" of which 37 were wrong, mean gap between first and second place
0.022, 8 top hits were digital-only TCG Pocket cards. Causes, in order of weight: the confidence
label uses absolute similarity while near-duplicates are the norm (median nearest-other-card
similarity inside the DB is 0.885); nothing reads the set number; 2,248 Pocket entries share
artwork with physical cards; the embedding DB was generated 2026-04-16 and ships as five 45 MB
JSON files inside the repo, so updating it means regenerating and redeploying, and every session
downloads 225 MB.

Two deliverables, in this order:

- **Part A** moves the embedding database into a versioned, sharded, incrementally updatable
  store in Supabase Storage with a weekly GitHub Actions job. No redeploy per update, ~22 MB
  download, no duplicates.
- **Part B** is an offline bake-off of three identification strategies on the 507 TAG photos.
  The winner is implemented in the browser; if the current strategy wins, nothing changes.

## 2. Non-goals

- No new embedding model. Part B re-ranks the existing CLIP model's candidates.
- No phone-photo evaluation; none exists in the repo (see the grading review, §6).
- No change to the pHash path (`src/lib/card-matcher.js`, `phash.js`); it is not imported by
  the app and is left as is.
- No change to how the AI grade paths extract card info.

## 3. Facts the design relies on (verified 2026-09-14)

- Embedding DB: `public/models/clip_embeddings_{0..4}.json`, model `Xenova/clip-vit-base-patch32`,
  512-dim, 21,899 ids, generated from `public/card-images/{set}/{number}.png` (18 GB on disk,
  161 sets) by `scripts/generate-transformers-embeddings.mjs`. Ids are TCGDex ids (`sv02-001`).
- Names: `public/card-hashes.json` (`cards[]` with `id, name, set, number`), read by
  `clip-matcher.js loadCardInfo()`.
- TCG Pocket ids match `/^[AB]\d/` (2,248 entries).
- TCGDex REST: `GET https://api.tcgdex.net/v2/en/sets` lists sets with `id, name, cardCount`;
  `GET /v2/en/sets/{id}` returns `cards[]` with `id, localId, name, image` (image base URL;
  append `/high.png` or `/low.webp`). Series prefix rules already live in
  `clip-matcher.js getSeriesFromSetId()`.
- Supabase: app reads `import.meta.env.VITE_SUPABASE_URL`; public bucket pattern is in
  `supabase/migrations/20260913_slab_images.sql` (insert into `storage.buckets`, public read
  policy, service role writes).
- `scripts/build-hash-db.cjs --update` already knows how to fetch new cards from TCGDex and
  download images; the update job reuses its fetch/download logic rather than that script itself.
- CLIP inference in node via `@xenova/transformers` with `env.cacheDir = models/transformers-cache`
  works (used by the generator and by the 2026-09-14 probe, ~70 ms per card on CPU).

## 4. Part A — sharded card database

### 4.1 Bucket and layout

Bucket `card-db` (public read, service role write), migration
`supabase/migrations/20260914_card_db_bucket.sql` following the slab-images pattern.

```
card-db/
  manifest.json
  shards/0001.f16          # float16 little-endian, N × 512
  shards/0001.meta.json    # { ids: [...], cards: { id: { name, set, number } } }  (same order as rows)
  shards/0002.f16 ...
```

`manifest.json`:

```json
{
  "version": 3,
  "model": "Xenova/clip-vit-base-patch32",
  "dim": 512,
  "count": 19651,
  "generated": "2026-09-14T...",
  "shards": [ { "id": "0001", "count": 4000, "bytes": 4096000, "sha256": "..." }, ... ],
  "sets": { "sv02": 279, "me02.5": 295, ... },
  "excludedSeries": ["tcgp"],
  "pending": [ { "id": "me03-012", "reason": "image 404", "since": "2026-09-14" } ]
}
```

Rules: a card id appears in exactly one shard; shards are append-only (a new update writes a new
shard, never rewrites an old one); `version` increments on every publish; `sets` is the
per-set count of ids present (so a diff against TCGDex is a count comparison per set before any
card list is fetched).

Float16 encoding is a plain function in `src/lib/f16.js` (encode for node, decode for browser;
no reliance on `Float16Array` availability).

### 4.2 Initial build — `scripts/card-db/build-initial.mjs`

Reads the five JSON chunks plus `card-hashes.json`, drops ids matching `/^[AB]\d/`, groups the
rest into shards of 4,000, writes `.f16` + `.meta.json` locally under `scripts/card-db/out/`
(gitignored), builds the manifest with `version: 3` (JSON chunks were version 2), and uploads
with the service key. No re-embedding. Prints the TCGDex set diff at the end (§4.4) so the gap
"which sets are missing today" is known immediately.

### 4.3 Client — `src/lib/clip-matcher.js`

`loadEmbeddings()` becomes:

1. `GET {VITE_SUPABASE_URL}/storage/v1/object/public/card-db/manifest.json` (no auth).
2. Compare `version` with the one stored in the browser Cache API under `card-db/manifest`.
   Shards present in the cache with a matching sha are reused; missing ones are fetched and
   cached. On a version bump only new shards are downloaded because old shards never change.
3. Decode into one `Float32Array(count × 512)` plus an `ids` array and a `cards` lookup, which
   replaces `loadCardInfo()` and the `card-hashes.json` fetch on this path.
4. `findMatches()` runs cosine similarity over the flat matrix with typed arrays (embeddings
   are already L2-normalized, so it is a dot product).

Fallback: if the manifest fetch fails or the bucket is missing, load the bundled JSON chunks as
today and log a warning. The bundled chunks are removed from the repo in a follow-up commit
once the bucket has served the app for one release.

`CardIdentifier.jsx` is unchanged. `identify-card.js` is unchanged.

### 4.4 Update job — `scripts/card-db/update.mjs`

```
1. Fetch manifest from the bucket.
2. Fetch TCGDex set list. For each set not in excludedSeries:
     if manifest.sets[set] === cardCount.total → skip
     else fetch the set's card list; new ids = ids not in any shard meta and not in pending-with-recent-retry
3. For each new id: download high.png to a temp dir (and to public/card-images/{set}/ when run
   locally with --save-images); 404 → pending entry; keep going.
4. Embed the downloaded images (same pipeline call as the generator, normalize: true).
5. Write shards/NNNN.f16 + .meta.json (NNNN = next number), upload, then upload the new manifest
   (version+1, sets updated, pending updated). Manifest is written last so a failed run leaves
   the previous version intact.
6. Print a summary: sets checked, new cards, pending count, shard id, new version.
```

Flags: `--dry-run` (diff only), `--set sv11` (one set), `--save-images`, `--retry-pending`.
Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Rate limits: sequential set fetches with a
250 ms gap; image downloads 4 at a time.

### 4.5 GitHub Actions — `.github/workflows/card-db-update.yml`

Weekly (`cron: '0 9 * * 1'`) plus `workflow_dispatch`. Steps: checkout, node 20, `npm ci`,
restore `models/transformers-cache` with `actions/cache`, run `node scripts/card-db/update.mjs`,
upload the summary as a job artifact. Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
The repo's 18 GB image folder is not needed in CI; the job downloads only new-card images.

### 4.6 Tests

- `src/lib/f16.test.js`: round-trip 1,000 random floats, max abs error < 1e-3; exact for 0, ±1.
- `scripts/card-db/build-initial.mjs --dry-run` prints counts: 21,899 in, 2,248 dropped, 19,651
  out, 5 shards.
- Node smoke: load manifest + shards from the bucket, search with one embedding taken from the
  old JSON, confirm the same top-1 id as the JSON path.
- Browser: identify a card with the network tab open; confirm manifest + shards download once
  and a reload serves shards from cache.

## 5. Part B — identification bake-off

### 5.1 Harness — `scripts/harness/identify.mjs`

Inputs: the 507 cached 1400-px TAG fronts; truth = `card_name`, `card_number` from the TAG
manifest (exported once to `scripts/harness/id-truth.json` by extending
`export_ground_truth.py` with a `--names` flag). The DB is loaded from the bucket shards
(Part A) so the bake-off runs on the same data the app will use.

For each card: compute the CLIP embedding once, take the top 20 by cosine, then apply each
variant to produce a ranked list and a status.

| Variant | Ranking | Status rule |
|---|---|---|
| A `current` | cosine order | high ≥ 0.85, medium ≥ 0.75, else unknown (today's rule) |
| A2 `margin` | cosine order | high if top ≥ 0.80 **and** (top − second) ≥ 0.03; medium if top ≥ 0.75; else unknown |
| B `ocr` | cosine + 0.15 if the OCR'd set number equals the candidate's `number` | as A2 |
| C `pixel` | cosine + 0.25 × NCC of the number/symbol strip against the candidate's reference image | as A2 |

OCR (variant B): tesseract.js in node on the bottom 9% of the crop, whitelist `0123456789/`,
regex `(\d{1,3})\s*/\s*(\d{1,3})`; if nothing matches, the variant degrades to A2.

Pixel comparison (variant C): both the crop and the candidate reference
(`public/card-images/{set}/{number}.png`) are resized to 500 × 700; the strip is the bottom 9%
of the height, full width; both strips are converted to luminance, locally contrast-normalized
(subtract 15 px box mean, divide by local std), and compared with normalized cross-correlation
allowing a ±6 px shift. Candidates whose reference image is missing on disk get NCC 0.

### 5.2 Metrics (per variant)

- `top1Exact`: name and number match, over all 507
- `top1ExactInDb`: same, over cards whose (name, number) exists in the DB meta
- `inTop5InDb`
- `wrongHigh`: status high and top-1 wrong
- `unknownButInDb`: status unknown while the card is in the DB (the honesty cost)
- ms per card
- coverage line: cards not in the DB at all, listed by set, which is also the update job's to-do

Output: `scripts/harness/results/<date>-identify.json` and `.md`, same conventions as the
grading harness. Name matching normalizes to lowercase alphanumerics; number matching strips
leading zeros and compares the part before `/`.

### 5.3 Decision rule

Winner = highest `top1ExactInDb` whose `wrongHigh` is ≤ variant A's. Ties go to the simpler
variant (A2 over B over C). The owner reads the results file and makes the call. Implementation
of the winner in `clip-matcher.js`:

- A2: change `getConfidence`/status to the margin rule. Nothing else.
- B: after `findMatches`, run tesseract.js (already a dependency, used by `ocr.js`) on the
  bottom strip of the crop in the browser, boost matching candidates, re-sort.
- C: after `findMatches`, fetch the 20 candidates' low-res TCGDex images
  (`assets.tcgdex.net/.../low.webp`, the same URLs the UI shows as thumbnails), compute NCC on
  the strip in a canvas, boost, re-sort. Cost: 20 small image fetches per identification.

Either way, identification outcomes start being logged: a `card_identifications` table
(scan-less: user id nullable, top-5 ids and scores, status, chosen id, timestamp) written from
`CardIdentifier.jsx` when the user confirms or picks. This is the data for any future
card-specific model and for measuring the change in production.

## 6. Files

New: `supabase/migrations/20260914_card_db_bucket.sql`, `src/lib/f16.js`, `src/lib/f16.test.js`,
`scripts/card-db/build-initial.mjs`, `scripts/card-db/update.mjs`, `scripts/card-db/tcgdex.mjs`
(shared fetch/download helpers), `.github/workflows/card-db-update.yml`,
`scripts/harness/identify.mjs`, `scripts/harness/id-truth.json`,
`scripts/harness/results/<date>-identify.*`, `supabase/migrations/20260914_card_identifications.sql`.

Modified: `src/lib/clip-matcher.js`, `src/components/CardIdentifier/CardIdentifier.jsx` (logging
only), `scripts/harness/export_ground_truth.py` (`--names`), `package.json` (scripts:
`cards:build-initial`, `cards:update`, `harness:identify`), `.gitignore` (`scripts/card-db/out/`),
`docs/SOFTWARE_GRADE_REVIEW_2026-09-13.md` (identification section added).

Follow-up commit after one release on the bucket: delete `public/models/clip_embeddings_*.json`
and the JSON fallback branch.

## 7. Sequencing

1. f16 codec + tests.
2. Bucket migration (owner applies it), initial build + upload, set-diff report.
3. Client loader on shards with JSON fallback; browser check.
4. Update job + workflow; first run manually with `--dry-run`, then for real on one set.
5. Bake-off harness, results, decision.
6. Winner implemented + identification logging; push.
