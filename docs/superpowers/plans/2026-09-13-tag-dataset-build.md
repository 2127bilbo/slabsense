# TAG Dataset Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the raw TAG responses in `data/raw.sqlite` into the training tables (manifest, corners, edges, surface markers, dings, frozen splits) as parquet, plus a `stats` command that reports class balance, nulls, unmapped types, and file completeness.

**Architecture:** Pure extraction functions in `tagdataset/labels.py` map one cert's `(detail, score)` to rows; `tagdataset/splits.py` assigns per-card splits and preserves existing assignments; `tagdataset/build.py` iterates the store and writes parquet; `tagdataset/stats.py` reads the parquet back and prints the report. Nothing here talks to TAG or the bucket; the store is read-only.

**Tech Stack:** Python ≥ 3.11, pandas + pyarrow, stdlib json/hashlib. Tests use the recorded C1240631 fixtures plus small synthetic dicts.

**Spec:** `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` §6, §7 (type mapping), §11, §12.

## Global Constraints

- Read-only on the store: never call `put_*`, `add_failure`, or `clear_failure` from build/stats.
- All parquet outputs live in `data/` (gitignored) and are rebuilt from scratch on every `build`, except `splits.parquet`, which is merged: existing cert assignments are never changed, new certs are assigned, test stays frozen.
- Split fractions 0.80 / 0.10 / 0.10, stratified by `(grade_label, era)`, seeded, assigned per cert so every crop of a card shares a split.
- Grade encoding: `grade_label` is TAG's string (`"10 PRISTINE"`, `"8.5 NM MT+"`); `grade_num` is a float from `pop.grade` (fallback: first token of the grade string); `is_pristine` is `gradeAlias == "PRISTINE"`.
- Nullable numerics are float columns with NaN; never impute. Known nulls: back-corner angle scores, `score_total` (present on ~13% of certs), `marker.scoreDeduction` (rare).
- Marker geometry is expressed as fractions of the annotation canvas (`annotations.width/height`), origin top-left: `x, y, w, h` in `[0, 1]`. Line markers get the bounding box of their segment with a minimum size of `LINE_MIN_FRAC = 0.004` per axis. Rotation is ignored (recorded as `rotation_deg`).
- Effective deduction = `scoreDeduction_Override` when it is a non-zero number, else `scoreDeduction`.
- Engine type mapping lives in `tagdataset/type_map.json` (committed). Unmapped `(typeName, subtypeName, location)` combos map to `"UNKNOWN"` and are counted by `stats`; they never raise.
- Every `.py` change has tests; run `.\.venv\Scripts\python.exe -m pytest -q` from `scripts/tag-dataset` before each commit; zero warnings.
- Commit messages end with:
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QGLEdmut9ukoVuG8AAVUHV

## Deviations from the spec (rulings)

- **Dings are a separate table** (`dings.parquet`) rather than appended to `surface.parquet` with `source="ding"`. TAG's ding list is derived from the markers, and matching them would require fuzzy overlap rules that invent errors. Both tables carry `cert` and `side`, so training can join them if needed.
- **`type_map.json` lives in the package** (`tagdataset/type_map.json`), not `training/`. It is input to `build`, not output of `stats`; `stats` reports what fell through to `UNKNOWN` so the map can be extended.
- **Manifest carries file-completeness counts** (`n_files_uploaded`, `n_files_unavailable`) from the store's `files` and `failures` tables so `stats` can report completeness per grade without touching the bucket.

## Observed data facts (922 certs, 2026-09-13)

- `score.data.scoreTotal` and `detail.data.scoreTotal` are null on 805/922. `scoreRollup{Centering,Corners,Edges,Surface}` present on all.
- `pop.grade` is the numeric grade string (`"9"`, `"6.5"`, `"10"` for both GEM MINT and PRISTINE); `pop.gradeAlias` distinguishes `PRISTINE`. One cert has `gradeAlias` null.
- `annotations.width/height` ≈ 2390×3306 (canvas), while `imageWidth/Height` ≈ 4394×6084 (sfx image). Sides with no markers have no `annotations` block at all.
- Marker families and geometry: `FrameMarker_*`, `EllipseMarker_*`, `FreehandMarker_*` have `top,left,width,height`; `LineMarker_*` have `x1,y1,x2,y2` only.
- `FrameMarker_ESW_CSW` carries `location` in `{TL,TR,BL,BR}` (corner) or `{T,B,L,R}` (edge); 1,346 of them have `isRollup: true` (side-level summaries, median area 0.19% of card vs 0.003% for regular markers).
- `FrameMarker_Ink` uses `subtypeName` for `SURFACE DEFECT`, `WRINKLES/CREASES`, `DENTS`, `SCRATCHES`.
- 166 markers have a non-zero integer `scoreDeduction_Override`, always equal to `scoreDeduction` in the sample.
- Dings: 3,330 of 3,423 have `Width`/`Height`; `LocationX/Y` are in `imageWidth/Height` pixel space.

---

## File structure

```
scripts/tag-dataset/
├── tagdataset/
│   ├── type_map.json      typeName[/subtypeName][/location-class] → engine type
│   ├── labels.py          card_row, corner_rows, edge_rows, surface_rows, ding_rows, map_engine_type
│   ├── splits.py          assign_splits(manifest, existing, seed)
│   ├── build.py           build(store, out_dir, seed) → writes 6 parquet files, returns counts
│   ├── stats.py           report(out_dir, store) → str
│   └── cli.py             + build, stats subcommands
├── tests/
│   ├── test_labels.py
│   ├── test_splits.py
│   ├── test_build.py
│   └── test_stats.py
└── README.md              + build/stats rows, Outputs section
```

---

### Task 1: Type map and card/corner/edge label rows

**Files:**
- Create: `scripts/tag-dataset/tagdataset/type_map.json`
- Create: `scripts/tag-dataset/tagdataset/labels.py`
- Create: `scripts/tag-dataset/tests/test_labels.py`

**Interfaces:**
- Consumes: `grades.era_for_year`, `files.CORNER_KEYS`/`EDGE_KEYS` (for crop path names), recorded fixtures `detail_fixture`, `score_fixture`.
- Produces: `labels.map_engine_type(type_name, subtype_name, location) -> str`; `labels.card_row(cert, detail, score, store_counts: dict | None = None) -> dict`; `labels.corner_rows(cert, score) -> list[dict]`; `labels.edge_rows(cert, score) -> list[dict]`; column-name constants `MANIFEST_COLUMNS`, `CORNER_COLUMNS`, `EDGE_COLUMNS`.

