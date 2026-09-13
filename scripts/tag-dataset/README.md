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
| `python -m tagdataset fetch` | Detail + score for every cert in `data/certs.parquet` not yet in the store. `--retry-failures` re-attempts parked certs. |
| `python -m tagdataset download` | Upload all expected files for every fetched cert. `--retry-missing data/missing.parquet` re-does a verify list. |
| `python -m tagdataset verify` | Print completeness per grade, write `data/missing.parquet`, exit 1 if anything is missing. `--check-bucket` also lists the bucket. |

Config can point at a different prefix (e.g. `scratch/smoke`) to test without touching the real dataset.

## Layout in the bucket

`tag-dataset/{cert}/` → `front.jpg back.jpg sfx_front.jpg sfx_back.jpg sfx_front_annotated.jpg sfx_back_annotated.jpg corner_{F,B}{TL,TR,BL,BR}.png edge_{F,B}{T,B,L,R}.png ding_{n}.jpg`

## Store

`data/raw.sqlite`: `raw` (verbatim detail/score JSON per cert, HTTP status), `files` (every uploaded object with size and sha256), `failures` (what gave up and why).
