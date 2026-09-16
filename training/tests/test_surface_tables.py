import pytest

from trainlib import surface_tables as st


def test_class_list_and_labels():
    assert st.SURFACE_CLASSES == ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"]
    assert st.LABEL_OF == {c: i + 1 for i, c in enumerate(st.SURFACE_CLASSES)}


def test_train_split_sides_and_filtered_boxes(surface_tables):
    ds, sp = surface_tables
    sides, boxes = st.load_surface_split(ds, sp, "train")
    assert list(sides.columns) == ["cert", "side", "view", "image_key", "grade_label"]
    assert sides[["cert", "side", "view"]].values.tolist()[:4] == [["A1", "B", "rgb"], ["A1", "B", "sfx"], ["A1", "F", "rgb"], ["A1", "F", "sfx"]]
    assert len(sides) == 8
    assert sides.image_key.tolist()[2] == "tag-dataset/A1/front.jpg" and sides.image_key.tolist()[3] == "tag-dataset/A1/sfx_front.jpg"
    assert sides.grade_label.tolist()[0] == "9 MINT"
    # A1: crease, dent, scratch; B2: pit, print line, tear (stain frame dropped)
    assert len(boxes) == 6
    assert set(boxes.cls) == {"CREASE", "DENT", "SCRATCH", "PIT", "PRINT_DEFECT", "TEAR"}
    tear = boxes[boxes.cls == "TEAR"].iloc[0]
    assert tear.label == 7 and tear.deduction == 1000.0
    assert boxes[boxes.cls == "PIT"].iloc[0].label == 3


def test_boxes_for_view_drops_dents_from_rgb_only(surface_tables):
    ds, sp = surface_tables
    _, boxes = st.load_surface_split(ds, sp, "train")
    assert st.VIEWS == ("sfx", "rgb") and st.RGB_EXCLUDED_LABELS == {2}
    assert len(st.boxes_for_view(boxes, "sfx")) == 6
    rgb = st.boxes_for_view(boxes, "rgb")
    assert len(rgb) == 5 and "DENT" not in set(rgb.cls)


def test_val_split_drops_edge_playwear_and_zero_width(surface_tables):
    ds, sp = surface_tables
    sides, boxes = st.load_surface_split(ds, sp, "val")
    assert len(sides) == 4 and len(boxes) == 0


def test_test_split_is_gated(surface_tables):
    ds, sp = surface_tables
    with pytest.raises(ValueError):
        st.load_surface_split(ds, sp, "test")
    sides, boxes = st.load_surface_split(ds, sp, "test", allow_test=True)
    assert len(sides) == 4 and len(boxes) == 1


def test_limit_cards_is_seeded(surface_tables):
    ds, sp = surface_tables
    a, _ = st.load_surface_split(ds, sp, "train", limit_cards=1, seed=1)
    b, _ = st.load_surface_split(ds, sp, "train", limit_cards=1, seed=1)
    assert a.cert.tolist() == b.cert.tolist() and a.cert.nunique() == 1 and len(a) == 4
