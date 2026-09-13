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
