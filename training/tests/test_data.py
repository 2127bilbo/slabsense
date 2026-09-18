import numpy as np
import pandas as pd
import pytest
import torch
from PIL import Image

from conftest import make_cache, make_boxes_table
from trainlib import cache as cache_mod
from trainlib import data
from trainlib import surface_tables as st
from trainlib import tables as tables_mod


def test_corner_dataset_shapes_and_first_row_targets(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=False)
    img, side, target, mask = d[0]
    assert img.shape == (3, 384, 384) and img.dtype == torch.float32
    assert side.shape == (1,) and target.shape == (3,) and mask.shape == (3,)
    row = df.iloc[0]
    assert side.item() == (1.0 if row.side == "B" else 0.0)
    # row 0: ding_count 0 -> wear 0.0 (not masked); marker_deduction 40.0 -> deduction 0.04;
    # side F -> score_angle 990.0 -> angle 0.99
    assert target[0].item() == 0.0 and mask[0].item() == 1.0
    assert abs(target[1].item() - 0.04) < 1e-6 and mask[1].item() == 1.0
    assert abs(target[2].item() - 0.99) < 1e-6 and mask[2].item() == 1.0


def test_corner_wear_target_is_one_when_ding_count_positive(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=False)
    # row 4: cert A1 side B corner TL, ding_count 1 -> wear 1.0; score_angle NaN -> angle masked
    _, _, target, mask = d[4]
    assert target[0].item() == 1.0 and mask[0].item() == 1.0
    assert target[2].item() == 0.0 and mask[2].item() == 0.0


def test_corner_wear_mask_is_zero_when_ding_count_is_nan(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=False)
    assert pd.isna(df.iloc[5].ding_count)
    _, _, target, mask = d[5]
    assert mask[0].item() == 0.0 and target[0].item() == 0.0


def test_corner_deduction_mask_is_zero_when_marker_deduction_is_nan(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=False)
    assert pd.isna(df.iloc[2].marker_deduction) and pd.isna(df.iloc[7].marker_deduction)
    for i in (2, 7):
        _, _, target, mask = d[i]
        assert mask[1].item() == 0.0 and target[1].item() == 0.0


