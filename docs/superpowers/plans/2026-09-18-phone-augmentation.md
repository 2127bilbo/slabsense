# Phone-Photo Augmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `phone` training augmentation for the corner and edge crop models (random backdrop recolour, loose crop, softness, resolution loss) and a deterministic `--phone-sim` evaluation, so corners v3 / edges v2 stop depending on TAG's orange backdrop and survive phone softness (handoff Step 9, measured in the app on 2026-09-17/18).

**Architecture:** One new module `trainlib/phone_aug.py` holds the four transforms and the slot→seed table; `data.load_crop` gains `aug="phone"` (applied after rotation, before the resize; no random window) and a `phone_sim` flag for the deterministic eval variant; `evaluate.py` gains `--phone-sim`. The flood fill matches the app's `repaintBackdrop` (`src/lib/tag-crops.js`): tolerance 60 (sum of absolute RGB differences), grow 2 px, abandon if the fill reaches the crop centre or exceeds 30% of the crop, skip a seed that is not orange-ish (sum of absolute differences to (247,126,44) above 110).

**Tech Stack:** Python 3.12, numpy, scipy.ndimage (label, binary_dilation), Pillow (GaussianBlur, JPEG re-encode), pytest; existing `trainlib`.

**Spec:** `training/HANDOFF-rented-gpu.md` Step 9 (written by the app session) and `training/README.md` "Next training run: backdrop augmentation" / "Edges v2: what to fix". Deviations ruled here: (1) the `phone` mode does NOT apply `strong`'s random window (it can cut off the crop's outer corner, which is both the flood-fill seed and where the corner label lives); `phone` = the four transforms + `light` photometric jitter (±10%) + the existing edge flip; (2) dilation is 2 px to match the app (Step 9 text says 3); (3) tests live in `training/tests/` (Step 9 says `trainlib/tests/`).

## Global Constraints

