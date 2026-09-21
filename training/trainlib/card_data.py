"""Datasets for the card segmentation model (plan 2026-09-21-card-model).

`SyntheticCards` is an `IterableDataset` that composes synthetic training samples on the fly
(cutout + background + optional distractors, via `card_compose.compose`); `SyntheticVal` is a
deterministic map-style counterpart for validation; `RealCardVal` reads the app's own
`<scanId>/{front,back}.jpg` + `labels.json` folders for a real-photo validation set.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import torch
from PIL import Image, ImageOps
from torch.utils.data import Dataset, IterableDataset, get_worker_info

from .card_backgrounds import RealPool, sample_background
from .card_compose import apply_letterbox_points, compose, letterbox
from .card_metrics import canonical_quad
from .data import MEAN, STD

OUTER_RING_PX = 8


def list_cutouts(cache_dir: Path, splits_path: Path, split: str) -> list[Path]:
    """All `<cache_dir>/cutouts/<cert>_<side>.png` whose cert is in `split`."""
    splits = pd.read_parquet(splits_path)[["cert", "split"]]
    certs = set(splits.loc[splits.split == split, "cert"])
    cutouts_dir = Path(cache_dir) / "cutouts"
    if not cutouts_dir.is_dir():
        return []
    paths = []
    for p in sorted(cutouts_dir.glob("*.png")):
        cert = p.stem.rsplit("_", 1)[0]
        if cert in certs:
            paths.append(p)
    return paths


def _to_tensors(sample: dict) -> tuple[torch.Tensor, torch.Tensor, dict]:
    image = torch.from_numpy(sample["image"]).permute(2, 0, 1).float() / 255.0
    image = (image - MEAN) / STD
    mask = torch.from_numpy((sample["mask"] > 127).astype(np.float32)).unsqueeze(0)
    return image, mask, sample["meta"]


def collate_cards(batch):
    """Stacks images/masks; keeps `meta` as a list (it holds per-sample numpy arrays/dicts that
    the default collate can't stack)."""
    images = torch.stack([b[0] for b in batch])
    masks = torch.stack([b[1] for b in batch])
    metas = [b[2] for b in batch]
    return images, masks, metas


class _LazyImageList:
    """Wraps a fixed list of paths; each is opened (RGBA) and cached only on first access, so a
    worker that never draws a given clutter image never pays to decode it."""

    def __init__(self, paths: list[Path]) -> None:
        self.paths = paths
        self._cache: dict[int, Image.Image] = {}

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, i: int) -> Image.Image:
        if i not in self._cache:
            with Image.open(self.paths[i]) as im:
                self._cache[i] = im.convert("RGBA")
        return self._cache[i]


class SyntheticCards(IterableDataset):
    """Composes `samples_per_epoch // num_workers` synthetic samples per worker per epoch."""

    def __init__(self, cutout_paths: list[Path], bg_pool: RealPool | None, samples_per_epoch: int,
                base_seed: int = 42, epoch: int = 0, canvas: int = 1024, out: int = 512,
                n_clutter: int = 200) -> None:
        self.cutout_paths = list(cutout_paths)
        self.bg_pool = bg_pool
        self.samples_per_epoch = samples_per_epoch
        self.base_seed = base_seed
        self.epoch = epoch
        self.canvas = canvas
        self.out = out
        self.n_clutter = n_clutter

    def set_epoch(self, e: int) -> None:
        self.epoch = e

    def __iter__(self):
        info = get_worker_info()
        wid = info.id if info else 0
        nw = info.num_workers if info else 1
        rng = np.random.default_rng(self.base_seed + self.epoch * 1000 + wid)

        n = len(self.cutout_paths)
        n_clutter = min(self.n_clutter, n)
        clutter_idx = rng.choice(n, size=n_clutter, replace=False) if n_clutter else np.array([], dtype=int)
        clutter = _LazyImageList([self.cutout_paths[i] for i in clutter_idx])

        count = self.samples_per_epoch // nw
        for _ in range(count):
            path = self.cutout_paths[int(rng.integers(0, n))]
            with Image.open(path) as im:
                cutout = im.convert("RGBA")
            bg = sample_background(rng, self.canvas, self.bg_pool, clutter if len(clutter) else None)
            k = int(rng.integers(1, 3))  # 1 or 2 distractor cutouts
            distractors = []
            for _ in range(k):
                with Image.open(self.cutout_paths[int(rng.integers(0, n))]) as im:
                    distractors.append(im.convert("RGBA"))
            sample = compose(rng, cutout, bg, distractor_cutouts=distractors, canvas=self.canvas, out=self.out)
            yield _to_tensors(sample)