def test_edge_dataset_rotates_vertical_strips(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    d = data.CropDataset(df, "edges", cache, train=False)
    for i in range(len(d)):
        img, _, target, mask = d[i]
        assert img.shape == (3, 192, 1024)
        assert target.shape == (2,) and mask.shape == (2,)
        assert set(mask.tolist()) <= {0.0, 1.0}
        assert ((target >= 0.0) & (target <= 1.0)).all()


def test_edge_wear_mask_is_zero_when_ding_count_is_nan(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    d = data.CropDataset(df, "edges", cache, train=False)
    assert pd.isna(df.iloc[3].ding_count)
    _, _, target, mask = d[3]
    assert mask[0].item() == 0.0 and target[0].item() == 0.0


def test_edge_deduction_mask_is_zero_when_marker_deduction_is_nan(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    d = data.CropDataset(df, "edges", cache, train=False)
    assert pd.isna(df.iloc[9].marker_deduction)
    _, _, target, mask = d[9]
    assert mask[1].item() == 0.0 and target[1].item() == 0.0


def test_collate_stacks(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=True)
    imgs, sides, targets, masks = data.collate([d[0], d[1], d[2]])
    assert imgs.shape == (3, 3, 384, 384) and sides.shape == (3, 1) and targets.shape == (3, 3) and masks.shape == (3, 3)


def test_train_transform_rng_is_seeded_and_reproducible(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)

    d1 = data.CropDataset(df, "edges", cache, train=True)
    d1.rng = np.random.default_rng(1)
    d2 = data.CropDataset(df, "edges", cache, train=True)
    d2.rng = np.random.default_rng(2)
    d3 = data.CropDataset(df, "edges", cache, train=True)
    d3.rng = np.random.default_rng(1)

    a = d1[0][0]
    b = d2[0][0]
    c = d3[0][0]

    assert not torch.equal(a, b)
    assert torch.equal(a, c)


def test_eval_transform_is_deterministic_and_train_transform_is_bounded(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)

    e1 = data.CropDataset(df, "edges", cache, train=False)
    e2 = data.CropDataset(df, "edges", cache, train=False)
    eval_a = e1[0][0]
    eval_b = e2[0][0]
    assert torch.equal(eval_a, eval_b)

    d = data.CropDataset(df, "edges", cache, train=True)
    d.rng = np.random.default_rng(7)
    train_a = d[0][0]
    assert torch.isfinite(train_a).all()
    assert (train_a - eval_a).abs().mean().item() < 0.3


def test_generator_is_lazy_and_per_dataset_instance(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)

    d1 = data.CropDataset(df, "edges", cache, train=True)
    d2 = data.CropDataset(df, "edges", cache, train=True)
    assert d1.rng is None and d2.rng is None

    d1[0]
    d2[0]

    assert d1.rng is not None and d2.rng is not None


def test_edge_dataset_reads_from_resized_cache(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True, resized=True)
    d = data.CropDataset(df, "edges", cache, train=False)
    img, _, target, mask = d[0]
    assert img.shape == (3, 192, 1024)
    assert target.shape == (2,) and mask.shape == (2,)


def test_edge_dataset_falls_back_to_full_res_when_resized_missing(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)  # full-res only
    d = data.CropDataset(df, "edges", cache, train=False)
    img, *_ = d[0]
    assert img.shape == (3, 192, 1024)


def test_edge_dataset_raises_with_both_paths_when_neither_exists(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    cache = tmp_path / "empty_cache"
    cache.mkdir()
    d = data.CropDataset(df, "edges", cache, train=False)
    with pytest.raises(FileNotFoundError) as exc:
        d[0]
    msg = str(exc.value)
    assert "resized" in msg and str(cache) in msg


def test_full_res_flag_ignores_resized_cache(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("edges", ds, sp, "train")
    # only a full-res file exists at the wrong size, plus a resized one; full_res=True
    # must read the full-res file, not the resized one, even though it exists.
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True, resized=True)
    make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)  # also writes full-res copies into same cache dir
    d = data.CropDataset(df, "edges", cache, train=False, full_res=True)
    img, *_ = d[0]
    assert img.shape == (3, 192, 1024)


def test_corner_dataset_ignores_resize_since_corners_have_no_cache_resize(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    assert tables_mod.TASKS["corners"]["cache_resize"] is None
    d = data.CropDataset(df, "corners", cache, train=False)
    img, *_ = d[0]
    assert img.shape == (3, 384, 384)


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


def test_strong_aug_keeps_shape_is_bounded_and_reproducible(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 96, 96)

    ev = data.CropDataset(df, "corners", cache, train=False)[0][0]
    d1 = data.CropDataset(df, "corners", cache, train=True, aug="strong")
    d1.rng = np.random.default_rng(3)
    d2 = data.CropDataset(df, "corners", cache, train=True, aug="strong")
    d2.rng = np.random.default_rng(3)
    d3 = data.CropDataset(df, "corners", cache, train=True, aug="strong")
    d3.rng = np.random.default_rng(4)

    a = d1[0][0]
    assert a.shape == ev.shape
    assert torch.isfinite(a).all()
    assert (a - ev).abs().mean().item() < 0.6
    assert torch.equal(a, d2[0][0])
    assert not torch.equal(a, d3[0][0])


def test_light_aug_is_the_default_and_rejects_unknown_modes(tables, tmp_path):
    ds, sp = tables
    df = tables_mod.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 96, 96)
    assert data.CropDataset(df, "corners", cache, train=True).aug == "light"
    with pytest.raises(ValueError):
        data.load_crop(cache / df.iloc[0].crop_path, "corners", True, np.random.default_rng(0), aug="wild")


def test_surface_sfx_dataset_shapes_and_first_row_targets(surface_tables, tmp_path):
    from PIL import Image

    from trainlib import cache as cache_mod

    ds, sp = surface_tables
    df = tables_mod.load_task_table("surface_sfx", ds, sp, "train")
    cache = tmp_path / "cache"
    for p in df.crop_path:
        dest = cache_mod.resized_path(cache, p, (896, 1248))
        dest.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (896, 1248), (128, 128, 128)).save(dest, format="JPEG", quality=95)
    d = data.CropDataset(df, "surface_sfx", cache, train=False)
    img, side, target, mask = d[0]
    assert img.shape == (3, 1248, 896) and img.dtype == torch.float32
    row = df.iloc[0]
    assert side.item() == (1.0 if row.side == "B" else 0.0)
    assert target.shape == (1,) and mask.shape == (1,)
    assert abs(target[0].item() - row.score / 1000.0) < 1e-6
    assert mask[0].item() == 1.0
    kept, dropped = tables_mod.filter_cached(df, cache, "surface_sfx")
    assert dropped == 0 and len(kept) == len(df)


def _border_image(w=200, h=300, l=20, r=30, t=25, b=35):
    arr = np.full((h, w, 3), 200, dtype=np.uint8)
    arr[t:h - b, l:w - r] = 60                      # printed frame region darker than the border
    return Image.fromarray(arr)


def test_jitter_edges_moves_targets_with_the_crop():
    img = _border_image()
    pm = [20 / 200 * 1000, 30 / 200 * 1000, 25 / 300 * 1000, 35 / 300 * 1000]
    out, pm2 = data.jitter_edges(img, pm, np.random.default_rng(0), j=0.05)
    assert out.size == img.size
    # locate the dark frame in the jittered image and compare with the predicted per-mille targets
    a = np.asarray(out.convert("L")); dark = a < 120
    cols = np.where(dark.any(axis=0))[0]; rows_ = np.where(dark.any(axis=1))[0]
    l_px, r_px = cols[0], out.width - 1 - cols[-1]
    t_px, b_px = rows_[0], out.height - 1 - rows_[-1]
    for got, exp in ((l_px, pm2[0] / 1000 * out.width), (r_px, pm2[1] / 1000 * out.width),
                     (t_px, pm2[2] / 1000 * out.height), (b_px, pm2[3] / 1000 * out.height)):
        assert abs(got - exp) <= 2.0
    assert pm2 != pm


def test_jitter_edges_zero_is_identity():
    img = _border_image(); pm = [100.0, 150.0, 83.3, 116.7]
    out, pm2 = data.jitter_edges(img, pm, np.random.default_rng(1), j=0.0)
    assert out.size == img.size and pm2 == pm


def test_centering_dataset_applies_jitter_in_train_only(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    sides, _ = st.load_surface_split(ds, sp, "train")
    boxes_path = make_boxes_table(tmp_path, sides[sides.view == "rgb"])
    monkeypatch.setenv("TRAINLIB_BOXES", str(boxes_path))
    df = tables_mod.load_task_table("centering_rgb", ds, sp, "train")
    cache = tmp_path / "cache"
    for p in df.crop_path:
        dest = cache_mod.resized_path(cache, p, (896, 1248), "card"); dest.parent.mkdir(parents=True, exist_ok=True)
        _border_image(896, 1248, 40, 60, 50, 70).save(dest, format="JPEG", quality=95)
    ev = data.CropDataset(df, "centering_rgb", cache, train=False)
    img, side, target, mask = ev[0]
    assert img.shape == (3, 1248, 896) and mask.tolist() == [1.0] * 4
    assert torch.allclose(target, torch.tensor([df.dte_l[0], df.dte_r[0], df.dte_t[0], df.dte_b[0]], dtype=torch.float32) / 1000)
    tr = data.CropDataset(df, "centering_rgb", cache, train=True); tr.rng = np.random.default_rng(3)
    img2, _, target2, _ = tr[0]
    assert img2.shape == img.shape and not torch.allclose(target2, target)
    assert tables_mod.filter_cached(df, cache, "centering_rgb")[1] == 0
