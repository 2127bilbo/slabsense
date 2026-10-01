# M. Housekeeping ledger

Read-only audit of repo layout, `git status`, ignore and history health, docs, package scripts, config and CI (2026-10-01, branch `tag-dataset`, HEAD 12f9b98).
The tree is in good shape where it ships (`src/`, `api/`, `public/`, `index.html`) and messy around it: 4,738 untracked paths (4,633 of them TAG jpgs under `scripts/Tag scraper/`, **not ignored and already staged once**: 11.97 GB of unreachable blobs sit in `.git`), five June-era root docs that contradict each other and cite files that no longer exist, no `test`/`lint` script, no CI on push, no node pin, and line-ending warnings that `.gitattributes` (Sept 15) did not stop because `core.autocrlf=true` is still set.
Counts: 1 Major (M-01), 17 Minor, 10 Note. Per-file dispositions for the untracked set are in D §5 (D-27/D-28) and are not repeated; this section adds the layout, the object store, ignore/docs/scripts/config/CI health and the first-hour hazards.

## 1. Repo layout (top level, one level down)

| Dir | Purpose | Class |
|---|---|---|
| `src/` | React 18 app: `components/`, `hooks/`, `lib/` (engine, detectors, 13 `*.test.js`), `services/`, `utils/`, `App.jsx`, `main.jsx`. 4 ignored `centercheck.com*.txt` dumps and an ignored `.claude/` sit here | ships (web build) |
| `public/` | static assets copied into `dist/`: `slab/` (label engine + `vendor/supabase.js`), `slabs/` (2 slab PNGs, 3 MB), `slabview.html`, `studio.html`, PWA manifest/icons, `card-hashes.json` (1.9 MB), `card-images/` (ignored, 18 GB, E-09) | ships |
| `index.html`, `vite.config.js`, `vercel.json` | app shell, Vite build, Vercel rewrites | ships |
| `api/` | Vercel functions: 5 handlers, `_lib/` (auth, credits, grade jobs, rollup model 1.9 MB, 6 tests), `_providers/`, `credits/`, `stripe/` | ships (serverless) |
| `config/` | `holo-config.json` (imported by `App.jsx:33`, `CollectionView.jsx:17`, so bundled); `grading-calibration.json` (unreferenced, D-28) | ships / scratch |
| `supabase/` | 13 migrations; empty `Backups/` (untracked, empty dirs are invisible to git) | infra |
| `scripts/` | tooling: `card-db/` (shard build + weekly update), `harness/` (software-grade harness + `results/`), `models/`, `storage/`, `tag-dataset/` (Python, own venv), `fixtures/`, 12 `verify-*.cjs` Playwright drivers, ~10 June one-off `.cjs/.mjs` at the root, `unused/` (ignored), `Tag scraper/` (untracked, 12.5 GB) | tooling / scratch |
| `training/` | Python `trainlib/` + `tests/`, `weights/` (run metadata tracked, `.pt/.onnx/.joblib` ignored), `eval_logs/`, `derived/` (parquet), `README.md`, `MODEL-ROADMAP.md`, two `HANDOFF-*.md`; own venv | training |
| `models/` | ignored: `.pth` checkpoints, CLIP embedding JSONs, `transformers-cache/` (the CI job caches this path) | training / tooling |
| `docs/` | 8 top-level md, `audits/`, `grading-research/` (sources + e-reader note), `superpowers/` (18 plans, 5 specs, 1 runbook), ignored `my slab/` photos and `grading-research/.claude/` | docs |
| `backend/` | Python FastAPI prototype, 15 files, last commit 2026-04-14, nothing in `src/`/`api/` calls it | scratch (tracked) |
| `backup-api/` | 3 superseded `deep-analyze*.js` copies | scratch (tracked) |
| `staging/` | June API backups, multi-AI drafts, damage-report mockup (31 tracked) + untracked `unified prompting/` | scratch (tracked) |
| `SlabSense Slab Engraving Studio/` | offline studio build (562 KB html, carved into `public/studio.html` by `scripts/split-studio.cjs`), a backup html, 9 reference jpgs, 5 doc copies; only `README-studio.md` tracked | tooling / docs / scratch |
| `Mapping Defects/`, `todo/`, `logo stuff/` | June TAG notes (untracked); Sept model progress notes; logo system md + jpeg | docs / scratch |
| `.github/` | one workflow (`card-db-update.yml`) | tooling |
| `.claude/`, `.superpowers/`, `.vercel/`, `dist/`, `node_modules/` | local tool state and outputs, all ignored | scratch |
| root files | `README.md`, `HANDOFF.md`, `CODEBASE_AUDIT.md` (tracked); `CODEBASE_DOCUMENTATION.md`, `CROSS_REFERENCE.md`, `Slabsense Gemini API-.txt` (untracked); `.env.example`, `.env.local` (ignored), `.gitattributes`, `.gitignore`, `package.json`/lock | docs / config |

