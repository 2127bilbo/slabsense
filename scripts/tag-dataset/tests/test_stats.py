import pandas as pd

from tagdataset import build, stats
from tagdataset.store import Store


def _built(tmp_path, detail_fixture, score_fixture):
    s = Store(str(tmp_path / "t.sqlite"))
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    d2 = {"data": {**detail_fixture["data"], "certificateValue": "X2", "uuid": "u2", "grade": "9 MINT",
                   "pop": {**detail_fixture["data"]["pop"], "grade": "9", "gradeAlias": "MINT"}}}
    s2 = {"data": {**score_fixture["data"], "scoreTotal": 901}}
    s2["data"]["surfaceFrontData"] = {"annotations": {"width": 100, "height": 100, "markers": [
        {"ID": 1, "typeName": "Brand_New_Marker", "top": 1, "left": 1, "width": 2, "height": 2, "scoreDeduction": 5}]}}
    s.put_raw("X2", "9", d2, s2, 200, None)
    for name in ("front.jpg", "back.jpg", "ding_1.jpg"):
        s.put_file("C1240631", name, "u", 1, "h")
    out = tmp_path / "out"
    build.build(s, str(out), seed=1)
    return str(out)


def test_report_sections_and_key_facts(tmp_path, detail_fixture, score_fixture):
    out = _built(tmp_path, detail_fixture, score_fixture)
    text = stats.report(out)
    for h in stats.SECTIONS:
        assert h in text
    assert "7 NEAR MINT" in text and "9 MINT" in text
    assert "Brand_New_Marker" in text                      # listed under unmapped
    assert "UNKNOWN" in text
    assert "score_total present: 2/2" in text
    assert "scoreBTLCAngle" in text or "score_angle" in text  # null report names the column
    assert "ding crops without upload" in text


def test_report_on_empty_dataset(tmp_path):
    s = Store(str(tmp_path / "e.sqlite"))
    out = tmp_path / "out"
    build.build(s, str(out))
    text = stats.report(str(out))
    assert "cards: 0" in text
