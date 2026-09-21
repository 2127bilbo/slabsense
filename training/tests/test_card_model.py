import numpy as np
import torch

from trainlib.card_model import CardSegNet, bce_dice, count_params


def test_forward_shape_works_for_any_multiple_of_32():
    model = CardSegNet(pretrained=False)
    model.eval()
    x = torch.randn(2, 3, 64, 64)
    with torch.no_grad():
        out = model(x)
    assert out.shape == (2, 1, 64, 64)


def test_bce_dice_near_zero_for_confident_correct_logits():
    rng = np.random.default_rng(0)
    target = torch.from_numpy((rng.random((2, 1, 16, 16)) < 0.5).astype(np.float32))
    logits = torch.where(target > 0.5, torch.full_like(target, 10.0), torch.full_like(target, -10.0))
    loss = bce_dice(logits, target)
    assert loss.item() < 1e-3


def test_bce_dice_large_for_confidently_wrong_logits():
    target = torch.ones(2, 1, 8, 8)
    logits = torch.full_like(target, -10.0)
    loss = bce_dice(logits, target)
    assert loss.item() > 1.0


def test_count_params_under_budget_for_mobilenet_encoder():
    model = CardSegNet(pretrained=False)
    n = count_params(model)
    print(f"CardSegNet(mobilenetv3_large_100) param count: {n:,}")
    assert n < 6_500_000
