# TAG Dataset Acquisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A resumable Python package, `scripts/tag-dataset/`, that samples certs from the TAG browse cache, fetches both raw TAG API responses per cert into SQLite, uploads every per-card image to a Backblaze B2 bucket, and verifies completeness; then re-fetches the 507-card pilot through it.

**Architecture:** Four CLI commands (`sample`, `fetch`, `download`, `verify`) over one SQLite store (`raw`, `files`, `failures` tables). Raw API JSON is stored verbatim and never flattened here. Images stream from TAG's CDN into memory and straight to B2 via the S3 API; nothing large touches local disk. Every command skips work already recorded in the store, so any run can be killed and restarted.

**Tech Stack:** Python ≥ 3.11 (3.14 is installed), `aiohttp`, `pycryptodome`, `boto3`, `pandas` + `pyarrow` (parquet), `sqlite3` and `tomllib` from the standard library, `pytest`.

**Spec:** `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` (sections 2, 3, 5, 11, 12, 14)

## Global Constraints

- Python ≥ 3.11. Async tests call `asyncio.run(...)` directly; do not add `pytest-asyncio`.
- Store both raw responses verbatim (`detail_json`, `score_json`). Never mutate or flatten them in this package.
- Composition rule: every cert with grade key in `1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 10P`; grade keys `6, 6.5, 7, 7.5, 8, 8.5, 9, 10` capped at 1,500 each, allocated across five eras proportionally to availability with a floor of 150 per era where available; grade key `VA` skipped.
- Eras: `1999-2003`, `2004-2010`, `2011-2016`, `2017-2022`, `2023+`.
- Fetch rate limit default 4 requests/second total, 8 workers, backoff 1 s, 4 s, 16 s, then park in `failures`. HTTP 403 and 404 are recorded and never retried.
- Download concurrency 16, 3 retries with the same backoff, then `failures`. Slab photos and 1×1 thumbnails are not downloaded.
- Bucket layout: `s3://<bucket>/tag-dataset/{cert}/{file}`. File names exactly: `front.jpg, back.jpg, sfx_front.jpg, sfx_back.jpg, sfx_front_annotated.jpg, sfx_back_annotated.jpg, corner_{F|B}{TL|TR|BL|BR}.png, edge_{F|B}{T|B|L|R}.png, ding_{n}.jpg`.
- Secrets (B2 key id and application key) come from environment variables `B2_KEY_ID` and `B2_APP_KEY`, never from a committed file.
- Commit after every task. Commit messages end with the attribution lines from the session's system reminder.

---

## File structure

```
scripts/tag-dataset/
├── pyproject.toml                 package + deps + pytest config
├── README.md                      setup, B2 bucket steps, command reference
├── config.example.toml            copy to config.toml (gitignored)
├── tagdataset/
│   ├── __init__.py
│   ├── __main__.py                `python -m tagdataset` → cli.main()
│   ├── config.py                  Config dataclass + load_config()
│   ├── grades.py                  grade keys, era_for_year, grade_num, allocate()
│   ├── tagapi.py                  signing, decrypt, TagClient (async)
│   ├── store.py                   SQLite Store: raw / files / failures
│   ├── sample.py                  load_cache(), build_sample(), sample_from_cert_list()
│   ├── files.py                   expected_files(detail, score)
│   ├── fetch.py                   RateLimiter, fetch_one(), run_fetch()
│   ├── bucket.py                  Bucket (boto3 S3 client for B2)
│   ├── download.py                pending_files(), download_one(), run_download()
│   ├── verify.py                  verify(), completeness_by_grade()
│   └── cli.py                     argparse subcommands
└── tests/
    ├── conftest.py                fixture loaders, FakeBucket, FakeSession
    ├── fixtures/
    │   ├── C1240631.encrypted.txt   raw encrypted detail body (recorded)
    │   ├── C1240631.detail.json     decrypted detail response (recorded)
    │   ├── C1240631.score.json      decrypted score response (recorded)
    │   ├── mini_cache.json          synthetic browse cache
    │   └── smoke_certs.txt          20 pilot certs for the end-to-end smoke
    ├── record_fixtures.py         one-off script that records the three C1240631 files
    ├── test_grades.py
    ├── test_tagapi.py
    ├── test_store.py
    ├── test_sample.py
    ├── test_files.py
    ├── test_fetch.py
    ├── test_download.py
    └── test_verify.py
```

Responsibilities: `tagapi` knows TAG; `bucket` knows B2; `store` knows SQLite; `files` knows the URL→filename mapping; `fetch`/`download`/`verify` orchestrate and depend only on the interfaces above, so tests replace `TagClient`, `Bucket`, and the HTTP session with fakes.

---

### Task 1: Package scaffold, config, and grade rules

**Files:**
- Create: `scripts/tag-dataset/pyproject.toml`
- Create: `scripts/tag-dataset/config.example.toml`
- Create: `scripts/tag-dataset/tagdataset/__init__.py`
- Create: `scripts/tag-dataset/tagdataset/config.py`
- Create: `scripts/tag-dataset/tagdataset/grades.py`
- Create: `scripts/tag-dataset/tests/test_grades.py`
- Modify: `.gitignore` (append three lines)

**Interfaces:**
- Produces: `grades.FULL_GRADE_KEYS`, `grades.CAPPED_GRADE_KEYS`, `grades.SKIP_GRADE_KEYS`, `grades.CAP_PER_GRADE = 1500`, `grades.ERA_FLOOR = 150`, `grades.era_for_year(year) -> str`, `grades.grade_num(key: str) -> float`, `grades.allocate(avail: dict[str, int], cap: int, floor: int) -> dict[str, int]`, `config.Config` dataclass, `config.load_config(path: str) -> Config`.

- [ ] **Step 1: Create the package files**

`scripts/tag-dataset/pyproject.toml`:
```toml
[project]
name = "tagdataset"
version = "0.1.0"
description = "Pull TAG Grading DIG reports and images into a training dataset"
requires-python = ">=3.11"
dependencies = [
  "aiohttp>=3.9",
  "pycryptodome>=3.20",
  "boto3>=1.34",
  "pandas>=2.2",
  "pyarrow>=15",
]

[project.optional-dependencies]
dev = ["pytest>=8"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["tagdataset*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`scripts/tag-dataset/config.example.toml`:
```toml
[paths]
db = "data/raw.sqlite"

[bucket]
# From the B2 console: Buckets → your bucket → Endpoint. Region is the middle part.
endpoint = "https://s3.us-west-004.backblazeb2.com"
region = "us-west-004"
name = "slabsense-tag-dataset"
prefix = "tag-dataset"
# Keys are read from env vars B2_KEY_ID and B2_APP_KEY. Never put them here.

[fetch]
rate = 4.0
workers = 8

[download]
concurrency = 16
```

`scripts/tag-dataset/tagdataset/__init__.py`: empty file.

`scripts/tag-dataset/tagdataset/config.py`:
```python
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    db_path: str
    endpoint: str
    region: str
    bucket: str
    prefix: str
    key_id: str | None
    app_key: str | None
    rate: float
    workers: int
    concurrency: int


def load_config(path: str = "config.toml") -> Config:
    with open(path, "rb") as f:
        data = tomllib.load(f)
    b = data["bucket"]
    return Config(
        db_path=data["paths"]["db"],
        endpoint=b["endpoint"],
        region=b["region"],
        bucket=b["name"],
        prefix=b.get("prefix", "tag-dataset"),
        key_id=os.environ.get("B2_KEY_ID"),
        app_key=os.environ.get("B2_APP_KEY"),
        rate=float(data.get("fetch", {}).get("rate", 4.0)),
        workers=int(data.get("fetch", {}).get("workers", 8)),
        concurrency=int(data.get("download", {}).get("concurrency", 16)),
    )
```

Append to `.gitignore`:
```
scripts/tag-dataset/data/
scripts/tag-dataset/config.toml
scripts/tag-dataset/config.smoke.toml
scripts/tag-dataset/.venv/
```

- [ ] **Step 2: Create the venv and install**

Run (PowerShell, from repo root):
```powershell
cd "scripts/tag-dataset"; python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -e ".[dev]"
```
Expected: ends with `Successfully installed ... tagdataset-0.1.0`. All later `pytest` and `python -m tagdataset` commands in this plan run from `scripts/tag-dataset` with this venv active.

- [ ] **Step 3: Write the failing grade tests**

`scripts/tag-dataset/tests/test_grades.py`:
```python
from tagdataset import grades


def test_era_boundaries():
    assert grades.era_for_year(1999) == "1999-2003"
    assert grades.era_for_year(2003) == "1999-2003"
    assert grades.era_for_year(2004) == "2004-2010"
    assert grades.era_for_year(2010) == "2004-2010"
    assert grades.era_for_year(2011) == "2011-2016"
    assert grades.era_for_year(2016) == "2011-2016"
    assert grades.era_for_year(2017) == "2017-2022"
    assert grades.era_for_year(2022) == "2017-2022"
    assert grades.era_for_year(2023) == "2023+"
    assert grades.era_for_year("2026") == "2023+"


def test_grade_num():
    assert grades.grade_num("10P") == 10.0
    assert grades.grade_num("10") == 10.0
    assert grades.grade_num("8.5") == 8.5
    assert grades.grade_num("1") == 1.0


def test_grade_key_sets_are_disjoint_and_complete():
    all_keys = {"1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5",
                "6", "6.5", "7", "7.5", "8", "8.5", "9", "10", "10P", "VA"}
    union = grades.FULL_GRADE_KEYS | grades.CAPPED_GRADE_KEYS | grades.SKIP_GRADE_KEYS
    assert union == all_keys
    assert not (grades.FULL_GRADE_KEYS & grades.CAPPED_GRADE_KEYS)
    assert "VA" in grades.SKIP_GRADE_KEYS
    assert "10P" in grades.FULL_GRADE_KEYS


def test_allocate_returns_everything_when_under_cap():
    avail = {"1999-2003": 100, "2023+": 200}
    assert grades.allocate(avail, cap=1500, floor=150) == avail