## 2. `git status --short` triage (37 entries, 4,738 paths)

Disposition key: **track**, **move** (out of the repo, e.g. the dataset drive), **delete**, **ask**. Sizes are on-disk.

| Group | Paths | What (opened) | Size | Disposition |
|---|---|---|---|---|
| Owner edits | ` M scripts/tag-dataset/tagdataset/{cli,download}.py` | proxy-rotation changes the foil pull ran on (+61/−75) | 22 KB | **ask** → commit (STATUS "Housekeeping owed"); untouched by this audit |
| Root docs | `CODEBASE_DOCUMENTATION.md`, `CROSS_REFERENCE.md` | "Generated June 16 2026" descriptions of the June tree (pre-models, pre-card-DB) | 34 + 27 KB | **delete** (D §5) |
| Root secret | `Slabsense Gemini API-.txt` | live provider keys, not ignored | 290 B | rotate, **delete** (G-07, D-03) |
| Root notes | `Mapping Defects/` (2 md) | June TAG coordinate/scoring notes; differ from the tracked `staging/damage-report/tag-data/` pair | 24 KB | **delete** after folding anything new into `docs/grading-research/` (D §5) |
| Engraving Studio | `SlabSense-Engraving-Studio.html` | editable original of the live studio | 562 KB | **track** |
| | `…pre-settings-backup.html` | older copy | 433 KB | **delete** |
| | `SLABBING-PIPELINE.md`, `docs/` (5 md) | pipeline summary (2026-09-14) + Sept 13 snapshots of plans/spec/runbook that all differ from the tracked `docs/superpowers/` versions | 15 + 176 KB | **move** `SLABBING-PIPELINE.md` to `docs/`; **delete** the 5 copies (canonical ones are tracked) |
| | `Referances/` (9 jpg) | label and empty-slab reference photos | 768 KB | **move** to `docs/engraving/refs/` and track, or out |
| API | `api/_lib/replicate-utils.js` | duplicate `pollForResult` | 2 KB | **delete** (D-11, G-24) |
| Audit | `docs/audits/` | this audit | 321 KB | **track** |
| scripts/ scraper | `scripts/Tag scraper/` | June scraper: `dig info/` 12 GB (4,633 TAG jpgs), `Slabs/` 200 MB, `validation_test/` 27 MB, `tag_cache.json` 8 MB, 9 `.cjs`, `tag_proxy.py` with secrets | 12.5 GB, 4,665 files | **move** out of the repo (dataset drive / R2), then ignore the path (M-01, H-05, H-24) |
| scripts/ one-offs | `analyze_tag_calibration.cjs` (v1 of tracked `_v2`), `check_card_types.cjs`, `check_centering_format.cjs`, `get_references.cjs` (read `.env.local` against `graded_references`), `certs.txt` (98 cert ids), `tag_scraper.py` (byte-identical to the scraper copy), `test_deep_analyze_v3.js` + `deep_analyze_v3_test_results.json` (8/8 errors: auth failure), `upload_graded_references.js` (ESM twin of tracked `.cjs`) | June scratch | 70 KB | **delete** (D-27) |
| scripts/ proxy tests | `scripts/tag-dataset/test_proxy_single.py`, `test_proxy_speed.py`, `test_quick.py` | proxy-rate probes written with the owner's uncommitted changes | 9 KB | **ask** (go with the cli/download commit as `tools/`, or out) |
| harness | `scripts/harness/results/2026-09-17-model.json` | a result like its 29 tracked siblings (README: "Results are committed") | 17 KB | **track** |
| staging | `staging/damage-report/mockup/coordinate-test.html` | June mockup | 12 KB | **delete** |
| | `staging/unified prompting/` (5 md + 5 js/json) | June engine-wiring docs and API drafts; `ENGINE_WIRING.md` is cited by `softwareGrade.js:171` | 144 KB | **move** the 5 md to `docs/grading-research/archive/`, **delete** the code (D-28) |
| training | `eval_logs/task4/` (`.log` ignored, 5 `.pid` not) | rented-GPU run logs | 27 KB | **delete**; ignore `training/eval_logs/task4/` |
| | `tools_make_backgrounds.py` | background generator for the card compositor | 20 KB | **track** + one line in `training/README.md` |
| | `weights/card/v1/*.{json,csv}`, `weights/centering_rgb/v1/eval_val*.csv`, `weights/centering_rgb/v2b/*.{json,csv}` (`.pt` 12.7 MB and 112 MB ignored) | run records of the two live models; every older model's records are tracked | 60 KB | **track** |
| | `weights/onnx/{card-v1,centering_rgb-v2b}.json` + `.parity.json` | export manifests of the production models | 6 KB | **track** (D-04) |
| | `weights/surface/smoke/deduction_val.csv` (`.joblib` ignored) | rejected smoke run | <1 KB | **delete** |

