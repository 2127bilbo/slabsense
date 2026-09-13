"""Which files to download for a cert and what to call them (spec §5.3)."""
from __future__ import annotations

CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}

# filename tag -> score-response key
CORNER_KEYS = {
    "FTL": "imageFileFTL", "FTR": "imageFileFTR", "FBL": "imageFileFBL", "FBR": "imageFileFBR",
    "BTL": "imageFileBTL", "BTR": "imageFileBTR", "BBL": "imageFileBBL", "BBR": "imageFileBBR",
}
EDGE_KEYS = {
    "FT": "imageFileFTE", "FB": "imageFileFBE", "FL": "imageFileFLE", "FR": "imageFileFRE",
    "BT": "imageFileBTE", "BB": "imageFileBBE", "BL": "imageFileBLE", "BR": "imageFileBRE",
}


def _image(block: dict | None) -> str | None:
    return (block or {}).get("image")


def ding_names(detail: dict) -> list[str]:
    """Filenames for every ding in a cert's `dingsJSON.Dings`, in ding order.

    Mirrors the collision rule `expected_files` applies: a ding's own `Ordering` names it
    (`ding_{ordering}.jpg`), falling back to its 1-based position when `Ordering` is not an
    int; a name already used by an earlier ding gets its position appended instead.
    """
    d = (detail or {}).get("data") or {}
    dings = (d.get("dingsJSON") or {}).get("Dings") or []
    used_names: set[str] = set()
    names: list[str] = []
    for i, ding in enumerate(dings, start=1):
        ordering = ding.get("Ordering")
        if isinstance(ordering, int):
            candidate = f"ding_{ordering}.jpg"
        else:
            candidate = f"ding_{i}.jpg"

        if candidate in used_names:
            if isinstance(ordering, int):
                name = f"ding_{ordering}_{i}.jpg"
            else:
                name = f"ding_idx{i}.jpg"
        else:
            name = candidate

        used_names.add(name)
        names.append(name)
    return names


def expected_files(detail: dict, score: dict | None) -> list[tuple[str, str]]:
    d = (detail or {}).get("data") or {}
    s = (score or {}).get("data") or {}
    out: list[tuple[str, str]] = []
    used_names: set[str] = set()

    def add(name: str, url: str | None) -> None:
        if url:
            out.append((name, url))
            used_names.add(name)

    add("front.jpg", d.get("imageFileDeskewedFront"))
    add("back.jpg", d.get("imageFileDeskewedBack"))
    add("sfx_front.jpg", d.get("imageFileFSFX") or s.get("imageFileFSFX"))
    add("sfx_back.jpg", d.get("imageFileBSFX") or s.get("imageFileBSFX"))
    add("sfx_front_annotated.jpg", _image(d.get("surfaceFrontData")) or _image(s.get("surfaceFrontData")))
    add("sfx_back_annotated.jpg", _image(d.get("surfaceBackData")) or _image(s.get("surfaceBackData")))
    for tag, key in CORNER_KEYS.items():
        add(f"corner_{tag}.png", s.get(key))
    for tag, key in EDGE_KEYS.items():
        add(f"edge_{tag}.png", s.get(key))
    dings = (d.get("dingsJSON") or {}).get("Dings") or []
    for name, ding in zip(ding_names(detail), dings):
        add(name, ding.get("ImageURL"))
    return out