def test_allocate_sums_to_cap_and_respects_floor():
    avail = {"1999-2003": 10, "2004-2010": 300, "2011-2016": 2000, "2017-2022": 5000, "2023+": 40000}
    q = grades.allocate(avail, cap=1500, floor=150)
    assert sum(q.values()) == 1500
    assert q["1999-2003"] == 10            # fewer than floor available: take all
    assert q["2004-2010"] >= 150           # floor honoured
    assert q["2023+"] > q["2017-2022"] > q["2011-2016"]   # proportional above floor
    for era, n in q.items():
        assert n <= avail[era]


def test_allocate_is_deterministic():
    avail = {"a": 700, "b": 900, "c": 5}
    assert grades.allocate(avail, cap=1000, floor=100) == grades.allocate(avail, cap=1000, floor=100)
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pytest tests/test_grades.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.grades'`

- [ ] **Step 5: Implement grades.py**

`scripts/tag-dataset/tagdataset/grades.py`:
```python
"""Grade keys, eras, and the dataset composition rule (spec §2, §5.1)."""
from __future__ import annotations

FULL_GRADE_KEYS = frozenset({"1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "10P"})
CAPPED_GRADE_KEYS = frozenset({"6", "6.5", "7", "7.5", "8", "8.5", "9", "10"})
SKIP_GRADE_KEYS = frozenset({"VA"})

CAP_PER_GRADE = 1500
ERA_FLOOR = 150
ERAS = ("1999-2003", "2004-2010", "2011-2016", "2017-2022", "2023+")


def era_for_year(year) -> str:
    y = int(year)
    if y <= 2003:
        return "1999-2003"
    if y <= 2010:
        return "2004-2010"
    if y <= 2016:
        return "2011-2016"
    if y <= 2022:
        return "2017-2022"
    return "2023+"


def grade_num(key: str) -> float:
    return 10.0 if key == "10P" else float(key)


def is_pristine(key: str) -> bool:
    return key == "10P"


def allocate(avail: dict[str, int], cap: int = CAP_PER_GRADE, floor: int = ERA_FLOOR) -> dict[str, int]:
    """Split `cap` picks across eras.

    Each era first gets min(available, floor). The remainder is handed out
    proportionally to the spare availability of each era, repeatedly, until
    the cap is met or nothing is left to give. Deterministic.
    """
    total = sum(avail.values())
    if total <= cap:
        return dict(avail)
    quota = {era: min(n, floor) for era, n in avail.items()}
    remaining = cap - sum(quota.values())
    while remaining > 0:
        spare = {era: avail[era] - quota[era] for era in avail if avail[era] > quota[era]}
        if not spare:
            break
        spare_total = sum(spare.values())
        adds = {era: min(s, int(remaining * s / spare_total)) for era, s in spare.items()}
        if sum(adds.values()) == 0:
            top = max(sorted(spare), key=spare.get)
            adds = {top: 1}
        for era, a in adds.items():
            quota[era] += a
            remaining -= a
    return quota
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_grades.py -v`
Expected: 6 passed

- [ ] **Step 7: Commit**

```bash
git add scripts/tag-dataset/pyproject.toml scripts/tag-dataset/config.example.toml scripts/tag-dataset/tagdataset/__init__.py scripts/tag-dataset/tagdataset/config.py scripts/tag-dataset/tagdataset/grades.py scripts/tag-dataset/tests/test_grades.py .gitignore
git commit -m "feat(tag-dataset): package scaffold, config loader, grade composition rules"
```

---

### Task 2: TAG API client and recorded fixtures

**Files:**
- Create: `scripts/tag-dataset/tagdataset/tagapi.py`
- Create: `scripts/tag-dataset/tests/record_fixtures.py`
- Create: `scripts/tag-dataset/tests/fixtures/C1240631.encrypted.txt` (recorded)
- Create: `scripts/tag-dataset/tests/fixtures/C1240631.detail.json` (recorded)
- Create: `scripts/tag-dataset/tests/fixtures/C1240631.score.json` (recorded)
- Create: `scripts/tag-dataset/tests/conftest.py`
- Create: `scripts/tag-dataset/tests/test_tagapi.py`

**Interfaces:**
- Produces: `tagapi.make_key(*args) -> str`, `tagapi.decrypt(body: str) -> dict`, `tagapi.TagHttpError(status: int, body: str)`, `tagapi.TagClient(session: aiohttp.ClientSession)` with `async detail(cert) -> dict` and `async score(cert) -> dict`. Test fixtures `detail_fixture`, `score_fixture` (dicts) in `conftest.py`.

- [ ] **Step 1: Write tagapi.py**

The two constants are copied from `scripts/Tag scraper/tag_proxy.py` lines 18–19; they are already committed there.

`scripts/tag-dataset/tagdataset/tagapi.py`:
```python
"""TAG public API: request signing, response decryption, async client (spec §3)."""
from __future__ import annotations

import hashlib
import json

import aiohttp
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

BASE_URL = "https://api.taggrading.com"
SIGNING_SECRET = "TZY0j76MKF1AA0QK0ppAGySAaCNgKG"
AES_KEY_STRING = "K5ucGQIf7vigW9ITOXLak5MjSIxxsgixqj"

HEADERS_BASE = {
    "Accept": "application/json, text/plain, */*",
    "Pragma": "no-cache",
    "Content-Type": "application/json",
    "Origin": "https://my.taggrading.com",
    "Referer": "https://my.taggrading.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

TIMEOUT = aiohttp.ClientTimeout(total=30)


def make_key(*args) -> str:
    payload = SIGNING_SECRET + ":" + ",".join(str(a) for a in args)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def decrypt(body: str) -> dict:
    """Return the JSON payload of a TAG response.

    Responses are either plain JSON or `<iv_hex>:<ciphertext_hex>` (AES-CBC).
    Anything else (an HTML page, an error string) raises ValueError.
    """
    text = body.strip()
    if text.startswith("{") or text.startswith("["):
        return json.loads(text)
    if ":" not in text:
        raise ValueError(f"not a TAG payload: {text[:60]!r}")
    iv_hex, c_hex = text.split(":", 1)
    key = hashlib.sha256(AES_KEY_STRING.encode()).digest()
    cipher = AES.new(key, AES.MODE_CBC, bytes.fromhex(iv_hex))
    return json.loads(unpad(cipher.decrypt(bytes.fromhex(c_hex)), 16).decode("utf-8"))


class TagHttpError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


class TagClient:
    def __init__(self, session: aiohttp.ClientSession):
        self.session = session

    async def _get(self, url: str, key: str) -> dict:
        headers = {**HEADERS_BASE, "x-tag-key": key}
        async with self.session.get(url, headers=headers, timeout=TIMEOUT) as r:
            text = await r.text()
            if r.status != 200:
                raise TagHttpError(r.status, text[:200])
            return decrypt(text)

    async def detail(self, cert: str) -> dict:
        return await self._get(f"{BASE_URL}/graded-cards/public/detail/{cert}", make_key(cert))

    async def score(self, cert: str) -> dict:
        return await self._get(
            f"{BASE_URL}/graded-cards/public/score/{cert}?includeAnnotation=true",
            make_key(cert, "true"),
        )
```

- [ ] **Step 2: Write and run the fixture recorder**

`scripts/tag-dataset/tests/record_fixtures.py`:
```python
"""One-off: record real TAG responses for cert C1240631 as test fixtures.

Run from scripts/tag-dataset with the venv active:
    python tests/record_fixtures.py
"""
import asyncio
import json
from pathlib import Path

import aiohttp

from tagdataset import tagapi

CERT = "C1240631"
OUT = Path(__file__).parent / "fixtures"


async def main():
    OUT.mkdir(exist_ok=True)
    async with aiohttp.ClientSession() as session:
        url = f"{tagapi.BASE_URL}/graded-cards/public/detail/{CERT}"
        headers = {**tagapi.HEADERS_BASE, "x-tag-key": tagapi.make_key(CERT)}
        async with session.get(url, headers=headers, timeout=tagapi.TIMEOUT) as r:
            assert r.status == 200, r.status
            encrypted = await r.text()
        (OUT / f"{CERT}.encrypted.txt").write_text(encrypted, encoding="utf-8")
        client = tagapi.TagClient(session)
        detail = await client.detail(CERT)
        score = await client.score(CERT)
    (OUT / f"{CERT}.detail.json").write_text(json.dumps(detail, indent=1), encoding="utf-8")
    (OUT / f"{CERT}.score.json").write_text(json.dumps(score, indent=1), encoding="utf-8")
    print("recorded", CERT, "dings:", detail["data"]["dingsJSON"]["DingsCount"])


if __name__ == "__main__":
    asyncio.run(main())
```

Run: `python tests/record_fixtures.py`
Expected: prints `recorded C1240631 dings: 5` and three files exist under `tests/fixtures/`.

- [ ] **Step 3: Write conftest.py and the failing tests**

`scripts/tag-dataset/tests/conftest.py`:
```python
import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def load_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def detail_fixture() -> dict:
    return load_json("C1240631.detail.json")


@pytest.fixture
def score_fixture() -> dict:
    return load_json("C1240631.score.json")


@pytest.fixture
def encrypted_fixture() -> str:
    return (FIXTURES / "C1240631.encrypted.txt").read_text(encoding="utf-8")
```

