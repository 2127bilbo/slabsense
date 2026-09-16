"""Pure tile geometry for the surface detector: grid, box clipping, tile selection."""
from __future__ import annotations

import numpy as np

TILE = 1024
STRIDE = 896
MIN_VISIBLE = 0.5
MIN_SIDE_PX = 4


def _axis_origins(length: int, tile: int, stride: int) -> list[int]:
    if length <= tile:
        return [0]
    origins = list(range(0, length - tile, stride))
    origins.append(length - tile)
    return sorted(set(origins))


def tile_grid(w: int, h: int, tile: int = TILE, stride: int = STRIDE) -> list[tuple[int, int]]:
    """Tile origins (x0, y0) covering a w×h image; the last row/column end exactly on the image edge."""
    return [(x, y) for y in _axis_origins(h, tile, stride) for x in _axis_origins(w, tile, stride)]


def clip_boxes(boxes_px: list[list[float]], x0: int, y0: int, tile: int = TILE) -> list[list[float]]:
    """Boxes ([label, x1, y1, x2, y2] in image px) with >= MIN_VISIBLE of their area inside the tile,
    translated to tile coordinates and clipped; slivers thinner than MIN_SIDE_PX are dropped."""
    out = []
    for label, x1, y1, x2, y2 in boxes_px:
        area = max(x2 - x1, 0.0) * max(y2 - y1, 0.0)
        if area <= 0:
            continue
        cx1, cy1 = max(x1, x0), max(y1, y0)
        cx2, cy2 = min(x2, x0 + tile), min(y2, y0 + tile)
        if cx2 - cx1 <= 0 or cy2 - cy1 <= 0:
            continue
        if (cx2 - cx1) * (cy2 - cy1) < MIN_VISIBLE * area:
            continue
        if cx2 - cx1 < MIN_SIDE_PX or cy2 - cy1 < MIN_SIDE_PX:
            continue
        out.append([label, float(cx1 - x0), float(cy1 - y0), float(cx2 - x0), float(cy2 - y0)])
    return out


def select_tiles(w: int, h: int, boxes_px: list[list[float]], rng: np.random.Generator,
                 neg_per_side: int = 1, tile: int = TILE, stride: int = STRIDE) -> list[tuple[int, int, list]]:
    """Every grid tile containing a clipped box; for a side with no boxes, neg_per_side random grid tiles."""
    grid = tile_grid(w, h, tile, stride)
    if boxes_px:
        sel = []
        for x0, y0 in grid:
            kept = clip_boxes(boxes_px, x0, y0, tile)
            if kept:
                sel.append((x0, y0, kept))
        return sel
    n = min(neg_per_side, len(grid))
    idx = sorted(rng.choice(len(grid), size=n, replace=False).tolist())
    return [(grid[i][0], grid[i][1], []) for i in idx]
