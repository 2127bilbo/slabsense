import torch

from trainlib import models


def test_regressor_forward_returns_raw_logits():
    m = models.ScoreRegressor(n_out=3, backbone="resnet18", pretrained=False).eval()
    x = torch.randn(2, 3, 64, 64); s = torch.tensor([[0.0], [1.0]])
    y = m(x, s)
    assert y.shape == (2, 3)
    with torch.no_grad():
        f = m.backbone(x)
        expected = m.head(torch.cat([f, s.to(f.dtype)], dim=1))
    # forward() must return the head's output as-is, with no sigmoid applied
    assert torch.equal(y, expected)


def test_side_changes_output():
    torch.manual_seed(0)
    m = models.ScoreRegressor(n_out=2, backbone="resnet18", pretrained=False).eval()
    x = torch.randn(1, 3, 64, 64)
    a = m(x, torch.tensor([[0.0]])); b = m(x, torch.tensor([[1.0]]))
    assert not torch.allclose(a, b)


def test_to_scores_is_sigmoid_in_unit_range():
    pred = torch.tensor([[-5.0, 0.0, 5.0]])
    scores = models.to_scores(pred, kinds=["binary", "regress", "regress"])
    assert torch.equal(scores, torch.sigmoid(pred))
    assert (scores >= 0).all() and (scores <= 1).all()


def test_masked_loss_all_masked_regress_equals_bce_alone():
    kinds = ["binary", "regress"]
    pred = torch.tensor([[2.0, -1.0], [-1.0, 3.0]])
    target = torch.tensor([[1.0, 0.7], [0.0, 0.2]])
    mask = torch.tensor([[1.0, 0.0], [1.0, 0.0]])
    loss = models.masked_loss(pred, target, mask, kinds)
    bce = torch.nn.functional.binary_cross_entropy_with_logits(pred[:, 0], target[:, 0], reduction="mean")
    assert torch.allclose(loss, bce)


def test_masked_loss_all_masked_is_zero_with_grad():
    kinds = ["binary", "regress"]
    pred = torch.zeros(2, 2, requires_grad=True)
    target = torch.ones(2, 2)
    mask = torch.zeros(2, 2)
    loss = models.masked_loss(pred, target, mask, kinds)
    assert loss.item() == 0.0
    assert loss.requires_grad
    loss.backward()
    assert pred.grad is not None


def test_masked_loss_decreases_denominator_contribution_when_mixed():
    kinds = ["binary"]
    pred = torch.tensor([[0.5], [0.5]])
    target = torch.tensor([[1.0], [1.0]])
    mask_none = torch.zeros(2, 1)
    assert models.masked_loss(pred, target, mask_none, kinds).item() == 0.0
    mask_all = torch.ones(2, 1)
    assert models.masked_loss(pred, target, mask_all, kinds).item() > 0.0


def test_convnext_tiny_param_count():
    m = models.ScoreRegressor(n_out=3, backbone="convnext_tiny", pretrained=False)
    n = models.count_params(m)
    assert 27_000_000 < n < 30_000_000


def test_drop_path_rate_reaches_backbone_and_keeps_state_dict_keys():
    plain = models.ScoreRegressor(n_out=3, backbone="convnext_tiny", pretrained=False)
    reg = models.ScoreRegressor(n_out=3, backbone="convnext_tiny", pretrained=False, drop_path_rate=0.2)
    probs = [m.drop_prob for m in reg.modules() if type(m).__name__ == "DropPath"]
    assert probs and max(probs) > 0.0
    assert [m.drop_prob for m in plain.modules() if type(m).__name__ == "DropPath"] in ([], [0.0] * len(probs))
    assert list(reg.state_dict().keys()) == list(plain.state_dict().keys())