- [ ] **Step 1: Write type_map.json**

`scripts/tag-dataset/tagdataset/type_map.json`:
```json
{
  "_comment": "Key = typeName, or typeName|subtypeName, or typeName|location-class (corner/edge). Most specific match wins. Values are gradingEngine defect type keys.",
  "FrameMarker_ESW_CSW|corner": "CORNER",
  "FrameMarker_ESW_CSW|edge": "EDGE",
  "FrameMarker_ESW_CSW": "EDGE",
  "FrameMarker_PlayWear": "PLAY_WEAR",
  "FrameMarker_Ink": "PRINT_DEFECT",
  "FrameMarker_Ink|SURFACE DEFECT": "PLAY_WEAR",
  "FrameMarker_Ink|WRINKLES/CREASES": "CREASE",
  "FrameMarker_Ink|DENTS": "DENT",
  "FrameMarker_Ink|SCRATCHES": "SCRATCH",
  "LineMarker_Wrinkle_Crease": "CREASE",
  "FreehandMarker_Scratch": "SCRATCH",
  "EllipseMarker_Dent": "DENT",
  "EllipseMarker_Pit": "PIT",
  "FrameMarker_Stain": "STAIN",
  "LineMarker_PrintLine": "PRINT_DEFECT",
  "LineMarker_Roller": "PRINT_DEFECT",
  "FrameMarker_Bend": "CREASE",
  "FrameMarker_OtherDamage": "PLAY_WEAR",
  "FrameMarker_PrintDefect": "PRINT_DEFECT",
  "CORNER WEAR": "CORNER",
  "EDGE WEAR": "EDGE",
  "EDGE/CORNER / BEND": "CREASE",
  "SURFACE / PLAY WEAR": "PLAY_WEAR",
  "SURFACE / WRINKLE/CREASE": "CREASE",
  "SURFACE / WRINKLES/CREASES": "CREASE",
  "SURFACE / INK DEFECT": "PRINT_DEFECT",
  "SURFACE / DENT": "DENT",
  "SURFACE / DENTS": "DENT",
  "SURFACE / SCRATCH(ES)": "SCRATCH",
  "SURFACE / SCRATCHES": "SCRATCH",
  "SURFACE / SURFACE DEFECT": "PLAY_WEAR",
  "SURFACE / ROLLER MARK": "PRINT_DEFECT",
  "SURFACE / PRINT LINE": "PRINT_DEFECT",
  "SURFACE / PRINT DEFECT": "PRINT_DEFECT",
  "SURFACE / PIT": "PIT",
  "SURFACE / PITS": "PIT",
  "SURFACE / STAIN": "STAIN",
  "SURFACE / STAIN / RESIDUE": "STAIN",
  "SURFACE / WATER DAMAGE": "STAIN",
  "SURFACE / WATER/STAIN": "STAIN",
  "SURFACE / TEAR": "TEAR",
  "SURFACE / MISSING STOCK": "TEAR",
  "SURFACE / OTHER DAMAGE": "PLAY_WEAR",
  "SURFACE / SCUFFING": "PLAY_WEAR",
  "SURFACE / DISCOLORATION": "STAIN",
  "SURFACE / BEND": "CREASE",
  "CENTERING": "SKIP"
}
```

- [ ] **Step 2: Write the failing tests**

`scripts/tag-dataset/tests/test_labels.py`:
```python
import math

from tagdataset import labels


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


def test_edge_rows(score_fixture):
    rows = labels.edge_rows("C1240631", score_fixture)
    assert len(rows) == 8 and all(list(r.keys()) == labels.EDGE_COLUMNS for r in rows)
    bl = next(r for r in rows if r["side"] == "B" and r["edge"] == "L")
    s = score_fixture["data"]
    assert bl["score_fill"] == s["scoreBLEFill"] and bl["score_fray"] == s["scoreBLEFray"]
    assert bl["fill_px"] == s["fillBLEpx"] and bl["fray_px"] == s["frayBLEpx"]
    assert bl["crop_path"] == "tag-dataset/C1240631/edge_BL.png"


def test_corner_rows_missing_keys_become_nan():
    rows = labels.corner_rows("X", {"data": {}})
    assert len(rows) == 8 and all(math.isnan(r["score_fill"]) for r in rows)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_labels.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.labels'`

- [ ] **Step 4: Implement labels.py (card, corner, edge parts)**