`scripts/tag-dataset/tests/test_tagapi.py`:
```python
import hashlib

import pytest

from tagdataset import tagapi


def test_make_key_matches_sha256_of_secret_and_args():
    expected = hashlib.sha256(f"{tagapi.SIGNING_SECRET}:ABC123,true".encode()).hexdigest()
    assert tagapi.make_key("ABC123", "true") == expected
    assert tagapi.make_key("ABC123") != tagapi.make_key("ABC123", "true")


def test_decrypt_recorded_body_matches_recorded_json(encrypted_fixture, detail_fixture):
    assert tagapi.decrypt(encrypted_fixture) == detail_fixture


def test_decrypt_passes_plain_json_through():
    assert tagapi.decrypt('  {"a": 1} ') == {"a": 1}
    assert tagapi.decrypt("[1,2]") == [1, 2]


def test_decrypt_rejects_html():
    with pytest.raises(ValueError):
        tagapi.decrypt("<!doctype html><html></html>")


def test_fixture_shape(detail_fixture, score_fixture):
    d = detail_fixture["data"]
    s = score_fixture["data"]
    assert d["certificateValue"] == "C1240631"
    assert d["dingsJSON"]["DingsCount"] == len(d["dingsJSON"]["Dings"])
    for k in ("imageFileFTL", "imageFileBBR", "imageFileFTE", "imageFileBRE",
              "scoreRollupCorners", "scoreFCSE", "surfaceFrontData"):
        assert k in s
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_tagapi.py -v`
Expected: 5 passed. (These pass on first run because tagapi.py was written before the tests; the tests are the regression net for the recorded fixtures.)

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-dataset/tagdataset/tagapi.py scripts/tag-dataset/tests/record_fixtures.py scripts/tag-dataset/tests/fixtures/ scripts/tag-dataset/tests/conftest.py scripts/tag-dataset/tests/test_tagapi.py
git commit -m "feat(tag-dataset): TAG API client with recorded fixtures"
```

---

### Task 3: SQLite store

**Files:**
- Create: `scripts/tag-dataset/tagdataset/store.py`
- Create: `scripts/tag-dataset/tests/test_store.py`

**Interfaces:**
- Produces: `store.Store(path: str)` with methods
  `has_raw(cert) -> bool`,
  `put_raw(cert, grade_key, detail: dict|None, score: dict|None, http_status: int, error: str|None) -> None`,
  `get_raw(cert) -> tuple[dict|None, dict|None]`,
  `iter_raw_ok() -> Iterator[tuple[str, dict, dict]]` (only rows with status 200 and detail present),
  `grade_key_for(cert) -> str|None`,
  `certs_with_raw() -> set[str]`,
  `has_file(cert, name) -> bool`, `put_file(cert, name, url, nbytes, sha256) -> None`, `files_for(cert) -> set[str]`,
  `add_failure(kind, cert, name, reason) -> None`, `clear_failure(kind, cert, name) -> None`, `list_failures(kind) -> list[tuple[str, str, str, int]]`,
  `counts() -> dict[str, int]`, `close()`.

- [ ] **Step 1: Write the failing tests**

`scripts/tag-dataset/tests/test_store.py`:
```python
from tagdataset.store import Store


def make_store(tmp_path):
    return Store(str(tmp_path / "t.sqlite"))


def test_put_and_get_raw_roundtrip(tmp_path, detail_fixture, score_fixture):
    s = make_store(tmp_path)
    assert not s.has_raw("C1240631")
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    assert s.has_raw("C1240631")
    d, sc = s.get_raw("C1240631")
    assert d == detail_fixture and sc == score_fixture
    assert s.grade_key_for("C1240631") == "7"
    assert s.certs_with_raw() == {"C1240631"}


def test_gone_rows_are_stored_but_not_iterated(tmp_path, detail_fixture, score_fixture):
    s = make_store(tmp_path)
    s.put_raw("GONE1", "9", None, None, 404, "Not Found")
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    assert s.has_raw("GONE1")
    assert [c for c, _, _ in s.iter_raw_ok()] == ["C1240631"]
    assert s.get_raw("GONE1") == (None, None)


def test_put_raw_replaces_existing(tmp_path, detail_fixture, score_fixture):
    s = make_store(tmp_path)
    s.put_raw("X", "9", None, None, 500, "boom")
    s.put_raw("X", "9", detail_fixture, score_fixture, 200, None)
    assert [c for c, _, _ in s.iter_raw_ok()] == ["X"]


def test_files_table(tmp_path):
    s = make_store(tmp_path)
    assert not s.has_file("X", "front.jpg")
    s.put_file("X", "front.jpg", "https://cdn/x.jpg", 1234, "abc")
    s.put_file("X", "back.jpg", "https://cdn/y.jpg", 99, "def")
    assert s.has_file("X", "front.jpg")
    assert s.files_for("X") == {"front.jpg", "back.jpg"}
    assert s.files_for("Y") == set()


def test_failures_count_attempts_and_clear(tmp_path):
    s = make_store(tmp_path)
    s.add_failure("fetch", "X", "", "HTTP 500")
    s.add_failure("fetch", "X", "", "HTTP 502")
    s.add_failure("download", "X", "front.jpg", "timeout")
    assert s.list_failures("fetch") == [("X", "", "HTTP 502", 2)]
    assert s.list_failures("download") == [("X", "front.jpg", "timeout", 1)]
    s.clear_failure("fetch", "X", "")
    assert s.list_failures("fetch") == []


def test_counts(tmp_path, detail_fixture, score_fixture):
    s = make_store(tmp_path)
    s.put_raw("A", "7", detail_fixture, score_fixture, 200, None)
    s.put_raw("B", "9", None, None, 404, "nf")
    s.put_file("A", "front.jpg", "u", 1, "h")
    s.add_failure("download", "A", "back.jpg", "x")
    c = s.counts()
    assert c == {"raw_ok": 1, "raw_gone": 1, "files": 1, "failures_fetch": 0, "failures_download": 1}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.store'`

- [ ] **Step 3: Implement store.py**

`scripts/tag-dataset/tagdataset/store.py`:
```python
"""SQLite store for raw TAG responses, uploaded files, and failures (spec §5.2–5.4, §11)."""
from __future__ import annotations

import datetime as _dt
import json
import sqlite3
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS raw (
    cert        TEXT PRIMARY KEY,
    grade_key   TEXT,
    detail_json TEXT,
    score_json  TEXT,
    fetched_at  TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    error       TEXT
);
CREATE TABLE IF NOT EXISTS files (
    cert        TEXT NOT NULL,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    bytes       INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    PRIMARY KEY (cert, name)
);
CREATE TABLE IF NOT EXISTS failures (
    kind     TEXT NOT NULL,
    cert     TEXT NOT NULL,
    name     TEXT NOT NULL DEFAULT '',
    reason   TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_at  TEXT NOT NULL,
    PRIMARY KEY (kind, cert, name)
);
"""


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)

    # ── raw ──────────────────────────────────────────────────────────────
    def has_raw(self, cert: str) -> bool:
        return self.conn.execute("SELECT 1 FROM raw WHERE cert=?", (cert,)).fetchone() is not None

    def put_raw(self, cert, grade_key, detail, score, http_status, error) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO raw VALUES (?,?,?,?,?,?,?)",
            (
                cert,
                grade_key,
                json.dumps(detail) if detail is not None else None,
                json.dumps(score) if score is not None else None,
                _now(),
                http_status,
                error,
            ),
        )
        self.conn.commit()

    def get_raw(self, cert: str) -> tuple[dict | None, dict | None]:
        row = self.conn.execute("SELECT detail_json, score_json FROM raw WHERE cert=?", (cert,)).fetchone()
        if row is None:
            return None, None
        return (json.loads(row[0]) if row[0] else None, json.loads(row[1]) if row[1] else None)

    def grade_key_for(self, cert: str) -> str | None:
        row = self.conn.execute("SELECT grade_key FROM raw WHERE cert=?", (cert,)).fetchone()
        return row[0] if row else None

    def iter_raw_ok(self) -> Iterator[tuple[str, dict, dict]]:
        cur = self.conn.execute(
            "SELECT cert, detail_json, score_json FROM raw "
            "WHERE http_status=200 AND detail_json IS NOT NULL ORDER BY cert"
        )
        for cert, d, s in cur:
            yield cert, json.loads(d), (json.loads(s) if s else {})

    def certs_with_raw(self) -> set[str]:
        return {r[0] for r in self.conn.execute("SELECT cert FROM raw")}

    # ── files ────────────────────────────────────────────────────────────
    def has_file(self, cert: str, name: str) -> bool:
        return self.conn.execute("SELECT 1 FROM files WHERE cert=? AND name=?", (cert, name)).fetchone() is not None

    def put_file(self, cert, name, url, nbytes, sha256) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?)",
            (cert, name, url, nbytes, sha256, _now()),
        )
        self.conn.commit()

    def files_for(self, cert: str) -> set[str]:
        return {r[0] for r in self.conn.execute("SELECT name FROM files WHERE cert=?", (cert,))}

    # ── failures ─────────────────────────────────────────────────────────
    def add_failure(self, kind, cert, name, reason) -> None:
        self.conn.execute(
            "INSERT INTO failures (kind, cert, name, reason, attempts, last_at) VALUES (?,?,?,?,1,?) "
            "ON CONFLICT(kind, cert, name) DO UPDATE SET reason=excluded.reason, "
            "attempts=failures.attempts+1, last_at=excluded.last_at",
            (kind, cert, name, reason, _now()),
        )
        self.conn.commit()

    def clear_failure(self, kind, cert, name) -> None:
        self.conn.execute("DELETE FROM failures WHERE kind=? AND cert=? AND name=?", (kind, cert, name))
        self.conn.commit()

    def list_failures(self, kind: str) -> list[tuple[str, str, str, int]]:
        return [
            tuple(r)
            for r in self.conn.execute(
                "SELECT cert, name, reason, attempts FROM failures WHERE kind=? ORDER BY cert, name", (kind,)
            )
        ]

    # ── misc ─────────────────────────────────────────────────────────────
    def counts(self) -> dict[str, int]:
        q = lambda sql: self.conn.execute(sql).fetchone()[0]
        return {
            "raw_ok": q("SELECT COUNT(*) FROM raw WHERE http_status=200 AND detail_json IS NOT NULL"),
            "raw_gone": q("SELECT COUNT(*) FROM raw WHERE http_status IN (403, 404)"),
            "files": q("SELECT COUNT(*) FROM files"),
            "failures_fetch": q("SELECT COUNT(*) FROM failures WHERE kind='fetch'"),
            "failures_download": q("SELECT COUNT(*) FROM failures WHERE kind='download'"),
        }

    def close(self) -> None:
        self.conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_store.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-dataset/tagdataset/store.py scripts/tag-dataset/tests/test_store.py
git commit -m "feat(tag-dataset): SQLite store for raw responses, files, failures"
```

