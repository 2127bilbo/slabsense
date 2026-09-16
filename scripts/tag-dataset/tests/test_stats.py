import pandas as pd

from tagdataset import build, stats
from tagdataset.store import Store


def _built(tmp_path, detail_fixture, score_fixture):
    s = Store(str(tmp_path / "t.sqlite"))
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    d2 = {"data": {**detail_fixture["data"], "certificateValue": "X2", "uuid": "u2", "grade": "9 MINT",
                   "scoreTotal": None,
                   "pop": {**detail_fixture["data"]["pop"], "grade": "9", "gradeAlias": "MINT"}}}
    s2 = {"data": {**score_fixture["data"], "scoreTotal": None}}
    s2["data"]["surfaceFrontData"] = {"annotations": {"width": 100, "height": 100, "markers": [
        {"ID": 1, "typeName": "Brand_New_Marker", "top": 1, "left": 1, "width": 2, "height": 2, "scoreDeduction": 5}]}}
    s.put_raw("X2", "9", d2, s2, 200, None)
    for name in ("front.jpg", "back.jpg", "ding_1.jpg"):
        s.put_file("C1240631", name, "u", 1, "h")
    out = tmp_path / "out"
    build.build(s, str(out), seed=1, splits_path=tmp_path / "s.parquet")
    return str(out)


def test_report_sections_and_key_facts(tmp_path, detail_fixture, score_fixture):
    out = _built(tmp_path, detail_fixture, score_fixture)
    text = stats.report(out)
    for h in stats.SECTIONS:
        assert h in text
    assert "7 NEAR MINT" in text and "9 MINT" in text
    assert "Brand_New_Marker" in text                      # listed under unmapped
    assert "UNKNOWN" in text
    assert "score_total present: 1/2" in text
    assert "scoreBTLCAngle" in text or "score_angle" in text  # null report names the column
    assert "ding crops without upload" in text


def test_report_on_empty_dataset(tmp_path):
    s = Store(str(tmp_path / "e.sqlite"))
    out = tmp_path / "out"
    build.build(s, str(out), splits_path=tmp_path / "s.parquet")
    text = stats.report(str(out))
    assert "cards: 0" in text
    # Both diagnostics sections (item 7) must handle an empty surface table without raising.
    assert "== markers with rotation ==" in text
    assert "== boxes out of range ==" in text


# ── unmapped fallback pairs (item 1) ─────────────────────────────────────
def test_report_lists_fallback_pairs_missing_from_type_map(tmp_path, detail_fixture, score_fixture):
    ann = score_fixture["data"]["surfaceFrontData"]["annotations"]
    marker = {**ann["markers"][0], "typeName": "FrameMarker_Ink", "subtypeName": "SOMETHING NEW"}
    score = {"data": {**score_fixture["data"],
                       "surfaceFrontData": {"annotations": {**ann, "markers": [marker]}}}}
    s = Store(str(tmp_path / "t.sqlite"))
    s.put_raw("C1240631", "7", detail_fixture, score, 200, None)
    out = tmp_path / "out"
    build.build(s, str(out), seed=1, splits_path=tmp_path / "s.parquet")
    text = stats.report(str(out))
    assert "fallback pairs" in text
    assert "FrameMarker_Ink" in text and "SOMETHING NEW" in text


# ── rotation and range diagnostics (item 7) ──────────────────────────────
def test_report_rotation_and_out_of_range_sections(tmp_path, detail_fixture, score_fixture):
    ann = score_fixture["data"]["surfaceFrontData"]["annotations"]
    W, H = ann["width"], ann["height"]
    rotated = {"ID": 100, "typeName": "LineMarker_Roller", "top": 10, "left": 10, "width": 10, "height": 10,
               "rotationAngle": 15, "scoreDeduction": 5}
    out_of_range = {"ID": 101, "typeName": "LineMarker_Roller", "top": -5, "left": W - 2, "width": 10, "height": 10,
                     "scoreDeduction": 5}
    score = {"data": {**score_fixture["data"],
                       "surfaceFrontData": {"annotations": {**ann, "markers": ann["markers"] + [rotated, out_of_range]}}}}
    s = Store(str(tmp_path / "t.sqlite"))
    s.put_raw("C1240631", "7", detail_fixture, score, 200, None)
    out = tmp_path / "out"
    build.build(s, str(out), seed=1, splits_path=tmp_path / "s.parquet")
    text = stats.report(str(out))
    assert "rotated markers: 1 {'Line': 1}" in text
    assert "boxes out of range: 1" in text


