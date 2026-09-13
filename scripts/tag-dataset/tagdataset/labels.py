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