---

### Task 4: Sampling from the browse cache

**Files:**
- Create: `scripts/tag-dataset/tagdataset/sample.py`
- Create: `scripts/tag-dataset/tests/fixtures/mini_cache.json`
- Create: `scripts/tag-dataset/tests/test_sample.py`

**Interfaces:**
- Consumes: `grades.*` from Task 1.
- Produces: `sample.load_cache(path) -> list[dict]` (rows with keys `cert, grade_key, year, brand, set, card_name, card_number, variation`), `sample.build_sample(rows, exclude: set[str], seed: int, cap: int, floor: int) -> pandas.DataFrame`, `sample.sample_from_cert_list(rows, certs: list[str]) -> pandas.DataFrame`, `sample.COLUMNS`. The DataFrame columns are exactly `cert, grade_key, grade_num, is_pristine, era, year, brand, set, card_name, card_number, variation`.

- [ ] **Step 1: Write the synthetic cache fixture**

`scripts/tag-dataset/tests/fixtures/mini_cache.json` (same shape as `tag_cache.json`: `cards` keyed by any string, each with `year, brand, set, card_name, card_number, variation, grades{key: [certs]}`):
```json
{
  "cached_at": "2026-01-01T00:00:00",
  "cards": {
    "1999|WOTC Pokémon|Base Set|Charizard|4|Holo": {
      "year": "1999", "brand": "WOTC Pokémon", "set": "Base Set",
      "card_name": "Charizard", "card_number": "4", "variation": "Holo",
      "grades": { "3": ["A0000001", "A0000002"], "9": ["A0000003", "A0000004", "A0000005"], "VA": ["A0000099"] }
    },
    "2016|Pokémon XY|Evolutions|Pikachu|35|": {
      "year": "2016", "brand": "Pokémon XY", "set": "Evolutions",
      "card_name": "Pikachu", "card_number": "35", "variation": "",
      "grades": { "9": ["B0000001", "B0000002", "B0000003", "B0000004", "B0000005", "B0000006"], "10P": ["B0000007"] }
    },
    "2024|Pokémon Scarlet & Violet|Temporal Forces|Iron Leaves|25|": {
      "year": "2024", "brand": "Pokémon Scarlet & Violet", "set": "Temporal Forces",
      "card_name": "Iron Leaves", "card_number": "25", "variation": "",
      "grades": { "9": ["C0000001", "C0000002", "C0000003", "C0000004", "C0000005", "C0000006", "C0000007", "C0000008", "C0000009", "C0000010"], "1": ["C0000011"] }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`scripts/tag-dataset/tests/test_sample.py`:
```python
from pathlib import Path

import pandas as pd

from tagdataset import sample

MINI = str(Path(__file__).parent / "fixtures" / "mini_cache.json")


def test_load_cache_flattens_to_cert_rows():
    rows = sample.load_cache(MINI)
    certs = {r["cert"] for r in rows}
    assert len(rows) == 2 + 3 + 1 + 6 + 1 + 10 + 1
    assert "A0000099" in certs                     # VA rows are loaded; filtered later
    row = next(r for r in rows if r["cert"] == "A0000001")
    assert row == {"cert": "A0000001", "grade_key": "3", "year": 1999, "brand": "WOTC Pokémon",
                   "set": "Base Set", "card_name": "Charizard", "card_number": "4", "variation": "Holo"}


def test_build_sample_full_grades_all_kept_and_va_skipped():
    df = sample.build_sample(sample.load_cache(MINI), exclude=set(), seed=1, cap=1500, floor=150)
    assert list(df.columns) == sample.COLUMNS
    assert set(df[df.grade_key == "3"].cert) == {"A0000001", "A0000002"}
    assert set(df[df.grade_key == "1"].cert) == {"C0000011"}
    assert set(df[df.grade_key == "10P"].cert) == {"B0000007"}
    assert "A0000099" not in set(df.cert)
    assert bool(df[df.cert == "B0000007"].is_pristine.iloc[0]) is True
    assert df[df.cert == "B0000007"].grade_num.iloc[0] == 10.0
    assert df[df.cert == "C0000011"].era.iloc[0] == "2023+"


def test_build_sample_caps_high_grade_across_eras():
    # grade 9 availability: 1999-2003 → 3, 2011-2016 → 6, 2023+ → 10 (19 total); cap 8, floor 2
    df = sample.build_sample(sample.load_cache(MINI), exclude=set(), seed=1, cap=8, floor=2)
    nines = df[df.grade_key == "9"]
    assert len(nines) == 8
    per_era = nines.era.value_counts().to_dict()
    assert per_era["1999-2003"] >= 2 and per_era["2011-2016"] >= 2 and per_era["2023+"] >= 2
    assert per_era["2023+"] >= per_era["2011-2016"] >= per_era["1999-2003"]


def test_build_sample_excludes_and_is_deterministic():
    rows = sample.load_cache(MINI)
    a = sample.build_sample(rows, exclude={"C0000001", "C0000002"}, seed=7, cap=8, floor=2)
    b = sample.build_sample(rows, exclude={"C0000001", "C0000002"}, seed=7, cap=8, floor=2)
    assert a.equals(b)
    assert not ({"C0000001", "C0000002"} & set(a.cert))
    assert len(a[a.grade_key == "9"]) == 8


def test_sample_from_cert_list_keeps_order_and_marks_unknown():
    rows = sample.load_cache(MINI)
    df = sample.sample_from_cert_list(rows, ["B0000007", "ZZZ", "A0000001"])
    assert list(df.columns) == sample.COLUMNS
    assert list(df.cert) == ["B0000007", "ZZZ", "A0000001"]
    assert df.iloc[0].grade_key == "10P" and df.iloc[0].era == "2011-2016"
    assert pd.isna(df.iloc[1].grade_key) and pd.isna(df.iloc[1].era) and pd.isna(df.iloc[1].grade_num)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_sample.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.sample'`

- [ ] **Step 4: Implement sample.py**

`scripts/tag-dataset/tagdataset/sample.py`:
```python
"""Sampling certs from the TAG browse cache per the composition rule (spec §5.1)."""
from __future__ import annotations

import json
import random

import pandas as pd

from .grades import (CAP_PER_GRADE, CAPPED_GRADE_KEYS, ERA_FLOOR, FULL_GRADE_KEYS,
                     SKIP_GRADE_KEYS, allocate, era_for_year, grade_num)

COLUMNS = ["cert", "grade_key", "grade_num", "is_pristine", "era", "year",
           "brand", "set", "card_name", "card_number", "variation"]


def load_cache(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        cards = json.load(f)["cards"]
    rows = []
    for card in cards.values():
        for grade_key, certs in (card.get("grades") or {}).items():
            for cert in certs:
                rows.append({
                    "cert": cert,
                    "grade_key": grade_key,
                    "year": int(card["year"]),
                    "brand": card.get("brand"),
                    "set": card.get("set"),
                    "card_name": card.get("card_name"),
                    "card_number": card.get("card_number", ""),
                    "variation": card.get("variation", ""),
                })
    return rows


def _finish(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=[c for c in COLUMNS if c not in ("grade_num", "is_pristine")])
    df["grade_num"] = df["grade_key"].map(lambda k: grade_num(k) if k else None)
    df["is_pristine"] = df["grade_key"] == "10P"
    return df[COLUMNS].reset_index(drop=True)


def build_sample(rows: list[dict], exclude: set[str], seed: int = 42,
                 cap: int = CAP_PER_GRADE, floor: int = ERA_FLOOR) -> pd.DataFrame:
    rng = random.Random(seed)
    seen: set[str] = set()
    uniq: list[dict] = []
    for r in rows:
        if r["grade_key"] in SKIP_GRADE_KEYS or r["cert"] in exclude or r["cert"] in seen:
            continue
        seen.add(r["cert"])
        uniq.append({**r, "era": era_for_year(r["year"])})

    by_grade: dict[str, list[dict]] = {}
    for r in uniq:
        by_grade.setdefault(r["grade_key"], []).append(r)

    out: list[dict] = []
    for grade_key in sorted(by_grade):
        group = by_grade[grade_key]
        if grade_key in FULL_GRADE_KEYS:
            out.extend(group)
            continue
        if grade_key not in CAPPED_GRADE_KEYS:
            continue
        by_era: dict[str, list[dict]] = {}
        for r in group:
            by_era.setdefault(r["era"], []).append(r)
        quota = allocate({era: len(v) for era, v in by_era.items()}, cap, floor)
        for era in sorted(quota):
            pool = sorted(by_era[era], key=lambda r: r["cert"])
            rng.shuffle(pool)
            out.extend(pool[: quota[era]])

    return _finish(sorted(out, key=lambda r: r["cert"]))


def sample_from_cert_list(rows: list[dict], certs: list[str]) -> pd.DataFrame:
    index = {r["cert"]: r for r in rows}
    out = []
    for cert in certs:
        r = index.get(cert)
        if r is None:
            out.append({"cert": cert, "grade_key": None, "era": None, "year": None, "brand": None,
                        "set": None, "card_name": None, "card_number": None, "variation": None})
        else:
            out.append({**r, "era": era_for_year(r["year"])})
    return _finish(out)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_sample.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add scripts/tag-dataset/tagdataset/sample.py scripts/tag-dataset/tests/fixtures/mini_cache.json scripts/tag-dataset/tests/test_sample.py
git commit -m "feat(tag-dataset): cert sampling with per-grade caps and era allocation"
```

---

### Task 5: Expected file list per cert

**Files:**
- Create: `scripts/tag-dataset/tagdataset/files.py`
- Create: `scripts/tag-dataset/tests/test_files.py`

**Interfaces:**
- Produces: `files.expected_files(detail: dict, score: dict | None) -> list[tuple[str, str]]` returning `(filename, url)` pairs in a stable order, and `files.CONTENT_TYPES: dict[str, str]` keyed by extension.

- [ ] **Step 1: Write the failing tests**

