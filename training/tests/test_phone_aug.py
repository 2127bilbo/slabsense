import io

import numpy as np
from PIL import Image

from trainlib import phone_aug as pa

ORANGE = (247, 126, 44)


def _corner(w=200, h=200, backdrop=ORANGE, card=(200, 190, 60), radius=90, tl=True):
    """A synthetic corner crop: orange backdrop outside a rounded card corner at the top-left."""
    arr = np.zeros((h, w, 3), dtype=np.uint8); arr[...] = card
    yy, xx = np.mgrid[0:h, 0:w]
    outside_notch = (xx < radius) & (yy < radius) & ((xx - radius) ** 2 + (yy - radius) ** 2 > radius ** 2)
    arr[outside_notch] = backdrop
    return Image.fromarray(arr)


def test_seeds_and_outer_sides_follow_the_slot_table():
    assert pa.seeds_for("corner_FTL", 100, 50) == [(0, 0)]
    assert pa.seeds_for("corner_BBR", 100, 50) == [(99, 49)]
    assert pa.seeds_for("edge_FT", 100, 50) == [(0, 0), (99, 0)]
    assert pa.seeds_for("edge_BL", 100, 50) == [(0, 49), (99, 49)]
    assert pa.seeds_for("edge_FR", 100, 50) == [(0, 0), (99, 0)]
    assert pa.outer_sides_for("corner_FTL") == ["top", "left"]
    assert pa.outer_sides_for("edge_BL") == ["bottom"]
    assert pa.outer_sides_for("edge_FR") == ["top"]


def test_recolour_fills_the_backdrop_and_leaves_the_card():
    img = _corner()
    out, filled = pa.recolour_backdrop(img, [(0, 0)], np.random.default_rng(0), colour=(0, 0, 0))
    a = np.asarray(out)
    assert filled
    assert tuple(a[0, 0]) == (0, 0, 0)                  # backdrop corner is black
    assert tuple(a[150, 150]) == (200, 190, 60)          # card untouched
    assert tuple(a[5, 150]) == (200, 190, 60)            # card along the top edge untouched


def test_recolour_refuses_a_seed_that_is_not_orange_or_that_leaks():
    black = Image.fromarray(np.zeros((100, 100, 3), dtype=np.uint8))
    out, filled = pa.recolour_backdrop(black, [(0, 0)], np.random.default_rng(0), colour=(255, 0, 0))
    assert not filled and np.asarray(out).max() == 0
    orange = Image.fromarray(np.full((100, 100, 3), ORANGE, dtype=np.uint8))   # all backdrop: fill reaches the centre
    out, filled = pa.recolour_backdrop(orange, [(0, 0)], np.random.default_rng(0), colour=(255, 0, 0))
    assert not filled and tuple(np.asarray(out)[50, 50]) == ORANGE


def test_loose_crop_pads_only_the_outer_sides():
    img = _corner(100, 100)
    rng = np.random.default_rng(1)
    out = pa.loose_crop(img, ["top", "left"], rng, fill=(1, 2, 3), max_frac=0.15)
    assert out.size[0] > 100 and out.size[1] > 100 and out.size[0] <= 115 and out.size[1] <= 115
    assert tuple(np.asarray(out)[0, 0]) == (1, 2, 3)
    assert tuple(np.asarray(out)[-1, -1]) == (200, 190, 60)        # bottom-right (card) untouched


def test_soften_and_resolution_loss_keep_size_and_change_pixels():
    img = _corner(120, 120)
    a = np.asarray(img).astype(int)
    s = pa.soften(img, np.random.default_rng(2), input_size=(60, 60))
    r = pa.resolution_loss(img, np.random.default_rng(3))
    assert s.size == img.size and r.size == img.size
    assert np.abs(np.asarray(s).astype(int) - a).mean() > 0.5
    assert np.abs(np.asarray(r).astype(int) - a).mean() > 0.5


def test_apply_phone_is_reproducible_and_phone_sim_is_deterministic():
    img = _corner()
    a = pa.apply_phone(img, "corner_FTL", np.random.default_rng(7), (100, 100))
    b = pa.apply_phone(img, "corner_FTL", np.random.default_rng(7), (100, 100))
    c = pa.apply_phone(img, "corner_FTL", np.random.default_rng(8), (100, 100))
    assert np.array_equal(np.asarray(a), np.asarray(b))
    assert not np.array_equal(np.asarray(a), np.asarray(c)) or a.size != c.size
    s1 = pa.phone_sim(img, "corner_FTL", (100, 100)); s2 = pa.phone_sim(img, "corner_FTL", (100, 100))
    assert np.array_equal(np.asarray(s1), np.asarray(s2)) and s1.size == img.size
    assert tuple(np.asarray(s1)[0, 0]) == (0, 0, 0)               # backdrop painted black


def test_phone_sim_soft_is_deterministic_same_size_and_changes_pixels():
    img = _corner()
    a = np.asarray(img).astype(int)
    s1 = pa.phone_sim_soft(img, (100, 100))
    s2 = pa.phone_sim_soft(img, (100, 100))
    assert s1.size == img.size
    assert np.array_equal(np.asarray(s1), np.asarray(s2))
    # no jpeg pass (unlike `soften`), so most of the change is at the card/backdrop boundary
    assert np.abs(np.asarray(s1).astype(int) - a).mean() > 0.05