## 3. gitignore and history health

- **Ignore misses.** `*-API-.txt` and `api/Slabsense Gemini API-.txt` do not match the root file (G-07). `scripts/Tag scraper/` is not ignored at all; `*.log` hides the task4 logs but not their `.pid` files, so the folder still shows as untracked.
- **Ignore entries that document scratch living inside the repo:** `scripts/unused/`, `docs/my slab/`, `scripts/out-*.png`, `scripts/studio-app.extracted.js`, `src/*.txt`, `src/App1.jsx`, `src/Old revs/`, `.claude/` (three `settings.local.json` copies: root, `src/`, `docs/grading-research/`). Move them out rather than ignoring them.
- **Ignored but referenced by docs as if present:** `public/models/clip_embeddings_*` is cited by `docs/TECHNICAL_REFERENCE.md:479,751,797,805` and `HANDOFF.md:410,457`; those files were deleted from the tree (the card DB is bucket-served) and only survive as 430 MB of history. `training/runs/` (13 citations) is correctly described as local/R2.
- **Tracked generated files:** `scripts/harness/results/` 29 files, 9.9 MB in tree, 9.4 MB of history; eight full-run JSONs are 740–853 KB each (`2026-09-14-*`, `2026-10-01-rollup-check.json`). Policy (`scripts/harness/README.md:19`) is "results are committed", so this is by design; the `.md` twins carry the numbers. `api/_lib/models/grade-rollup-v1.json` 1.9 MB (deploys with the API, fine). `scripts/tag-dataset/samples/2026-foil-border/popreport-2026-sir.json` 2.4 MB sample. `public/card-hashes.json` 1.9 MB (H-09).
- **Largest objects in history** (`git rev-list --objects --all | git cat-file --batch-check | sort -k3 -nr | head -15`): ten blobs of `public/models/clip_embeddings_{0..4}.json` at 45–52 MB each (431 MB total, no longer in the tree), then `popreport-2026-sir.json` 2.2 MB, `public/card-hashes.json` 2.0 MB, `grade-rollup-v1.json` 1.7 MB, `public/slabs/slabsense-{back,front}.png` 1.6/1.4 MB. By path: `public/models` 431 MB, `src/App.jsx` 20 MB (3,487 lines rewritten often), `scripts/harness` 9.4 MB, everything else under 5 MB. Every clone pulls ~500 MB.
- **Object store:** `git count-objects -v` = 9,009 loose objects, **0 packs**, 12.04 GiB, 1 garbage `tmp_obj`. Only 4,257 objects are reachable; `git fsck --unreachable --no-reflogs` finds 4,719 blobs = **11.97 GB**, i.e. the 4,633 scraper jpgs were staged once and unstaged. `git gc --prune=now` would take `.git` from 13 GB to under 1 GB; auto-gc has evidently never run (gc.auto unset, Windows detached gc).
- **Line endings:** `.gitattributes` (`* text=auto` + binary list, added 2026-09-15 24a2175) normalised the index (0 `i/crlf`), but `core.autocrlf=true` remains, so the working tree is 278 CRLF / 226 LF / 2 mixed (`src/lib/clip-matcher.js`, `src/lib/id-rerank.js`), and every `git add` of an LF file prints "LF will be replaced by CRLF".