`scripts/tag-dataset/tests/test_files.py`:
```python
from tagdataset import files


def test_expected_files_for_recorded_cert(detail_fixture, score_fixture):
    out = files.expected_files(detail_fixture, score_fixture)
    names = [n for n, _ in out]
    urls = [u for _, u in out]
    assert len(names) == len(set(names)), "file names must be unique"
    assert all(u.startswith("https://") for u in urls)
    dings = detail_fixture["data"]["dingsJSON"]["Dings"]
    assert len(out) == 6 + 8 + 8 + len(dings)
    assert names[:6] == ["front.jpg", "back.jpg", "sfx_front.jpg", "sfx_back.jpg",
                         "sfx_front_annotated.jpg", "sfx_back_annotated.jpg"]
    assert "corner_FTL.png" in names and "corner_BBR.png" in names
    assert "edge_FT.png" in names and "edge_BR.png" in names
    d = dict(out)
    assert d["front.jpg"] == detail_fixture["data"]["imageFileDeskewedFront"]
    assert d["corner_FTL.png"] == score_fixture["data"]["imageFileFTL"]
    assert d["edge_BL.png"] == score_fixture["data"]["imageFileBLE"]
    assert d["sfx_front_annotated.jpg"] == detail_fixture["data"]["surfaceFrontData"]["image"]
    assert d[f"ding_{dings[0]['Ordering']}.jpg"] == dings[0]["ImageURL"]


def test_missing_urls_are_skipped(detail_fixture, score_fixture):
    score = {"data": {**score_fixture["data"], "imageFileFTL": None}}
    detail = {"data": {**detail_fixture["data"], "dingsJSON": {"Dings": [], "DingsCount": 0, "Summary": {}}}}
    out = files.expected_files(detail, score)
    names = [n for n, _ in out]
    assert "corner_FTL.png" not in names
    assert not any(n.startswith("ding_") for n in names)
    assert len(out) == 6 + 7 + 8


def test_score_none_yields_detail_files_only(detail_fixture):
    out = files.expected_files(detail_fixture, None)
    names = [n for n, _ in out]
    assert not any(n.startswith(("corner_", "edge_")) for n in names)
    assert "front.jpg" in names


def test_slab_images_are_never_included(detail_fixture, score_fixture):
    urls = [u for _, u in files.expected_files(detail_fixture, score_fixture)]
    assert not any("slab-images" in u for u in urls)


def test_content_types():
    assert files.CONTENT_TYPES[".jpg"] == "image/jpeg"
    assert files.CONTENT_TYPES[".png"] == "image/png"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_files.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.files'`

- [ ] **Step 3: Implement files.py**

`scripts/tag-dataset/tagdataset/files.py`:
```python
"""Which files to download for a cert and what to call them (spec §5.3)."""
from __future__ import annotations

CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}

# filename tag -> score-response key
CORNER_KEYS = {
    "FTL": "imageFileFTL", "FTR": "imageFileFTR", "FBL": "imageFileFBL", "FBR": "imageFileFBR",
    "BTL": "imageFileBTL", "BTR": "imageFileBTR", "BBL": "imageFileBBL", "BBR": "imageFileBBR",
}
EDGE_KEYS = {
    "FT": "imageFileFTE", "FB": "imageFileFBE", "FL": "imageFileFLE", "FR": "imageFileFRE",
    "BT": "imageFileBTE", "BB": "imageFileBBE", "BL": "imageFileBLE", "BR": "imageFileBRE",
}


def _image(block: dict | None) -> str | None:
    return (block or {}).get("image")


def expected_files(detail: dict, score: dict | None) -> list[tuple[str, str]]:
    d = (detail or {}).get("data") or {}
    s = (score or {}).get("data") or {}
    out: list[tuple[str, str]] = []

    def add(name: str, url: str | None) -> None:
        if url:
            out.append((name, url))

    add("front.jpg", d.get("imageFileDeskewedFront"))
    add("back.jpg", d.get("imageFileDeskewedBack"))
    add("sfx_front.jpg", d.get("imageFileFSFX") or s.get("imageFileFSFX"))
    add("sfx_back.jpg", d.get("imageFileBSFX") or s.get("imageFileBSFX"))
    add("sfx_front_annotated.jpg", _image(d.get("surfaceFrontData")) or _image(s.get("surfaceFrontData")))
    add("sfx_back_annotated.jpg", _image(d.get("surfaceBackData")) or _image(s.get("surfaceBackData")))
    for tag, key in CORNER_KEYS.items():
        add(f"corner_{tag}.png", s.get(key))
    for tag, key in EDGE_KEYS.items():
        add(f"edge_{tag}.png", s.get(key))
    for ding in ((d.get("dingsJSON") or {}).get("Dings") or []):
        add(f"ding_{ding.get('Ordering')}.jpg", ding.get("ImageURL"))
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_files.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-dataset/tagdataset/files.py scripts/tag-dataset/tests/test_files.py
git commit -m "feat(tag-dataset): expected file list per cert"
```

---

### Task 6: Fetch runner with rate limit and backoff

**Files:**
- Create: `scripts/tag-dataset/tagdataset/fetch.py`
- Create: `scripts/tag-dataset/tests/test_fetch.py`

**Interfaces:**
- Consumes: `store.Store`, `tagapi.TagHttpError`. The client is duck-typed: any object with `async detail(cert)` and `async score(cert)`.
- Produces: `fetch.BACKOFF = (1, 4, 16)`, `fetch.RateLimiter(per_second: float)` with `async wait()`, `fetch.fetch_one(client, store, cert, grade_key, limiter, sleep) -> str` returning `"ok" | "gone" | "failed"`, `fetch.run_fetch(client, store, certs: list[tuple[str, str | None]], rate: float, workers: int, sleep=asyncio.sleep, progress=None) -> dict[str, int]` with keys `ok, gone, failed, skipped`.

- [ ] **Step 1: Write the failing tests**

`scripts/tag-dataset/tests/test_fetch.py`:
```python
import asyncio

import aiohttp

from tagdataset import fetch
from tagdataset.store import Store
from tagdataset.tagapi import TagHttpError


class ScriptedClient:
    """detail()/score() pop the next scripted outcome for that cert.

    An outcome is a dict (returned) or an Exception (raised).
    """

    def __init__(self, script: dict[str, list]):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls: list[tuple[str, str]] = []

    async def _next(self, kind, cert):
        self.calls.append((kind, cert))
        outcome = self.script[cert].pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    async def detail(self, cert):
        return await self._next("detail", cert)

    async def score(self, cert):
        return await self._next("score", cert)


def run(coro):
    return asyncio.run(coro)


def make(tmp_path):
    return Store(str(tmp_path / "t.sqlite"))


def test_fetch_one_ok(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [detail_fixture, score_fixture]})
    slept = []

    async def sleep(s):
        slept.append(s)

    result = run(fetch.fetch_one(client, store, "A", "7", fetch.RateLimiter(1000), sleep))
    assert result == "ok"
    assert store.get_raw("A") == (detail_fixture, score_fixture)
    assert store.grade_key_for("A") == "7"
    assert slept == []


def test_fetch_one_404_is_gone_without_retry(tmp_path):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(404, "Not Found")]})
    slept = []

    async def sleep(s):
        slept.append(s)

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.RateLimiter(1000), sleep)) == "gone"
    assert store.has_raw("A") and store.get_raw("A") == (None, None)
    assert slept == [] and len(client.calls) == 1
    assert store.list_failures("fetch") == []


def test_fetch_one_retries_with_backoff_then_succeeds(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(500, "x"), TagHttpError(502, "y"), detail_fixture, score_fixture]})
    slept = []

    async def sleep(s):
        slept.append(s)

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.RateLimiter(1000), sleep)) == "ok"
    assert slept == [1, 4]
    assert store.list_failures("fetch") == []


def test_fetch_one_gives_up_after_backoff(tmp_path):
    store = make(tmp_path)
    client = ScriptedClient({"A": [TagHttpError(500, "x")] * 4})
    slept = []

    async def sleep(s):
        slept.append(s)

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.RateLimiter(1000), sleep)) == "failed"
    assert slept == [1, 4, 16]
    assert not store.has_raw("A")
    assert store.list_failures("fetch") == [("A", "", "HTTP 500", 1)]


def test_fetch_one_network_and_decrypt_errors_are_retried(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    client = ScriptedClient({"A": [aiohttp.ClientConnectionError("down"), detail_fixture,
                                   ValueError("not a TAG payload"), detail_fixture, score_fixture]})

    async def sleep(s):
        pass

    assert run(fetch.fetch_one(client, store, "A", "9", fetch.RateLimiter(1000), sleep)) == "ok"


def test_run_fetch_skips_existing_and_counts(tmp_path, detail_fixture, score_fixture):
    store = make(tmp_path)
    store.put_raw("HAVE", "9", detail_fixture, score_fixture, 200, None)
    client = ScriptedClient({
        "A": [detail_fixture, score_fixture],
        "B": [TagHttpError(403, "Forbidden")],
        "C": [TagHttpError(500, "x")] * 4,
    })

    async def sleep(s):
        pass

    counts = run(fetch.run_fetch(client, store, [("HAVE", "9"), ("A", "7"), ("B", "9"), ("C", "9")],
                                 rate=1000, workers=3, sleep=sleep))
    assert counts == {"ok": 1, "gone": 1, "failed": 1, "skipped": 1}
    assert ("detail", "HAVE") not in client.calls


def test_rate_limiter_spaces_calls():
    async def go():
        limiter = fetch.RateLimiter(per_second=50)   # 20 ms apart
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        for _ in range(6):
            await limiter.wait()
        return loop.time() - t0

    assert run(go()) >= 0.09
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_fetch.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.fetch'`

- [ ] **Step 3: Implement fetch.py**

