import math

from tagdataset import files, labels
from tagdataset.files import CORNER_KEYS, EDGE_KEYS


# ── type map ──────────────────────────────────────────────────────────────
def test_map_engine_type_prefers_location_for_esw():
    assert labels.map_engine_type("FrameMarker_ESW_CSW", None, "TL") == "CORNER"
    assert labels.map_engine_type("FrameMarker_ESW_CSW", None, "R") == "EDGE"
    assert labels.map_engine_type("FrameMarker_ESW_CSW", None, None) == "EDGE"


def test_map_engine_type_prefers_subtype_for_ink():
    assert labels.map_engine_type("FrameMarker_Ink", "DENTS", None) == "DENT"
    assert labels.map_engine_type("FrameMarker_Ink", None, None) == "PRINT_DEFECT"
    assert labels.map_engine_type("FrameMarker_Ink", "", None) == "PRINT_DEFECT"
    # An unreviewed subtype must not fall through to the bare type's mapping.
    assert labels.map_engine_type("FrameMarker_Ink", "SOMETHING NEW", None) == "UNKNOWN"


def test_map_engine_type_ding_strings_and_unknown():
    assert labels.map_engine_type("CORNER WEAR", None, "TOP LEFT") == "CORNER"
    assert labels.map_engine_type("CENTERING", None, None) == "SKIP"
    assert labels.map_engine_type("Nope_Marker", None, None) == "UNKNOWN"


def test_map_engine_type_new_full_build_types():
    """Item 1: new type_map.json entries surfaced by the live UNKNOWN report."""
    assert labels.map_engine_type("FrameMarker_Ink", "GLOSS", None) == "PLAY_WEAR"
    assert labels.map_engine_type("FrameMarker_OtherDamage", "PIN HOLE(S)", None) == "TEAR"
    assert labels.map_engine_type("FrameMarker_OtherDamage", "TAPE", None) == "STAIN"
    assert labels.map_engine_type("SURFACE / GLOSS", None, None) == "PLAY_WEAR"
    assert labels.map_engine_type("SURFACE / PIN HOLE(S)", None, None) == "TEAR"
    assert labels.map_engine_type("SURFACE / TAPE", None, None) == "STAIN"
    assert labels.map_engine_type("SURFACE/SCRATCH(ES)", None, None) == "SCRATCH"


def test_map_engine_type_frame_esw_csw_location_classes():
    """Item 1: FRAMEMARKER_ESW_CSW (dings casing) resolved via location class, with
    bare-type fallback when the location doesn't reduce to a known class."""
    assert labels.map_engine_type("FRAMEMARKER_ESW_CSW", None, "TL") == "CORNER"
    assert labels.map_engine_type("FRAMEMARKER_ESW_CSW", None, "L") == "EDGE"
    assert labels.map_engine_type("FRAMEMARKER_ESW_CSW", None, None) == "EDGE"


def test_ding_location_class():
    assert labels.ding_location_class("TOP LEFT") == "TL"
    assert labels.ding_location_class("TOP RIGHT") == "TR"
    assert labels.ding_location_class("BOTTOM LEFT") == "BL"
    assert labels.ding_location_class("BOTTOM RIGHT") == "BR"
    assert labels.ding_location_class("TOP") == "T"
    assert labels.ding_location_class("BOTTOM") == "B"
    assert labels.ding_location_class("LEFT") == "L"
    assert labels.ding_location_class("RIGHT") == "R"
    # lower-case input still resolves (locations are upper-cased before matching)
    assert labels.ding_location_class("top left") == "TL"
    # non-exact locations (interior/edge-center words, or corner variants missing a space)
    # fall back to None so map_engine_type uses the bare type.
    assert labels.ding_location_class("MIDDLE LEFT") is None
    assert labels.ding_location_class("TOP CENTER") is None
    assert labels.ding_location_class("BOTTOMLEFT") is None
    assert labels.ding_location_class(None) is None


def test_ding_location_class_is_whitespace_tolerant():
    assert labels.ding_location_class(" TOP LEFT") == "TL"
    assert labels.ding_location_class("TOP LEFT ") == "TL"
    assert labels.ding_location_class("TOP  LEFT") == "TL"
    assert labels.ding_location_class("bottom right") == "BR"
    assert labels.ding_location_class("") is None
    assert labels.ding_location_class(None) is None


