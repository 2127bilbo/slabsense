# TAG dataset pull — operator runbook

How the cards get pulled, what the limits are, and how to stop, restart, or recover without losing work. Read alongside `README.md` (setup and command reference).

## 1. What a pull actually does

Every card goes through four stages. Each stage records its progress in `data/raw.sqlite` as it goes, so any stage can be killed at any moment and re-run later; it picks up where it left off.

| Stage | Command | Talks to | What it records |
|---|---|---|---|
| Sample | `sample` | nothing (reads `tag_cache.json`) | `data/certs.parquet`: the list of certs to pull |
| Fetch | `fetch` | TAG API (2 requests per cert) | `raw` table: both API responses verbatim per cert |
| Download | `download` | TAG's image CDN → Backblaze B2 | `files` table: one row per uploaded image |
| Verify | `verify` | B2 listing (optional) | `data/missing.parquet`: anything retryable that is still missing |

Per card, TAG gives us: front, back, both raking-light surface images, both annotated surface images (when TAG generated them), 8 corner crops, 8 edge crops, and one crop per ding. About 22–27 files, roughly 24 MB.

## 2. The rate limit, measured 2026-09-13

TAG's API (`api.taggrading.com`) throttles per client IP.

| Fact | Value |
|---|---|
| Budget | about 20–25 requests per rolling 5 minutes |
| What happens over budget | HTTP 429 `{"message":"Too many requests"}` on every request |
| How long the block lasts | until the rolling 5-minute count drops under the budget, about 8 minutes if we go quiet; blocked requests still count, so hammering extends it |
| Safe sustained rate | 1 request every 15 seconds (40 for 40 over 10 minutes) |
| Cost per card | 2 requests, so about 2 cards per minute at best |
| Observed pace | about 1.4 cards per minute, because the occasional 429 still costs a 5-minute pause |

The image CDN (`cloudfront.net`) has shown no rate limit. Downloads run 16 at a time.

How the fetch runner behaves, from `config.toml` `[fetch]`:

- `rate = 0.0667` → one request every 15 s, shared across all workers.
- `workers = 2` → two certs in flight; more workers do not go faster because the rate is global.
- On a 429: **every worker pauses** for `cooldown_start` (300 s). The cert is put back in the queue, not marked failed. Each further 429 doubles the pause up to `cooldown_max` (900 s); a success resets it to 300 s.
- A cert that is throttled 20 separate times is parked in `failures` with reason `HTTP 429 x20` so the run can end. `fetch --retry-failures` picks it up later.
- Any other error (timeout, 5xx) is retried after 1 s, 4 s, 16 s, then parked with its reason.
- HTTP 403/404 from the API means the cert does not exist publicly: recorded once, never retried.

Rough timing at the measured pace:

| Set | Certs | Fetch | Download (12–24 MB/card) |
|---|---|---|---|
| Pilot | 507 | about 5–6 hours | 20–40 minutes |
| Full dataset | about 27,000 | about 13 days continuous | about 1–2 days |

The full pull is expected to run for days. That is fine: it is built to be stopped and resumed.

## 3. Starting a pull

All commands run from `scripts/tag-dataset` in PowerShell. `download` and `verify --check-bucket` need the B2 keys; they are set as user environment variables, and `data/env.ps1` sets them for a single command line if a fresh shell does not have them.

Pilot (explicit cert list):

```powershell
cd "G:\Grading App\SlabSense\scripts\tag-dataset"
.\.venv\Scripts\python.exe -m tagdataset sample --cache "..\Tag scraper\tag_cache.json" --certs-file data\pilot_certs.txt --out data\pilot_certs.parquet
.\.venv\Scripts\python.exe -m tagdataset fetch --certs data\pilot_certs.parquet
. .\data\env.ps1; .\.venv\Scripts\python.exe -m tagdataset download
. .\data\env.ps1; .\.venv\Scripts\python.exe -m tagdataset verify --check-bucket
```

Full dataset (composition rule: every cert graded 5.5 and below plus all 10 Pristine, and 1,500 each for 6 through 10 spread across eras):

```powershell
.\.venv\Scripts\python.exe -m tagdataset sample --cache "..\Tag scraper\tag_cache.json"
.\.venv\Scripts\python.exe -m tagdataset fetch
. .\data\env.ps1; .\.venv\Scripts\python.exe -m tagdataset download
. .\data\env.ps1; .\.venv\Scripts\python.exe -m tagdataset verify --check-bucket
```

`sample` skips any cert already in the database, so re-sampling never duplicates work. Run the stages one after another. Running `fetch` and `download` at the same time has not been tested; the database allows it in principle, but a `database is locked` error is possible under contention, so keep them sequential.

What you see while it runs: one line, updated in place, like `fetch: {'ok': 120, 'gone': 0, 'failed': 0, 'skipped': 48, 'throttled': 3}  0.0/s`. A rising `throttled` count with `ok` still climbing is normal. `failed` should stay at 0.

## 4. Stopping safely

There is no unsafe moment to stop. Every cert and every file is committed to the database the instant it completes, and nothing is written half-done.

- **Ctrl+C in the terminal.** The run stops within a few seconds. You may see a Python traceback ending in `KeyboardInterrupt`; that is expected and harmless.
- **Close the terminal, log off, reboot, power loss.** Same result. The database uses write-ahead logging, so an unclean stop loses at most the single request that was in flight.
- **From another window:** `Get-Process python | Where-Object { $_.Path -like "*tag-dataset*" } | Stop-Process`.

