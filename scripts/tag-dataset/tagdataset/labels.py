"""Pure extraction: one cert's (detail, score) → label rows (spec §6.1)."""
from __future__ import annotations

import json
import math
from pathlib import Path

from .files import CORNER_KEYS, EDGE_KEYS, ding_names
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


def type_map_keys() -> frozenset[str]:
    return frozenset(_TYPE_MAP)


def map_engine_type(type_name: str | None, subtype_name: str | None, location: str | None) -> str:
    t = type_name or ""
    if subtype_name:
        # A non-empty subtype must match an exact type|subtype key; no fallthrough to the
        # bare type, so a subtype we have not reviewed maps to UNKNOWN instead of silently
        # taking on a possibly-wrong bare-type label.
        return _TYPE_MAP.get(f"{t}|{subtype_name}", "UNKNOWN")
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
    for k in CORNER_KEYS:
        side, corner = k[0], k[1:]
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
    for k in EDGE_KEYS:
        side, edge = k[0], k[1]
        out.append({
            "cert": cert, "side": side, "edge": edge,
            "score_fill": _num(s.get(f"score{k}EFill")), "score_fray": _num(s.get(f"score{k}EFray")),
            "fill_px": _num(s.get(f"fill{k}Epx")), "fray_px": _num(s.get(f"fray{k}Epx")),
            "crop_path": f"{PREFIX}/{cert}/edge_{k}.png",
        })
    return out


# ── surface markers ──────────────────────────────────────────────────────
SURFACE_COLUMNS = [
    "cert", "side", "marker_id", "ordering", "type_name", "subtype_name", "family", "engine_type",
    "location", "source", "is_rollup", "x", "y", "w", "h", "x1", "y1", "x2", "y2",
    "rotation_deg", "deduction", "deduction_raw", "deduction_override", "area", "depth", "white_scale",
]


def _bbox(m: dict, W: float, H: float) -> tuple[float, float, float, float, float, float, float, float]:
    """Return (x, y, w, h, x1, y1, x2, y2) as canvas fractions; NaN where absent."""
    if all(m.get(k) is not None for k in ("x1", "y1", "x2", "y2")):
        rx1, ry1, rx2, ry2 = _num(m["x1"]), _num(m["y1"]), _num(m["x2"]), _num(m["y2"])
        x1, y1, x2, y2 = rx1 / W, ry1 / H, rx2 / W, ry2 / H
        x, y = min(x1, x2), min(y1, y2)
        # Divide the raw pixel delta (not the pre-divided fractions) to avoid float
        # rounding drift between divide-then-subtract and subtract-then-divide.
        raw_w, raw_h = abs(rx2 - rx1) / W, abs(ry2 - ry1) / H
        w, h = max(raw_w, LINE_MIN_FRAC), max(raw_h, LINE_MIN_FRAC)
        # When the minimum-size bump kicks in on an axis, centre the box on the segment
        # instead of anchoring it at the segment's min corner, so a near-zero-width line
        # doesn't get pushed entirely to one side of its true position.
        if raw_w < LINE_MIN_FRAC:
            x = (x1 + x2) / 2 - w / 2
        if raw_h < LINE_MIN_FRAC:
            y = (y1 + y2) / 2 - h / 2
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
                # ID/Ordering are usually ints, but some real markers carry "ERROR" (a string);
                # coerce through _num so the column stays a single float dtype (NaN for non-numeric)
                # instead of a mixed int/str column that breaks to_parquet.
                "marker_id": _num(m.get("ID")), "ordering": _num(m.get("Ordering")),
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
    dings = (d.get("dingsJSON") or {}).get("Dings") or []
    names = ding_names(detail)
    out = []
    for i, (g, name) in enumerate(zip(dings, names), start=1):
        px, py, pw, ph = (_num(g.get("LocationX")), _num(g.get("LocationY")), _num(g.get("Width")), _num(g.get("Height")))
        ordering = g.get("Ordering") if isinstance(g.get("Ordering"), int) else i
        out.append({
            "cert": cert, "side": (g.get("Side") or "?")[0].upper(),
            "ordering": ordering, "type_name": g.get("Type"),
            "engine_type": map_engine_type(g.get("Type"), None, None), "location": g.get("Location"),
            "px_x": px, "px_y": py, "px_w": pw, "px_h": ph,
            "x": px / W if W else NAN, "y": py / H if H else NAN,
            "w": pw / W if W else NAN, "h": ph / H if H else NAN,
            "crop_path": f"{PREFIX}/{cert}/{name}",
        })
    return out
