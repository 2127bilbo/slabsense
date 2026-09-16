import torch

from trainlib import models


def test_regressor_forward_shape_and_range():
    m = models.ScoreRegressor(n_out=3, backbone="resnet18", pretrained=False)
    x = torch.randn(2, 3, 64, 64); s = torch.tensor([[0.0], [1.0]])
    y = m(x, s)
    assert y.shape == (2, 3) and (y >= 0).all() and (y <= 1).all()


def test_side_changes_output():
    torch.manual_seed(0)
    m = models.ScoreRegressor(n_out=2, backbone="resnet18", pretrained=False).eval()
    x = torch.randn(1, 3, 64, 64)
    a = m(x, torch.tensor([[0.0]])); b = m(x, torch.tensor([[1.0]]))
    assert not torch.allclose(a, b)


def test_masked_huber_ignores_masked_elements():
    pred = torch.tensor([[0.5, 0.5], [0.5, 0.5]])
    target = torch.tensor([[0.5, 0.0], [0.5, 0.0]])
    mask = torch.tensor([[1.0, 0.0], [1.0, 0.0]])
    assert models.masked_huber(pred, target, mask).item() == 0.0
    mask_all = torch.ones_like(mask)
    assert models.masked_huber(pred, target, mask_all).item() > 0.0


def test_masked_huber_all_masked_is_zero_not_nan():
    pred = torch.zeros(2, 2); target = torch.ones(2, 2); mask = torch.zeros(2, 2)
    assert models.masked_huber(pred, target, mask).item() == 0.0


def test_convnext_tiny_param_count():
    m = models.ScoreRegressor(n_out=3, backbone="convnext_tiny", pretrained=False)
    n = models.count_params(m)
    assert 27_000_000 < n < 30_000_000