def test_ding_rows_uses_location_class_for_engine_type():
    """Item 1: ding_rows must derive a location class from Location before mapping, so a
    corner-only key like FRAMEMARKER_ESW_CSW|corner can match."""
    detail = {"data": {"imageWidth": 1000, "imageHeight": 2000, "dingsJSON": {"Dings": [
        {"Ordering": 1, "Side": "FRONT", "Type": "FRAMEMARKER_ESW_CSW", "Location": "TOP LEFT",
         "LocationX": 1, "LocationY": 1, "Width": 1, "Height": 1},
        {"Ordering": 2, "Side": "FRONT", "Type": "FRAMEMARKER_ESW_CSW", "Location": "LEFT",
         "LocationX": 1, "LocationY": 1, "Width": 1, "Height": 1},
        {"Ordering": 3, "Side": "FRONT", "Type": "FRAMEMARKER_ESW_CSW", "Location": "MIDDLE LEFT",
         "LocationX": 1, "LocationY": 1, "Width": 1, "Height": 1},
        {"Ordering": 4, "Side": "FRONT", "Type": "CORNER WEAR", "Location": "TOP LEFT",
         "LocationX": 1, "LocationY": 1, "Width": 1, "Height": 1},
    ]}}}
    rows = labels.ding_rows("X", detail)
    assert [r["engine_type"] for r in rows] == ["CORNER", "EDGE", "EDGE", "CORNER"]


# ── card row ──────────────────────────────────────────────────────────────
def test_card_row_from_fixture(detail_fixture, score_fixture):
    row = labels.card_row("C1240631", detail_fixture, score_fixture)
    assert list(row.keys()) == labels.MANIFEST_COLUMNS
    d = detail_fixture["data"]; s = score_fixture["data"]
    assert row["cert"] == "C1240631" and row["uuid"] == d["uuid"]
    assert row["grade_label"] == d["grade"]
    assert row["grade_num"] == float(d["pop"]["grade"])
    assert row["is_pristine"] is False
    assert row["era"] == "2004-2010" and row["year"] == 2008
    assert row["set_name"] == d["cardSet"]["setName"] and row["card_name"] == d["cardName"]
    assert row["rollup_centering"] == s["scoreRollupCentering"]
    assert row["rollup_surface"] == s["scoreRollupSurface"]
    assert row["score_size"] == s["scoreSize"]
    assert row["dte_front_left"] == d["centerLeftDTE"] and row["dte_back_bottom"] == d["bCenterBottomDTE"]
    assert row["image_w"] == d["imageWidth"] and row["image_h"] == d["imageHeight"]
    assert row["ann_front_w"] == s["surfaceFrontData"]["annotations"]["width"]
    assert row["n_dings"] == d["dingsJSON"]["DingsCount"]
    assert row["path_front"] == "tag-dataset/C1240631/front.jpg"
    assert row["path_sfx_back_annotated"] == "tag-dataset/C1240631/sfx_back_annotated.jpg"
    assert row["n_files_uploaded"] == 0 and row["n_files_unavailable"] == 0


def test_card_row_score_total_fallbacks_and_pristine(detail_fixture, score_fixture):
    d = {"data": {**detail_fixture["data"], "scoreTotal": None, "grade": "10 PRISTINE",
                  "pop": {**detail_fixture["data"]["pop"], "grade": "10", "gradeAlias": "PRISTINE"}}}
    s = {"data": {**score_fixture["data"], "scoreTotal": None, "surfaceBackData": {"image": None}}}
    row = labels.card_row("X", d, s, {"uploaded": 20, "unavailable": 2})
    assert math.isnan(row["score_total"])
    assert row["is_pristine"] is True and row["grade_num"] == 10.0
    assert math.isnan(row["ann_back_w"]) and math.isnan(row["ann_back_h"])
    assert row["n_files_uploaded"] == 20 and row["n_files_unavailable"] == 2

    s2 = {"data": {**score_fixture["data"], "scoreTotal": 748}}
    assert labels.card_row("X", d, s2)["score_total"] == 748.0

    d2 = {"data": {**detail_fixture["data"], "pop": {**detail_fixture["data"]["pop"], "grade": None}, "grade": "6.5 EX MT+"}}
    assert labels.card_row("X", d2, score_fixture)["grade_num"] == 6.5