`scripts/tag-dataset/tagdataset/labels.py`:
```python
"""Pure extraction: one cert's (detail, score) → label rows (spec §6.1)."""
from __future__ import annotations

import json
import math
from pathlib import Path

from .grades import era_for_year

NAN = float("nan")
PREFIX = "tag-dataset"
LINE_MIN_FRAC = 0.004

_TYPE_MAP: dict[str, str] = {
    k: v for k, v in json.loads((Path(__file__).parent / "type_map.json").read_text(encoding="utf-8")).items()
    if not k.startswith("_")
}
CORNER_LOCATIONS = {"TL", "TR", "BL", "BR"}
EDGE_LOCATIONS = {"T", "B", "L", "R"}


def _num(v) -> float:
    try:
        return float(v) if v is not None and v != "" else NAN
    except (TypeError, ValueError):
        return NAN


def map_engine_type(type_name: str | None, subtype_name: str | None, location: str | None) -> str:
    t = type_name or ""
    if subtype_name and f"{t}|{subtype_name}" in _TYPE_MAP:
        return _TYPE_MAP[f"{t}|{subtype_name}"]
    if location in CORNER_LOCATIONS and f"{t}|corner" in _TYPE_MAP:
        return _TYPE_MAP[f"{t}|corner"]
    if location in EDGE_LOCATIONS and f"{t}|edge" in _TYPE_MAP:
        return _TYPE_MAP[f"{t}|edge"]
    return _TYPE_MAP.get(t, "UNKNOWN")


# ── manifest ─────────────────────────────────────────────────────────────
MANIFEST_COLUMNS = [
    "cert", "uuid", "grade_label", "grade_num", "is_pristine", "grade_alias", "date_graded",
    "era", "year", "brand", "set_name", "subset_name", "card_name", "card_number",
    "score_total", "rollup_centering", "rollup_corners", "rollup_edges", "rollup_surface",
    "score_size", "card_w_in", "card_h_in", "surface_front", "surface_back",
    "dte_front_left", "dte_front_right", "dte_front_top", "dte_front_bottom",
    "dte_back_left", "dte_back_right", "dte_back_top", "dte_back_bottom",
    "image_w", "image_h", "ann_front_w", "ann_front_h", "ann_back_w", "ann_back_h",
    "n_dings", "n_markers_front", "n_markers_back",
    "path_front", "path_back", "path_sfx_front", "path_sfx_back",
    "path_sfx_front_annotated", "path_sfx_back_annotated",
    "n_files_uploaded", "n_files_unavailable",
]


def _grade_num(d: dict) -> float:
    pop = d.get("pop") or {}
    g = _num(pop.get("grade"))
    if not math.isnan(g):
        return g
    return _num(str(d.get("grade") or "").split(" ")[0])


def card_row(cert: str, detail: dict, score: dict, store_counts: dict | None = None) -> dict:
    d = (detail or {}).get("data") or {}
    s = (score or {}).get("data") or {}
    pop = d.get("pop") or {}
    cs = d.get("cardSet") or {}
    card = d.get("card") or {}
    dings = d.get("dingsJSON") or {}
    fa = ((s.get("surfaceFrontData") or {}).get("annotations")) or {}
    ba = ((s.get("surfaceBackData") or {}).get("annotations")) or {}
    year = cs.get("setYear")
    sc = store_counts or {}
    total = s.get("scoreTotal")
    if total is None:
        total = d.get("scoreTotal")
    p = lambda name: f"{PREFIX}/{cert}/{name}"
    return {
        "cert": cert, "uuid": d.get("uuid"),
        "grade_label": d.get("grade"), "grade_num": _grade_num(d),
        "is_pristine": pop.get("gradeAlias") == "PRISTINE", "grade_alias": pop.get("gradeAlias"),
        "date_graded": pop.get("dateGraded"),
        "era": era_for_year(year) if year else None, "year": int(year) if year else None,
        "brand": cs.get("brandName"), "set_name": cs.get("setName"), "subset_name": cs.get("subsetName"),
        "card_name": d.get("cardName"), "card_number": card.get("cardNumber"),
        "score_total": _num(total),
        "rollup_centering": _num(s.get("scoreRollupCentering")), "rollup_corners": _num(s.get("scoreRollupCorners")),
        "rollup_edges": _num(s.get("scoreRollupEdges")), "rollup_surface": _num(s.get("scoreRollupSurface")),
        "score_size": _num(s.get("scoreSize")), "card_w_in": _num(s.get("cardWidthInches")), "card_h_in": _num(s.get("cardHeightInches")),
        "surface_front": _num(s.get("scoreFCSE")), "surface_back": _num(s.get("scoreBCSE")),
        "dte_front_left": _num(d.get("centerLeftDTE")), "dte_front_right": _num(d.get("centerRightDTE")),
        "dte_front_top": _num(d.get("centerTopDTE")), "dte_front_bottom": _num(d.get("centerBottomDTE")),
        "dte_back_left": _num(d.get("bCenterLeftDTE")), "dte_back_right": _num(d.get("bCenterRightDTE")),
        "dte_back_top": _num(d.get("bCenterTopDTE")), "dte_back_bottom": _num(d.get("bCenterBottomDTE")),
        "image_w": _num(d.get("imageWidth")), "image_h": _num(d.get("imageHeight")),
        "ann_front_w": _num(fa.get("width")), "ann_front_h": _num(fa.get("height")),
        "ann_back_w": _num(ba.get("width")), "ann_back_h": _num(ba.get("height")),
        "n_dings": int(dings.get("DingsCount") or 0),
        "n_markers_front": len(fa.get("markers") or []), "n_markers_back": len(ba.get("markers") or []),
        "path_front": p("front.jpg"), "path_back": p("back.jpg"),
        "path_sfx_front": p("sfx_front.jpg"), "path_sfx_back": p("sfx_back.jpg"),
        "path_sfx_front_annotated": p("sfx_front_annotated.jpg"), "path_sfx_back_annotated": p("sfx_back_annotated.jpg"),
        "n_files_uploaded": int(sc.get("uploaded", 0)), "n_files_unavailable": int(sc.get("unavailable", 0)),
    }


# ── corners / edges ──────────────────────────────────────────────────────
CORNER_COLUMNS = ["cert", "side", "corner", "score_angle", "score_fill", "score_fray",
                  "fill_px", "fray_px", "angle_deg", "crop_path"]
EDGE_COLUMNS = ["cert", "side", "edge", "score_fill", "score_fray", "fill_px", "fray_px", "crop_path"]


def corner_rows(cert: str, score: dict) -> list[dict]:
    s = (score or {}).get("data") or {}
    out = []
    for side in "FB":
        for corner in ("TL", "TR", "BL", "BR"):
            k = f"{side}{corner}"
            out.append({
                "cert": cert, "side": side, "corner": corner,
                "score_angle": _num(s.get(f"score{k}CAngle")), "score_fill": _num(s.get(f"score{k}CFill")),
                "score_fray": _num(s.get(f"score{k}CFray")), "fill_px": _num(s.get(f"fill{k}Cpx")),
                "fray_px": _num(s.get(f"fray{k}Cpx")), "angle_deg": _num(s.get(f"angle{k}")),
                "crop_path": f"{PREFIX}/{cert}/corner_{k}.png",
            })
    return out


def edge_rows(cert: str, score: dict) -> list[dict]:
    s = (score or {}).get("data") or {}
    out = []
    for side in "FB":
        for edge in "TBLR":
            k = f"{side}{edge}"
            out.append({
                "cert": cert, "side": side, "edge": edge,
                "score_fill": _num(s.get(f"score{k}EFill")), "score_fray": _num(s.get(f"score{k}EFray")),
                "fill_px": _num(s.get(f"fill{k}Epx")), "fray_px": _num(s.get(f"fray{k}Epx")),
                "crop_path": f"{PREFIX}/{cert}/edge_{k}.png",
            })
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_labels.py -v`
Expected: 8 passed

- [ ] **Step 6: Commit**

```bash
git add scripts/tag-dataset/tagdataset/type_map.json scripts/tag-dataset/tagdataset/labels.py scripts/tag-dataset/tests/test_labels.py
git commit -m "feat(tag-dataset): manifest, corner, and edge label rows with engine type map"
```

