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
