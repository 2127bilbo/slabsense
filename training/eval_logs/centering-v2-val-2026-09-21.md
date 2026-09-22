# Centering v2 — val results (pulled off the box 2026-09-21 before it stopped)

Run: `--epochs 10 --batch-size 8 --drop-path 0.1 --ema-decay 0.999 --aug phone
--ratio-weight 0.02 --balance-deviation`, 896x1248 card crop, ConvNeXt-Tiny.
Checkpoint + ONNX are still ON THE BOX (not pulled home before it stopped).
These tables are the full val split, n = 5,549 cards.

## ALL rows (mae in per-mille; ratio mae in ratio points)

| run | l | r | t | b | ratio_lr | ratio_tb | within1 | within2 | slope |
|---|---|---|---|---|---|---|---|---|---|
| v1 clean     | 1.7488 | 1.8689 | 1.0903 | 1.2092 | 1.2364 | 1.0741 | 0.3682 | 0.7362 | 0.7624 |
| v1 phone-sim | 1.8084 | 1.9613 | 1.2582 | 1.1473 | 1.2825 | 1.2560 | 0.3307 | 0.7037 | 0.7397 |
| v2 clean     | 1.6180 | 1.6919 | 0.9645 | 1.0257 | 1.1731 | 0.8650 | 0.4248 | 0.7873 | 0.8708 |
| v2 phone-sim | 1.6809 | 1.7376 | 0.9596 | 1.0195 | 1.1695 | 0.8537 | 0.4318 | 0.7893 | 0.8672 |

## Deviation buckets (mean deviation in ratio points)

| bucket | n | TAG | v1 pred | v2 pred |
|---|---|---|---|---|
| 0 [0,2)   | 812  | 1.371  | 1.692  | 1.667  |
| 1 [2,5)   | 2772 | 3.478  | 3.219  | 3.418  |
| 2 [5,10)  | 1698 | 6.690  | 5.780  | 6.332  |
| 3 [10,20) | 243  | 12.540 | 10.280 | 11.586 |
| 4 [20,inf)| 24   | 28.646 | 21.477 | 23.951 |

## Acceptance (Step 11.2)

Passes 6 of 7: all four distance MAEs beat v1; ratio MAEs 1.17/0.87 (<= 1.4);
within2 0.787 (>= 0.68); buckets 2 and 3 within 10% of TAG (-5%, -8%); phone-sim
ratio gap 0.00/0.01 (<= 0.3). **Fails slope: 0.871 vs >= 0.95** — still
under-calls off-centre cards, worst in bucket 4 (23.95 vs 28.65).

Decision pending: v2b (`--ratio-weight 0.1`) was queued but the instance stopped
before it ran. Test split NOT read for v2.

## Final epoch (v2 log.csv)

```
epoch,train_loss,val_loss,lr,loss_dist,loss_ratio,seconds,mae_dte_l,mae_dte_r,mae_dte_t,mae_dte_b
8,0.00096,0.00049,2.34e-05,0.00023,0.03620,1551.8,1.6467,1.7214,1.0555,1.1118
9,0.00090,0.00048,6.03e-06,0.00021,0.03432,1553.3,1.6245,1.6799,0.9866,1.0480
10,0.00088,0.00048,8.00e-10,0.00020,0.03368,1714.1,1.6181,1.6918,0.9644,1.0256
```

ONNX export ran on the box: fp32 107.0 MB, fp16 54.0 MB, int8 27.1 MB;
fp16 parity mae_dte l/r/t/b = 1.4903 / 1.5718 / 0.9596 / 0.8544.