`scripts/tag-dataset/tagdataset/fetch.py`:
```python
"""Fetch detail + score for each cert into the store (spec §5.2)."""
from __future__ import annotations

import asyncio
import time
from typing import Callable

import aiohttp

from .store import Store
from .tagapi import TagHttpError

BACKOFF = (1, 4, 16)
GONE_STATUSES = (403, 404)


class RateLimiter:
    """Simple global spacing: at most `per_second` calls per second across all workers."""

    def __init__(self, per_second: float):
        self.interval = 1.0 / per_second
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next - now)
            self._next = max(now, self._next) + self.interval
        if delay:
            await asyncio.sleep(delay)


async def fetch_one(client, store: Store, cert: str, grade_key: str | None,
                    limiter: RateLimiter, sleep=asyncio.sleep) -> str:
    last = "unknown"
    for delay in (0,) + BACKOFF:
        if delay:
            await sleep(delay)
        try:
            await limiter.wait()
            detail = await client.detail(cert)
            await limiter.wait()
            score = await client.score(cert)
        except TagHttpError as e:
            if e.status in GONE_STATUSES:
                store.put_raw(cert, grade_key, None, None, e.status, e.body)
                return "gone"
            last = f"HTTP {e.status}"
            continue
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
            last = f"{type(e).__name__}: {e}"[:200]
            continue
        store.put_raw(cert, grade_key, detail, score, 200, None)
        store.clear_failure("fetch", cert, "")
        return "ok"
    store.add_failure("fetch", cert, "", last)
    return "failed"


async def run_fetch(client, store: Store, certs: list[tuple[str, str | None]], rate: float,
                    workers: int, sleep=asyncio.sleep,
                    progress: Callable[[dict], None] | None = None) -> dict[str, int]:
    limiter = RateLimiter(rate)
    queue: asyncio.Queue = asyncio.Queue()
    for cert, grade_key in certs:
        if not store.has_raw(cert):
            queue.put_nowait((cert, grade_key))
    counts = {"ok": 0, "gone": 0, "failed": 0, "skipped": len(certs) - queue.qsize()}

    async def worker() -> None:
        while True:
            try:
                cert, grade_key = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            counts[await fetch_one(client, store, cert, grade_key, limiter, sleep)] += 1
            if progress:
                progress(counts)

    await asyncio.gather(*(worker() for _ in range(max(1, workers))))
    return counts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_fetch.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-dataset/tagdataset/fetch.py scripts/tag-dataset/tests/test_fetch.py
git commit -m "feat(tag-dataset): rate-limited fetch runner with backoff and gone handling"
```

---

### Task 7: B2 bucket wrapper and download runner

**Files:**
- Create: `scripts/tag-dataset/tagdataset/bucket.py`
- Create: `scripts/tag-dataset/tagdataset/download.py`
- Modify: `scripts/tag-dataset/tests/conftest.py` (add `FakeBucket`, `FakeSession`)
- Create: `scripts/tag-dataset/tests/test_download.py`

**Interfaces:**
- Consumes: `store.Store`, `files.expected_files`, `files.CONTENT_TYPES`, `fetch.BACKOFF`.
- Produces: `bucket.Bucket(endpoint, region, name, key_id, app_key, prefix)` with `key(cert, name) -> str`, `put(cert, name, data: bytes, content_type: str) -> None`, `exists(cert, name) -> bool`, `list_keys() -> set[tuple[str, str]]`. `download.pending_files(store, only_certs: set[str] | None = None) -> list[tuple[str, str, str]]` as `(cert, name, url)`, `download.download_one(session, bucket, store, cert, name, url, sem, sleep) -> str` (`"ok" | "failed"`), `download.run_download(session, bucket, store, items, concurrency, sleep=asyncio.sleep, progress=None) -> dict[str, int]` with keys `ok, failed`. Session is duck-typed: `session.get(url, timeout=...)` as an async context manager whose result has `.status` and `async read()`.

- [ ] **Step 1: Write bucket.py**

`scripts/tag-dataset/tagdataset/bucket.py`:
```python
"""Backblaze B2 via the S3-compatible API (spec §2, §5.3)."""
from __future__ import annotations

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError


class Bucket:
    def __init__(self, endpoint: str, region: str, name: str, key_id: str, app_key: str, prefix: str):
        if not key_id or not app_key:
            raise RuntimeError("Set B2_KEY_ID and B2_APP_KEY in the environment")
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=key_id,
            aws_secret_access_key=app_key,
            config=BotoConfig(retries={"max_attempts": 3, "mode": "standard"}, max_pool_connections=32),
        )
        self.name = name
        self.prefix = prefix.strip("/")

    def key(self, cert: str, name: str) -> str:
        return f"{self.prefix}/{cert}/{name}"

    def put(self, cert: str, name: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.name, Key=self.key(cert, name), Body=data, ContentType=content_type)

    def exists(self, cert: str, name: str) -> bool:
        try:
            self.client.head_object(Bucket=self.name, Key=self.key(cert, name))
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def list_keys(self) -> set[tuple[str, str]]:
        """Every (cert, name) under the prefix. One paginated listing, cheap even at 650k objects."""
        out: set[tuple[str, str]] = set()
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.name, Prefix=self.prefix + "/"):
            for obj in page.get("Contents", []):
                rel = obj["Key"][len(self.prefix) + 1:]
                cert, _, name = rel.partition("/")
                if cert and name:
                    out.add((cert, name))
        return out
```

- [ ] **Step 2: Add fakes to conftest.py**

Append to `scripts/tag-dataset/tests/conftest.py`:
```python
class FakeBucket:
    """In-memory stand-in for tagdataset.bucket.Bucket."""

    def __init__(self, prefix: str = "tag-dataset"):
        self.prefix = prefix
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.fail_names: set[str] = set()       # names whose put() raises

    def key(self, cert, name):
        return f"{self.prefix}/{cert}/{name}"

    def put(self, cert, name, data, content_type):
        if name in self.fail_names:
            raise RuntimeError("bucket write failed")
        self.objects[self.key(cert, name)] = (data, content_type)

    def exists(self, cert, name):
        return self.key(cert, name) in self.objects

    def list_keys(self):
        out = set()
        for k in self.objects:
            cert, _, name = k[len(self.prefix) + 1:].partition("/")
            out.add((cert, name))
        return out


class _FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self._body = body

    async def read(self):
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class FakeSession:
    """Maps url -> bytes, or url -> list of outcomes (bytes | int status | Exception) popped per call."""

    def __init__(self, responses: dict):
        self.responses = {k: (list(v) if isinstance(v, list) else v) for k, v in responses.items()}
        self.calls: list[str] = []

    def get(self, url, timeout=None):
        self.calls.append(url)
        outcome = self.responses[url]
        if isinstance(outcome, list):
            outcome = outcome.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, int):
            return _FakeResponse(outcome, b"")
        return _FakeResponse(200, outcome)


@pytest.fixture
def fake_bucket():
    return FakeBucket()
```

- [ ] **Step 3: Write the failing download tests**

`scripts/tag-dataset/tests/test_download.py`:
```python
import asyncio
import hashlib

from conftest import FakeSession
from tagdataset import download, files
from tagdataset.store import Store


def run(coro):
    return asyncio.run(coro)


async def no_sleep(_):
    pass


def seeded_store(tmp_path, detail_fixture, score_fixture):
    store = Store(str(tmp_path / "t.sqlite"))
    store.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    return store


def test_pending_files_lists_everything_then_nothing(tmp_path, detail_fixture, score_fixture):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    expected = files.expected_files(detail_fixture, score_fixture)
    pending = download.pending_files(store)
    assert [(c, n, u) for c, n, u in pending] == [("C1240631", n, u) for n, u in expected]
    for name, url in expected:
        store.put_file("C1240631", name, url, 1, "h")
    assert download.pending_files(store) == []


def test_pending_files_filters_by_cert(tmp_path, detail_fixture, score_fixture):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    assert download.pending_files(store, only_certs={"OTHER"}) == []
    assert len(download.pending_files(store, only_certs={"C1240631"})) > 0


def test_download_one_uploads_and_records(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = detail_fixture["data"]["imageFileDeskewedFront"]
    body = b"\xff\xd8jpegbytes"
    session = FakeSession({url: body})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       asyncio.Semaphore(4), no_sleep))
    assert result == "ok"
    assert fake_bucket.objects["tag-dataset/C1240631/front.jpg"] == (body, "image/jpeg")
    assert store.has_file("C1240631", "front.jpg")
    row = store.conn.execute("SELECT bytes, sha256 FROM files WHERE cert='C1240631' AND name='front.jpg'").fetchone()
    assert row == (len(body), hashlib.sha256(body).hexdigest())


def test_download_one_png_content_type(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = score_fixture["data"]["imageFileFTL"]
    session = FakeSession({url: b"\x89PNG"})
    run(download.download_one(session, fake_bucket, store, "C1240631", "corner_FTL.png", url,
                              asyncio.Semaphore(4), no_sleep))
    assert fake_bucket.objects["tag-dataset/C1240631/corner_FTL.png"][1] == "image/png"


def test_download_one_retries_then_fails(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [503, 503, 503, 503]})
    slept = []

    async def sleep(s):
        slept.append(s)

    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       asyncio.Semaphore(4), sleep))
    assert result == "failed"
    assert slept == [1, 4, 16]
    assert not store.has_file("C1240631", "front.jpg")
    assert store.list_failures("download") == [("C1240631", "front.jpg", "HTTP 503", 1)]


def test_download_one_recovers_after_transient_error(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [ConnectionError("reset"), b"ok"]})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       asyncio.Semaphore(4), no_sleep))
    assert result == "ok"
    assert store.list_failures("download") == []


def test_download_one_bucket_failure_is_retried_and_recorded(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    fake_bucket.fail_names.add("front.jpg")
    url = "https://cdn/x.jpg"
    session = FakeSession({url: b"ok"})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       asyncio.Semaphore(4), no_sleep))
    assert result == "failed"
    assert store.list_failures("download")[0][2].startswith("RuntimeError")


def test_run_download_processes_all_pending(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    items = download.pending_files(store)
    session = FakeSession({url: b"data-" + name.encode() for _, name, url in items})
    counts = run(download.run_download(session, fake_bucket, store, items, concurrency=4, sleep=no_sleep))
    assert counts == {"ok": len(items), "failed": 0}
    assert download.pending_files(store) == []
    assert len(fake_bucket.objects) == len(items)
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pytest tests/test_download.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.download'`

- [ ] **Step 5: Implement download.py**

