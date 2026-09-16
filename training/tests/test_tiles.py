import numpy as np

from trainlib import tiles


def test_grid_covers_image_and_ends_on_edges():
    g = tiles.tile_grid(4391, 6063)
    xs = sorted({x for x, _ in g}); ys = sorted({y for _, y in g})
    assert xs[0] == 0 and ys[0] == 0
    assert xs[-1] == 4391 - 1024 and ys[-1] == 6063 - 1024
    assert all(x + 1024 <= 4391 and y + 1024 <= 6063 for x, y in g)
    assert xs[1] == 896 and ys[1] == 896
    assert len(g) == len(xs) * len(ys) == 5 * 7


def test_grid_small_image_is_single_origin():
    assert tiles.tile_grid(800, 700) == [(0, 0)]


def test_clip_keeps_boxes_with_half_area_inside_and_translates():
    boxes = [[1, 100.0, 100.0, 300.0, 300.0],      # fully inside tile (0,0)
             [2, 900.0, 100.0, 1100.0, 300.0],     # 62% inside -> kept, clipped at 1024
             [3, 1000.0, 100.0, 1400.0, 300.0],    # 6% inside -> dropped
             [4, 1020.0, 500.0, 1030.0, 900.0]]    # 40% inside -> dropped
    out = tiles.clip_boxes(boxes, 0, 0)
    assert out == [[1, 100.0, 100.0, 300.0, 300.0], [2, 900.0, 100.0, 1024.0, 300.0]]
    out2 = tiles.clip_boxes(boxes, 896, 0)
    assert [b[0] for b in out2] == [2, 3, 4]
    assert out2[0][1:] == [4.0, 100.0, 204.0, 300.0]


def test_clip_drops_slivers_below_min_side():
    boxes = [[5, 1020.0, 10.0, 1200.0, 20.0]]      # 4 px wide inside tile (0,0), 2.2% of area -> dropped anyway
    assert tiles.clip_boxes(boxes, 0, 0) == []
    boxes = [[5, 10.0, 10.0, 13.0, 200.0]]         # 3 px wide -> dropped by MIN_SIDE_PX
    assert tiles.clip_boxes(boxes, 0, 0) == []


def test_select_positive_tiles_only_when_boxes_exist():
    boxes = [[1, 100.0, 100.0, 300.0, 300.0]]
    sel = tiles.select_tiles(4391, 6063, boxes, np.random.default_rng(0))
    assert [(x, y) for x, y, _ in sel] == [(0, 0)]
    assert sel[0][2] == [[1, 100.0, 100.0, 300.0, 300.0]]


def test_select_negative_tiles_for_clean_side_are_seeded_and_distinct():
    a = tiles.select_tiles(4391, 6063, [], np.random.default_rng(3), neg_per_side=2)
    b = tiles.select_tiles(4391, 6063, [], np.random.default_rng(3), neg_per_side=2)
    assert a == b and len(a) == 2 and a[0][:2] != a[1][:2] and a[0][2] == [] and a[1][2] == []
    assert all((x, y) in tiles.tile_grid(4391, 6063) for x, y, _ in a)


def test_box_spanning_two_tiles_appears_in_both():
    boxes = [[4, 800.0, 10.0, 1100.0, 30.0]]       # a print line 300 px wide crossing x = 896..1024
    sel = tiles.select_tiles(4391, 6063, boxes, np.random.default_rng(0))
    assert [(x, y) for x, y, _ in sel] == [(0, 0), (896, 0)]