# ── corners / edges ───────────────────────────────────────────────────────
def test_corner_rows(score_fixture):
    rows = labels.corner_rows("C1240631", score_fixture)
    assert len(rows) == 8 and all(list(r.keys()) == labels.CORNER_COLUMNS for r in rows)
    ftl = next(r for r in rows if r["side"] == "F" and r["corner"] == "TL")
    s = score_fixture["data"]
    assert ftl["score_angle"] == s["scoreFTLCAngle"] and ftl["score_fill"] == s["scoreFTLCFill"]
    assert ftl["score_fray"] == s["scoreFTLCFray"] and ftl["fill_px"] == s["fillFTLCpx"]
    assert ftl["angle_deg"] == s["angleFTL"] and ftl["crop_path"] == "tag-dataset/C1240631/corner_FTL.png"
    btl = next(r for r in rows if r["side"] == "B" and r["corner"] == "TL")
    assert math.isnan(btl["score_angle"]) and math.isnan(btl["angle_deg"])
    assert btl["score_fill"] == s["scoreBTLCFill"]
    assert (rows[0]["side"], rows[0]["corner"]) == ("F", "TL")
    assert (rows[7]["side"], rows[7]["corner"]) == ("B", "BR")
    assert {r["side"] + r["corner"] for r in rows} == set(CORNER_KEYS)


def test_edge_rows(score_fixture):
    rows = labels.edge_rows("C1240631", score_fixture)
    assert len(rows) == 8 and all(list(r.keys()) == labels.EDGE_COLUMNS for r in rows)
    bl = next(r for r in rows if r["side"] == "B" and r["edge"] == "L")
    s = score_fixture["data"]
    assert bl["score_fill"] == s["scoreBLEFill"] and bl["score_fray"] == s["scoreBLEFray"]
    assert bl["fill_px"] == s["fillBLEpx"] and bl["fray_px"] == s["frayBLEpx"]
    assert bl["crop_path"] == "tag-dataset/C1240631/edge_BL.png"
    assert (rows[0]["side"], rows[0]["edge"]) == ("F", "T")
    assert (rows[7]["side"], rows[7]["edge"]) == ("B", "R")
    assert {r["side"] + r["edge"] for r in rows} == set(EDGE_KEYS)


def test_corner_rows_missing_keys_become_nan():
    rows = labels.corner_rows("X", {"data": {}})
    assert len(rows) == 8 and all(math.isnan(r["score_fill"]) for r in rows)


# ── surface markers ───────────────────────────────────────────────────────
def _score_with_markers(markers, W=2000.0, H=3000.0):
    return {"data": {"surfaceFrontData": {"annotations": {"width": W, "height": H, "markers": markers}},
                     "surfaceBackData": {"image": None}}}


def test_surface_rows_frame_marker_box_as_fractions():
    m = {"ID": 7, "Ordering": 2, "typeName": "FrameMarker_ESW_CSW", "location": "TL", "Source": "Auto",
         "top": 300.0, "left": 100.0, "width": 50.0, "height": 30.0, "scoreDeduction": 133,
         "isRollup": None, "rotationAngle": 0}
    rows = labels.surface_rows("X", _score_with_markers([m]))
    assert len(rows) == 1 and list(rows[0].keys()) == labels.SURFACE_COLUMNS
    r = rows[0]
    assert r["side"] == "F" and r["marker_id"] == 7 and r["ordering"] == 2
    assert r["family"] == "Frame" and r["type_name"] == "FrameMarker_ESW_CSW" and r["engine_type"] == "CORNER"
    assert r["location"] == "TL" and r["source"] == "Auto" and r["is_rollup"] is False
    assert (r["x"], r["y"], r["w"], r["h"]) == (0.05, 0.1, 0.025, 0.01)
    assert r["deduction"] == 133.0 and r["deduction_raw"] == 133.0 and math.isnan(r["deduction_override"])
    assert math.isnan(r["x1"]) and r["rotation_deg"] == 0.0
    assert (r["raw_w"], r["raw_h"]) == (0.025, 0.01)


# ── rotated markers (item 2) ─────────────────────────────────────────────
def test_rotated_aabb_zero_angle_returns_input_box():
    assert labels._rotated_aabb(100.0, 200.0, 50.0, 30.0, 0) == (100.0, 200.0, 50.0, 30.0)


def test_rotated_aabb_90_degrees_swings_left():
    assert labels._rotated_aabb(200.0, 300.0, 100.0, 50.0, 90) == (150.0, 300.0, 50.0, 100.0)


def test_rotated_aabb_45_degrees_on_a_line():
    x, y, w, h = labels._rotated_aabb(0.0, 0.0, 100.0, 0.0, 45)
    assert math.isclose(w, 100.0 / math.sqrt(2), abs_tol=1e-6)
    assert math.isclose(h, 100.0 / math.sqrt(2), abs_tol=1e-6)