---

### Task 2: Surface marker rows and ding rows

**Files:**
- Modify: `scripts/tag-dataset/tagdataset/labels.py` (append)
- Modify: `scripts/tag-dataset/tests/test_labels.py` (append)

**Interfaces:**
- Produces: `labels.surface_rows(cert, score) -> list[dict]` with `SURFACE_COLUMNS`; `labels.ding_rows(cert, detail) -> list[dict]` with `DING_COLUMNS`.

- [ ] **Step 1: Append the failing tests**

Append to `scripts/tag-dataset/tests/test_labels.py`:
```python
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


def test_surface_rows_line_marker_bbox_with_min_size():
    m = {"ID": 1, "typeName": "LineMarker_Roller", "Source": "Manual",
         "x1": 1500.0, "y1": 2700.0, "x2": 1520.0, "y2": 60.0, "scoreDeduction": 250}
    r = labels.surface_rows("X", _score_with_markers([m]))[0]
    assert r["family"] == "Line" and r["engine_type"] == "PRINT_DEFECT"
    assert r["x"] == 0.75 and r["y"] == 0.02
    assert r["w"] == max(20.0 / 2000, labels.LINE_MIN_FRAC) and r["h"] == 2640.0 / 3000
    assert (r["x1"], r["y1"], r["x2"], r["y2"]) == (0.75, 0.9, 0.76, 0.02)


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


def test_ding_rows_without_dimensions():
    detail = {"data": {"imageWidth": 1000, "imageHeight": 2000,
                       "dingsJSON": {"Dings": [{"Ordering": 1, "Side": "BACK", "Type": "CENTERING",
                                                "Location": "LEFT", "LocationX": 10, "LocationY": 20}]}}}
    r = labels.ding_rows("X", detail)[0]
    assert r["side"] == "B" and r["engine_type"] == "SKIP" and math.isnan(r["w"]) and r["x"] == 0.01
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_labels.py -v`
Expected: the 8 new tests FAIL with `AttributeError: module 'tagdataset.labels' has no attribute 'surface_rows'`; the earlier 8 still pass.

- [ ] **Step 3: Append the implementation**

Append to `scripts/tag-dataset/tagdataset/labels.py`:
```python
# ── surface markers ──────────────────────────────────────────────────────
SURFACE_COLUMNS = [
    "cert", "side", "marker_id", "ordering", "type_name", "subtype_name", "family", "engine_type",
    "location", "source", "is_rollup", "x", "y", "w", "h", "x1", "y1", "x2", "y2",
    "rotation_deg", "deduction", "deduction_raw", "deduction_override", "area", "depth", "white_scale",
]


def _bbox(m: dict, W: float, H: float) -> tuple[float, float, float, float, float, float, float, float]:
    """Return (x, y, w, h, x1, y1, x2, y2) as canvas fractions; NaN where absent."""
    if all(m.get(k) is not None for k in ("x1", "y1", "x2", "y2")):
        x1, y1, x2, y2 = (_num(m["x1"]) / W, _num(m["y1"]) / H, _num(m["x2"]) / W, _num(m["y2"]) / H)
        x, y = min(x1, x2), min(y1, y2)
        w, h = max(abs(x2 - x1), LINE_MIN_FRAC), max(abs(y2 - y1), LINE_MIN_FRAC)
        return x, y, w, h, x1, y1, x2, y2
    if all(m.get(k) is not None for k in ("top", "left", "width", "height")):
        return (_num(m["left"]) / W, _num(m["top"]) / H, _num(m["width"]) / W, _num(m["height"]) / H,
                NAN, NAN, NAN, NAN)
    return (NAN,) * 8


def _effective_deduction(m: dict) -> tuple[float, float, float]:
    raw = _num(m.get("scoreDeduction"))
    ovr = _num(m.get("scoreDeduction_Override"))
    if not math.isnan(ovr) and ovr != 0:
        return ovr, raw, ovr
    return raw, raw, NAN


def surface_rows(cert: str, score: dict) -> list[dict]:
    s = (score or {}).get("data") or {}
    out = []
    for side, key in (("F", "surfaceFrontData"), ("B", "surfaceBackData")):
        ann = ((s.get(key) or {}).get("annotations")) or {}
        W, H = _num(ann.get("width")), _num(ann.get("height"))
        for m in ann.get("markers") or []:
            t = m.get("typeName") or ""
            if math.isnan(W) or math.isnan(H) or W == 0 or H == 0:
                geom = (NAN,) * 8
            else:
                geom = _bbox(m, W, H)
            ded, raw, ovr = _effective_deduction(m)
            out.append({
                "cert": cert, "side": side,
                "marker_id": m.get("ID"), "ordering": m.get("Ordering"),
                "type_name": t, "subtype_name": m.get("subtypeName"),
                "family": t.split("Marker", 1)[0] if "Marker" in t else "",
                "engine_type": map_engine_type(t, m.get("subtypeName"), m.get("location")),
                "location": m.get("location"), "source": m.get("Source"),
                "is_rollup": bool(m.get("isRollup")),
                "x": geom[0], "y": geom[1], "w": geom[2], "h": geom[3],
                "x1": geom[4], "y1": geom[5], "x2": geom[6], "y2": geom[7],
                "rotation_deg": _num(m.get("rotationAngle")) if m.get("rotationAngle") is not None else 0.0,
                "deduction": ded, "deduction_raw": raw, "deduction_override": ovr,
                "area": _num(m.get("Area")), "depth": _num(m.get("Depth")), "white_scale": _num(m.get("WhiteScale")),
            })
    return out


# ── dings ────────────────────────────────────────────────────────────────
DING_COLUMNS = ["cert", "side", "ordering", "type_name", "engine_type", "location",
                "px_x", "px_y", "px_w", "px_h", "x", "y", "w", "h", "crop_path"]


def ding_rows(cert: str, detail: dict) -> list[dict]:
    d = (detail or {}).get("data") or {}
    W, H = _num(d.get("imageWidth")), _num(d.get("imageHeight"))
    out = []
    for i, g in enumerate((d.get("dingsJSON") or {}).get("Dings") or [], start=1):
        px, py, pw, ph = (_num(g.get("LocationX")), _num(g.get("LocationY")), _num(g.get("Width")), _num(g.get("Height")))
        ordering = g.get("Ordering") if isinstance(g.get("Ordering"), int) else i
        out.append({
            "cert": cert, "side": (g.get("Side") or "?")[0].upper(),
            "ordering": ordering, "type_name": g.get("Type"),
            "engine_type": map_engine_type(g.get("Type"), None, None), "location": g.get("Location"),
            "px_x": px, "px_y": py, "px_w": pw, "px_h": ph,
            "x": px / W if W else NAN, "y": py / H if H else NAN,
            "w": pw / W if W else NAN, "h": ph / H if H else NAN,
            "crop_path": f"{PREFIX}/{cert}/ding_{ordering}.jpg",
        })
    return out
```

