import numpy as np
import pytest
from PIL import Image

from trainlib import card_backgrounds as cb

SIZE = 96

GENERATORS = [cb.flat, cb.gradient, cb.wood, cb.weave, cb.speckle, cb.paper]


@pytest.mark.parametrize("gen", GENERATORS, ids=[g.__name__ for g in GENERATORS])
def test_generator_shape_dtype_and_variation(gen):
    rng = np.random.default_rng(0)
    img = gen(rng, SIZE)
    assert img.shape == (SIZE, SIZE, 3)
    assert img.dtype == np.uint8
    assert img.std() > 2


def test_procedural_picks_among_all_six_generators():
    seen = set()
    for seed in range(60):
        rng = np.random.default_rng(seed)
        idx = int(rng.integers(0, len(GENERATORS)))
        seen.add(idx)
    assert seen == {0, 1, 2, 3, 4, 5}


def test_procedural_reproducible_with_same_seed():
    a = cb.procedural(np.random.default_rng(123), SIZE)
    b = cb.procedural(np.random.default_rng(123), SIZE)
    np.testing.assert_array_equal(a, b)


def test_procedural_returns_uint8_rgb():
    img = cb.procedural(np.random.default_rng(1), SIZE)
    assert img.shape == (SIZE, SIZE, 3)
    assert img.dtype == np.uint8
    assert img.std() > 2


def test_real_pool_empty_folder_has_zero_length(tmp_path):
    pool = cb.RealPool(tmp_path)
    assert len(pool) == 0


def test_real_pool_missing_folder_has_zero_length(tmp_path):
    pool = cb.RealPool(tmp_path / "does-not-exist")
    assert len(pool) == 0


def test_sample_background_with_empty_pool_falls_back_without_error(tmp_path):
    pool = cb.RealPool(tmp_path)
    for seed in range(20):
        img = cb.sample_background(np.random.default_rng(seed), SIZE, pool=pool)
        assert img.shape == (SIZE, SIZE, 3)
        assert img.dtype == np.uint8


def _make_photo(path, w, h):
    arr = (np.random.default_rng(abs(hash(str(path))) % (2**32)).integers(0, 256, size=(h, w, 3))).astype(np.uint8)
    Image.fromarray(arr, mode="RGB").save(path)


def test_real_pool_samples_two_synthetic_images(tmp_path):
    _make_photo(tmp_path / "a.png", 300, 200)
    _make_photo(tmp_path / "b.png", 200, 300)
    pool = cb.RealPool(tmp_path)
    assert len(pool) == 2
    for seed in range(10):
        img = pool.sample(np.random.default_rng(seed), SIZE)
        assert img.shape == (SIZE, SIZE, 3)
        assert img.dtype == np.uint8


def test_real_pool_lists_only_supported_extensions_sorted(tmp_path):
    (tmp_path / "z.jpg").write_bytes(b"")
    (tmp_path / "a.PNG").write_bytes(b"")
    (tmp_path / "m.jpeg").write_bytes(b"")
    (tmp_path / "note.txt").write_bytes(b"")
    pool = cb.RealPool(tmp_path)
    assert [p.name for p in pool.paths] == ["a.PNG", "m.jpeg", "z.jpg"]


def test_clutter_with_fully_transparent_cutout_matches_plain_procedural():
    cutout = Image.new("RGBA", (40, 30), (10, 20, 30, 0))
    rng1 = np.random.default_rng(5)
    rng2 = np.random.default_rng(5)
    clutter_img = cb._clutter(rng1, SIZE, [cutout, cutout])
    plain_img = cb.procedural(rng2, SIZE)
    np.testing.assert_array_equal(clutter_img, plain_img)


def test_clutter_with_opaque_cutouts_differs_from_plain_procedural():
    cutout = Image.new("RGBA", (40, 30), (250, 10, 10, 255))
    rng1 = np.random.default_rng(5)
    rng2 = np.random.default_rng(5)
    clutter_img = cb._clutter(rng1, SIZE, [cutout, cutout])
    plain_img = cb.procedural(rng2, SIZE)
    assert clutter_img.shape == (SIZE, SIZE, 3)
    assert not np.array_equal(clutter_img, plain_img)


@pytest.mark.parametrize("cutouts", [None, []])
def test_clutter_with_no_cutouts_is_plain_procedural(cutouts):
    rng1 = np.random.default_rng(7)
    rng2 = np.random.default_rng(7)
    np.testing.assert_array_equal(cb._clutter(rng1, SIZE, cutouts), cb.procedural(rng2, SIZE))


def test_sample_background_reproducible_with_fixed_seed():
    a = cb.sample_background(np.random.default_rng(42), SIZE)
    b = cb.sample_background(np.random.default_rng(42), SIZE)
    np.testing.assert_array_equal(a, b)


def test_sample_background_shape_dtype_across_seeds():
    for seed in range(30):
        img = cb.sample_background(np.random.default_rng(seed), SIZE)
        assert img.shape == (SIZE, SIZE, 3)
        assert img.dtype == np.uint8


def test_sample_background_with_pool_and_clutter_reproducible(tmp_path):
    _make_photo(tmp_path / "a.png", 300, 200)
    pool = cb.RealPool(tmp_path)
    cutout = Image.new("RGBA", (40, 30), (250, 10, 10, 255))
    a = cb.sample_background(np.random.default_rng(9), SIZE, pool=pool, clutter_cutouts=[cutout])
    b = cb.sample_background(np.random.default_rng(9), SIZE, pool=pool, clutter_cutouts=[cutout])
    np.testing.assert_array_equal(a, b)
