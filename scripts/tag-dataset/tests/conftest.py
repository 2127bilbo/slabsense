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
    """Maps url -> bytes, or url -> list of outcomes popped per call.

    An outcome is bytes (200 with that body), an int status (that status with an
    empty body), a (status, body_bytes) tuple, or an Exception to raise.
    """

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
        if isinstance(outcome, tuple):
            status, body = outcome
            return _FakeResponse(status, body)
        if isinstance(outcome, int):
            return _FakeResponse(outcome, b"")
        return _FakeResponse(200, outcome)


@pytest.fixture
def fake_bucket():
    return FakeBucket()
