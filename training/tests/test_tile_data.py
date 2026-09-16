import numpy as np
import torch

from conftest import make_tile_index
from trainlib import tile_data


def test_eval_item_shapes_and_targets(tmp_path):
    cache, idx = make_tile_index(tmp_path)
    ds = tile_data.TileDataset(idx, cache, train=False)
    img, tgt = ds[0]
    assert img.shape == (3, 128, 128) and img.dtype == torch.float32 and 0.0 <= img.min() and img.max() <= 1.0
    assert tgt["boxes"].shape == (1, 4) and tgt["labels"].tolist() == [1]
    assert tgt["boxes"][0].tolist() == [10.0, 20.0, 50.0, 50.0]
    img3, tgt3 = ds[3]
    assert tgt3["boxes"].shape == (0, 4) and tgt3["labels"].shape == (0,)


def test_train_flips_move_boxes_consistently(tmp_path):
    cache, idx = make_tile_index(tmp_path)
    ds = tile_data.TileDataset(idx, cache, train=True)
    ds.rng = np.random.default_rng(0)
    seen = set()
    for _ in range(20):
        img, tgt = ds[0]
        x1, y1, x2, y2 = tgt["boxes"][0].tolist()
        # the dark rectangle must sit exactly inside the box after any flip
        patch = img[:, int(y1):int(y2), int(x1):int(x2)]
        assert patch.mean() < 0.3 and (x2 - x1, y2 - y1) == (40.0, 30.0)
        seen.add((x1, y1))
    assert len(seen) > 1


def test_collate_returns_lists():
    imgs, tgts = tile_data.collate_det([(torch.zeros(3, 8, 8), {"boxes": torch.zeros(0, 4), "labels": torch.zeros(0, dtype=torch.int64)})] * 2)
    assert isinstance(imgs, list) and len(imgs) == 2 and isinstance(tgts, list)
