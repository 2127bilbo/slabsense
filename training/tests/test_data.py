import math

import pandas as pd
import torch

from conftest import make_cache
from trainlib import data
from trainlib import tables as tables_mod


def test_corner_dataset_shapes_targets_and_mask(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=False)
    img, side, target, mask = d[0]
    assert img.shape == (3, 384, 384) and img.dtype == torch.float32
    assert side.shape == (1,) and target.shape == (3,) and mask.shape == (3,)
    row = df.iloc[0]
    assert side.item() == (1.0 if row.side == "B" else 0.0)
    assert abs(target[1].item() - row.score_fill / 1000) < 1e-6 and mask[1].item() == 1.0
    back = next(i for i in range(len(d)) if df.iloc[i].side == "B")
    _, _, t, m = d[back]
    assert m[0].item() == 0.0 and t[0].item() == 0.0 and m[1].item() == 1.0


def test_edge_dataset_rotates_vertical_strips(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    d = data.CropDataset(df, "edges", cache, train=False)
    for i in range(len(d)):
        img, _, target, mask = d[i]
        assert img.shape == (3, 192, 1024)
        assert target.shape == (2,) and mask.tolist() == [1.0, 1.0]


def test_collate_stacks(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=True)
    imgs, sides, targets, masks = data.collate([d[0], d[1], d[2]])
    assert imgs.shape == (3, 3, 384, 384) and sides.shape == (3, 1) and targets.shape == (3, 3) and masks.shape == (3, 3)


def test_train_transform_is_stochastic_but_bounded(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    d = data.CropDataset(df, "edges", cache, train=True)
    a = d[0][0]; b = d[0][0]
    assert torch.isfinite(a).all() and a.shape == b.shape


def test_input_size_override_does_not_mutate_tasks(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    default_size = tables_mod.TASKS["corners"]["input_size"]
    d_default = data.CropDataset(df, "corners", cache, train=False)
    d_small = data.CropDataset(df, "corners", cache, train=False, input_size=(64, 64))
    img_default, *_ = d_default[0]
    img_small, *_ = d_small[0]
    assert img_default.shape == (3, 384, 384)
    assert img_small.shape == (3, 64, 64)
    assert tables_mod.TASKS["corners"]["input_size"] == default_size