`scripts/tag-dataset/tagdataset/download.py`:
```python
"""Stream each expected file from TAG's CDN into the bucket (spec §5.3)."""
from __future__ import annotations

import asyncio
import hashlib
import os
from typing import Callable

import aiohttp

from .fetch import BACKOFF
from .files import CONTENT_TYPES, expected_files
from .store import Store

DOWNLOAD_TIMEOUT = aiohttp.ClientTimeout(total=120)


class HttpStatusError(Exception):
    def __init__(self, status: int):
        super().__init__(f"HTTP {status}")
        self.status = status


def pending_files(store: Store, only_certs: set[str] | None = None) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    for cert, detail, score in store.iter_raw_ok():
        if only_certs is not None and cert not in only_certs:
            continue
        have = store.files_for(cert)
        for name, url in expected_files(detail, score):
            if name not in have:
                out.append((cert, name, url))
    return out


async def _fetch_bytes(session, url: str) -> bytes:
    async with session.get(url, timeout=DOWNLOAD_TIMEOUT) as r:
        if r.status != 200:
            raise HttpStatusError(r.status)
        return await r.read()


async def download_one(session, bucket, store: Store, cert: str, name: str, url: str,
                       sem: asyncio.Semaphore, sleep=asyncio.sleep) -> str:
    content_type = CONTENT_TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    last = "unknown"
    for delay in (0,) + BACKOFF:
        if delay:
            await sleep(delay)
        try:
            async with sem:
                data = await _fetch_bytes(session, url)
            await asyncio.to_thread(bucket.put, cert, name, data, content_type)
        except HttpStatusError as e:
            last = f"HTTP {e.status}"
            continue
        except Exception as e:  # network, bucket, timeout — all retried the same way
            last = f"{type(e).__name__}: {e}"[:200]
            continue
        store.put_file(cert, name, url, len(data), hashlib.sha256(data).hexdigest())
        store.clear_failure("download", cert, name)
        return "ok"
    store.add_failure("download", cert, name, last)
    return "failed"


async def run_download(session, bucket, store: Store, items: list[tuple[str, str, str]], concurrency: int,
                       sleep=asyncio.sleep, progress: Callable[[dict], None] | None = None) -> dict[str, int]:
    sem = asyncio.Semaphore(max(1, concurrency))
    queue: asyncio.Queue = asyncio.Queue()
    for item in items:
        queue.put_nowait(item)
    counts = {"ok": 0, "failed": 0}

    async def worker() -> None:
        while True:
            try:
                cert, name, url = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            counts[await download_one(session, bucket, store, cert, name, url, sem, sleep)] += 1
            if progress:
                progress(counts)

    await asyncio.gather(*(worker() for _ in range(max(1, concurrency))))
    return counts
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_download.py -v`
Expected: 8 passed

- [ ] **Step 7: Commit**

```bash
git add scripts/tag-dataset/tagdataset/bucket.py scripts/tag-dataset/tagdataset/download.py scripts/tag-dataset/tests/conftest.py scripts/tag-dataset/tests/test_download.py
git commit -m "feat(tag-dataset): B2 bucket wrapper and streaming download runner"
```

---

### Task 8: Verify

**Files:**
- Create: `scripts/tag-dataset/tagdataset/verify.py`
- Create: `scripts/tag-dataset/tests/test_verify.py`

**Interfaces:**
- Consumes: `store.Store`, `files.expected_files`, bucket duck type with `list_keys()`.
- Produces: `verify.verify(store, bucket=None) -> pandas.DataFrame` with columns `cert, name, url, reason` (reason ∈ `not_in_files_table`, `missing_in_bucket`); `verify.completeness_by_grade(store, missing: pandas.DataFrame) -> pandas.DataFrame` with columns `grade_key, cards, expected_files, missing_files, complete_cards`.

- [ ] **Step 1: Write the failing tests**

`scripts/tag-dataset/tests/test_verify.py`:
```python
import pandas as pd

from tagdataset import files, verify
from tagdataset.store import Store


def seeded(tmp_path, detail_fixture, score_fixture):
    store = Store(str(tmp_path / "t.sqlite"))
    store.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    store.put_raw("GONE", "9", None, None, 404, "nf")
    return store


def test_verify_reports_files_not_yet_downloaded(tmp_path, detail_fixture, score_fixture):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    missing = verify.verify(store)
    expected = files.expected_files(detail_fixture, score_fixture)
    assert list(missing.columns) == ["cert", "name", "url", "reason"]
    assert len(missing) == len(expected)
    assert set(missing.reason) == {"not_in_files_table"}
    assert set(missing.cert) == {"C1240631"}


def test_verify_clean_when_files_table_and_bucket_agree(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    for name, url in files.expected_files(detail_fixture, score_fixture):
        store.put_file("C1240631", name, url, 1, "h")
        fake_bucket.put("C1240631", name, b"x", "image/jpeg")
    assert verify.verify(store).empty
    assert verify.verify(store, fake_bucket).empty


def test_verify_detects_bucket_gap(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    for name, url in files.expected_files(detail_fixture, score_fixture):
        store.put_file("C1240631", name, url, 1, "h")
        if name != "back.jpg":
            fake_bucket.put("C1240631", name, b"x", "image/jpeg")
    missing = verify.verify(store, fake_bucket)
    assert missing.to_dict("records") == [{
        "cert": "C1240631", "name": "back.jpg",
        "url": detail_fixture["data"]["imageFileDeskewedBack"], "reason": "missing_in_bucket"}]


def test_completeness_by_grade(tmp_path, detail_fixture, score_fixture):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    store.put_raw("OTHER7", "7", detail_fixture, score_fixture, 200, None)
    for name, url in files.expected_files(detail_fixture, score_fixture):
        store.put_file("OTHER7", name, url, 1, "h")
    missing = verify.verify(store)
    table = verify.completeness_by_grade(store, missing)
    assert list(table.columns) == ["grade_key", "cards", "expected_files", "missing_files", "complete_cards"]
    row = table[table.grade_key == "7"].iloc[0]
    n = len(files.expected_files(detail_fixture, score_fixture))
    assert (row.cards, row.expected_files, row.missing_files, row.complete_cards) == (2, 2 * n, n, 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_verify.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.verify'`

- [ ] **Step 3: Implement verify.py**

`scripts/tag-dataset/tagdataset/verify.py`:
```python
"""Compare what the store says should exist with what landed (spec §5.4)."""
from __future__ import annotations

import pandas as pd

from .files import expected_files
from .store import Store

MISSING_COLUMNS = ["cert", "name", "url", "reason"]


def verify(store: Store, bucket=None) -> pd.DataFrame:
    in_bucket = bucket.list_keys() if bucket is not None else None
    rows = []
    for cert, detail, score in store.iter_raw_ok():
        have = store.files_for(cert)
        for name, url in expected_files(detail, score):
            if name not in have:
                rows.append((cert, name, url, "not_in_files_table"))
            elif in_bucket is not None and (cert, name) not in in_bucket:
                rows.append((cert, name, url, "missing_in_bucket"))
    return pd.DataFrame(rows, columns=MISSING_COLUMNS)


def completeness_by_grade(store: Store, missing: pd.DataFrame) -> pd.DataFrame:
    missing_by_cert = missing.groupby("cert").size().to_dict() if len(missing) else {}
    rows = []
    for cert, detail, score in store.iter_raw_ok():
        n_expected = len(expected_files(detail, score))
        n_missing = missing_by_cert.get(cert, 0)
        rows.append({"grade_key": store.grade_key_for(cert) or "?", "cert": cert,
                     "expected": n_expected, "missing": n_missing, "complete": n_missing == 0})
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["grade_key", "cards", "expected_files", "missing_files", "complete_cards"])
    out = df.groupby("grade_key").agg(cards=("cert", "count"), expected_files=("expected", "sum"),
                                      missing_files=("missing", "sum"), complete_cards=("complete", "sum"))
    return out.reset_index()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_verify.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-dataset/tagdataset/verify.py scripts/tag-dataset/tests/test_verify.py
git commit -m "feat(tag-dataset): verify expected files against store and bucket"
```

---

### Task 9: CLI, README, and the 20-cert end-to-end smoke

**Files:**
- Create: `scripts/tag-dataset/tagdataset/cli.py`
- Create: `scripts/tag-dataset/tagdataset/__main__.py`
- Create: `scripts/tag-dataset/README.md`
- Create: `scripts/tag-dataset/tests/fixtures/smoke_certs.txt`

**Interfaces:**
- Consumes: everything above.
- Produces: `python -m tagdataset {sample|fetch|download|verify}` as documented in the README. Exit code 0 on success; `verify` exits 1 if anything is missing.

- [ ] **Step 1: Write cli.py and __main__.py**

`scripts/tag-dataset/tagdataset/__main__.py`:
```python
from .cli import main

raise SystemExit(main())
```