Note: `ding_rows` crop names follow `files.expected_files` for the common case (unique integer `Ordering`); the rare collision fallback names in `files.py` are not reproduced here. `stats` reports dings whose `crop_path` is not in the store's `files` table.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_labels.py -v`
Expected: 16 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-dataset/tagdataset/labels.py scripts/tag-dataset/tests/test_labels.py
git commit -m "feat(tag-dataset): surface marker and ding label rows"
```

---

### Task 3: Split assignment with frozen test

**Files:**
- Create: `scripts/tag-dataset/tagdataset/splits.py`
- Create: `scripts/tag-dataset/tests/test_splits.py`

**Interfaces:**
- Produces: `splits.assign_splits(manifest: pd.DataFrame, existing: pd.DataFrame | None, seed: int = 42, fracs=(0.8, 0.1, 0.1)) -> pd.DataFrame` with columns `cert, split, stratum, assigned_at`; `splits.SPLITS = ("train", "val", "test")`.

- [ ] **Step 1: Write the failing tests**

`scripts/tag-dataset/tests/test_splits.py`:
```python
import pandas as pd

from tagdataset import splits


def _manifest(n_per=(("9 MINT", "2023+", 100), ("1 POOR", "1999-2003", 30), ("5 EXCELLENT", "2011-2016", 7))):
    rows = []
    for grade, era, n in n_per:
        for i in range(n):
            rows.append({"cert": f"{grade[:1]}{era[:4]}{i:04d}", "grade_label": grade, "era": era})
    return pd.DataFrame(rows)


def test_assign_columns_and_coverage():
    m = _manifest()
    out = splits.assign_splits(m, None, seed=1)
    assert list(out.columns) == ["cert", "split", "stratum", "assigned_at"]
    assert set(out.cert) == set(m.cert) and set(out.split) <= set(splits.SPLITS)
    assert out.cert.is_unique


def test_assign_is_stratified_and_deterministic():
    m = _manifest()
    a = splits.assign_splits(m, None, seed=7)
    b = splits.assign_splits(m, None, seed=7)
    assert a.drop(columns="assigned_at").equals(b.drop(columns="assigned_at"))
    big = a[a.stratum == "9 MINT|2023+"].split.value_counts()
    assert 76 <= big["train"] <= 84 and 6 <= big["val"] <= 14 and 6 <= big["test"] <= 14
    small = a[a.stratum == "5 EXCELLENT|2011-2016"].split.value_counts()
    assert small.get("test", 0) >= 1 and small.get("val", 0) >= 1 and small.get("train", 0) >= 1


def test_existing_assignments_are_preserved_and_new_certs_added():
    m = _manifest()
    first = splits.assign_splits(m.iloc[:60], None, seed=3)
    more = m.copy()
    second = splits.assign_splits(more, first, seed=99)
    merged = second.set_index("cert")
    for _, r in first.iterrows():
        assert merged.loc[r.cert, "split"] == r.split and merged.loc[r.cert, "assigned_at"] == r.assigned_at
    assert len(second) == len(m)
    new = second[~second.cert.isin(first.cert)]
    assert len(new) == len(m) - 60 and set(new.split) <= set(splits.SPLITS)


def test_existing_certs_missing_from_manifest_are_kept():
    m = _manifest()
    first = splits.assign_splits(m, None, seed=3)
    second = splits.assign_splits(m.iloc[:10], first, seed=3)
    assert len(second) == len(first)


def test_null_stratum_fields_do_not_crash():
    m = pd.DataFrame({"cert": ["A", "B", "C"], "grade_label": [None, "9 MINT", None], "era": ["2023+", None, None]})
    out = splits.assign_splits(m, None, seed=1)
    assert len(out) == 3 and out.stratum.str.contains("?", regex=False).all() is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_splits.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.splits'`

- [ ] **Step 3: Implement splits.py**

`scripts/tag-dataset/tagdataset/splits.py`:
```python
"""Per-card train/val/test assignment, stratified and frozen (spec §6.1, §11)."""
from __future__ import annotations

import datetime as _dt
import hashlib

import pandas as pd

SPLITS = ("train", "val", "test")
COLUMNS = ["cert", "split", "stratum", "assigned_at"]


def _stratum(row) -> str:
    g = row["grade_label"] if isinstance(row["grade_label"], str) else "?"
    e = row["era"] if isinstance(row["era"], str) else "?"
    return f"{g}|{e}"


def _rank_key(cert: str, seed: int) -> str:
    return hashlib.sha256(f"{seed}:{cert}".encode()).hexdigest()


def assign_splits(manifest: pd.DataFrame, existing: pd.DataFrame | None, seed: int = 42,
                  fracs: tuple[float, float, float] = (0.8, 0.1, 0.1)) -> pd.DataFrame:
    """Assign new certs; keep every existing assignment untouched.

    Within each stratum, unassigned certs are ordered by a seeded hash and dealt so that the
    stratum's overall train/val/test proportions (existing + new) approach `fracs`. Every
    stratum with ≥ 3 new certs and no existing rows gets at least one of each split.
    """
    now = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    prev = existing[COLUMNS].copy() if existing is not None and len(existing) else pd.DataFrame(columns=COLUMNS)
    done = set(prev.cert)
    m = manifest[["cert", "grade_label", "era"]].drop_duplicates("cert")
    m = m[~m.cert.isin(done)].copy()
    m["stratum"] = m.apply(_stratum, axis=1)

    new_rows = []
    prev_strata = prev.groupby("stratum").split.value_counts() if len(prev) else None
    for stratum, grp in m.groupby("stratum"):
        certs = sorted(grp.cert, key=lambda c: _rank_key(c, seed))
        counts = {s: 0 for s in SPLITS}
        if prev_strata is not None and stratum in prev_strata.index.get_level_values(0):
            for s in SPLITS:
                counts[s] = int(prev_strata.get((stratum, s), 0))
        total_existing = sum(counts.values())
        if total_existing == 0 and len(certs) >= 3:
            order = ["test", "val", "train"]
            for s, c in zip(order, certs[:3]):
                counts[s] += 1; new_rows.append((c, s, stratum, now))
            certs = certs[3:]
        for c in certs:
            total = sum(counts.values()) + 1
            # pick the split furthest below its target share
            deficits = {s: fracs[i] * total - counts[s] for i, s in enumerate(SPLITS)}
            s = max(SPLITS, key=lambda k: deficits[k])
            counts[s] += 1
            new_rows.append((c, s, stratum, now))

    new = pd.DataFrame(new_rows, columns=COLUMNS)
    out = pd.concat([prev, new], ignore_index=True)
    return out.sort_values("cert").reset_index(drop=True)[COLUMNS]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_splits.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-dataset/tagdataset/splits.py scripts/tag-dataset/tests/test_splits.py
git commit -m "feat(tag-dataset): stratified per-card splits with frozen existing assignments"
```

