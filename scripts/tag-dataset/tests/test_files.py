from tagdataset import files


def test_expected_files_for_recorded_cert(detail_fixture, score_fixture):
    out = files.expected_files(detail_fixture, score_fixture)
    names = [n for n, _ in out]
    urls = [u for _, u in out]
    assert len(names) == len(set(names)), "file names must be unique"
    assert all(u.startswith("https://") for u in urls)
    dings = detail_fixture["data"]["dingsJSON"]["Dings"]
    assert len(out) == 6 + 8 + 8 + len(dings)
    assert names[:6] == ["front.jpg", "back.jpg", "sfx_front.jpg", "sfx_back.jpg",
                         "sfx_front_annotated.jpg", "sfx_back_annotated.jpg"]
    assert "corner_FTL.png" in names and "corner_BBR.png" in names
    assert "edge_FT.png" in names and "edge_BR.png" in names
    d = dict(out)
    assert d["front.jpg"] == detail_fixture["data"]["imageFileDeskewedFront"]
    assert d["corner_FTL.png"] == score_fixture["data"]["imageFileFTL"]
    assert d["edge_BL.png"] == score_fixture["data"]["imageFileBLE"]
    assert d["sfx_front_annotated.jpg"] == detail_fixture["data"]["surfaceFrontData"]["image"]
    assert d[f"ding_{dings[0]['Ordering']}.jpg"] == dings[0]["ImageURL"]


def test_missing_urls_are_skipped(detail_fixture, score_fixture):
    score = {"data": {**score_fixture["data"], "imageFileFTL": None}}
    detail = {"data": {**detail_fixture["data"], "dingsJSON": {"Dings": [], "DingsCount": 0, "Summary": {}}}}
    out = files.expected_files(detail, score)
    names = [n for n, _ in out]
    assert "corner_FTL.png" not in names
    assert not any(n.startswith("ding_") for n in names)
    assert len(out) == 6 + 7 + 8


def test_score_none_yields_detail_files_only(detail_fixture):
    out = files.expected_files(detail_fixture, None)
    names = [n for n, _ in out]
    assert not any(n.startswith(("corner_", "edge_")) for n in names)
    assert "front.jpg" in names


def test_slab_images_are_never_included(detail_fixture, score_fixture):
    urls = [u for _, u in files.expected_files(detail_fixture, score_fixture)]
    assert not any("slab-images" in u for u in urls)


def test_content_types():
    assert files.CONTENT_TYPES[".jpg"] == "image/jpeg"
    assert files.CONTENT_TYPES[".png"] == "image/png"


def test_duplicate_ordering_values(detail_fixture, score_fixture):
    """Two dings with the same Ordering should have unique filenames."""
    base_ding = detail_fixture["data"]["dingsJSON"]["Dings"][0]
    detail = {
        "data": {
            **detail_fixture["data"],
            "dingsJSON": {
                "Dings": [
                    {**base_ding, "ImageURL": "https://example.com/ding1.jpg"},
                    {**base_ding, "ImageURL": "https://example.com/ding2.jpg"},
                ],
                "DingsCount": 2,
                "Summary": {},
            }
        }
    }
    out = files.expected_files(detail, score_fixture)
    names = [n for n, _ in out]
    urls = [u for _, u in out]

    # All names must be unique
    assert len(names) == len(set(names)), "file names must be unique"

    # Both URLs must be present
    assert "https://example.com/ding1.jpg" in urls
    assert "https://example.com/ding2.jpg" in urls

    # First ding keeps ding_1.jpg
    d = dict(out)
    assert "ding_1.jpg" in names
    assert d["ding_1.jpg"] == "https://example.com/ding1.jpg"

    # Second ding gets ding_1_2.jpg (ordering_index format)
    assert "ding_1_2.jpg" in names
    assert d["ding_1_2.jpg"] == "https://example.com/ding2.jpg"


def test_none_ordering_with_int_ordering(detail_fixture, score_fixture):
    """Ding with Ordering: None alongside one with Ordering: 2 should have unique, sensible names."""
    detail = {
        "data": {
            **detail_fixture["data"],
            "dingsJSON": {
                "Dings": [
                    {"Ordering": None, "ImageURL": "https://example.com/ding_none.jpg"},
                    {"Ordering": 2, "ImageURL": "https://example.com/ding_2.jpg"},
                ],
                "DingsCount": 2,
                "Summary": {},
            }
        }
    }
    out = files.expected_files(detail, score_fixture)
    names = [n for n, _ in out]
    urls = [u for _, u in out]

    # All names must be unique
    assert len(names) == len(set(names)), "file names must be unique"

    # Both URLs must be present
    assert "https://example.com/ding_none.jpg" in urls
    assert "https://example.com/ding_2.jpg" in urls

    # No names should contain "None"
    assert not any("None" in n for n in names)

    # ding_2.jpg should be present
    d = dict(out)
    assert "ding_2.jpg" in names
    assert d["ding_2.jpg"] == "https://example.com/ding_2.jpg"

    # ding_1.jpg should be present (for the None-ordered ding at index 1)
    assert "ding_1.jpg" in names
    assert d["ding_1.jpg"] == "https://example.com/ding_none.jpg"