class SyntheticVal(Dataset):
    """Deterministic synthetic validation set: sample `i` composed with `default_rng(seed + i)`."""

    def __init__(self, cutout_paths: list[Path], bg_pool: RealPool | None, n: int = 2000,
                seed: int = 12345, canvas: int = 1024, out: int = 512) -> None:
        self.cutout_paths = list(cutout_paths)
        self.bg_pool = bg_pool
        self.n = n
        self.seed = seed
        self.canvas = canvas
        self.out = out
        self._order = np.random.default_rng(seed).permutation(len(self.cutout_paths))

    def __len__(self) -> int:
        return self.n

    def __getitem__(self, i: int):
        rng = np.random.default_rng(self.seed + i)
        idx = int(self._order[i % len(self._order)])
        with Image.open(self.cutout_paths[idx]) as im:
            cutout = im.convert("RGBA")
        bg = sample_background(rng, self.canvas, self.bg_pool, None)
        sample = compose(rng, cutout, bg, canvas=self.canvas, out=self.out)
        return _to_tensors(sample)


def _outer_ring_mean(img: np.ndarray) -> tuple[int, int, int]:
    h, w = img.shape[:2]
    r = min(OUTER_RING_PX, h, w)
    mask = np.zeros((h, w), dtype=bool)
    mask[:r, :] = True
    mask[h - r:, :] = True
    mask[:, :r] = True
    mask[:, w - r:] = True
    mean = img[mask].reshape(-1, img.shape[2]).mean(axis=0)
    return tuple(int(round(v)) for v in mean)


class RealCardVal(Dataset):
    """Reads `folder/<scanId>/labels.json` + the sides' jpgs (the app's own scan schema)."""

    def __init__(self, folder: Path, out: int = 512) -> None:
        self.folder = Path(folder)
        self.out = out
        self.items: list[tuple[Path, dict]] = []
        self.skipped_rotation = 0
        if not self.folder.is_dir():
            return
        for scan_dir in sorted(p for p in self.folder.iterdir() if p.is_dir()):
            labels_path = scan_dir / "labels.json"
            if not labels_path.exists():
                continue
            data = json.loads(labels_path.read_text(encoding="utf-8"))
            for side_name, side_data in data.get("sides", {}).items():
                jpg_path = scan_dir / f"{side_name}.jpg"
                if not jpg_path.exists():
                    continue
                rotation = side_data.get("rotation")
                if rotation not in (0, None):
                    self.skipped_rotation += 1
                    continue
                self.items.append((jpg_path, side_data))

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, i: int):
        jpg_path, side_data = self.items[i]
        with Image.open(jpg_path) as raw:
            img = np.asarray(ImageOps.exif_transpose(raw).convert("RGB"))
        h, w = img.shape[:2]
        c = side_data["corners"]
        quad_src = np.array([
            [c["tl"]["x"] * w, c["tl"]["y"] * h],
            [c["tr"]["x"] * w, c["tr"]["y"] * h],
            [c["br"]["x"] * w, c["br"]["y"] * h],
            [c["bl"]["x"] * w, c["bl"]["y"] * h],
        ], dtype=np.float64)

        letterboxed, tf = letterbox(img, self.out, pad_colour=_outer_ring_mean(img))
        quad_out = apply_letterbox_points(quad_src, tf).astype(np.float32)
        # The app's tl/tr/br/bl labels are whatever the user's corner-picking UI assigned, not
        # necessarily the card's true visual top-left/etc for a rotated scan -- canonicalize by
        # geometry so this quad is TL-first for any downstream (display/storage) use. Note this is
        # NOT what makes `corner_error_pct` correct against an unrotated-label quad: that metric
        # matches corners by angle-order + a search over cyclic shifts, not by trusting either
        # side's start corner (`canonical_quad`'s own tie-break is exact, and therefore unstable,
        # at a 45-degree rotation -- see `card_metrics.corner_error_pct`), so it does not depend
        # on this call. This canonicalization is kept anyway because it's harmless and keeps the
        # returned `meta["quad"]` in the same human-facing convention as `mask_to_quad`'s output.
        quad_out = canonical_quad(quad_out).astype(np.float32)

        mask = np.zeros((self.out, self.out), dtype=np.uint8)
        cv2.fillPoly(mask, [np.round(quad_out).astype(np.int32)], 255)

        image = torch.from_numpy(letterboxed).permute(2, 0, 1).float() / 255.0
        image = (image - MEAN) / STD
        mask_t = torch.from_numpy((mask > 127).astype(np.float32)).unsqueeze(0)

        edge_lengths = [float(np.linalg.norm(quad_out[j] - quad_out[(j + 1) % 4])) for j in range(4)]
        meta = {"quad": quad_out, "letterbox": tf, "card_long_side": max(edge_lengths), "path": str(jpg_path)}
        return image, mask_t, meta