---

### Task 4: Build command

**Files:**
- Create: `scripts/tag-dataset/tagdataset/build.py`
- Create: `scripts/tag-dataset/tests/test_build.py`
- Modify: `scripts/tag-dataset/tagdataset/cli.py` (add `build` subcommand)

**Interfaces:**
- Consumes: `Store.iter_raw_ok`, `Store.files_for`, `Store.gone_files`, `labels.*`, `splits.assign_splits`.
- Produces: `build.build(store, out_dir: str, seed: int = 42) -> dict[str, int]` writing `manifest.parquet, corners.parquet, edges.parquet, surface.parquet, dings.parquet, splits.parquet` under `out_dir`; returns `{cards, corners, edges, markers, dings, splits_new, splits_total}`. `build.OUTPUTS` tuple of the six file names.

- [ ] **Step 1: Write the failing tests**

`scripts/tag-dataset/tests/test_build.py`:
```python
import pandas as pd

from tagdataset import build, labels
from tagdataset.store import Store


def _store(tmp_path, detail_fixture, score_fixture):
    s = Store(str(tmp_path / "t.sqlite"))
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    d2 = {"data": {**detail_fixture["data"], "certificateValue": "X2", "uuid": "u2"}}
    s.put_raw("X2", "7", d2, score_fixture, 200, None)
    s.put_raw("GONE", "9", None, None, 404, "nf")
    s.put_file("C1240631", "front.jpg", "u", 1, "h")
    s.put_file("C1240631", "corner_FTL.png", "u", 1, "h")
    s.add_failure("download", "C1240631", "sfx_front_annotated.jpg", "HTTP 403")
    return s


def test_build_writes_all_outputs_with_expected_rows(tmp_path, detail_fixture, score_fixture):
    store = _store(tmp_path, detail_fixture, score_fixture)
    out = tmp_path / "out"
    counts = build.build(store, str(out), seed=1)
    for name in build.OUTPUTS:
        assert (out / name).exists()
    assert counts["cards"] == 2 and counts["corners"] == 16 and counts["edges"] == 16
    n_markers = sum(len(score_fixture["data"][k]["annotations"]["markers"]) for k in ("surfaceFrontData", "surfaceBackData"))
    assert counts["markers"] == 2 * n_markers
    assert counts["dings"] == 2 * len(detail_fixture["data"]["dingsJSON"]["Dings"])
    assert counts["splits_new"] == 2 and counts["splits_total"] == 2

    m = pd.read_parquet(out / "manifest.parquet")
    assert list(m.columns) == labels.MANIFEST_COLUMNS and set(m.cert) == {"C1240631", "X2"}
    row = m.set_index("cert").loc["C1240631"]
    assert row.n_files_uploaded == 2 and row.n_files_unavailable == 1
    assert pd.read_parquet(out / "corners.parquet").columns.tolist() == labels.CORNER_COLUMNS
    assert pd.read_parquet(out / "surface.parquet").columns.tolist() == labels.SURFACE_COLUMNS
    assert pd.read_parquet(out / "dings.parquet").columns.tolist() == labels.DING_COLUMNS
    sp = pd.read_parquet(out / "splits.parquet")
    assert set(sp.cert) == {"C1240631", "X2"}


def test_build_rebuild_keeps_split_assignments(tmp_path, detail_fixture, score_fixture):
    store = _store(tmp_path, detail_fixture, score_fixture)
    out = tmp_path / "out"
    build.build(store, str(out), seed=1)
    first = pd.read_parquet(out / "splits.parquet").set_index("cert").split.to_dict()
    d3 = {"data": {**detail_fixture["data"], "certificateValue": "X3", "uuid": "u3"}}
    store.put_raw("X3", "7", d3, score_fixture, 200, None)
    counts = build.build(store, str(out), seed=999)
    second = pd.read_parquet(out / "splits.parquet").set_index("cert").split.to_dict()
    assert all(second[c] == v for c, v in first.items())
    assert counts["splits_new"] == 1 and counts["splits_total"] == 3 and "X3" in second


def test_build_empty_store_writes_empty_frames_with_columns(tmp_path):
    store = Store(str(tmp_path / "e.sqlite"))
    out = tmp_path / "out"
    counts = build.build(store, str(out))
    assert counts["cards"] == 0
    m = pd.read_parquet(out / "manifest.parquet")
    assert len(m) == 0 and list(m.columns) == labels.MANIFEST_COLUMNS
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_build.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.build'`

- [ ] **Step 3: Implement build.py**