`scripts/tag-dataset/tagdataset/cli.py`:
```python
"""Command line: sample / fetch / download / verify (spec §5)."""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

import aiohttp
import pandas as pd

from . import download as dl
from . import sample as smp
from . import verify as vf
from .bucket import Bucket
from .config import load_config
from .fetch import run_fetch
from .store import Store
from .tagapi import TagClient


def _bucket(cfg) -> Bucket:
    return Bucket(cfg.endpoint, cfg.region, cfg.bucket, cfg.key_id, cfg.app_key, cfg.prefix)


def _progress(label: str):
    t0 = time.monotonic()
    last = [0.0]

    def show(counts: dict) -> None:
        now = time.monotonic()
        if now - last[0] < 2 and sum(counts.values()) % 100:
            return
        last[0] = now
        done = sum(v for k, v in counts.items() if k != "skipped")
        rate = done / max(now - t0, 1e-6)
        print(f"\r{label}: {counts}  {rate:.1f}/s", end="", flush=True)

    return show


def cmd_sample(args, cfg) -> int:
    rows = smp.load_cache(args.cache)
    store = Store(cfg.db_path)
    if args.certs_file:
        certs = [c.strip() for c in Path(args.certs_file).read_text().splitlines() if c.strip()]
        df = smp.sample_from_cert_list(rows, certs)
    else:
        df = smp.build_sample(rows, exclude=store.certs_with_raw(), seed=args.seed)
    store.close()
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(args.out, index=False)
    print(f"wrote {len(df)} certs to {args.out}")
    print(df.groupby("grade_key", dropna=False).size().to_string())
    return 0


def cmd_fetch(args, cfg) -> int:
    store = Store(cfg.db_path)
    if args.retry_failures:
        certs = [(cert, store.grade_key_for(cert)) for cert, _, _, _ in store.list_failures("fetch")]
        for cert, _ in certs:
            store.clear_failure("fetch", cert, "")
    else:
        df = pd.read_parquet(args.certs)
        certs = [(str(r.cert), (None if pd.isna(r.grade_key) else str(r.grade_key))) for r in df.itertuples()]

    async def go():
        async with aiohttp.ClientSession() as session:
            return await run_fetch(TagClient(session), store, certs, args.rate or cfg.rate,
                                   args.workers or cfg.workers, progress=_progress("fetch"))

    counts = asyncio.run(go())
    print(f"\nfetch done: {counts}")
    print("store:", store.counts())
    store.close()
    return 0


def cmd_download(args, cfg) -> int:
    store = Store(cfg.db_path)
    bucket = _bucket(cfg)
    if args.retry_missing:
        m = pd.read_parquet(args.retry_missing)
        items = [(str(r.cert), str(r.name), str(r.url)) for r in m.itertuples()]
    else:
        only = None
        if args.certs_file:
            only = {c.strip() for c in Path(args.certs_file).read_text().splitlines() if c.strip()}
        items = dl.pending_files(store, only)
    print(f"{len(items)} files to download")

    async def go():
        async with aiohttp.ClientSession() as session:
            return await dl.run_download(session, bucket, store, items, args.concurrency or cfg.concurrency,
                                         progress=_progress("download"))

    counts = asyncio.run(go())
    print(f"\ndownload done: {counts}")
    print("store:", store.counts())
    store.close()
    return 0


def cmd_verify(args, cfg) -> int:
    store = Store(cfg.db_path)
    bucket = _bucket(cfg) if args.check_bucket else None
    missing = vf.verify(store, bucket)
    table = vf.completeness_by_grade(store, missing)
    print(table.to_string(index=False))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    missing.to_parquet(args.out, index=False)
    print(f"{len(missing)} missing files written to {args.out}")
    store.close()
    return 1 if len(missing) else 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tagdataset")
    p.add_argument("--config", default="config.toml")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sample", help="pick certs from the browse cache")
    s.add_argument("--cache", required=True, help="path to tag_cache.json")
    s.add_argument("--out", default="data/certs.parquet")
    s.add_argument("--seed", type=int, default=42)
    s.add_argument("--certs-file", help="text file of certs, one per line (overrides the composition rule)")
    s.set_defaults(func=cmd_sample)

    f = sub.add_parser("fetch", help="fetch detail+score for sampled certs")
    f.add_argument("--certs", default="data/certs.parquet")
    f.add_argument("--rate", type=float)
    f.add_argument("--workers", type=int)
    f.add_argument("--retry-failures", action="store_true")
    f.set_defaults(func=cmd_fetch)

    d = sub.add_parser("download", help="upload every expected image to the bucket")
    d.add_argument("--concurrency", type=int)
    d.add_argument("--certs-file", help="limit to these certs")
    d.add_argument("--retry-missing", help="missing.parquet from verify")
    d.set_defaults(func=cmd_download)

    v = sub.add_parser("verify", help="report files that should exist but do not")
    v.add_argument("--out", default="data/missing.parquet")
    v.add_argument("--check-bucket", action="store_true", help="also list the bucket and compare")
    v.set_defaults(func=cmd_verify)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    return args.func(args, cfg)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Write the README**

`scripts/tag-dataset/README.md`:
```markdown
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
```

- [ ] **Step 3: Create the smoke cert list**

Run from `scripts/tag-dataset` (venv active):
```powershell
python -c "import json; t=json.load(open('../Tag scraper/training.json', encoding='utf-8')); certs=sorted({c['cert'] for g in t['cards_by_grade'].values() for c in g}); open('tests/fixtures/smoke_certs.txt','w').write('\n'.join(certs[:20])+'\n'); print(certs[:20])"
```
Expected: prints 20 certs; `tests/fixtures/smoke_certs.txt` has 20 lines.

- [ ] **Step 4: Run the full unit suite**

Run: `pytest -q`
Expected: all tests pass (6 + 5 + 6 + 5 + 5 + 7 + 8 + 4 = 46 passed).

- [ ] **Step 5: End-to-end smoke into a scratch prefix**

Create `config.smoke.toml` next to `config.toml` (already gitignored from Task 1). Copy `config.toml` and change two lines: `db = "data/smoke.sqlite"` and `prefix = "scratch/smoke"`.

Run, with `B2_KEY_ID` and `B2_APP_KEY` set:
```powershell
python -m tagdataset --config config.smoke.toml sample --cache "../Tag scraper/tag_cache.json" --certs-file tests/fixtures/smoke_certs.txt --out data/smoke_certs.parquet
python -m tagdataset --config config.smoke.toml fetch --certs data/smoke_certs.parquet
python -m tagdataset --config config.smoke.toml download
python -m tagdataset --config config.smoke.toml verify --check-bucket --out data/smoke_missing.parquet
```
Expected: `sample` prints `wrote 20 certs`; `fetch` ends with `ok: 20` (or `gone` for any cert TAG has since removed); `download` ends with `failed: 0`; `verify` prints a completeness table where `missing_files` is 0 on every row and exits 0. Check the B2 console: `scratch/smoke/<cert>/` folders exist with 22+ files each.

If `verify` reports missing files, run `python -m tagdataset --config config.smoke.toml download --retry-missing data/smoke_missing.parquet` once and verify again. If still missing, stop and report which URLs fail; do not change the retry logic to paper over it.

- [ ] **Step 6: Commit**

```bash
git add scripts/tag-dataset/tagdataset/cli.py scripts/tag-dataset/tagdataset/__main__.py scripts/tag-dataset/README.md scripts/tag-dataset/tests/fixtures/smoke_certs.txt
git commit -m "feat(tag-dataset): CLI, README, and 20-cert end-to-end smoke"
```

---

### Task 10: Pilot re-fetch of the 507 certs

**Files:**
- Create: `scripts/tag-dataset/data/pilot_certs.txt` (gitignored; generated)
- Modify: `scripts/tag-dataset/README.md` (append a "Status" section)

**Interfaces:**
- Consumes: the CLI from Task 9, the real `config.toml` (prefix `tag-dataset`).

- [ ] **Step 1: Extract the 507 pilot certs**

Run from `scripts/tag-dataset` (venv active):
```powershell
python -c "import json; t=json.load(open('../Tag scraper/training.json', encoding='utf-8')); certs=sorted({c['cert'] for g in t['cards_by_grade'].values() for c in g}); open('data/pilot_certs.txt','w').write('\n'.join(certs)+'\n'); print(len(certs))"
```
Expected: prints `507`.

- [ ] **Step 2: Sample, fetch, download, verify against the real prefix**

```powershell
python -m tagdataset sample --cache "../Tag scraper/tag_cache.json" --certs-file data/pilot_certs.txt --out data/pilot_certs.parquet
python -m tagdataset fetch --certs data/pilot_certs.parquet
python -m tagdataset download
python -m tagdataset verify --check-bucket
```
Expected: `sample` writes 507 rows; `fetch` reports about 507 ok (a handful of `gone` is acceptable and must be listed in the final message); `download` reports roughly 507 × 22 to 25 files with `failed: 0`; `verify` shows `missing_files` 0 for every grade and exits 0. If `verify` exits 1, run `download --retry-missing data/missing.parquet` once and verify again; report anything still missing with its URL and HTTP status from the `failures` table:
```powershell
python -c "from tagdataset.store import Store; s=Store('data/raw.sqlite'); [print(r) for r in s.list_failures('download')]; print(s.counts())"
```

- [ ] **Step 3: Record the outcome in the README**

Append to `scripts/tag-dataset/README.md`:
```markdown
## Status

| Date | Run | Certs | Files | Notes |
|---|---|---|---|---|
| 2026-09-XX | pilot re-fetch | 507 | NNNN | replace XX/NNNN with the real values from `verify`; list any `gone` certs here |
```
Fill in the real date, file count, and any gone or still-missing certs.

- [ ] **Step 4: Commit**

```bash
git add scripts/tag-dataset/README.md
git commit -m "docs(tag-dataset): record pilot re-fetch results"
```

---

## Self-review

**Spec coverage.** §5.1 sample → Task 4 and CLI `sample` (Task 9). §5.2 fetch with rate limit, backoff, 403/404 handling → Task 6. §5.3 download naming, streaming, concurrency, retries, no slab images → Tasks 5 and 7. §5.4 verify with bucket comparison and per-grade completeness → Task 8, `--check-bucket` in Task 9. §5.5 pilot migration → Task 10. §11 idempotence, failures table, primary-key dedupe → Task 3 and the `has_raw`/`files_for` skips in Tasks 6 and 7. §12 unit tests for sample rule, decrypt fixture, and the 20-cert integration with zero missing → Tasks 1, 2, 9. §14 bucket region → README setup step. Not in this plan by design: `build`, `stats`, splits (spec §6, next plan).

**Placeholder scan.** The only intentional placeholders are `2026-09-XX`/`NNNN` in Task 10 Step 3, which the executor fills from real output; the step says so.

**Type consistency.** `Store.iter_raw_ok()` yields `(cert, detail, score)` with `score` as `{}` when absent; `expected_files` tolerates `None` or `{}`. `pending_files` and `verify` both return `(cert, name, url)` shapes that `run_download` and `--retry-missing` consume. `RateLimiter`, `BACKOFF`, `TagHttpError`, `FakeBucket`, `FakeSession` names match across tasks. `COLUMNS` in `sample.py` matches the columns asserted in tests and read by `cmd_fetch` (`cert`, `grade_key`).