- Python `>=3.12,<3.13`; tests via `cd training && .venv/Scripts/python -m pytest -q` (131 pass now; `filterwarnings = ["error"]`). Add `"scipy>=1.12"` to `dependencies` in `training/pyproject.toml` (already installed transitively; make it explicit).
- Never `git add` `scripts/tag-dataset/tagdataset/cli.py` or `download.py`; never `.pt`/`.joblib`; never `git stash`. Commit only the files each task names.
- Slot seeds (crop pixel coordinates AFTER the rotation step in `load_crop`; the slot comes from the cached file's stem: `corner_FTL` → corner `TL`, `edge_BL` → edge `L`):

| stem pattern | seeds |
|---|---|
| `corner_?TL` | (0, 0) |
| `corner_?TR` | (W−1, 0) |
| `corner_?BL` | (0, H−1) |
| `corner_?BR` | (W−1, H−1) |
| `edge_?T` | (0, 0), (W−1, 0) |
| `edge_?B` | (0, H−1), (W−1, H−1) |
| `edge_?L` (after ROTATE_90 the outer side is the bottom) | (0, H−1), (W−1, H−1) |
| `edge_?R` (after ROTATE_90 the outer side is the top) | (0, 0), (W−1, 0) |

- Backdrop recolour (`recolour_backdrop(img, seeds, rng, tolerance=60, grow=2, max_fill=0.3, skip_tolerance=110, orange=(247,126,44)) -> (img, filled: bool)`): for each seed, skip if `sum|seed_rgb − orange| > skip_tolerance`; mask = pixels with `sum|rgb − seed_rgb| <= tolerance`; component = the connected component (4-connectivity) of the mask containing the seed; abandon the seed if the component contains the centre pixel `(W//2, H//2)` or has more than `max_fill·W·H` pixels; dilate the union of accepted components by `grow` iterations; fill with one random colour drawn uniformly from the palette: black (0,0,0), white (255,255,255), greys (v,v,v) for v in {64,128,192}, wood browns {(120,80,40), (160,110,60), (90,60,30)}, and a random hue at random saturation (HSV with S∈[0.2,1], V∈[0.3,1]); return whether anything was filled.
- Loose crop (`loose_crop(img, outer_sides, rng, max_frac=0.15, fill)`): pad the named outer side(s) (`"top"`, `"bottom"`, `"left"`, `"right"`, derived from the seeds table: corner TL → top+left, edge T → top, edge L-after-rotation → bottom, etc.) by a random 0–15% of the crop's size on that axis with the given flat colour (the recolour colour if a fill happened, else the seed colour).
- Softness (`soften(img, rng, input_size)`): Gaussian blur radius `r_in ~ U(0.5, 1.5)` defined at the model input size, applied at native scale as `r_in · (native_w / input_w)`; then JPEG re-encode at quality `U{60..90}` in memory.
- Resolution loss (`resolution_loss(img, rng)`): downscale by `s ~ U(0.35, 0.6)` and upscale back to the original size, both bilinear.
- `apply_phone(img, slot_stem, rng, input_size) -> img`: recolour with p=0.6, loose crop p=0.3, softness p=0.5, resolution loss p=0.3, in that order, each decided by its own `rng.random()` draw in that fixed order (so a seeded rng is reproducible).
- `phone_sim(img, slot_stem, input_size) -> img` (deterministic, no rng): recolour with black on every accepted seed (same fill rules), blur 1.0 px at input scale, downscale 0.5 and back. No loose crop, no JPEG.
- `data.AUG_MODES = ("light", "strong", "phone")`; in `load_crop`, when `train and aug == "phone"`: after rotation, `img = apply_phone(img, path.stem, rng, (w, h))`, then the resize, then the `light` photometric path (±10% brightness/contrast) and the existing edge flip. When `phone_sim=True` (a new keyword, eval only): after rotation, `img = phone_sim(img, path.stem, (w, h))`, then the resize, no other augmentation. `CropDataset(..., phone_sim=False)` passes it through; `train.make_loader` unchanged; `evaluate.py` gains `--phone-sim` which builds the val loader with `phone_sim=True` and writes `eval_<split>_phonesim.csv` instead of `eval_<split>.csv`.
- The flood fill runs on the native crop (550×550 corners, ~3300×550 edges): use numpy/scipy vectorised ops only, no per-pixel Python loops.

---

## File structure

| File | Responsibility |
|---|---|
| `training/trainlib/phone_aug.py` | seeds table, four transforms, `apply_phone`, `phone_sim` |
| `training/trainlib/data.py` | `phone` mode and `phone_sim` flag in `load_crop` / `CropDataset` |
| `training/trainlib/evaluate.py` | `--phone-sim` |
| `training/tests/test_phone_aug.py`, `tests/test_data.py`, `tests/test_evaluate.py` | tests |
| `training/pyproject.toml` | scipy dependency |
| `training/HANDOFF-rented-gpu.md` (Step 9), `training/README.md` | revised recipe and results of the local phone-sim baseline |

---

### Task 1: `phone_aug` module

**Files:**
- Create: `training/trainlib/phone_aug.py`
- Modify: `training/pyproject.toml`
- Test: `training/tests/test_phone_aug.py`

**Interfaces:** as in the Global Constraints: `seeds_for(stem, W, H) -> list[tuple[int,int]]`, `outer_sides_for(stem) -> list[str]`, `recolour_backdrop`, `loose_crop`, `soften`, `resolution_loss`, `apply_phone`, `phone_sim`, `PALETTE` (the fixed colours), `random_fill_colour(rng)`.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_phone_aug.py`:

```python
import io

import numpy as np
from PIL import Image

from trainlib import phone_aug as pa

ORANGE = (247, 126, 44)


def _corner(w=200, h=200, backdrop=ORANGE, card=(200, 190, 60), radius=60, tl=True):
    """A synthetic corner crop: orange backdrop outside a rounded card corner at the top-left."""
    arr = np.zeros((h, w, 3), dtype=np.uint8); arr[...] = backdrop
    yy, xx = np.mgrid[0:h, 0:w]
    inside = ((xx >= radius) | (yy >= radius) | ((xx - radius) ** 2 + (yy - radius) ** 2 <= radius ** 2)) & (xx >= 0) & (yy >= 0)
    # the card occupies everything except the outer quarter-circle notch at (0,0)
    arr[inside & ~((xx < radius) & (yy < radius) & ((xx - radius) ** 2 + (yy - radius) ** 2 > radius ** 2))] = card
    return Image.fromarray(arr)


def test_seeds_and_outer_sides_follow_the_slot_table():
    assert pa.seeds_for("corner_FTL", 100, 50) == [(0, 0)]
    assert pa.seeds_for("corner_BBR", 100, 50) == [(99, 49)]
    assert pa.seeds_for("edge_FT", 100, 50) == [(0, 0), (99, 0)]
    assert pa.seeds_for("edge_BL", 100, 50) == [(0, 49), (99, 49)]
    assert pa.seeds_for("edge_FR", 100, 50) == [(0, 0), (99, 0)]
    assert pa.outer_sides_for("corner_FTL") == ["top", "left"]
    assert pa.outer_sides_for("edge_BL") == ["bottom"]
    assert pa.outer_sides_for("edge_FR") == ["top"]


def test_recolour_fills_the_backdrop_and_leaves_the_card():
    img = _corner()
    out, filled = pa.recolour_backdrop(img, [(0, 0)], np.random.default_rng(0), colour=(0, 0, 0))
    a = np.asarray(out)
    assert filled
    assert tuple(a[0, 0]) == (0, 0, 0)                  # backdrop corner is black
    assert tuple(a[150, 150]) == (200, 190, 60)          # card untouched
    assert tuple(a[5, 150]) == (200, 190, 60)            # card along the top edge untouched


def test_recolour_refuses_a_seed_that_is_not_orange_or_that_leaks():
    black = Image.fromarray(np.zeros((100, 100, 3), dtype=np.uint8))
    out, filled = pa.recolour_backdrop(black, [(0, 0)], np.random.default_rng(0), colour=(255, 0, 0))
    assert not filled and np.asarray(out).max() == 0
    orange = Image.fromarray(np.full((100, 100, 3), ORANGE, dtype=np.uint8))   # all backdrop: fill reaches the centre
    out, filled = pa.recolour_backdrop(orange, [(0, 0)], np.random.default_rng(0), colour=(255, 0, 0))
    assert not filled and tuple(np.asarray(out)[50, 50]) == ORANGE


def test_loose_crop_pads_only_the_outer_sides():
    img = _corner(100, 100)
    rng = np.random.default_rng(1)
    out = pa.loose_crop(img, ["top", "left"], rng, fill=(1, 2, 3), max_frac=0.15)
    assert out.size[0] > 100 and out.size[1] > 100 and out.size[0] <= 115 and out.size[1] <= 115
    assert tuple(np.asarray(out)[0, 0]) == (1, 2, 3)
    assert tuple(np.asarray(out)[-1, -1]) == (200, 190, 60)        # bottom-right (card) untouched


def test_soften_and_resolution_loss_keep_size_and_change_pixels():
    img = _corner(120, 120)
    a = np.asarray(img).astype(int)
    s = pa.soften(img, np.random.default_rng(2), input_size=(60, 60))
    r = pa.resolution_loss(img, np.random.default_rng(3))
    assert s.size == img.size and r.size == img.size
    assert np.abs(np.asarray(s).astype(int) - a).mean() > 0.5
    assert np.abs(np.asarray(r).astype(int) - a).mean() > 0.5


def test_apply_phone_is_reproducible_and_phone_sim_is_deterministic():
    img = _corner()
    a = pa.apply_phone(img, "corner_FTL", np.random.default_rng(7), (100, 100))
    b = pa.apply_phone(img, "corner_FTL", np.random.default_rng(7), (100, 100))
    c = pa.apply_phone(img, "corner_FTL", np.random.default_rng(8), (100, 100))
    assert np.array_equal(np.asarray(a), np.asarray(b))
    assert not np.array_equal(np.asarray(a), np.asarray(c)) or a.size != c.size
    s1 = pa.phone_sim(img, "corner_FTL", (100, 100)); s2 = pa.phone_sim(img, "corner_FTL", (100, 100))
    assert np.array_equal(np.asarray(s1), np.asarray(s2)) and s1.size == img.size
    assert tuple(np.asarray(s1)[0, 0]) == (0, 0, 0)               # backdrop painted black
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_phone_aug.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'trainlib.phone_aug'`

- [ ] **Step 3: Implement**

`training/trainlib/phone_aug.py`:

```python
"""Phone-photo augmentation for the corner/edge crop models (handoff Step 9).

Every TAG crop shows TAG's orange backdrop beyond the card; the shipped models learned it as
part of "a corner". These transforms recolour that backdrop, loosen the crop, soften the image
and lose resolution the way a phone upload does. The flood fill mirrors the app's
`repaintBackdrop` (src/lib/tag-crops.js) so training and inference agree.
"""
from __future__ import annotations

import colorsys
import io
import re

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

TAG_ORANGE = (247, 126, 44)
PALETTE = [(0, 0, 0), (255, 255, 255), (64, 64, 64), (128, 128, 128), (192, 192, 192),
           (120, 80, 40), (160, 110, 60), (90, 60, 30)]
_SLOT = re.compile(r"^(corner|edge)_[FB]([A-Z]{1,2})$")


def _slot(stem: str) -> tuple[str, str]:
    m = _SLOT.match(stem)
    if not m:
        raise ValueError(f"not a corner/edge crop stem: {stem!r}")
    return m.group(1), m.group(2)


def seeds_for(stem: str, W: int, H: int) -> list[tuple[int, int]]:
    kind, key = _slot(stem)
    tl, tr, bl, br = (0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)
    if kind == "corner":
        return [{"TL": tl, "TR": tr, "BL": bl, "BR": br}[key]]
    return {"T": [tl, tr], "B": [bl, br], "L": [bl, br], "R": [tl, tr]}[key]


def outer_sides_for(stem: str) -> list[str]:
    kind, key = _slot(stem)
    if kind == "corner":
        return [{"T": "top", "B": "bottom"}[key[0]], {"L": "left", "R": "right"}[key[1]]]
    return [{"T": "top", "B": "bottom", "L": "bottom", "R": "top"}[key]]


def random_fill_colour(rng: np.random.Generator) -> tuple[int, int, int]:
    i = int(rng.integers(0, len(PALETTE) + 1))
    if i < len(PALETTE):
        return PALETTE[i]
    h, s, v = float(rng.random()), float(rng.uniform(0.2, 1.0)), float(rng.uniform(0.3, 1.0))
    return tuple(int(round(c * 255)) for c in colorsys.hsv_to_rgb(h, s, v))


def recolour_backdrop(img: Image.Image, seeds, rng, colour=None, tolerance=60, grow=2, max_fill=0.3,
                      skip_tolerance=110, orange=TAG_ORANGE):
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    H, W = a.shape[:2]
    fill = np.zeros((H, W), dtype=bool)
    for x, y in seeds:
        seed = a[y, x]
        if int(np.abs(seed - np.array(orange)).sum()) > skip_tolerance:
            continue
        mask = np.abs(a - seed).sum(axis=2) <= tolerance
        lab, _ = ndi.label(mask)
        comp = lab == lab[y, x]
        if comp[H // 2, W // 2] or comp.sum() > max_fill * W * H:
            continue
        fill |= comp
    if not fill.any():
        return img, False
    if grow > 0:
        fill = ndi.binary_dilation(fill, iterations=grow)
    if colour is None:
        colour = random_fill_colour(rng)
    out = a.astype(np.uint8).copy()
    out[fill] = colour
    return Image.fromarray(out), True


def loose_crop(img: Image.Image, outer_sides, rng, fill, max_frac=0.15):
    W, H = img.size
    pl = int(round(W * rng.uniform(0, max_frac))) if "left" in outer_sides else 0
    pr = int(round(W * rng.uniform(0, max_frac))) if "right" in outer_sides else 0
    pt = int(round(H * rng.uniform(0, max_frac))) if "top" in outer_sides else 0
    pb = int(round(H * rng.uniform(0, max_frac))) if "bottom" in outer_sides else 0
    if not (pl or pr or pt or pb):
        return img
    canvas = Image.new("RGB", (W + pl + pr, H + pt + pb), tuple(int(c) for c in fill))
    canvas.paste(img, (pl, pt))
    return canvas


def _jpeg(img: Image.Image, quality: int) -> Image.Image:
    buf = io.BytesIO(); img.save(buf, format="JPEG", quality=quality); buf.seek(0)
    with Image.open(buf) as im:
        return im.convert("RGB")


def soften(img: Image.Image, rng, input_size, radius_in=None, quality=None):
    r_in = float(rng.uniform(0.5, 1.5)) if radius_in is None else radius_in
    r = r_in * (img.width / input_size[0])
    out = img.filter(ImageFilter.GaussianBlur(r))
    q = int(rng.integers(60, 91)) if quality is None else quality
    return _jpeg(out, q) if q is not None else out


def resolution_loss(img: Image.Image, rng, scale=None):
    s = float(rng.uniform(0.35, 0.6)) if scale is None else scale
    W, H = img.size
    small = img.resize((max(1, int(W * s)), max(1, int(H * s))), Image.Resampling.BILINEAR)
    return small.resize((W, H), Image.Resampling.BILINEAR)


def apply_phone(img: Image.Image, stem: str, rng, input_size) -> Image.Image:
    W, H = img.size
    seeds = seeds_for(stem, W, H)
    fill_colour = tuple(int(c) for c in np.asarray(img)[seeds[0][1], seeds[0][0]])
    if rng.random() < 0.6:
        img, filled = recolour_backdrop(img, seeds, rng)
        if filled:
            fill_colour = tuple(int(c) for c in np.asarray(img)[seeds[0][1], seeds[0][0]])
    if rng.random() < 0.3:
        img = loose_crop(img, outer_sides_for(stem), rng, fill_colour)
    if rng.random() < 0.5:
        img = soften(img, rng, input_size)
    if rng.random() < 0.3:
        img = resolution_loss(img, rng)
    return img


def phone_sim(img: Image.Image, stem: str, input_size) -> Image.Image:
    W, H = img.size
    img, _ = recolour_backdrop(img, seeds_for(stem, W, H), None, colour=(0, 0, 0))
    img = img.filter(ImageFilter.GaussianBlur(1.0 * (img.width / input_size[0])))
    return resolution_loss(img, None, scale=0.5)
```

`pyproject.toml`: add `"scipy>=1.12"` to `dependencies`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_phone_aug.py`
Expected: 6 passed. If the synthetic corner in `_corner` does not produce the expected geometry (the notch), fix the fixture, not the module, and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/phone_aug.py training/tests/test_phone_aug.py training/pyproject.toml
git commit -m "feat(training): phone-photo augmentation (backdrop recolour, loose crop, softness, resolution loss)"
```

---

### Task 2: Wire `phone` and `phone_sim` into the loader and the evaluator

**Files:**
- Modify: `training/trainlib/data.py`, `training/trainlib/evaluate.py`
- Test: `training/tests/test_data.py`, `training/tests/test_evaluate.py` (append)

**Interfaces:** `data.AUG_MODES = ("light", "strong", "phone")`; `load_crop(..., aug="phone")` and `load_crop(..., phone_sim=True)`; `CropDataset(..., phone_sim=False)`; `evaluate.per_grade_table(..., phone_sim=False)`; CLI `--phone-sim` → `eval_<split>_phonesim.csv` and `.log` naming is the caller's (`tee`).

- [ ] **Step 1: Write the failing tests**

Append to `training/tests/test_data.py` (use the file's existing fixtures `tables`, `make_cache`, and import aliases):

```python
def test_phone_aug_mode_changes_the_backdrop_and_keeps_shape(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 96, 96)
    # paint a TAG-orange backdrop on the outer corner of the first crop so the flood fill has a seed
    p = cache / df.crop_path.iloc[0]
    with Image.open(p) as im:
        arr = np.asarray(im.convert("RGB")).copy()
    arr[:30, :30] = (247, 126, 44); Image.fromarray(arr).save(p, format="PNG")
    ev = data.load_crop(p, "corners", False)
    ph = data.load_crop(p, "corners", True, np.random.default_rng(0), aug="phone")
    assert ph.shape == ev.shape and torch.isfinite(ph).all()
    sim = data.load_crop(p, "corners", False, phone_sim=True)
    assert sim.shape == ev.shape and not torch.equal(sim, ev)
    sim2 = data.load_crop(p, "corners", False, phone_sim=True)
    assert torch.equal(sim, sim2)


def test_phone_sim_is_passed_through_the_dataset(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "val")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    plain = data.CropDataset(df, "edges", cache, train=False)[0][0]
    sim = data.CropDataset(df, "edges", cache, train=False, phone_sim=True)[0][0]
    assert sim.shape == plain.shape
```

Append to `training/tests/test_evaluate.py` (mirror its existing CLI test): run `evaluate.main([...same args as the existing test..., "--phone-sim"])` on a tiny checkpoint and assert `eval_val_phonesim.csv` is written next to the checkpoint with the same columns as `eval_val.csv`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_data.py tests/test_evaluate.py`
Expected: FAIL with `ValueError: aug must be one of ('light', 'strong')` / `TypeError ... phone_sim`

- [ ] **Step 3: Implement**

`data.py`: `AUG_MODES = ("light", "strong", "phone")`; `load_crop(..., aug="light", phone_sim=False)`; after the rotation block:

```python
    if phone_sim:
        img = phone_sim_fn(img, path.stem, (w, h))
    elif train and aug == "phone":
        img = apply_phone(img, path.stem, rng, (w, h))
    elif train and aug == "strong":
        ...  # existing window crop
```

and in the photometric block treat `phone` like `light` (`lo, hi = (0.8, 1.2) if aug == "strong" else (0.9, 1.1)` already does; the `Color` jitter stays strong-only). Import `from .phone_aug import apply_phone, phone_sim as phone_sim_fn`. Update the docstring (blur is now deliberate in `phone`). `CropDataset.__init__(..., phone_sim=False)` stores it and passes `phone_sim=self.phone_sim` to `load_crop` in the non-jitter path (the centering jitter path ignores it).

`evaluate.py`: `make_loader`'s dataset construction needs `phone_sim`; since `make_loader` lives in `train.py`, add a `phone_sim=False` keyword there that is passed to `CropDataset`, and in `evaluate.per_grade_table(..., phone_sim=False)` pass it through. CLI: `p.add_argument("--phone-sim", action="store_true", help="deterministic phone-photo simulation (black backdrop, 1 px blur, 0.5x resolution) on the eval crops")`; output name `eval_{split}_phonesim.csv` when set; print a line `phone-sim: ON` at the top.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q`
Expected: all pass (131 + 6 + 3).

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/data.py training/trainlib/train.py training/trainlib/evaluate.py training/tests/test_data.py training/tests/test_evaluate.py
git commit -m "feat(training): phone aug mode in the loader; --phone-sim evaluation"
```

---

### Task 3: Local phone-sim baseline, handoff Step 9 revision, README

**Files:**
- Modify: `training/HANDOFF-rented-gpu.md` (Step 9), `training/README.md`

Run-and-record on the local PC (RTX 4070; the corner smoke cache at `scripts/tag-dataset/data/cache/` holds 500 train + 100 val cards of corners full-res, and the edge resized cache holds 500/100). The shipped checkpoints are at `training/weights/corners/v2/best.pt` and `training/weights/edges/v1/best.pt`.

- [ ] **Step 1: Phone-sim baseline on the shipped models**, detached (memory guard), `--limit-cards 100 --workers 0 --batch-size 8`:
  `evaluate --task corners --checkpoint weights/corners/v2/best.pt --split val --limit-cards 100 --workers 0 --batch-size 8` and the same with `--phone-sim`; likewise edges v1. Record the `ALL` rows for clean vs phone-sim (auroc_wear, precision, recall, mae_deduction). Expect phone-sim to be much worse; that is the number Step 9 must beat.
- [ ] **Step 2: Visual check**: write 8 augmented corner crops and 4 edge crops (`aug="phone"`, seeds 0..7) as JPEGs under `runs/phone_aug_samples/` (gitignored) and look at them: the backdrop must be recoloured only outside the card, the loose crop must pad the outer sides only, and the card content must stay recognisable. Record what you saw; if a fill leaks into the card on any sample, stop and report.
- [ ] **Step 3: Revise handoff Step 9**: (a) Step 9.1/9.2 are DONE in code (name the modules and flags; delete the implementation instructions); (b) the `phone` mode has no random window (state why); (c) tests path; (d) disk: the 2048×384 edge cache (~130 GB) fits now that the rejected surface caches are gone (219 GB free); (e) `runs/edges/v2` exists (rejected regularized run) → the phone run is `--run-name v2-phone`, and corners `--run-name v3-phone`; (f) add the local phone-sim baseline numbers from Step 1 as the reference row; (g) chain the two runs in one nohup so the GPU does not idle between them; (h) keep the acceptance rule as written (clean within 0.01 AUROC / 5% MAE of shipped; phone-sim +0.03 AUROC and higher recall).
- [ ] **Step 4: README**: a short "Phone-photo augmentation" section under "Edges v2: what to fix": what the four transforms do, the no-window ruling, the seed table pointer, the local phone-sim baseline table.
- [ ] **Step 5: Commit** `training/HANDOFF-rented-gpu.md`, `training/README.md`: `docs(training): phone-sim baseline; handoff Step 9 revised for the implemented aug`.

---

## Self-review

**Spec coverage.** Step 9.1 (four transforms, seeds, app-matching fill): Task 1. Step 9.2 (`--phone-sim`): Task 2. Step 9.3–9.7 (runs, acceptance, export): remain the operator's, with the doc revised in Task 3. The double-resolution edge task (Step 9.4) is left to the operator as written; it needs only a `TASKS` entry and is optional.

**Placeholder scan.** Task 2's evaluate test and Task 3 are described against existing patterns; all other steps carry code.

**Type consistency.** `apply_phone(img, stem, rng, input_size)` and `phone_sim(img, stem, input_size)` are called from `load_crop` with `path.stem` and `(w, h)`; `recolour_backdrop` returns `(img, bool)` everywhere; `loose_crop` takes the side names produced by `outer_sides_for`.
