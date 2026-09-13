import math

from tagdataset import labels
from tagdataset.files import CORNER_KEYS, EDGE_KEYS


# ── type map ──────────────────────────────────────────────────────────────
def test_map_engine_type_prefers_location_for_esw():
    assert labels.map_engine_type("FrameMarker_ESW_CSW", None, "TL") == "CORNER"
    assert labels.map_engine_type("FrameMarker_ESW_CSW", None, "R") == "EDGE"
    assert labels.map_engine_type("FrameMarker_ESW_CSW", None, None) == "EDGE"


def test_map_engine_type_prefers_subtype_for_ink():
    assert labels.map_engine_type("FrameMarker_Ink", "DENTS", None) == "DENT"
    assert labels.map_engine_type("FrameMarker_Ink", None, None) == "PRINT_DEFECT"
    assert labels.map_engine_type("FrameMarker_Ink", "SOMETHING NEW", None) == "PRINT_DEFECT"


def test_map_engine_type_ding_strings_and_unknown():
    assert labels.map_engine_type("CORNER WEAR", None, "TOP LEFT") == "CORNER"
    assert labels.map_engine_type("CENTERING", None, None) == "SKIP"
    assert labels.map_engine_type("Nope_Marker", None, None) == "UNKNOWN"


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
