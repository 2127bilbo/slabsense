"""Crop datasets with NaN-masked targets (spec §7, §11)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image, ImageEnhance
from torch.utils.data import Dataset, get_worker_info

from .cache import resized_path
from .tables import TASKS

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
SCALE = 1000.0
AUG_MODES = ("light", "strong")


def load_crop(
    path: Path,
    task: str,
    train: bool,
    rng: np.random.Generator | None = None,
    input_size: tuple[int, int] | None = None,
    aug: str = "light",
) -> torch.Tensor:
    """Decode, orient, resize and normalize one crop.

    Training augmentation modes: `light` (v1: +-10% brightness/contrast, edge flips) and
    `strong` (v2: a random 88-100% window before the resize, +-20% brightness/contrast,
    +-20% saturation, edge flips). No rotation or blur: a corner's angle target must
    survive the transform, and blur would erase the hairline marks we are trying to find.
    """
    if aug not in AUG_MODES:
        raise ValueError(f"aug must be one of {AUG_MODES}, got {aug!r}")
    spec = TASKS[task]
    w, h = input_size if input_size is not None else spec["input_size"]
    with Image.open(path) as im:
        img = im.convert("RGB")
    if spec["long_side_horizontal"] and img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    if train:
        rng = rng or np.random.default_rng()
    if train and aug == "strong":
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
    ):
        if aug not in AUG_MODES:
            raise ValueError(f"aug must be one of {AUG_MODES}, got {aug!r}")
        self.aug = aug
        self.df = df.reset_index(drop=True)
        self.task = task
        self.cache_dir = Path(cache_dir)
        self.train = train
        self.input_size = input_size
        self.full_res = full_res
        self.targets = TASKS[task]["targets"]
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

    def __getitem__(self, i: int):
        row = self.df.iloc[i]
        img = load_crop(self._resolve_path(row.crop_path), self.task, self.train, self._generator(), self.input_size,
                        aug=self.aug)
        side = torch.tensor([1.0 if row.side == "B" else 0.0])
        vals, masks = [], []
        for _name, kind, column in self.targets:
            raw = row[column]
            missing = pd.isna(raw)
            if kind == "binary":
                vals.append(1.0 if (not missing and float(raw) > 0) else 0.0)
            else:
                vals.append(0.0 if missing else min(max(float(raw) / SCALE, 0.0), 1.0))
            masks.append(0.0 if missing else 1.0)
        target = torch.tensor(vals)
        mask = torch.tensor(masks)
        return img, side, target, mask


def collate(batch):
    imgs, sides, targets, masks = zip(*batch)
    return torch.stack(imgs), torch.stack(sides), torch.stack(targets), torch.stack(masks)
