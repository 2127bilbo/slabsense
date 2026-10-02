# SlabSense — where everything stands

Updated 2026-10-01. One page to re-read before touching anything. Each line points at the
document that holds the detail; nothing here is the only copy of a fact.

## Live app (main, Vercel, slabsenseai.com)

| Area | State | Detail |
|---|---|---|
| Engine | v1.1, eight subgrades, TAG rubric, company conversions | `docs/GRADING_SYSTEM.md` |
| Corner / edge models | `corners-v3-phone`, `edges-v2-phone` fp16 in the `models` bucket, on by default (Settings toggle), thresholds 0.20 / 0.20 | GRADING_SYSTEM "Corner and edge models" |
| Card outline model | `card-v1`: live viewfinder outline, auto snap after 2.5 s lock, pre-placed card line in the centering tool, capture check | GRADING_SYSTEM "Card and centering models…", "Viewfinder", "Auto snap" |
| Centering model | `centering_rgb-v2b` pre-places the artwork line; crop-edge sensitive; 8 points off on foil-border 2026 cards | GRADING_SYSTEM same section; `docs/grading-research/e-reader-centering.md` §3 |
| Surface | No learned detector on the free path; paid paths use Claude + the deduction regressor for severity | GRADING_SYSTEM "Surface severity from the deduction model" |
| Grade rollup model | Wired on paid paths, **off** (`GRADE_ROLLUP_MODEL`); lenient on our inputs until a surface model exists | GRADING_SYSTEM "Grade rollup model (wired, OFF)" |
| Paid paths | AI and Deep AI grades spend credits server-side; `cornerEdge` slot table makes them agree with the free grade | `api/ai-analyze-unified.js`, `deep-analyze-v2.js`, `api/_lib/cornerEdgeInput.js` |
| Card identification | OCR + pixel re-rank over the bucket card DB (v9), weekly update job | `src/lib/card-db-client.js`, `scripts/card-db/` |
| Slabs | Order flow, studio queue, cert pages; Stripe in test mode | `docs/superpowers/runbooks/slab-order-setup.md`; go-live checklist in memory |
| Known phone problem | Page reloads during the model pass on memory-tight phones; crash guard turns models off on that device. Decision pending: keep only the 6 MB card model on phones, make the 54 MB models opt-in there | this file, "Decisions pending" |

## In flight

- **Training, Step 13** (`training/HANDOFF-rented-gpu.md`): centering v3 on the `foil2026-train/val`
  splits, edges HR, card v1.1, rollup. Rollup is DONE (above). The rest wait on the GPU the owner is
  buying. Data for all of it is in R2 and the tables are rebuilt (`scripts/tag-dataset/samples/2026-foil-border/`).
- **Viewfinder check-in, ~2026-10-06**: ask the owner how the live outline and auto snap held up
  (heat, battery, 2.5 s). Knobs: `LIVE_INTERVAL_MS`, `AUTO_SNAP_MS` in `src/App.jsx`; revert 68547b2 if bad.
- **Rig** (`docs/RIG-PLAN.md`): PC-hosted grading station; machine-vision camera, entry tier first;
  backdrop grey/blue not orange; Phase 0 (Python inference service + parity) not started.
- **App Store readiness** (`docs/superpowers/plans/2026-10-01-app-store-readiness.md`): audit DONE
  (`docs/audits/2026-10-app-store-audit.md`, 22 Blockers = 7 problems); fix groups 3a security and 3c account+privacy DONE 2026-10-02; 3b payments core DONE; one-button AI Grade LIVE
  (Deep flow, 1 credit); accuracy measured (GRADING_SYSTEM "Paid path accuracy"): Deep 0.85 vs free 1.20, surface
  recall near zero at 2,000 px, tiled native-res surface pass IN PRODUCTION since Oct 2 (~$0.30/grade); originals no longer uploaded. Stripe web catalogue re-cut to the same three products (2026-10-02; owner creates the prices); 3d code cleanup first pass DONE 2026-10-02 (ESLint 0 errors, dist 18 GB → 5.8 MB, error boundary; App.jsx split and the transformers runtime swap deferred to 3f). 3h listing drafts + 3g UI part 1 DONE 2026-10-02 (`docs/app-store/listing.md`, /support page, estimate wording everywhere, company slab look-alikes gone). Open: 3e headers (owner's header text), 3f native shell (needs a Mac or a cloud Mac for Xcode), 3g remainder (bottom tabs, iPad, bundled fonts; the 11 px floor and inline banners are done), App Store Connect + prices + demo account + screenshots (owner), sandbox after 3f.
- **Web app**: feature-frozen for accuracy work; bug fixes only. Accuracy moves to the rig and the
  native app.

## Decisions pending (owner)

1. Phone web app: keep only the card model on phones, heavy models opt-in (stops the reloads).
2. DECIDED 2026-10-02: one paid tier "AI Grade" on the Deep flow; free keeps the software grade. Open: price points; the ~$120 Deep-path accuracy run on the 507 harness cards (owner funds it; see plan 3b).
3. Rig: camera vendor (Basler/FLIR/IDS vs Hikrobot/Daheng); GPU bought vs rented for the big runs.
4. Source-file header text (owner will specify) before the header pass in the App Store plan.

## Housekeeping owed

- DONE 2026-10-02 (fix group 3a): TAG scraper folder and the key file moved to `../SlabSense-data/` and
  ignored; TAG signing values now come from `scripts/tag-dataset/data/env.ps1`; git objects pruned
  12 GB → 137 MB. STILL OWED by the owner: rotate the Google AI and OpenAI keys that were in the
  root file; decide whether to rewrite history for the two TAG constants (public repo, force push);
  apply `supabase/migrations/20261001_lockdown.sql` AND `20261002_account_deletion.sql` in the SQL editor;
  apply `20261002_apple_iap.sql` too; add `ANTHROPIC_API_KEY` to `.env.local` for the accuracy run;
  confirm the support mailbox `support@slabsenseai.com` and the governing-law state (Indiana assumed) in
  `docs/legal/`; add `https://www.slabsenseai.com/?recovery=1` to the Supabase auth redirect allow-list.
- 118 HEIC photos on the owner's desktop still unlabelled for card-val (`npm run models:label-card-val`).
- Owner's uncommitted `scripts/tag-dataset/tagdataset/{cli,download}.py` proxy changes: they are
  what the foil pull ran on; commit them or they stay local forever.
- Root-level untracked scratch files (`CODEBASE_DOCUMENTATION.md`, `CROSS_REFERENCE.md`,
  `Mapping Defects/`, `staging/`, `scripts/*.cjs` one-offs): triage in the App Store audit.

## Where the numbers live

- Model accuracy and every training run: `training/README.md`; per-model plan: `training/MODEL-ROADMAP.md`.
- Harness results: `scripts/harness/results/` (latest: `2026-10-01-model.json`, `2026-10-01-rollup-check.md`, `2026-09-30-lugia-30th.json`, `2026-09-29-card-chain.json`).
- Dataset: `scripts/tag-dataset/README.md`, `RUNBOOK.md`, `data/dataset/stats_report.txt` (local).
- Grading sources (verbatim company rubrics): `docs/grading-research/sources/`.