`scripts/tag-dataset/tagdataset/build.py`:
```python
"""Store → training parquet tables (spec §6.1)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from . import labels
from .splits import COLUMNS as SPLIT_COLUMNS, assign_splits
from .store import Store

OUTPUTS = ("manifest.parquet", "corners.parquet", "edges.parquet", "surface.parquet", "dings.parquet", "splits.parquet")


def _frame(rows: list[dict], columns: list[str]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=columns)
    return df[columns]


def build(store: Store, out_dir: str, seed: int = 42) -> dict[str, int]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    cards, corners, edges, markers, dings = [], [], [], [], []
    for cert, detail, score in store.iter_raw_ok():
        counts = {"uploaded": len(store.files_for(cert)), "unavailable": len(store.gone_files(cert))}
        cards.append(labels.card_row(cert, detail, score, counts))
        corners.extend(labels.corner_rows(cert, score))
        edges.extend(labels.edge_rows(cert, score))
        markers.extend(labels.surface_rows(cert, score))
        dings.extend(labels.ding_rows(cert, detail))

    manifest = _frame(cards, labels.MANIFEST_COLUMNS)
    splits_path = out / "splits.parquet"
    existing = pd.read_parquet(splits_path) if splits_path.exists() else None
    n_before = len(existing) if existing is not None else 0
    splits = assign_splits(manifest, existing, seed=seed) if len(manifest) else (
        existing if existing is not None else pd.DataFrame(columns=SPLIT_COLUMNS))

    manifest.to_parquet(out / "manifest.parquet", index=False)
    _frame(corners, labels.CORNER_COLUMNS).to_parquet(out / "corners.parquet", index=False)
    _frame(edges, labels.EDGE_COLUMNS).to_parquet(out / "edges.parquet", index=False)
    _frame(markers, labels.SURFACE_COLUMNS).to_parquet(out / "surface.parquet", index=False)
    _frame(dings, labels.DING_COLUMNS).to_parquet(out / "dings.parquet", index=False)
    splits.to_parquet(splits_path, index=False)

    return {"cards": len(manifest), "corners": len(corners), "edges": len(edges), "markers": len(markers),
            "dings": len(dings), "splits_new": len(splits) - n_before, "splits_total": len(splits)}
```

- [ ] **Step 4: Wire the CLI**

In `scripts/tag-dataset/tagdataset/cli.py`, add near the other imports:
```python
from . import build as bld
```
Add a command function after `cmd_verify`:
```python
def cmd_build(args, cfg) -> int:
    store = Store(cfg.db_path)
    counts = bld.build(store, args.out, seed=args.seed)
    store.close()
    print(f"build done: {counts}")
    print(f"outputs in {args.out}: {', '.join(bld.OUTPUTS)}")
    return 0
```
And in `build_parser()` before `return p`:
```python
    b = sub.add_parser("build", help="write training parquet tables from the store")
    b.add_argument("--out", default="data/dataset")
    b.add_argument("--seed", type=int, default=42)
    b.set_defaults(func=cmd_build)
```

- [ ] **Step 5: Run tests to verify they pass, plus the CLI parser**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_build.py -v` → 3 passed.
Run: `.\.venv\Scripts\python.exe -m tagdataset build --help` → prints usage with `--out` and `--seed`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/tag-dataset/tagdataset/build.py scripts/tag-dataset/tests/test_build.py scripts/tag-dataset/tagdataset/cli.py
git commit -m "feat(tag-dataset): build command writing manifest, crops, markers, dings, splits"
```

---

### Task 5: Stats command

**Files:**
- Create: `scripts/tag-dataset/tagdataset/stats.py`
- Create: `scripts/tag-dataset/tests/test_stats.py`
- Modify: `scripts/tag-dataset/tagdataset/cli.py` (add `stats` subcommand)
- Modify: `scripts/tag-dataset/README.md` (build/stats rows, Outputs section)

**Interfaces:**
- Produces: `stats.report(out_dir: str) -> str` (reads the six parquet files only); sections in this order with these exact headings: `== cards by grade and split ==`, `== crops by split ==`, `== markers by engine_type ==`, `== markers by type_name ==`, `== unmapped ==`, `== nulls ==`, `== score_total coverage ==`, `== canvas aspect check ==`, `== file completeness by grade ==`, `== ding crops without upload ==`, `== duplicates ==`.

- [ ] **Step 1: Write the failing tests**

`scripts/tag-dataset/tests/test_stats.py`:
```python
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
    assert "score_total present: 1/2" in text
    assert "scoreBTLCAngle" in text or "score_angle" in text  # null report names the column
    assert "ding crops without upload" in text


def test_report_on_empty_dataset(tmp_path):
    s = Store(str(tmp_path / "e.sqlite"))
    out = tmp_path / "out"
    build.build(s, str(out))
    text = stats.report(str(out))
    assert "cards: 0" in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stats.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tagdataset.stats'`

- [ ] **Step 3: Implement stats.py**

