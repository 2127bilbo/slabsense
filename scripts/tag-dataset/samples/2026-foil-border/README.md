# 2026 foil-border centering sample

Built 2026-09-30 from TAG's pop report for the centering retrain that
`training/MODEL-ROADMAP.md` §2 calls for after the 30th Celebration Lugia finding
(`docs/grading-research/e-reader-centering.md` §3): centering v2b is ~8 points off TAG on every
copy of a gold-foil-border card it never saw, because the dataset ends at graded date 2026-06-08.

**Rule (owner):** every graded cert at grade 9 and below, plus up to 2 × 10 GEM MINT and 1 × 10
PRISTINE per card + variation, so the sample shows centering deviation instead of a wall of
centred Pristines. Design classes covered: all 2026 sets whose name contains "30th" (every
variation), and the Illustration / Special Illustration / Hyper / Ultra / Secret / Special Art /
Futuristic / RGB / Full Art variations of Ascended Heroes, Perfect Order, Chaos Rising, Abyss Eye,
Ninja Spinner and Nullifying Zero.

| file | what |
|---|---|
| `certs.parquet` | 3,833 certs in the schema `tagdataset fetch --certs` expects (cert, grade_key, grade_num, is_pristine, era, year, brand, set, card_name, card_number, variation) plus score_total, date_graded, source |
| `certs.txt` | the same certs, one per line |
| `popreport-30th.json` | full enumeration of the 30th sets: 316 certs, every grade |
| `popreport-2026-sir.json` | full enumeration of the big-set rare variations: 17,204 certs, every grade (re-sample from here if the mix should change) |

Selected: 3,465 at ≤ 9 (2,825 of them 9s, 298 at 8.5, 177 at 8, 165 at 7.5 or below), 314 tens,
54 Pristines; 200 cards. By variation: Special Illustration Rare 2,216, Illustration Rare 721,
Mega Hyper Rare 552, Special Art Rare 134, Ultra Rare 116, the 30th Holo/Futuristic/RGB/Secret
Rare designs 67, others 13. The training session may thin the 9s (e.g. cap 600) if the mix is
too top-heavy; the ≤ 8.5 rows are the ones that carry the deviation.

Pull: `python -m tagdataset fetch --certs samples/2026-foil-border/certs.parquet --proxies …` then
`download` and `build` as in RUNBOOK.md. TAG's detail endpoint needs ~25 s between calls from
one address (429 otherwise), so use the proxy list; ~7,700 calls. These certs are pre-assigned in `splits/splits.parquet` as `foil2026-train` (3,034 cards) and
`foil2026-val` (759 cards), a seeded hash split; never into the frozen TAG train/val/test. The
pull was run 2026-09-30/10-01 (`run-pull.ps1`): 85,561 files in R2, 0 missing, tables rebuilt.
Training instructions: `training/HANDOFF-rented-gpu.md` Step 13.

Enumeration driver: session scratchpad `pw/popset.cjs` (Playwright over the pop-report pages:
year → sets → card+variation pages → cert table with grade and score).
