"""Crop datasets with NaN-masked targets (spec §7, §11)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image, ImageEnhance
from torch.utils.data import Dataset, get_worker_info

from .cache import resized_path
from .phone_aug import (apply_phone, phone_sim as phone_sim_fn, phone_sim_soft, resolution_loss as phone_resolution_loss,
                        soften as phone_soften)
from .tables import TASKS

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
SCALE = 1000.0
AUG_MODES = ("light", "strong", "phone")


def load_crop(
    path: Path,
    task: str,
    train: bool,
    rng: np.random.Generator | None = None,
    input_size: tuple[int, int] | None = None,
    aug: str = "light",
    phone_sim: bool = False,
) -> torch.Tensor:
    """Decode, orient, resize and normalize one crop.

    Training augmentation modes: `light` (v1: +-10% brightness/contrast, edge flips),
    `strong` (v2: a random 88-100% window before the resize, +-20% brightness/contrast,
    +-20% saturation, edge flips) and `phone` (v3: recolours the TAG backdrop, loosens the
    crop, softens and downsamples the way a phone upload does, then +-10% brightness/contrast
    and edge flips like `light`; no random window). No rotation: a corner's angle target must
    survive the transform. Blur/resolution loss is deliberate under `phone` and `phone_sim`
    (a phone photo is never as sharp as a scanner capture) but never happens otherwise, since
    it would erase the hairline marks we are trying to find.

    `phone_sim` is a deterministic phone-photo simulation (black backdrop, 1 px blur, 0.5x
    resolution) used for eval only; it is mutually exclusive with `train=True`.
    """
    if aug not in AUG_MODES:
        raise ValueError(f"aug must be one of {AUG_MODES}, got {aug!r}")
    if phone_sim and train:
        raise ValueError("phone_sim is for eval only; pass train=False")
    spec = TASKS[task]
    w, h = input_size if input_size is not None else spec["input_size"]
    stem = Path(path).stem
    with Image.open(path) as im:
        img = im.convert("RGB")
    if spec["long_side_horizontal"] and img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    if train:
        rng = rng or np.random.default_rng()
    if phone_sim:
        img = phone_sim_fn(img, stem, (w, h))
    elif train and aug == "phone":
        img = apply_phone(img, stem, rng, (w, h))
    elif train and aug == "strong":
        s = float(rng.uniform(0.88, 1.0))
        cw, ch = max(1, int(round(img.width * s))), max(1, int(round(img.height * s)))
        x0 = int(rng.integers(0, img.width - cw + 1))
        y0 = int(rng.integers(0, img.height - ch + 1))
        img = img.crop((x0, y0, x0 + cw, y0 + ch))
    img = img.resize((w, h), Image.Resampling.BILINEAR)
    if train:
        lo, hi = (0.8, 1.2) if aug == "strong" else (0.9, 1.1)
        img = ImageEnhance.Brightness(img).enhance(float(rng.uniform(lo, hi)))
        img = ImageEnhance.Contrast(img).enhance(float(rng.uniform(lo, hi)))
        if aug == "strong":
            img = ImageEnhance.Color(img).enhance(float(rng.uniform(0.8, 1.2)))
        if spec["long_side_horizontal"] and rng.random() < 0.5:
            img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    t = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
    return (t - MEAN) / STD


def jitter_edges(img: Image.Image, targets_pm: list[float], rng: np.random.Generator, j: float):
    """Shift each crop edge by up to ±j of the image size (negative cuts into the card, positive pads
    with a random flat color), resize back, and move the per-mille border targets to match."""
    if j <= 0:
        return img, list(targets_pm)
    W, H = img.size
    dl, dr, dt, db = (float(rng.uniform(-j, j)) for _ in range(4))
    pl, pr, pt, pb = dl * W, dr * W, dt * H, db * H
    box = (int(round(-pl)), int(round(-pt)), int(round(W + pr)), int(round(H + pb)))
    fill = tuple(int(v) for v in rng.integers(0, 256, size=3))
    canvas = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), fill)
    canvas.paste(img, (-box[0], -box[1]))
    out = canvas.resize((W, H), Image.Resampling.BILINEAR)
    nW, nH = box[2] - box[0], box[3] - box[1]
    l, r, t, b = targets_pm
    new = [(l / 1000 * W - box[0]) / nW * 1000, (r / 1000 * W + (box[2] - W)) / nW * 1000,
           (t / 1000 * H - box[1]) / nH * 1000, (b / 1000 * H + (box[3] - H)) / nH * 1000]
    return out, [min(max(v, 0.0), 1000.0) for v in new]


class CropDataset(Dataset):
    def __init__(
        self,
        df: pd.DataFrame,
        task: str,
        cache_dir: Path,
        train: bool,
        input_size: tuple[int, int] | None = None,
        full_res: bool = False,
        aug: str = "light",
        phone_sim: bool = False,
    ):
        if aug not in AUG_MODES:
            raise ValueError(f"aug must be one of {AUG_MODES}, got {aug!r}")
        spec = TASKS[task]
        if phone_sim and train and spec.get("edge_jitter", 0) > 0:
            raise ValueError("phone_sim cannot be combined with the centering edge-jitter augmentation")
        self.aug = aug
        self.phone_sim = phone_sim
        self.df = df.reset_index(drop=True)
        self.task = task
        self.cache_dir = Path(cache_dir)
        self.train = train
        self.input_size = input_size
        self.full_res = full_res
        self.targets = spec["targets"]
        self.rng = None

    def _generator(self) -> np.random.Generator:
        if self.rng is None:
            info = get_worker_info()
            seed = info.seed if info is not None else torch.initial_seed()
            self.rng = np.random.default_rng(seed % (2**32))
        return self.rng

    def __len__(self) -> int:
        return len(self.df)

    def _resolve_path(self, crop_path: str) -> Path:
        spec = TASKS[self.task]
        resize = spec["cache_resize"]
        full_path = self.cache_dir / crop_path
        if not resize or self.full_res:
            return full_path
        rpath = resized_path(self.cache_dir, crop_path, resize, spec.get("cache_variant"))
        if rpath.exists():
            return rpath
        if full_path.exists():
            return full_path
        raise FileNotFoundError(
            f"no cached crop for {crop_path!r}: checked resized ({rpath}) and full-res ({full_path})"
        )

    def _target_and_mask(self, row) -> tuple[torch.Tensor, torch.Tensor]:
        vals, masks = [], []
        for _name, kind, column in self.targets:
            raw = row[column]
            missing = pd.isna(raw)
            if kind == "binary":
                vals.append(1.0 if (not missing and float(raw) > 0) else 0.0)
            else:
                vals.append(0.0 if missing else min(max(float(raw) / SCALE, 0.0), 1.0))
            masks.append(0.0 if missing else 1.0)
        return torch.tensor(vals), torch.tensor(masks)

    def __getitem__(self, i: int):
        row = self.df.iloc[i]
        spec = TASKS[self.task]
        path = self._resolve_path(row.crop_path)
        side = torch.tensor([1.0 if row.side == "B" else 0.0])
        is_jitter_task = spec.get("edge_jitter", 0) > 0
        w, h = self.input_size if self.input_size is not None else spec["input_size"]
        if self.train and is_jitter_task:
            rng = self._generator()
            with Image.open(path) as im:
                img = im.convert("RGB")
            img = img.resize((w, h), Image.Resampling.BILINEAR)
            targets_pm = [float(row[column]) for _name, _kind, column in self.targets]
            img, targets_pm = jitter_edges(img, targets_pm, rng, spec["edge_jitter"])
            if self.aug == "phone":
                if rng.random() < 0.5:
                    img = phone_soften(img, rng, (w, h))
                if rng.random() < 0.3:
                    img = phone_resolution_loss(img, rng)
            img = ImageEnhance.Brightness(img).enhance(float(rng.uniform(0.9, 1.1)))
            img = ImageEnhance.Contrast(img).enhance(float(rng.uniform(0.9, 1.1)))
            t = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
            img_t = (t - MEAN) / STD
            target = torch.tensor([v / SCALE for v in targets_pm])
            mask = torch.tensor([1.0] * len(targets_pm))
            return img_t, side, target, mask
        if is_jitter_task and self.phone_sim:
            # No crop stem to seed a corner/edge-style backdrop flood fill from for a whole-card
            # centering image, so eval phone-sim uses the stem-free `phone_sim_soft` (blur +
            # downsample only) instead of routing through `load_crop`'s `phone_sim_fn`.
            with Image.open(path) as im:
                img = im.convert("RGB")
            img = img.resize((w, h), Image.Resampling.BILINEAR)
            img = phone_sim_soft(img, (w, h))
            t = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
            img_t = (t - MEAN) / STD
            target, mask = self._target_and_mask(row)
            return img_t, side, target, mask
        img = load_crop(path, self.task, self.train, self._generator(), self.input_size, aug=self.aug,
                        phone_sim=self.phone_sim)
        target, mask = self._target_and_mask(row)
        return img, side, target, mask


def collate(batch):
    imgs, sides, targets, masks = zip(*batch)
    return torch.stack(imgs), torch.stack(sides), torch.stack(targets), torch.stack(masks)