What is lost on a stop: nothing that finished. A cert whose two API calls had not both completed is simply fetched again next time. A file that was uploaded to B2 but not yet recorded is re-uploaded next time (B2 overwrites; no duplicate).

After stopping, wait at least 5 minutes before starting a fetch again if the run had been throttling. That lets TAG's rolling window clear so you do not start inside a block.

## 5. Resuming

Run the exact same command again. That is the whole procedure.

- `fetch` skips every cert already in `raw` (its `skipped` count shows how many) and continues with the rest.
- `download` skips every file already in `files` and every file marked unavailable upstream.
- `verify` recomputes everything from the database, never from memory.

The database is the only state that matters. If `data/raw.sqlite` exists, you can resume. If you delete it, you start from zero (the images in B2 would be re-uploaded, not lost).

Check progress at any time without touching TAG:

```powershell
.\.venv\Scripts\python.exe -c "from tagdataset.store import Store; print(Store('data/raw.sqlite').counts())"
```

Output like `{'raw_ok': 312, 'raw_gone': 0, 'files': 0, 'failures_fetch': 2, 'failures_download': 0}` means 312 certs fetched, 2 parked. Compare `raw_ok` to the row count of your certs parquet to see how far along you are.

## 6. Cleaning up parked failures

When a run ends with `failed` above 0, or `counts()` shows `failures_fetch` or `failures_download` above 0:

```powershell
# see what is parked and why
.\.venv\Scripts\python.exe -c "from tagdataset.store import Store; s=Store('data/raw.sqlite'); print(s.list_failures('fetch')); print(s.list_failures('download'))"

# retry parked fetches (same certs parquet you sampled with)
.\.venv\Scripts\python.exe -m tagdataset fetch --retry-failures

# retry retryable downloads after a verify
. .\data\env.ps1; .\.venv\Scripts\python.exe -m tagdataset download --retry-missing data\missing.parquet
```

Reasons and what they mean:

| Reason | Meaning | Action |
|---|---|---|
| `HTTP 429 x20` | throttled 20 times in one run | `fetch --retry-failures` after a quiet spell |
| `HTTP 5xx`, `TimeoutError`, `ClientConnectorError` | transient | `fetch --retry-failures` or `download --retry-missing` |
| `HTTP 403` / `HTTP 404` on a download | TAG never generated that file (common for annotated surface images) | nothing; `verify` reports these as `unavailable upstream` and they do not block a clean run |
| `HTTP 403` / `HTTP 404` on a fetch | cert not public | nothing; counted as `raw_gone` |

`verify` exits 0 when only unavailable-upstream files are missing, and 1 when something retryable is missing.

## 7. Files that matter, and what to back up

| Path | What | If lost |
|---|---|---|
| `data/raw.sqlite` (+ `-wal`, `-shm`) | all progress: raw API responses, upload records, failures | you start over; copy it somewhere occasionally during a long pull |
| `data/certs.parquet` / `data/pilot_certs.parquet` | the list being pulled | re-run `sample` |
| `config.toml` | endpoint, bucket, rate, cooldowns | copy `config.example.toml` and fill in bucket + endpoint |
| `data/env.ps1` | B2 keys for one-line use | recreate from the B2 console (rotate the key if the file leaked) |
| B2 bucket `slabsense-tag-dataset/tag-dataset/{cert}/` | the images | `download` re-uploads whatever the database says should exist |

Never delete the `-wal` or `-shm` files next to the database while a run is active; SQLite folds them into the main file on the next clean open.

Back up the database while a run is active by copying it with the WAL: stop the run, or use the SQLite backup API:

```powershell
.\.venv\Scripts\python.exe -c "import sqlite3; s=sqlite3.connect('data/raw.sqlite'); d=sqlite3.connect('data/raw.backup.sqlite'); s.backup(d); d.close(); print('ok')"
```

## 8. Things not to do

- Do not run two `fetch` processes at once. They share one IP budget and will throttle each other into a block.
- Do not probe or browse TAG's API by hand while a fetch is running; every request counts.
- Do not raise `rate` above 0.0667 hoping to go faster. Above the budget every request fails and the block lasts longer than the time you tried to save.
- Do not put the B2 keys in `config.toml` or commit `config.toml`, `config.smoke.toml`, or `data/`. They are gitignored for a reason.
- Do not delete `data/raw.sqlite` to "reset" a problem. Read `list_failures` first; almost everything is fixable with a retry flag.

## 9. Recovery scenarios

**PC rebooted mid-fetch.** Open PowerShell, `cd` to the package, run the same `fetch` command. It prints a `skipped` count equal to what was already done and continues.

**Run ended with `failed: 12`.** Look at `list_failures('fetch')`. If reasons are 429 or transient, wait 5 minutes and run `fetch --retry-failures`. If `HTTP 403/404`, those certs are not public; nothing to do.

**`verify` exits 1.** Run `download --retry-missing data\missing.parquet`, then `verify --check-bucket` again. If still 1, look at `list_failures('download')` for the URLs and reasons.

**Bucket looks empty in the console but the database says files exist.** The files are under the `tag-dataset/` prefix inside the bucket; open that folder. `verify --check-bucket` compares the database to a real listing and will report any true gap.

**Lost `data/raw.sqlite` but the bucket is intact.** Re-run `sample` and `fetch` (the API responses must be re-pulled; there is no copy of them in the bucket), then `download`. Existing objects are overwritten with identical bytes, so nothing is duplicated.

**Want to pull a different set of certs.** Write them one per line to a text file and run `sample --certs-file that.txt --out data\that.parquet`, then `fetch --certs data\that.parquet`. Everything else is unchanged.
