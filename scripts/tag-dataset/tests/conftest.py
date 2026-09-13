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
