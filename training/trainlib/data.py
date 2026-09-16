"""Crop datasets with NaN-masked targets (spec §7, §11)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image, ImageEnhance
from torch.utils.data import Dataset, get_worker_info

from .tables import TASKS

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
SCALE = 1000.0


def load_crop(
    path: Path,
    task: str,
    train: bool,
    rng: np.random.Generator | None = None,
    input_size: tuple[int, int] | None = None,
) -> torch.Tensor:
    spec = TASKS[task]
    w, h = input_size if input_size is not None else spec["input_size"]
    with Image.open(path) as im:
        img = im.convert("RGB")
    if spec["long_side_horizontal"] and img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    img = img.resize((w, h), Image.Resampling.BILINEAR)
    if train:
        rng = rng or np.random.default_rng()
        img = ImageEnhance.Brightness(img).enhance(float(rng.uniform(0.9, 1.1)))
        img = ImageEnhance.Contrast(img).enhance(float(rng.uniform(0.9, 1.1)))
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
    ):
        self.df = df.reset_index(drop=True)
        self.task = task
        self.cache_dir = Path(cache_dir)
        self.train = train
        self.input_size = input_size
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

    def __getitem__(self, i: int):
        row = self.df.iloc[i]
        img = load_crop(self.cache_dir / row.crop_path, self.task, self.train, self._generator(), self.input_size)
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
