# tag-dataset

Pulls TAG Grading DIG reports and every per-card image into a Backblaze B2 bucket
for model training. Spec: `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md`.

## One-time setup

1. **B2 bucket.** In the Backblaze console create a private bucket (e.g. `slabsense-tag-dataset`).
   Open it and note the Endpoint (`s3.us-west-004.backblazeb2.com` or similar).
2. **Application key.** App Keys → Add a New Application Key, restricted to that bucket,
   Read and Write. Copy the keyID and applicationKey once; they are not shown again.
3. **Python.**
   ```powershell
   cd "scripts/tag-dataset"
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -e ".[dev]"
   ```
4. **Config.** `copy config.example.toml config.toml`, set `endpoint`, `region`, `name`.
5. **Secrets** (per PowerShell session, or set them as user environment variables):
   ```powershell
   $env:B2_KEY_ID  = "..."
   $env:B2_APP_KEY = "..."
   ```
6. `pytest` → all green.

## Commands

All run from `scripts/tag-dataset` with the venv active. Every command is safe to rerun; it skips work already recorded in `data/raw.sqlite`.

| Command | What it does |
|---|---|
| `python -m tagdataset sample --cache "../Tag scraper/tag_cache.json"` | Apply the composition rule to the browse cache → `data/certs.parquet`. Add `--certs-file list.txt` to use an explicit list instead. |
| `python -m tagdataset fetch` | Detail + score for every cert in `data/certs.parquet` not yet in the store, throttled to stay under TAG's rate limit. `--retry-failures` re-attempts parked certs, reading their grade keys from the same `data/certs.parquet`. |
| `python -m tagdataset download` | Upload all expected files for every fetched cert, throttled to stay under the image CDN's rate limit. `--retry-missing data/missing.parquet` re-does a verify list. `--include-gone` also retries files previously recorded as unavailable upstream (HTTP 403/404 with an AccessDenied/NoSuchKey body); without it those names are skipped. `--rate` overrides `config.toml`'s `[download] rate`. |
| `python -m tagdataset verify` | Print completeness per grade, write retryable gaps to `data/missing.parquet`, exit 1 only if retryable gaps remain. Files upstream does not have (HTTP 403/404) are reported separately as an `unavailable upstream: N files across M certs` line and never fail the exit code. `--check-bucket` also lists the bucket. |
| `python -m tagdataset build` | Write training tables to `data/dataset/`; splits are frozen across rebuilds. |
| `python -m tagdataset stats` (wired in a follow-up) | Print dataset health report. |

Config can point at a different prefix (e.g. `scratch/smoke`) to test without touching the real dataset.

## Rate limits

TAG's API rate-limits at roughly 20-25 requests per 5-minute sliding window per client, and
blocked (`429`) responses count toward that window. The default config (`rate = 0.0667`, one
request every 15 s, `workers = 2`) stays well under that. When a worker gets a `429` it trips a
shared cooldown (starting at 300 s, doubling on repeated trips up to a 900 s cap, and reset back
to 300 s on the next success) that pauses every worker — not just the one cert — so a run in
progress doesn't keep hammering TAG and extending the ban. The `throttled` count in the fetch
summary is how many `429` responses were absorbed this way; a cert throttled more than 20 times
is parked as a failure (`HTTP 429 x20`) instead of being retried forever. At the default rate a
507-cert run takes about 4 hours.

The image CDN (`cloudfront.net`) also rate-limits: a pilot run at 16 concurrent unthrottled
requests (~180 files/s) tripped a CloudFront block after about 750 files, after which every
request — including URLs that had just succeeded — came back HTTP 403 with an HTML block page.
A real missing object answers 403 with an XML body containing `<Code>AccessDenied</Code>` (or
`NoSuchKey</Code>`); `download` tells the two apart by body content (`download.classify_403`) so
a block does not get mislabeled as a permanently missing file. `download`'s default config
(`concurrency = 4`, `rate = 8.0` requests/second, shared across workers) stays under that limit.
A 429, or a 403 classified as a block, trips the same shared cooldown described above for fetch
(same `cooldown_start`/`cooldown_max`); the `throttled` count in the download summary is how many
were absorbed this way, and a file throttled more than 20 times is parked as a failure
(`HTTP 403 x20` or `HTTP 429 x20`, whichever it last saw) instead of being retried forever.

## Layout in the bucket

`tag-dataset/{cert}/` → `front.jpg back.jpg sfx_front.jpg sfx_back.jpg sfx_front_annotated.jpg sfx_back_annotated.jpg corner_{F,B}{TL,TR,BL,BR}.png edge_{F,B}{T,B,L,R}.png ding_{n}.jpg`

## Store

`data/raw.sqlite`: `raw` (verbatim detail/score JSON per cert, HTTP status), `files` (every uploaded object with size and sha256), `failures` (what gave up and why). A `failures` row with `kind='download'` and reason `HTTP 403` or `HTTP 404` means upstream does not have that file — it is not retried automatically; `download` skips it (see `--include-gone`) and `verify` reports it as `unavailable_upstream` instead of a retryable gap.

## Outputs

`build` writes six cert-keyed parquet files to `data/dataset/` (all geometry is expressed as canvas fractions, i.e. divided by the annotation canvas width/height, not raw pixels):

- `manifest.parquet` — one row per card: identity (`cert`, `uuid`), grade (`grade_label`, `grade_num`, `grade_alias`, `is_pristine`), card metadata (`era`, `year`, `brand`, `set_name`, `subset_name`, `card_name`, `card_number`), scores (`score_total`, the four `rollup_*` scores, `score_size`, `card_w_in`/`card_h_in`, `surface_front`/`surface_back`), centering (`dte_*` for each side/edge), canvas and annotation dimensions (`image_w`/`image_h`, `ann_front_w`/`ann_front_h`, `ann_back_w`/`ann_back_h`), counts (`n_dings`, `n_markers_front`, `n_markers_back`), bucket paths (`path_front`, `path_back`, `path_sfx_*`), and file completeness (`n_files_uploaded`, `n_files_unavailable`).
- `corners.parquet` — one row per card per corner (`cert`, `side`, `corner`): `score_angle`, `score_fill`, `score_fray`, `fill_px`, `fray_px`, `angle_deg`, `crop_path`.
- `edges.parquet` — one row per card per edge (`cert`, `side`, `edge`): `score_fill`, `score_fray`, `fill_px`, `fray_px`, `crop_path`.
- `surface.parquet` — one row per surface marker (`cert`, `side`, `marker_id`): type (`type_name`, `subtype_name`, `family`, `engine_type`, an `is_rollup` flag for rollup-only markers), geometry as canvas fractions (`x`, `y`, `w`, `h`, plus raw-fraction endpoints `x1`/`y1`/`x2`/`y2` and `rotation_deg` where the source gave a line), and scoring (`deduction`, `deduction_raw`, `deduction_override`, `area`, `depth`, `white_scale`).
- `dings.parquet` — one row per ding, kept separate from `surface.parquet` since dings come from the detail record's `dingsJSON` rather than the score record's annotations: `cert`, `side`, `ordering`, `type_name`, `engine_type`, `location`, pixel geometry (`px_x`, `px_y`, `px_w`, `px_h`) and the same geometry as canvas fractions (`x`, `y`, `w`, `h`), plus `crop_path`.
- `splits.parquet` — one row per card (`cert`, `split`, `stratum`, `assigned_at`); frozen across rebuilds so a card's split never changes once assigned.
