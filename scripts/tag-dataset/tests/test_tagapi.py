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
