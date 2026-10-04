# SlabSense — https://www.slabsenseai.com
# Copyright (c) 2026 SlabSense. All rights reserved.
# Proprietary and confidential; see LICENSE at the repository root.
"""Step 13.7: colour whole-card surface tasks (`surface_damage_card`, `surface_front_card`)."""
import numpy as np
import pandas as pd
import pytest
from PIL import Image

from trainlib import data, phone_aug, tables


def _manifest():
    return pd.DataFrame({
        "cert": ["A", "B", "C", "D", "E"],
        "grade_label": ["7 NEAR MINT", "10 GEM MINT", "6 EX MT", "5 EX", "9 MINT"],
        "grade_num": [7.0, 10.0, 6.0, 5.0, 9.0],
        "path_front": ["tag-dataset/A/front.jpg", "tag-dataset/B/front.jpg", "tag-dataset/C/front.jpg",
                       "tag-dataset/D/front.jpg", None],
        "path_back": ["tag-dataset/A/back.jpg", "tag-dataset/B/back.jpg", "tag-dataset/C/back.jpg",
                      "tag-dataset/D/back.jpg", "tag-dataset/E/back.jpg"],
        "surface_front": [700.0, 1000.0, 600.0, 400.0, 950.0],
        "rollup_surface": [800.0, 1000.0, 700.0, 500.0, 960.0],
    })


def _surface():
    rows = [
        ("A", "F", "CREASE", 300.0), ("A", "F", "PLAY_WEAR", 100.0), ("A", "B", "CORNER", 50.0),
        ("D", "B", "TEAR", 700.0), ("D", "B", "STAIN", 600.0), ("D", "B", "DENT", 80.0),
        ("D", "F", "SCRATCH", 40.0), ("D", "F", "PRINT_DEFECT", 30.0), ("D", "F", "EDGE", 999.0),
    ]
    return pd.DataFrame(rows, columns=["cert", "side", "engine_type", "deduction"])


def test_damage_rows_count_types_per_side_and_cap_points():
    r = tables.surface_damage_rows(_manifest(), _surface()).set_index(["cert", "side"])
    assert list(r.columns) == ["crop_path", "crease", "dent", "stain", "scratch", "print", "wear", "pts"]
    a = r.loc[("A", "F")]
    assert (a.crease, a.wear, a.stain, a.pts) == (1, 1, 0, 400.0)
    assert r.loc[("A", "B")].pts == 0.0 and r.loc[("A", "B")].crease == 0   # corner/edge markers are not surface
    d = r.loc[("D", "B")]
    assert (d.crease, d.stain, d.dent, d.pts) == (1, 1, 1, 1000.0)          # a tear counts as a crease; points capped
    f = r.loc[("D", "F")]
    assert (f.scratch, f.print, f.pts) == (1, 1, 70.0)                     # the EDGE marker is ignored
    assert r.loc[("A", "F")].crop_path == "tag-dataset/A/front.jpg"


def test_damage_rows_clean_only_when_the_report_exists():
    r = tables.surface_damage_rows(_manifest(), _surface())
    certs = set(r.cert)
    assert "B" in certs            # graded 10 with no markers: genuinely clean
    assert "C" not in certs        # graded 6 with no markers at all: report missing, not clean
    assert set(r[r.cert == "B"].side) == {"F", "B"} and r[r.cert == "B"].pts.sum() == 0
    assert set(r[r.cert == "E"].side) == {"B"}   # no front image: that side is dropped


def test_tasks_share_the_centering_card_cache():
    for name in ("surface_damage_card", "surface_front_card"):
        spec = tables.TASKS[name]
        assert spec["cache_variant"] == "card"
        assert spec["crop_boxes"] == tables.TASKS["centering_rgb"]["crop_boxes"]
        assert spec["cache_resize"] == tables.TASKS["centering_rgb"]["cache_resize"] == (896, 1248)
        assert spec["whole_card"] is True and "edge_jitter" not in spec
    assert tables.target_names("surface_damage_card") == ["crease", "dent", "stain", "scratch", "print", "wear", "pts"]
    assert tables.target_kinds("surface_damage_card") == ["binary"] * 6 + ["regress"]
    assert tables.target_names("surface_front_card") == ["score_front", "rollup"]


def test_damage_task_loads_through_load_task_table(tmp_path):
    ds = tmp_path / "dataset"; ds.mkdir()
    _manifest().to_parquet(ds / "manifest.parquet")
    _surface().to_parquet(ds / "surface.parquet")
    sp = tmp_path / "splits.parquet"
    pd.DataFrame({"cert": ["A", "B", "C", "D", "E"], "split": ["train", "train", "train", "val", "train"]}).to_parquet(sp)
    tr = tables.load_task_table("surface_damage_card", ds, sp, "train")
    assert set(tr.cert) == {"A", "B", "E"} and "grade_label" in tr.columns
    va = tables.load_task_table("surface_damage_card", ds, sp, "val")
    assert set(va.cert) == {"D"} and len(va) == 2


def test_whole_card_phone_aug_keeps_size_and_is_seeded():
    img = Image.fromarray(np.full((312, 224, 3), 128, dtype=np.uint8))
    a = phone_aug.apply_phone_whole_card(img, np.random.default_rng(3), (224, 312))
    b = phone_aug.apply_phone_whole_card(img, np.random.default_rng(3), (224, 312))
    assert a.size == img.size and a.mode == "RGB"
    assert np.array_equal(np.asarray(a), np.asarray(b))


def test_glare_brightens_a_soft_patch_only():
    img = Image.fromarray(np.full((200, 140, 3), 100, dtype=np.uint8))
    out = np.asarray(phone_aug.add_glare(img, np.random.default_rng(0), strength=0.6)).astype(int)
    assert out.max() > 150 and out.min() == 100     # a bright spot, the rest untouched


@pytest.mark.parametrize("phone_sim,train,aug", [(False, True, "phone"), (True, False, "light")])
def test_load_crop_whole_card_has_no_stem_requirement(tmp_path, phone_sim, train, aug):
    p = tmp_path / "front.jpg"
    Image.fromarray(np.full((1248, 896, 3), 90, dtype=np.uint8)).save(p)
    t = data.load_crop(p, "surface_damage_card", train, np.random.default_rng(1), (224, 312), aug=aug, phone_sim=phone_sim)
    assert tuple(t.shape) == (3, 312, 224)