`scripts/tag-dataset/tagdataset/stats.py`:
```python
"""Read the built parquet tables and print a health report (spec §6.2)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

SECTIONS = (
    "== cards by grade and split ==", "== crops by split ==", "== markers by engine_type ==",
    "== markers by type_name ==", "== unmapped ==", "== nulls ==", "== score_total coverage ==",
    "== canvas aspect check ==", "== file completeness by grade ==", "== ding crops without upload ==",
    "== duplicates ==",
)
LABEL_NULL_COLUMNS = {
    "manifest": ["grade_label", "grade_num", "era", "rollup_centering", "rollup_corners", "rollup_edges",
                 "rollup_surface", "dte_front_left", "dte_back_left", "image_w", "score_total"],
    "corners": ["score_angle", "score_fill", "score_fray"],
    "edges": ["score_fill", "score_fray"],
    "surface": ["x", "y", "w", "h", "deduction"],
    "dings": ["w", "h"],
}


def _load(out: Path) -> dict[str, pd.DataFrame]:
    return {n: pd.read_parquet(out / f"{n}.parquet") for n in ("manifest", "corners", "edges", "surface", "dings", "splits")}


def report(out_dir: str) -> str:
    t = _load(Path(out_dir))
    m, sp = t["manifest"], t["splits"]
    lines: list[str] = [f"cards: {len(m)}"]
    ms = m.merge(sp[["cert", "split"]], on="cert", how="left")

    lines.append(SECTIONS[0])
    if len(ms):
        lines.append(pd.crosstab(ms.grade_label.fillna("?"), ms.split.fillna("?"), margins=True).to_string())

    lines.append(SECTIONS[1])
    for name in ("corners", "edges", "surface", "dings"):
        j = t[name].merge(sp[["cert", "split"]], on="cert", how="left")
        lines.append(f"{name}: " + (j.split.fillna("?").value_counts().to_dict().__repr__() if len(j) else "{}"))

    lines.append(SECTIONS[2])
    s = t["surface"]
    if len(s):
        lines.append(pd.crosstab(s.engine_type, s.is_rollup, margins=True).to_string())
    lines.append(SECTIONS[3])
    if len(s):
        lines.append(s.groupby(["type_name", s.subtype_name.fillna("")]).size().sort_values(ascending=False).to_string())

    lines.append(SECTIONS[4])
    unm = s[s.engine_type == "UNKNOWN"] if len(s) else s
    und = t["dings"][t["dings"].engine_type == "UNKNOWN"] if len(t["dings"]) else t["dings"]
    lines.append(f"markers UNKNOWN: {len(unm)} " + (unm.groupby(["type_name", unm.subtype_name.fillna("")]).size().to_dict().__repr__() if len(unm) else ""))
    lines.append(f"dings UNKNOWN: {len(und)} " + (und.type_name.value_counts().to_dict().__repr__() if len(und) else ""))

    lines.append(SECTIONS[5])
    for name, cols in LABEL_NULL_COLUMNS.items():
        df = t[name]
        for c in cols:
            if c in df.columns and len(df):
                n = int(df[c].isna().sum())
                if n:
                    lines.append(f"{name}.{c}: {n}/{len(df)} null")

    lines.append(SECTIONS[6])
    lines.append(f"score_total present: {int(m.score_total.notna().sum()) if len(m) else 0}/{len(m)}")

    lines.append(SECTIONS[7])
    if len(m):
        for side in ("front", "back"):
            sub = m[m[f"ann_{side}_w"].notna() & m.image_w.notna()]
            if len(sub):
                ratio = (sub[f"ann_{side}_w"] / sub[f"ann_{side}_h"]) / (sub.image_w / sub.image_h)
                bad = int(((ratio - 1).abs() > 0.01).sum())
                lines.append(f"{side}: {len(sub)} sides with canvas; aspect mismatch > 1%: {bad}")

    lines.append(SECTIONS[8])
    if len(m):
        g = m.groupby("grade_label").agg(cards=("cert", "count"), uploaded=("n_files_uploaded", "sum"),
                                        unavailable=("n_files_unavailable", "sum"))
        lines.append(g.to_string())

    lines.append(SECTIONS[9])
    lines.append("(requires the store; see cli stats --db for the joined count)")

    lines.append(SECTIONS[10])
    lines.append(f"duplicate certs in manifest: {int(m.cert.duplicated().sum()) if len(m) else 0}; "
                 f"in splits: {int(sp.cert.duplicated().sum()) if len(sp) else 0}")
    return "\n".join(lines)


def ding_crops_without_upload(out_dir: str, store) -> int:
    d = pd.read_parquet(Path(out_dir) / "dings.parquet")
    if not len(d):
        return 0
    missing = 0
    for cert, grp in d.groupby("cert"):
        have = store.files_for(cert)
        missing += int((~grp.crop_path.str.split("/").str[-1].isin(have)).sum())
    return missing
```

- [ ] **Step 4: Wire the CLI and README**

In `cli.py` add `from . import stats as st` and:
```python
def cmd_stats(args, cfg) -> int:
    text = st.report(args.out)
    store = Store(cfg.db_path)
    n = st.ding_crops_without_upload(args.out, store)
    store.close()
    print(text.replace("(requires the store; see cli stats --db for the joined count)", f"ding crops not in files table: {n}"))
    return 0
```
and in `build_parser()`:
```python
    s2 = sub.add_parser("stats", help="report class balance, nulls, unmapped types, completeness")
    s2.add_argument("--out", default="data/dataset")
    s2.set_defaults(func=cmd_stats)
```
README: add two rows to the Commands table (`build` → "write training tables to `data/dataset/`; splits are frozen across rebuilds"; `stats` → "print dataset health report") and an "Outputs" section listing the six parquet files with one line each on their columns (cert-keyed; geometry as canvas fractions; `is_rollup` flag; dings separate).

- [ ] **Step 5: Run tests and the full suite**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_stats.py -v` → 2 passed.
Run: `.\.venv\Scripts\python.exe -m pytest -q` → all passed, no warnings.

- [ ] **Step 6: Commit**

```bash
git add scripts/tag-dataset/tagdataset/stats.py scripts/tag-dataset/tests/test_stats.py scripts/tag-dataset/tagdataset/cli.py scripts/tag-dataset/README.md
git commit -m "feat(tag-dataset): stats command and README for the build outputs"
```

---

### Task 6: Run build and stats on the real store

**Files:**
- Modify: `scripts/tag-dataset/README.md` (Status table row)

- [ ] **Step 1: Build**

From `scripts/tag-dataset`: `.\.venv\Scripts\python.exe -m tagdataset build`
Expected: `build done: {...}` with `cards` equal to the store's `raw_ok` count at that moment (the user's full pull may still be adding certs; that is fine), six files under `data/dataset/`.

- [ ] **Step 2: Stats**

`.\.venv\Scripts\python.exe -m tagdataset stats` → save the full output to the task report. Check: `markers UNKNOWN: 0` and `dings UNKNOWN: 0` (if not, list the type names in the report; do not edit `type_map.json` in this task); `aspect mismatch > 1%: 0` on both sides (if not, report the count); `duplicate certs: 0`.

- [ ] **Step 3: Record**

Append a row to the README Status table: date, `build` cards/markers/dings counts, unknown-type count, aspect-mismatch count. Commit README only:
```bash
git add scripts/tag-dataset/README.md
git commit -m "docs(tag-dataset): record first dataset build"
```

---

## Self-review

**Spec coverage.** §6.1 manifest/corners/edges/surface/splits → Tasks 1–4 (dings split out per ruling). §6.2 stats items: cards per grade per split, crops per split, marker counts per type, files missing per grade (via manifest completeness counts), label ranges/nulls, duplicate check → Task 5. §7 type mapping → `type_map.json` in Task 1, unmapped reported in Task 5. §11 nulls kept and masked, test split frozen (`assign_splits` never reassigns) → Tasks 1, 3. §12 unit tests for coordinate conversion against the fixture and splits integrity → Tasks 2, 3.

**Placeholder scan.** None; Task 6 reports real numbers.

**Type consistency.** `labels.MANIFEST_COLUMNS` etc. are the single source for column order and are asserted in `test_build`. `store.gone_files` exists (Task 11 of the acquisition plan). `splits.COLUMNS` imported by `build`. `stats.SECTIONS` is asserted by `test_stats`.