## 4. Docs health and canonical set

| File | Last commit | Summary | State |
|---|---|---|---|
| `README.md` | 2026-04-12 | v0.2.0-beta (package.json says 0.1.0-beta); layout cites `api/ai-analyze.js`, `api/detect-card.js` (gone); "License: MIT" (H-01); Stripe "Planned"; points to HANDOFF | stale, keep and rewrite |
| `HANDOFF.md` | 2026-06-17 | June session log; cites `docs/Masterweights.md`, `src/lib/masterweights.js`, `src/lib/tag-calibration.js` (none exist) | stale → delete (D-28) |
| `CODEBASE_AUDIT.md` | 2026-06-09 | June function inventory | stale → delete; superseded by part D |
| `CODEBASE_DOCUMENTATION.md`, `CROSS_REFERENCE.md` | untracked, 2026-06-16 | generated June descriptions | duplicate of the above → delete |
| `docs/STATUS.md` | 2026-10-01 | where everything stands | current, canonical entry point |
| `docs/GRADING_SYSTEM.md` | 2026-10-01 | the one grading doc | current |
| `docs/RIG-PLAN.md` | 2026-10-01 | rig / own-models plan | current |
| `docs/TECHNICAL_REFERENCE.md` | 2026-04-16 | v0.1.0 architecture; CLIP in `public/models`, Replicate troubleshooting | stale → delete or rewrite as `docs/ARCHITECTURE.md` from parts C/D/F |
| `docs/PAYMENT_PLAN.md` | 2026-06-09 | Stripe game plan | superseded by part B + Phase 3b → `docs/archive/` |
| `docs/DISCLAIMERS.md`, `PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md` | 2026-04-06 | legal text, rendered by `App.jsx` | content owned by F/K; keep, revise there |
| `docs/grading-research/**` (7) | Sept | verbatim company sources + e-reader note | current |
| `docs/superpowers/plans|specs|runbooks` (24) | Sept–Oct | dated plans/specs; `2026-09-15-codebase-sweep.md` records the `.gitattributes` fix | current (immutable history) |
| `docs/audits/parts/*` (13) | Oct 1 | this audit | current |
| `training/README.md`, `MODEL-ROADMAP.md`, `HANDOFF-*.md` (4) | Sept 28–Oct 1 | model results, roadmap, GPU runbooks | current |
| `scripts/{harness,card-db,tag-dataset}/README.md`, `tag-dataset/RUNBOOK.md` | Sept | tool docs | current |
| `scripts/deep-analyze-v3-validation-report.md` | 2026-06-10 | validation of a dead endpoint | delete with `backup-api/` |
| `backend/README.md` | 2026-04-14 | abandoned FastAPI backend | delete with `backend/` |
| `todo/progress-checklist.md`, `todo/centering-and-crop-models.md` | Sept 28 / 17 | model progress snapshot; deferred-model notes | fold into `training/README.md` / STATUS, delete `todo/` |
| `logo stuff/SlabSense-Holographic-Logo-System.md` | 2026-06-04 | logo system | move to `docs/design/` |
| `SlabSense Slab Engraving Studio/README-studio.md`, `SLABBING-PIPELINE.md` | Sept 14 | studio and pipeline notes | move to `docs/engraving/` |
| `staging/**/*.md` (5 tracked + 5 untracked), `Mapping Defects/*.md` | June | TAG notes, engine wiring, damage-report plan | `docs/grading-research/archive/` or delete |

**Proposed canonical set:** `README.md` (rewritten: what it is, branches, how to run web + API, where the docs are) → `docs/STATUS.md` → `docs/GRADING_SYSTEM.md`, `docs/RIG-PLAN.md`, `docs/ARCHITECTURE.md` (new, replaces TECHNICAL_REFERENCE/HANDOFF/CODEBASE_*), legal three, `docs/grading-research/`, `docs/superpowers/`, `docs/audits/`, `docs/engraving/`, `docs/design/`, `docs/archive/`; plus `training/README.md` and the three `scripts/*/README.md`. Everything else in the table goes.

## 5. package.json scripts

