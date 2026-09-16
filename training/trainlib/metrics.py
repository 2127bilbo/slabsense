"""Rank-based AUROC and precision/recall metrics for binary targets, no sklearn dependency (spec §7)."""
from __future__ import annotations

import torch


def _average_ranks(x: torch.Tensor) -> torch.Tensor:
    """1-based ranks over `x`, with tied values receiving the average rank of their group."""
    n = x.numel()
    order = torch.argsort(x)
    sorted_x = x[order]
    ranks_sorted = torch.arange(1, n + 1, dtype=torch.float64)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and sorted_x[j + 1] == sorted_x[i]:
            j += 1
        if j > i:
            ranks_sorted[i:j + 1] = ranks_sorted[i:j + 1].mean()
        i = j + 1
    ranks = torch.empty(n, dtype=torch.float64)
    ranks[order] = ranks_sorted
    return ranks


def auroc(scores: torch.Tensor, labels: torch.Tensor) -> float:
    """Rank-based (Mann-Whitney U) AUROC. NaN when only one class is present in `labels`."""
    scores = torch.as_tensor(scores, dtype=torch.float64).flatten()
    labels = torch.as_tensor(labels, dtype=torch.float64).flatten()
    n_pos = int((labels == 1).sum().item())
    n_neg = int((labels == 0).sum().item())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    ranks = _average_ranks(scores)
    sum_ranks_pos = ranks[labels == 1].sum()
    auc = (sum_ranks_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
    return float(auc)


def precision_recall_at(scores: torch.Tensor, labels: torch.Tensor, threshold: float = 0.5) -> tuple[float, float]:
    """Precision and recall at a score threshold. NaN when the denominator is undefined."""
    scores = torch.as_tensor(scores, dtype=torch.float64).flatten()
    labels = torch.as_tensor(labels, dtype=torch.float64).flatten()
    pred_pos = scores >= threshold
    tp = int((pred_pos & (labels == 1)).sum().item())
    fp = int((pred_pos & (labels == 0)).sum().item())
    fn = int((~pred_pos & (labels == 1)).sum().item())
    precision = tp / (tp + fp) if (tp + fp) > 0 else float("nan")
    recall = tp / (tp + fn) if (tp + fn) > 0 else float("nan")
    return precision, recall
