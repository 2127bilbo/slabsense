"""Crop datasets with NaN-masked targets (spec §7, §11)."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image, ImageEnhance
from torch.utils.data import Dataset

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
    img = Image.open(path).convert("RGB")
    if spec["long_side_horizontal"] and img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    if train:
        rng = rng or np.random.default_rng()
        img = ImageEnhance.Brightness(img).enhance(float(rng.uniform(0.9, 1.1)))
        img = ImageEnhance.Contrast(img).enhance(float(rng.uniform(0.9, 1.1)))
        if spec["long_side_horizontal"] and rng.random() < 0.5:
            img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    img = img.resize((w, h), Image.Resampling.BILINEAR)
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
        self.rng = np.random.default_rng()

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, i: int):
        row = self.df.iloc[i]
        img = load_crop(self.cache_dir / row.crop_path, self.task, self.train, self.rng, self.input_size)
        side = torch.tensor([1.0 if row.side == "B" else 0.0])
        vals = [float(row[c]) for c in self.targets]
        mask = torch.tensor([0.0 if math.isnan(v) else 1.0 for v in vals])
        target = torch.tensor([0.0 if math.isnan(v) else v / SCALE for v in vals])
        return img, side, target, mask


def collate(batch):
    imgs, sides, targets, masks = zip(*batch)
    return torch.stack(imgs), torch.stack(sides), torch.stack(targets), torch.stack(masks)