- 14 scripts; every referenced file exists; all 19 `test:lib` files exist and are the only `*.test.js` in the tree (nothing orphaned from the chain).
- Missing: `test` (`npm test` errors), `lint` (E-06), `format`. `test:lib` is a 19-way `&&` chain, so the first failing file hides the rest; `node --test "src/lib/*.test.js" "api/_lib/*.test.js"` would run them all with one reporter.
- Scripts under `scripts/` with no package entry: the 12 `verify-*.cjs` Playwright drivers (documented only inside the Sept plans), `split-studio.cjs`, `plate-measure.cjs` + `plate-windows.json`, and the CLIP-era `build-hash-db.cjs`, `generate-transformers-embeddings.mjs`, `split-embeddings.cjs`, plus June `check_supabase.cjs`, `analyze_tag_calibration_v2.cjs`, `upload_graded_references.cjs` (D-28 lists them). Either give the live ones a `verify:*` entry or move them under `scripts/drivers/` with a README.
- `version` 0.1.0-beta vs README v0.2.0-beta; no `engines`, no `license` (H-01), `description` current.

## 6. Config files

- `vite.config.js`: React plugin, dev proxy for `/tcgdex-img`, `sourcemap: false`, no `manualChunks` (J-21). Fine.
- `vercel.json`: rewrites only (slab/studio/queue/tcgdex/SPA); no `headers`, no `functions` block (security headers are G's; function limits are J's).
- ESLint: none (E-06). Prettier: none. `.editorconfig`: none.
- `.gitattributes`: present (`* text=auto` + binaries) but no `eol=`; with `core.autocrlf=true` the warnings continue (§3). Fix: `* text=auto eol=lf`, add `.editorconfig` (`end_of_line = lf`, `insert_final_newline = true`, `indent_style = space`, `indent_size = 2`), `git config core.autocrlf false`, then `git add --renormalize .` once.
- Node: no `.nvmrc`, no `engines`; CI uses 22, local is v24.13.0, Vercel picks its default. Pin `"engines": {"node": ">=22"}` + `.nvmrc` `22`.
- `.env.example` lists 2 of the 23 `process.env.*` names the code reads (Supabase service role, Anthropic/OpenAI/Google/xAI/Replicate keys, 11 `STRIPE_*`, `SURFACE_DEDUCTION_MODEL`, `VITE_APP_URL`); nothing says how to run `api/` locally (`vercel dev` appears only inside one plan).
- Three Python environments (`training/pyproject.toml`, `scripts/tag-dataset/pyproject.toml`, `backend/requirements.txt`), each with its own `.venv`.

## 7. CI

- One workflow, `.github/workflows/card-db-update.yml`: weekly cron + dispatch, Node 22, actions v5, `npm ci`, card-DB update then a 7-day cleanup of grade uploads; needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets. No workflow runs on push or pull request, so `main` (which auto-deploys the web app) has never had a green check.
- Minimal `ci.yml` to add: `on: [push, pull_request]` → `actions/checkout@v5`, `actions/setup-node@v5` (node 22, `cache: npm`), `npm ci`, `npm run test:lib`, `npm run build` (no secrets needed; `VITE_SUPABASE_*` are read at runtime). Add `npm run lint` when E-06 lands, and upload `dist/` size as an artifact so J can watch the chunks. Make it a required check on `main`.

## 8. First-hour trip hazards (new engineer)

1. The clone is 13 GB (12 GB of it unreachable blobs) and `git status` lists 4,738 untracked paths; `git add .` or `git commit -a` would stage 12.5 GB of TAG jpgs and a live-key file in a public repo (`github.com/2127bilbo/slabsense`).
2. `README.md` describes the April app (wrong endpoints, wrong licence, Stripe "Planned", v0.2.0) and sends you to `HANDOFF.md`, which cites three files that do not exist; the real entry point is `docs/STATUS.md`.
3. `npm run dev` gives a UI whose grading, credits and slab calls 404: `api/` only runs under `vercel dev`, and `.env.example` names 2 of 23 variables.
4. `npm test` fails (the script is `test:lib`); nothing lints.
5. `vite build` writes an 18 GB `dist/` because `public/card-images/` is copied (E-09).
6. Work lands on `tag-dataset` while `main` deploys; two stale remote branches (`card-db-shards`, `centering-zoom-loupe`) are already merged.
7. Five directories have spaces in their names (`Mapping Defects`, `SlabSense Slab Engraving Studio`, `scripts/Tag scraper`, `logo stuff`, `docs/my slab`); unquoted shell commands and glob patterns break on them.
8. Three Python venvs and two Node runtimes (22 in CI, 24 locally) with nothing pinning either.
9. Every `git add` prints LF/CRLF warnings and two files are mixed-EOL in the working tree.

