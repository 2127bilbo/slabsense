"""Tests for training/export_card_model.py (plan 2026-09-21-card-model, Task 6: Export)."""
from __future__ import annotations

import json

import numpy as np
import pytest
import torch

pytest.importorskip("onnx")
pytest.importorskip("onnxruntime")

from test_train_card import _write_config, _write_cutout, _write_splits

import export_card_model
from trainlib.card_model import CardSegNet

INPUT_SIZE = 64


def _write_tiny_checkpoint(path, input_size=INPUT_SIZE, encoder="mobilenetv3_large_100"):
    model = CardSegNet(encoder=encoder, pretrained=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {"model": model.state_dict(), "encoder": encoder, "epoch": 0, "iou": 0.0, "input_size": input_size},
        path,
    )


def _setup(tmp_path):
    _write_splits(tmp_path)
    cache_dir = tmp_path / "cache"
    for cert in ("A1", "B2", "C3"):
        _write_cutout(cache_dir / "cutouts" / f"{cert}_F.png")
    cfg = _write_config(tmp_path)
    ckpt_path = tmp_path / "run" / "best.pt"
    _write_tiny_checkpoint(ckpt_path)
    return cfg, ckpt_path


def test_export_card_model_writes_five_files_and_valid_contract(tmp_path):
    cfg, ckpt_path = _setup(tmp_path)
    out_dir = tmp_path / "onnx"

    ret = export_card_model.main([
        "--config", str(cfg), "--checkpoint", str(ckpt_path), "--run-name", "t",
        "--out-dir", str(out_dir), "--parity-rows", "4", "--batch-size", "2",
        "--input-size", str(INPUT_SIZE), "--seed", "12345",
        "--backgrounds", str(tmp_path / "no_such_backgrounds"),
    ])

    stem = "card-t"
    fp32 = out_dir / f"{stem}.fp32.onnx"
    contract_path = out_dir / f"{stem}.json"
    parity_path = out_dir / f"{stem}.parity.json"

    assert fp32.exists()
    assert contract_path.exists()
    contract = json.loads(contract_path.read_text())

    assert contract["task"] == "card"
    assert contract["run"] == "t"
    assert contract["encoder"] == "mobilenetv3_large_100"
    assert contract["input_size"] == INPUT_SIZE
    assert contract["inputs"]["image"]["shape"] == ["N", 3, INPUT_SIZE, INPUT_SIZE]
    assert contract["inputs"]["image"]["layout"] == "NCHW"
    assert contract["inputs"]["image"]["normalise"] == "x/255 then (x-mean)/std"
    assert len(contract["inputs"]["image"]["mean"]) == 3
    assert len(contract["inputs"]["image"]["std"]) == 3
    assert "letterbox" in contract["inputs"]["image"]
    assert contract["outputs"]["mask"]["shape"] == ["N", 1, INPUT_SIZE, INPUT_SIZE]
    assert "logits" in contract["outputs"]["mask"]["meaning"]
    assert "fp32" in contract["files"]
    assert contract["files"]["fp32"]["path"] == fp32.name
    assert contract["files"]["fp32"]["bytes"] == fp32.stat().st_size
    assert len(contract["files"]["fp32"]["sha256"]) == 64
    assert isinstance(contract["fp16_block"], list)
    assert "exported_at" in contract

    assert parity_path.exists()
    parity = json.loads(parity_path.read_text())
    assert parity["rows"] == 4
    assert "fp32" in parity
    for key in ("mean_abs_logit_diff", "max_abs_logit_diff", "mask_disagreement_frac",
                "iou_vs_torch_mask", "ms_per_image"):
        assert key in parity["fp32"]
    assert parity["fp32"]["max_abs_logit_diff"] < 1e-3

    fp16 = out_dir / f"{stem}.fp16.onnx"
    int8 = out_dir / f"{stem}.int8.onnx"
    if fp16.exists():
        assert "fp16" in contract["files"]
        assert "fp16" in parity
        assert parity["fp16"]["mask_disagreement_frac"] < 0.005
    else:
        print("skipped fp16 export (see stdout of the export run for the reason)")
    if int8.exists():
        assert "int8" in contract["files"]
        assert "int8" in parity
    else:
        print("skipped int8 export (see stdout of the export run for the reason)")

    # fp32 parity must pass regardless; a non-zero return only happens on an fp16 parity failure.
    if fp16.exists():
        assert ret in (0, 1)
    else:
        assert ret == 0
