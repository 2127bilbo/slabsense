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
| `python -m tagdataset download` | Upload all expected files for every fetched cert. `--retry-missing data/missing.parquet` re-does a verify list. `--include-gone` also retries files previously recorded as unavailable upstream (HTTP 403/404); without it those names are skipped. |
| `python -m tagdataset verify` | Print completeness per grade, write retryable gaps to `data/missing.parquet`, exit 1 only if retryable gaps remain. Files upstream does not have (HTTP 403/404) are reported separately as an `unavailable upstream: N files across M certs` line and never fail the exit code. `--check-bucket` also lists the bucket. |

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

## Layout in the bucket

`tag-dataset/{cert}/` → `front.jpg back.jpg sfx_front.jpg sfx_back.jpg sfx_front_annotated.jpg sfx_back_annotated.jpg corner_{F,B}{TL,TR,BL,BR}.png edge_{F,B}{T,B,L,R}.png ding_{n}.jpg`

## Store

`data/raw.sqlite`: `raw` (verbatim detail/score JSON per cert, HTTP status), `files` (every uploaded object with size and sha256), `failures` (what gave up and why). A `failures` row with `kind='download'` and reason `HTTP 403` or `HTTP 404` means upstream does not have that file — it is not retried automatically; `download` skips it (see `--include-gone`) and `verify` reports it as `unavailable_upstream` instead of a retryable gap.
