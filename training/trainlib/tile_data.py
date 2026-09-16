"""Detection dataset over the tile index written by surface_cache_cli."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image, ImageEnhance
from torch.utils.data import Dataset, get_worker_info


class TileDataset(Dataset):
    def __init__(self, index: pd.DataFrame, cache_dir: Path, train: bool):
        self.index = index.reset_index(drop=True)
        self.cache_dir = Path(cache_dir)
        self.train = train
        self.rng = None

    def _generator(self) -> np.random.Generator:
        if self.rng is None:
            info = get_worker_info()
            seed = info.seed if info is not None else torch.initial_seed()
            self.rng = np.random.default_rng(seed % (2**32))
        return self.rng

    def __len__(self) -> int:
        return len(self.index)

    def __getitem__(self, i: int):
        row = self.index.iloc[i]
        with Image.open(self.cache_dir / row.tile_path) as im:
            img = im.convert("RGB")
        boxes = json.loads(row.boxes)
        labels = torch.tensor([int(b[0]) for b in boxes], dtype=torch.int64)
        xyxy = torch.tensor([b[1:] for b in boxes], dtype=torch.float32).reshape(-1, 4)
        w, h = img.size
        if self.train:
            rng = self._generator()
            if rng.random() < 0.5:
                img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                xyxy = torch.stack([w - xyxy[:, 2], xyxy[:, 1], w - xyxy[:, 0], xyxy[:, 3]], dim=1) if len(xyxy) else xyxy
            if rng.random() < 0.5:
                img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                xyxy = torch.stack([xyxy[:, 0], h - xyxy[:, 3], xyxy[:, 2], h - xyxy[:, 1]], dim=1) if len(xyxy) else xyxy
            img = ImageEnhance.Brightness(img).enhance(float(rng.uniform(0.9, 1.1)))
            img = ImageEnhance.Contrast(img).enhance(float(rng.uniform(0.9, 1.1)))
        t = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
        return t, {"boxes": xyxy, "labels": labels}


def collate_det(batch):
    imgs, tgts = zip(*batch)
    return list(imgs), list(tgts)
