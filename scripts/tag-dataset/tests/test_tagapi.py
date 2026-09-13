import asyncio
import hashlib
import json

import pytest

from tagdataset import tagapi


class FakeResponse:
    def __init__(self, status: int, body: str):
        self.status = status
        self._body = body

    async def text(self) -> str:
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


class FakeSession:
    """Minimal stand-in for aiohttp.ClientSession, recording calls."""

    def __init__(self, status: int, body: str):
        self.status = status
        self.body = body
        self.calls = []

    def get(self, url, headers=None, timeout=None):
        self.calls.append((url, headers))
        return FakeResponse(self.status, self.body)


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


def test_detail_returns_decrypted_fixture_and_signs_request(encrypted_fixture, detail_fixture):
    session = FakeSession(200, encrypted_fixture)
    client = tagapi.TagClient(session)

    result = asyncio.run(client.detail("C1240631"))

    assert result == detail_fixture
    assert len(session.calls) == 1
    url, headers = session.calls[0]
    assert url == "https://api.taggrading.com/graded-cards/public/detail/C1240631"
    assert headers["x-tag-key"] == tagapi.make_key("C1240631")


def test_score_returns_plain_json_and_signs_request_with_annotation_flag():
    body = json.dumps({"data": {"ok": True}})
    session = FakeSession(200, body)
    client = tagapi.TagClient(session)

    result = asyncio.run(client.score("C1240631"))

    assert result == {"data": {"ok": True}}
    assert len(session.calls) == 1
    url, headers = session.calls[0]
    assert url.endswith("/graded-cards/public/score/C1240631?includeAnnotation=true")
    assert headers["x-tag-key"] == tagapi.make_key("C1240631", "true")


def test_detail_raises_tag_http_error_on_403_with_status_and_body_preserved():
    session = FakeSession(403, "Forbidden")
    client = tagapi.TagClient(session)

    with pytest.raises(tagapi.TagHttpError) as exc_info:
        asyncio.run(client.detail("X"))

    assert exc_info.value.status == 403
    assert exc_info.value.body == "Forbidden"


def test_detail_raises_tag_http_error_on_500():
    session = FakeSession(500, "Internal Server Error")
    client = tagapi.TagClient(session)

    with pytest.raises(tagapi.TagHttpError) as exc_info:
        asyncio.run(client.detail("X"))

    assert exc_info.value.status == 500