# ── rotated-box expansion line (item 2) ───────────────────────────────────
def test_report_rotation_expansion_line_counts_boxes_that_grew_more_than_1pct(tmp_path, detail_fixture, score_fixture):
    ann = score_fixture["data"]["surfaceFrontData"]["annotations"]
    W, H = ann["width"], ann["height"]
    small_rotation = {"ID": 100, "typeName": "LineMarker_Roller", "top": 10, "left": 10, "width": 10, "height": 10,
                       "rotationAngle": 15, "scoreDeduction": 5}
    big_rotation = {"ID": 102, "typeName": "FrameMarker_ESW_CSW", "location": "TL", "top": 10, "left": 10,
                     "width": 100, "height": 10, "rotationAngle": 90, "scoreDeduction": 5}
    score = {"data": {**score_fixture["data"], "surfaceFrontData": {
        "annotations": {**ann, "markers": ann["markers"] + [small_rotation, big_rotation]}}}}
    s = Store(str(tmp_path / "t.sqlite"))
    s.put_raw("C1240631", "7", detail_fixture, score, 200, None)
    out = tmp_path / "out"
    build.build(s, str(out), seed=1, splits_path=tmp_path / "s.parquet")
    text = stats.report(str(out))
    assert "rotated markers: 2 " in text
    assert "expanded >1% of card: 1" in text


# ── aspect-mismatch cert list (item 3) ────────────────────────────────────
def test_report_lists_worst_aspect_mismatches_sorted(tmp_path, detail_fixture, score_fixture):
    s = Store(str(tmp_path / "t.sqlite"))

    def add(cert, front_w, front_h, image_w, image_h):
        d = {"data": {**detail_fixture["data"], "uuid": cert, "imageWidth": image_w, "imageHeight": image_h}}
        ann = score_fixture["data"]["surfaceFrontData"]["annotations"]
        back_ann = score_fixture["data"]["surfaceBackData"]["annotations"]
        # Keep the back side's canvas aspect matching the image exactly, so only the front
        # side (under test) can show up as an offender.
        sc = {"data": {**score_fixture["data"],
                       "surfaceFrontData": {"annotations": {**ann, "width": front_w, "height": front_h}},
                       "surfaceBackData": {"annotations": {**back_ann, "width": image_w, "height": image_h}}}}
        s.put_raw(cert, "7", d, sc, 200, None)

    add("OK1", 500, 500, 1000, 1000)          # ratio 1.0 -> not an offender
    add("BAD_SMALL", 550, 500, 1000, 1000)    # |ratio-1| = 0.10
    add("BAD_BIG", 700, 500, 1000, 1000)      # |ratio-1| = 0.40 (worst)
    out = tmp_path / "out"
    build.build(s, str(out), seed=1, splits_path=tmp_path / "s.parquet")
    text = stats.report(str(out))
    assert "offending certs (cert, side, ratio), worst first:" in text
    tail = text.split("offending certs (cert, side, ratio), worst first:")[1]
    assert "OK1" not in tail
    assert tail.index("BAD_BIG") < tail.index("BAD_SMALL")


# ── slot targets (corner/edge redesign Task 1) ────────────────────────────
def test_report_slot_targets_section_present_and_last(tmp_path, detail_fixture, score_fixture):
    out = _built(tmp_path, detail_fixture, score_fixture)
    text = stats.report(out)
    assert "== slot targets ==" in text
    assert stats.SECTIONS[-1] == "== slot targets =="


def test_report_slot_targets_reports_fixture_counts(tmp_path, detail_fixture, score_fixture):
    """C1240631 has three back-side CORNER WEAR dings (TL/BL/BR), so at least one corner
    slot must show ding_count > 0."""
    out = _built(tmp_path, detail_fixture, score_fixture)
    text = stats.report(out)
    assert "corners: ding_count>0: " in text
    n_positive = int(text.split("corners: ding_count>0: ")[1].split("/")[0])
    assert n_positive >= 1
    assert "edges: ding_count>0: " in text
    assert "dings unassigned to a slot:" in text
    assert "correlation(sum marker_deduction, 1000 - rollup_corners)" in text
    assert "correlation(sum marker_deduction, 1000 - rollup_edges)" in text


def test_report_slot_targets_handles_empty_dataset(tmp_path):
    s = Store(str(tmp_path / "e.sqlite"))
    out = tmp_path / "out"
    build.build(s, str(out), splits_path=tmp_path / "s.parquet")
    text = stats.report(str(out))
    assert "== slot targets ==" in text
    assert "corners: no rows" in text
    assert "edges: no rows" in text
    assert "dings unassigned to a slot: 0" in text