## 9. Findings

M-01 | **Major** | `.gitignore`; `scripts/Tag scraper/` (12.5 GB, 4,633 TAG jpgs, `tag_proxy.py` secrets); `.git/objects` | Accidental publication; 5.2.1 (TAG's images) | Folder is untracked and not ignored; `git fsck --unreachable` shows 4,719 blobs / 11.97 GB, so it has already been staged once. One `git add .` from pushing it to the public remote. Sharpens H-24 (Minor there). | Move the folder to the dataset drive (R2 per training README), add `scripts/Tag scraper/` and `**/dig info/` to `.gitignore`, then `git gc --prune=now`
M-02 | Minor | `.git` (9,009 loose objects, 0 packs, 12.04 GiB, 1 garbage tmp_obj) | Repo hygiene | Auto-gc has never packed the repo; the working clone is 13 GB for ~500 MB of reachable content | `git gc --prune=now` after M-01; set `gc.auto` default (unset today); check `.git` size drops under 1 GB
M-03 | Minor | history: `public/models/clip_embeddings_{0..4}.json` ×2 generations, 431 MB | Clone cost | Deleted from the tree, still in every clone; the data is bucket-served now | Accept, or rewrite history once (git filter-repo) before the repo gets more collaborators; decide with H-09
M-04 | Minor | `.gitattributes:2`, `core.autocrlf=true`, `src/lib/{clip-matcher,id-rerank}.js` (mixed EOL) | Consistency; the owner's "LF/CRLF warning on every commit" | Index is LF, working tree 278 CRLF / 226 LF / 2 mixed; attributes lack `eol=` | `* text=auto eol=lf`, `.editorconfig`, `git config core.autocrlf false`, `git add --renormalize .`
M-05 | Minor | `.gitignore:69-71` (`api/Slabsense Gemini API-.txt`, `*-API-.txt`) | Secrets hygiene | Neither pattern matches the root file (space before `API`) | Covered by G-07/D-03; after rotation add `*API-.txt` and `*.key.txt`
M-06 | Minor | `.gitignore` (`*.log` only), `training/eval_logs/task4/*.pid` | Ignore completeness | Run dir shows as untracked because the `.pid` files escape `*.log` | Ignore `training/eval_logs/task4/` (or `**/*.pid`); keep the dated CSVs tracked
M-07 | Minor | `README.md:1,120-145,195-201` | 2.3 accuracy of metadata (our own); onboarding | Version, layout, endpoints, licence and status are April-era; cites HANDOFF | Rewrite to the canonical set in §4 (what, branches, run web + `vercel dev`, env list, where docs are)
M-08 | Minor | `HANDOFF.md:803-806` (cites `docs/Masterweights.md`, `src/lib/masterweights.js`, `src/lib/tag-calibration.js`, none exist), `CODEBASE_AUDIT.md` | Stale docs | June session log and inventory contradict STATUS and part D | Delete both (D-28); nothing links to them except README
M-09 | Minor | `docs/TECHNICAL_REFERENCE.md:479,751,797,805`; `HANDOFF.md:410,457` | Stale docs | Describe CLIP embeddings under `public/models/` and Replicate troubleshooting; both gone | Replace with `docs/ARCHITECTURE.md` written from parts C/D/F after Phase 3; delete the old file
M-10 | Minor | `SlabSense Slab Engraving Studio/docs/*.md` (5, untracked) vs `docs/superpowers/{plans,specs,runbooks}` | Duplicate docs | All five differ from the tracked versions (Sept 13 snapshots) | Delete the copies; move `SLABBING-PIPELINE.md` and `README-studio.md` to `docs/engraving/`
M-11 | Minor | `Mapping Defects/*.md` vs `staging/damage-report/tag-data/*.md`; `staging/unified prompting/*.md` | Duplicate docs | Two diverging copies of the TAG coordinate/scoring notes; five June engine docs, one cited by `softwareGrade.js:171` | One archive copy each under `docs/grading-research/archive/`; delete the rest (D-28)
M-12 | Minor | `package.json` scripts | Test/lint entry points | No `test`, no `lint`; `test:lib` is a 19-way `&&` chain | Add `"test": "node --test src/lib/*.test.js api/_lib/*.test.js"`, `lint` (E-06), keep `test:lib` as alias
M-13 | Minor | `package.json` (no `engines`), no `.nvmrc`; CI node 22, local v24.13.0 | Reproducibility | Nothing pins Node; Vercel and CI can drift from local | `"engines": {"node": ">=22 <25"}`, `.nvmrc` = `22`, `engine-strict` in `.npmrc`
M-14 | Minor | `.github/workflows/` (only `card-db-update.yml`) | Release safety; 2.1 | No build or test runs on push/PR to the auto-deploying `main` | Add `ci.yml` (§7): `npm ci`, `test:lib`, `build`; required check on `main`
M-15 | Minor | `.env.example` (2 of 23 names) | Onboarding | API cannot be run locally from the docs; key list lives only in Vercel | List every name with a comment (no values) grouped by web / API / scripts; add a "Run the API locally" paragraph (`vercel dev`) to README
M-16 | Minor | `scripts/verify-*.cjs` (12), `split-studio.cjs`, `plate-measure.cjs`, `build-hash-db.cjs`, `generate-transformers-embeddings.mjs`, `split-embeddings.cjs`, `check_supabase.cjs`, `analyze_tag_calibration_v2.cjs`, `upload_graded_references.cjs` | Orphaned tooling | No package entry or README; three are CLIP-era (replaced by `scripts/card-db/`), four are June one-offs | Move live drivers to `scripts/drivers/` + README and `verify:*` entries; delete the CLIP-era and June scripts (D-28)
M-17 | Minor | `backend/` (15 files, 2026-04-14), `backup-api/`, `staging/` (31), `config/grading-calibration.json`, `todo/`, `logo stuff/` | Tracked scratch | Six tracked directories/files no shipped code imports (`config/holo-config.json` is the one `config/` file that is) | Delete or move per §1/§4 (D-28); keep `config/holo-config.json`
M-18 | Minor | directory names with spaces: `Mapping Defects`, `SlabSense Slab Engraving Studio`, `scripts/Tag scraper`, `logo stuff`, `docs/my slab` | Tooling friction | Break unquoted shell, globs and ignore patterns; three are scratch anyway | Rename survivors to kebab-case (`docs/engraving/`), remove the rest
M-19 | Note | `scripts/harness/results/` (29 tracked, 9.9 MB; eight JSONs at 740–853 KB) | Repo growth | By policy ("results are committed"); each full run adds ~850 KB | Keep; consider committing only `.md` + a gzipped JSON once the harness is stable
M-20 | Note | `scripts/harness/results/2026-09-17-model.json` (untracked) | Policy consistency | The one result not committed | `git add` (D §5)
M-21 | Note | `.claude/settings.local.json` ×3 (root, `src/`, `docs/grading-research/`), `.superpowers/`, `.vercel/` | Local state | All ignored; the two nested `.claude/` dirs are accidental | Delete the two nested copies
M-22 | Note | `supabase/Backups/` (empty), `scripts/card-db/out/` (ignored) | Empty/output dirs | Empty dir is invisible to git; harmless | Delete `Backups/` or put a README in it
M-23 | Note | `vercel.json` | Config | Rewrites only; `/v/:cert` and `/V/:cert` both mapped | None; headers/function limits belong to G/J
M-24 | Note | `vite.config.js` | Config | Minimal; `sourcemap: false` means production stack traces are unreadable | Consider `sourcemap: 'hidden'` + upload to the error tracker J proposes
M-25 | Note | remote branches `card-db-shards`, `centering-zoom-loupe` | Branch hygiene | Both merged (features live on main per STATUS) | Delete on origin
M-26 | Note | `package.json:version` 0.1.0-beta vs `README.md:1` v0.2.0-beta | Metadata | Two versions | Bump package.json to the App Store version scheme once K settles it
M-27 | Note | `training/pyproject.toml`, `scripts/tag-dataset/pyproject.toml`, `backend/requirements.txt` | Python env sprawl | Three environments; `backend/` goes with M-17 | Leave the two live ones; document both venvs in README §run
M-28 | Note | `docs/superpowers/plans/2026-09-15-codebase-sweep.md:14` | History | Records the `.gitattributes` fix as done; the warnings persisted because `core.autocrlf` was not changed | Reference from M-04's fix so the sweep note is corrected