def test_rotated_aabb_negative_angle_is_the_mirror():
    pos = labels._rotated_aabb(200.0, 300.0, 100.0, 0.0, 45)
    neg = labels._rotated_aabb(200.0, 300.0, 100.0, 0.0, -45)
    # Same magnitude box, but the +45 line swings down from the pivot while -45 swings up:
    # the top of the box sits at the pivot for +45, and h above the pivot for -45.
    assert math.isclose(pos[2], neg[2], abs_tol=1e-6) and math.isclose(pos[3], neg[3], abs_tol=1e-6)
    assert math.isclose(pos[1], 300.0, abs_tol=1e-6)
    assert math.isclose(neg[1], 300.0 - 100.0 / math.sqrt(2), abs_tol=1e-6)


def test_surface_rows_frame_marker_rotation_expands_box_and_keeps_raw():
    m = {"ID": 7, "typeName": "FrameMarker_ESW_CSW", "location": "TL", "Source": "Auto",
         "top": 300.0, "left": 200.0, "width": 100.0, "height": 50.0, "scoreDeduction": 10,
         "rotationAngle": 90}
    r = labels.surface_rows("X", _score_with_markers([m], W=2000.0, H=3000.0))[0]
    assert r["rotation_deg"] == 90.0
    # Expanded (rotated) box, as fractions of the 2000x3000 canvas.
    assert (r["x"], r["y"], r["w"], r["h"]) == (150.0 / 2000, 300.0 / 3000, 50.0 / 2000, 100.0 / 3000)
    # raw_w/raw_h stay the un-rotated fractions.
    assert (r["raw_w"], r["raw_h"]) == (100.0 / 2000, 50.0 / 3000)


def test_surface_rows_ellipse_marker_rotation_expands_box():
    m = {"ID": 8, "typeName": "EllipseMarker_Dent", "Source": "Auto",
         "top": 0.0, "left": 0.0, "width": 40.0, "height": 20.0, "scoreDeduction": 10,
         "rotationAngle": -90}
    r = labels.surface_rows("X", _score_with_markers([m], W=100.0, H=100.0))[0]
    assert math.isclose(r["w"], 20.0 / 100, abs_tol=1e-9) and math.isclose(r["h"], 40.0 / 100, abs_tol=1e-9)
    assert r["raw_w"] == 40.0 / 100 and r["raw_h"] == 20.0 / 100


def test_surface_rows_line_marker_bbox_with_min_size():
    m = {"ID": 1, "typeName": "LineMarker_Roller", "Source": "Manual",
         "x1": 1500.0, "y1": 2700.0, "x2": 1520.0, "y2": 60.0, "scoreDeduction": 250}
    r = labels.surface_rows("X", _score_with_markers([m]))[0]
    assert r["family"] == "Line" and r["engine_type"] == "PRINT_DEFECT"
    assert r["x"] == 0.75 and r["y"] == 0.02
    assert r["w"] == max(20.0 / 2000, labels.LINE_MIN_FRAC) and r["h"] == 2640.0 / 3000
    assert (r["x1"], r["y1"], r["x2"], r["y2"]) == (0.75, 0.9, 0.76, 0.02)


def test_surface_rows_line_marker_vertical_min_box_is_centered():
    """A perfectly vertical line's bumped-up width must be centred on the line, not
    anchored at its left edge."""
    m = {"ID": 2, "typeName": "LineMarker_Roller", "Source": "Manual",
         "x1": 1000.0, "y1": 0.0, "x2": 1000.0, "y2": 3000.0, "scoreDeduction": 10}
    r = labels.surface_rows("X", _score_with_markers([m]))[0]
    x1 = 1000.0 / 2000
    assert r["w"] == labels.LINE_MIN_FRAC
    assert r["x"] == x1 - labels.LINE_MIN_FRAC / 2


def test_surface_rows_override_rollup_subtype_and_back_side():
    front = {"ID": 1, "typeName": "FrameMarker_Ink", "subtypeName": "DENTS", "top": 0, "left": 0,
             "width": 10, "height": 10, "scoreDeduction": 40, "scoreDeduction_Override": 55}
    back = {"ID": 2, "typeName": "FrameMarker_ESW_CSW", "location": "R", "isRollup": True,
            "top": 0, "left": 0, "width": 10, "height": 10, "scoreDeduction": 9}
    score = {"data": {"surfaceFrontData": {"annotations": {"width": 100, "height": 100, "markers": [front]}},
                      "surfaceBackData": {"annotations": {"width": 200, "height": 200, "markers": [back]}}}}
    rows = labels.surface_rows("X", score)
    f = next(r for r in rows if r["side"] == "F"); b = next(r for r in rows if r["side"] == "B")
    assert f["engine_type"] == "DENT" and f["subtype_name"] == "DENTS"
    assert f["deduction"] == 55.0 and f["deduction_raw"] == 40.0 and f["deduction_override"] == 55.0
    assert b["engine_type"] == "EDGE" and b["is_rollup"] is True and b["w"] == 0.05


