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


def test_masked_loss_ratio_term_is_zero_when_pred_matches_target():
    kinds = ["regress"] * 4
    target = torch.tensor([[0.2, 0.3, 0.4, 0.1], [0.5, 0.5, 0.2, 0.2]])
    pred = torch.logit(target)
    mask = torch.ones(2, 4)
    total, terms = models.masked_loss(pred, target, mask, kinds, ratio_pairs=[(0, 1), (2, 3)],
                                      ratio_weight=2.0, return_terms=True)
    assert torch.allclose(terms.ratio, torch.tensor(0.0), atol=1e-5)
    assert torch.allclose(total, terms.dist)


def test_masked_loss_ratio_term_positive_when_lr_swapped():
    kinds = ["regress"] * 4
    target = torch.tensor([[0.2, 0.8, 0.5, 0.5]])
    swapped = target.clone()
    swapped[:, [0, 1]] = swapped[:, [1, 0]]
    pred = torch.logit(swapped)
    mask = torch.ones(1, 4)
    total, terms = models.masked_loss(pred, target, mask, kinds, ratio_pairs=[(0, 1)],
                                      ratio_weight=2.0, return_terms=True)
    assert terms.ratio.item() > 0.0
    dist_only = models.masked_loss(pred, target, mask, kinds)
    assert torch.allclose(dist_only, terms.dist)
    assert torch.allclose(total, dist_only + 2.0 * terms.ratio)


def test_masked_loss_ratio_excludes_rows_with_a_masked_pair_channel():
    kinds = ["regress"] * 4
    target = torch.tensor([[0.2, 0.8, 0.4, 0.6], [0.3, 0.7, 0.5, 0.5]])
    pred_vals = torch.full((2, 4), 0.5)
    pred = torch.logit(pred_vals)
    # row 1 is missing the second channel of the (0, 1) pair, so the WHOLE row is excluded
    # from the ratio mean, even though its (2, 3) pair is fully unmasked.
    mask = torch.tensor([[1.0, 1.0, 1.0, 1.0], [1.0, 0.0, 1.0, 1.0]])
    total, terms = models.masked_loss(pred, target, mask, kinds, ratio_pairs=[(0, 1), (2, 3)],
                                      ratio_weight=1.0, return_terms=True)
    # manual: only row 0 counts; sum |r(pred)-r(target)| over both pairs for that row
    r_pred_01 = 0.5 / (0.5 + 0.5 + 1e-6); r_targ_01 = 0.2 / (0.2 + 0.8 + 1e-6)
    r_pred_23 = 0.5 / (0.5 + 0.5 + 1e-6); r_targ_23 = 0.4 / (0.4 + 0.6 + 1e-6)
    expected = abs(r_pred_01 - r_targ_01) + abs(r_pred_23 - r_targ_23)
    assert torch.allclose(terms.ratio, torch.tensor(expected), atol=1e-4)


def test_drop_path_rate_reaches_backbone_and_keeps_state_dict_keys():
    plain = models.ScoreRegressor(n_out=3, backbone="convnext_tiny", pretrained=False)
    reg = models.ScoreRegressor(n_out=3, backbone="convnext_tiny", pretrained=False, drop_path_rate=0.2)
    probs = [m.drop_prob for m in reg.modules() if type(m).__name__ == "DropPath"]
    assert probs and max(probs) > 0.0
    assert [m.drop_prob for m in plain.modules() if type(m).__name__ == "DropPath"] in ([], [0.0] * len(probs))
    assert list(reg.state_dict().keys()) == list(plain.state_dict().keys())