def test_surface_rows_unknown_type_and_missing_geometry_survive():
    m = {"ID": 3, "typeName": "Weird_New", "scoreDeduction": None}
    r = labels.surface_rows("X", _score_with_markers([m]))[0]
    assert r["engine_type"] == "UNKNOWN" and math.isnan(r["x"]) and math.isnan(r["deduction"])


def test_surface_rows_non_numeric_marker_id_becomes_nan():
    bad = {"ID": "ERROR", "typeName": "Weird_New"}
    good = {"ID": 3, "typeName": "Weird_New"}
    rows = labels.surface_rows("X", _score_with_markers([bad, good]))
    assert math.isnan(rows[0]["marker_id"]) and math.isnan(rows[0]["ordering"])
    assert rows[1]["marker_id"] == 3.0


def test_surface_rows_empty_when_no_annotations(detail_fixture):
    assert labels.surface_rows("X", {"data": {"surfaceFrontData": {"image": "u"}}}) == []


def test_surface_rows_from_fixture_count(score_fixture):
    s = score_fixture["data"]
    n = len(s["surfaceFrontData"]["annotations"]["markers"]) + len(s["surfaceBackData"]["annotations"]["markers"])
    rows = labels.surface_rows("C1240631", score_fixture)
    assert len(rows) == n
    assert all(0.0 <= r["x"] <= 1.0 and 0.0 <= r["y"] <= 1.0 for r in rows if not math.isnan(r["x"]))


# ── dings ─────────────────────────────────────────────────────────────────
def test_ding_rows_from_fixture(detail_fixture):
    d = detail_fixture["data"]
    rows = labels.ding_rows("C1240631", detail_fixture)
    assert len(rows) == len(d["dingsJSON"]["Dings"]) and all(list(r.keys()) == labels.DING_COLUMNS for r in rows)
    g = d["dingsJSON"]["Dings"][0]; r = rows[0]
    assert r["side"] == g["Side"][0] and r["ordering"] == g["Ordering"] and r["type_name"] == g["Type"]
    assert r["engine_type"] == labels.map_engine_type(g["Type"], None, None)
    assert r["location"] == g["Location"]
    assert r["px_x"] == g["LocationX"] and r["px_w"] == g["Width"]
    assert r["x"] == g["LocationX"] / d["imageWidth"] and r["h"] == g["Height"] / d["imageHeight"]
    assert r["crop_path"] == f"tag-dataset/C1240631/ding_{g['Ordering']}.jpg"


def test_ding_rows_names_match_files_expected_files_duplicate_ordering(detail_fixture, score_fixture):
    """ding_rows' crop_path names must equal files.expected_files' ding names, including the
    duplicate-Ordering collision suffix (same pattern as test_files.test_duplicate_ordering_values)."""
    base_ding = detail_fixture["data"]["dingsJSON"]["Dings"][0]
    detail = {
        "data": {
            **detail_fixture["data"],
            "dingsJSON": {
                "Dings": [
                    {**base_ding, "ImageURL": "https://example.com/ding1.jpg"},
                    {**base_ding, "ImageURL": "https://example.com/ding2.jpg"},
                ],
                "DingsCount": 2,
                "Summary": {},
            }
        }
    }
    expected = files.expected_files(detail, score_fixture)
    expected_ding_names = [n for n, _ in expected if n.startswith("ding_")]
    rows = labels.ding_rows("C1240631", detail)
    assert [r["crop_path"] for r in rows] == [f"tag-dataset/C1240631/{n}" for n in expected_ding_names]


def test_ding_rows_without_dimensions():
    detail = {"data": {"imageWidth": 1000, "imageHeight": 2000,
                       "dingsJSON": {"Dings": [{"Ordering": 1, "Side": "BACK", "Type": "CENTERING",
                                                "Location": "LEFT", "LocationX": 10, "LocationY": 20}]}}}
    r = labels.ding_rows("X", detail)[0]
    assert r["side"] == "B" and r["engine_type"] == "SKIP" and math.isnan(r["w"]) and r["x"] == 0.01
