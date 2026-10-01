# H. Intellectual property

Summary: no GPL/AGPL/SSPL code in the tree and all 201 npm packages are permissive, but our own code is unprotected (public GitHub repo, no LICENSE, no headers, README says "MIT" while the Terms say "proprietary"); the installed-app manifest still calls the product "TAG Pre-Grader" and the 3D viewer draws PSA/BECKETT/CGC/SGC/TAG look-alike slab labels.
The models ship no TAG pixels, but 27,751 TAG DIG reports were pulled through TAG's app-private, key-encrypted API with the "check TAG's terms" item still open in the spec, and one TAG image is committed to the public repo; Pokémon artwork from TCGdex is shown full-size in the slab viewer and stored on scan records.
Findings: 0 Blocker, 6 Major (H-01, H-02, H-03, H-04, H-05, H-08), 11 Minor, 8 Note. Audit date 2026-10-01, branch `tag-dataset`, read-only.

## 1. Third-party code and assets

### 1a. npm dependencies (direct; `node_modules/*/package.json` "license")

| Package | Version | Licence | Scope | Note |
|---|---|---|---|---|
| @anthropic-ai/sdk | 0.52.0 | MIT | prod (api) | |
| @google/generative-ai | 0.24.1 | Apache-2.0 | prod (api) | |
| @supabase/supabase-js | 2.101.1 | MIT | prod | also vendored as `public/slab/vendor/supabase.js` (no header) |
| @tcgdex/sdk | 2.7.1 | MIT | prod | API client only; card art is not TCGdex's to license |
| heic2any | 0.0.4 | MIT | prod | embeds **libheif (LGPL-3.0)** in `dist/heic2any.js`; only importer `src/lib/image-converter.js:48`, which nothing imports (H-15) |
| html2canvas | 1.4.1 | MIT | prod | |
| openai | 6.42.0 | Apache-2.0 | prod (api) | |
| react, react-dom | 18.3.1 | MIT | prod | |
| stripe | 22.2.0 | MIT | prod (api) | |
| tesseract.js | 7.0.0 | Apache-2.0 | prod | worker/core/`eng.traineddata` (Apache-2.0) fetched from its CDN at runtime |
| @vitejs/plugin-react, vite | 4.7.0 / 6.4.2 | MIT | dev | |
| @xenova/transformers | 2.17.2 | Apache-2.0 | dev, but dynamically imported in `src/lib/clip-matcher.js:93`; loads `Xenova/clip-vit-base-patch32` (OpenAI CLIP, MIT) from the HF hub |
| canvas, pngjs | 3.2.3 / 7.0.0 | MIT | dev (scripts) | |
| heic-convert | 2.1.0 | ISC | dev (scripts) | → heic-decode (ISC) → **libheif-js 1.23.2 LGPL-3.0** (never shipped) |
| jsqr | 1.4.0 | Apache-2.0 | dev | |
| onnxruntime-web | 1.30.0 | MIT | dev; runtime loaded from the `models` bucket (`src/services/cornerEdgeModels.js:184-194`), wasm copied to `${MODELS_BASE}/ort/` |

All 201 installed packages: MIT 140, Apache-2.0 25, BSD-3 15, ISC 14, BSD-2 1, 0BSD 1, CC-BY-4.0 1 (caniuse-lite data), plus four flagged: `libheif-js` LGPL-3.0 (dev chain), `expand-template` (MIT OR WTFPL, dev chain of `canvas`), `rc` (BSD-2 OR MIT OR Apache-2.0), `flatbuffers@1.12.0` "SEE LICENSE IN LICENSE.txt" (the file is Apache-2.0). No GPL, AGPL, SSPL, or unknown licence anywhere.

### 1b. Vendored and inlined code (not from npm)

| File | Library | Licence | Notice present |
|---|---|---|---|
| `public/slab/vendor/opentype.js` | opentype.js 1.3.4 | MIT | one-line header only |
| `public/slab/vendor/polygon-clipping.js` | polygon-clipping 0.15.7 | MIT | one-line header only |
| `public/slab/vendor/qrcode.js` | qrcode-generator 1.4.4 (Kazuhiko Arase) | MIT; "QR Code" is a DENSO WAVE trademark (notice kept at `SlabSense-Engraving-Studio.html:294`) | header |
| `public/slab/vendor/supabase.js` | supabase-js UMD | MIT | **none** |
| `SlabSense Slab Engraving Studio/SlabSense-Engraving-Studio.html` (+ `.pre-settings-backup.html`) | qrcode-generator (~line 280-2530), opentype.js (line 2583) inlined | MIT | partial |
| `src/lib/id-rerank.js:3` | "Ported from scripts/harness/identify.mjs" | ours | n/a |

No StackOverflow/gist/"adapted from" attributions found in `src/`, `api/`, `scripts/`, `training/` (grep); no third-party icon set (no lucide/fontawesome/heroicons dependency).

### 1c. Fonts

| Font | Where | Licence | Issue |
|---|---|---|---|
| Inter, JetBrains Mono | `<link>` to fonts.googleapis.com, `src/App.jsx:3485` | SIL OFL 1.1 | runtime fetch (privacy/offline: sections F, J); no copy needed |
| Barlow Condensed (Regular/SemiBold/Bold), Michroma | base64 in `public/slab/fonts.js` (`FONT_B64`), used by label engine and cert page | SIL OFL 1.1 | OFL text must accompany redistributed font files; none in repo (H-18) |
| ui-monospace/Menlo/Arial system stacks | CSS | n/a | |

### 1d. Models and weights

| Asset | Base | Base licence | Trained on | Shipped |
|---|---|---|---|---|
| corners-v3-phone, edges-v2-phone, centering_rgb-v2b | timm `convnext_tiny`, `pretrained=True` (`training/trainlib/models.py:20`) | timm weights Apache-2.0 (ImageNet-1k/12k pretrain) | TAG DIG images | yes, `models` bucket, fp16 ONNX |
| card-v1 | timm `mobilenetv3_large_100` U-Net (`training/trainlib/card_model.py:27`) | Apache-2.0 | TAG images + owner backgrounds | yes |
| deduction regressor | gradient-boosted trees, `api/_lib/surfaceDeduction.js:7` "trained on 20,757 of TAG's own" boxes | ours | TAG ding JSON | yes (paid paths, server) |
| grade rollup v1 | boosted trees | ours | TAG subgrades | wired, off |
| surface detector v1/v3 | torchvision `fasterrcnn_resnet50_fpn_v2`, COCO weights (`trainlib/detector.py:19`) | BSD-3 (torchvision); COCO annotations CC-BY-4.0 | TAG | no (rejected) |
| Ultralytics YOLO | deliberately avoided: AGPL-3.0 (`training/README.md:586-592`) | | | no |
| CLIP embeddings (`models/`, root, gitignored, 221 MB) | Xenova CLIP over TCGdex art | MIT model | Pokémon art | legacy, not deployed |

ImageNet: the dataset's own terms are non-commercial research; shipping weights fine-tuned from ImageNet-pretrained backbones is universal industry practice and timm licenses its weights Apache-2.0, but the point is unsettled law. Record, do not rely on silence.

## 2. Third-party content shown in the app

**Pokémon card names and artwork.** Owners: The Pokémon Company / Nintendo / Creatures / GAME FREAK (artwork, names). Source: TCGdex (`src/services/tcgdex.js`, `scripts/card-db/tcgdex.mjs:6` `high.png`), served same-origin through `/tcgdex-img` → `assets.tcgdex.net` (`vercel.json:32`, `vite.config.js:11`). Uses: (a) identification candidates (OCR + pixel re-rank over the bucket card DB v9, which holds names, set names and image hashes, not pixels); (b) the identified card's `imageHigh` as the front image of the 3D slab viewer (`src/App.jsx:2413-2419`); (c) the URL persisted on the scan record (`App.jsx:2053 tcgdexImage`); (d) cardmarket pricing from TCGdex (`App.jsx:2774-2777`). Local-only: `public/card-images/` 22,141 PNGs, 18 GB (gitignored, not deployed); `public/card-hashes.json` (tracked, names + hashes, still fetched by legacy `card-matcher.js:102` / `clip-matcher.js:141`). Position: (a) is nominative/identification use comparable to price guides and the TCGdex/pokemontcg.io sites themselves; (b) is decorative use of full-resolution artwork and is the exposure (H-08).

**Grading companies.** Names PSA, BGS/Beckett, CGC, SGC, TAG appear in 9-31 files each in `src/`+`api/` as conversion targets (`src/lib/gradingEngine.js:355-398`, `convertToCompany` :589) — nominative, descriptive use. Rubric text in app code is limited to grade labels ("Gem Mint", "Pristine (Black Label)", "NM-MT", `gradingEngine.js:389-396,484,583`); the verbatim scales exist only in `docs/grading-research/sources/*_verbatim.md` (tracked, public repo). No company logo files exist (`find` for psa/bgs/cgc/sgc/logo → only SlabSense's own); but `RealisticSlab.jsx` paints brand-coloured labels with the company wordmarks (H-04). TAG's internal term "DINGS" (from its API `dingsJSON`; not on TAG's public scale/rubric pages) is the product's own vocabulary throughout the UI (H-11).

**"Not affiliated" disclaimer.** Exists: one-time modal `src/App.jsx:2631-2641` (gated by `localStorage slabsense_disclaimer_acknowledged`, :1526-1528), footer `App.jsx:3484` ("Not affiliated with TAG" only), export card `ExportCard.jsx:250`, `index.html` meta description, `docs/DISCLAIMERS.md`, `docs/TERMS_OF_SERVICE.md:73-77`. Missing from: grade result and company-conversion views, the public cert page `/v/<cert>` (`public/slabview.html`), the slab label, App Store metadata; `docs/DISCLAIMERS.md` and the Terms are not linked from the app (`AuthModal.jsx:240` names them without a link) (H-12).

## 3. Data provenance: the TAG DIG dataset

- What was taken: 27,751 certs (`scripts/tag-dataset/README.md:145-146`), every per-card image plus the raw `detail` and `score` JSON, stored in R2; 13 GB / 4,633 jpgs of an earlier pull still under `scripts/Tag scraper/` (untracked).
- How: "Two authenticated GET calls per cert, both AES-encrypted with the keys already in `scripts/Tag scraper/tag_proxy.py`" (`docs/superpowers/specs/2026-09-12-tag-grading-models-design.md:40`). That is TAG's app-private API, not a public image URL; the signing secret and AES key are hardcoded (STATUS "Housekeeping owed"; section G).
- Terms: the only statement in the repo is the open item "TAG terms of use for bulk access: the user to check before step 1 runs at full scale" (spec :183). No record that it was checked, no copy of TAG's terms, no correspondence, no robots/ToS capture. `README.md` and `RUNBOOK.md` document only rate-limit etiquette (README :42-60).
- Honest position: the shipped models contain no TAG images and are not substitutes for TAG's reports; training on lawfully accessible public report images is the norm the industry currently defends, and Apple's review does not look at training data. The exposure is contractual/anti-circumvention (keys extracted from TAG's client, bulk access, redistribution of copies: the committed fixture H-06, reference images sent to Anthropic H-07, the R2 bucket), plus the product's visible dependence on TAG ("TAG Pre-Grader", "DINGS", "TAG reference cards used"). Recorded as H-05; the fix is an owner/legal decision, not code.

## 4. Our own protection

- No `LICENSE`, `NOTICE` or `COPYING` file at the root. `package.json` has `"private": true` and **no `license` field**. `README.md:195-197` says `## License` / `MIT`. `docs/TERMS_OF_SERVICE.md:66-67` says "Our algorithms, code ... are proprietary". GitHub `2127bilbo/slabsense` is **public** (`api.github.com`: `"private": false, "license": null`).
- No copyright notice or header on any source file (sampled `src/App.jsx:1`, `src/lib/gradingEngine.js:1`, `api/_lib/auth.js:1`, `scripts/tag-dataset/tagdataset/cli.py:1`, `training/export_onnx.py:1`, `index.html:1`, `src/main.jsx:1`, `vite.config.js:1`; grep for "copyright|©|SPDX" in text files → 0 hits outside `api/card-info-unified.js:282` which is a JSON key).
- "Ours" (file counts excluding `.venv`/`node_modules`): `src/` 86, `api/` 37, `scripts/` 193, `training/` 260, `docs/` 44, `backend/` 12, `supabase/` 13, `backup-api/` 3, `public/` 13 (less `slab/vendor/`, `slab/fonts.js`), Engraving Studio 9 (less the inlined libs), `staging/` 31 tracked, `config/`, `index.html`, `vite.config.js`, `vercel.json`, `training/weights/` (derived). Not ours: `node_modules/`, `public/slab/vendor/*`, `public/slab/fonts.js` payload, inlined libs in the studio HTML, both `.venv`s, `public/card-hashes.json` data, `docs/grading-research/sources/` text, `src/lib/__fixtures__/*.jpg`, `src/centercheck.com data.txt`.

**Proposed header rules** (text to be supplied by the owner; `<HEADER>` = owner's wording, e.g. "Copyright (c) 2026 <owner>. All rights reserved. SPDX-License-Identifier: LicenseRef-SlabSense-Proprietary"):

| Files | Placement | Form |
|---|---|---|
| `*.js *.jsx *.mjs *.cjs` (src, api, scripts, backend, public/slab/*.js except vendor) | line 1, before imports; after an existing `/** file — purpose */` block, merge into it | `/* <HEADER> */` |
| `*.py` (training, scripts/tag-dataset, backend) | line 1, or line 2 after a `#!`/encoding line, before the module docstring | `# <HEADER>` |
| `*.html` (index.html, public/*.html, studio) | immediately after `<!DOCTYPE html>` | `<!-- <HEADER> -->` |
| `*.css` | line 1 | `/* <HEADER> */` |
| `*.md` (docs) | footer line, not header (keeps the H1 first) | `_<HEADER>_` |
| `*.sql` (supabase) | line 1 | `-- <HEADER>` |
| `*.json`, `*.toml`, `*.onnx`, images | none (no comments); covered by LICENSE | |
| `public/slab/vendor/*`, `public/slab/fonts.js`, inlined libs, `.venv`, `node_modules` | never | upstream notices stay |

**NOTICE file structure** (`NOTICE.md` at root, mirrored in an in-app "Open-source licences" screen): 1. SlabSense copyright line + licence pointer. 2. Bundled JavaScript (every prod dependency with licence and copyright line from its `LICENSE`). 3. Runtime-loaded (onnxruntime-web MIT, tesseract.js + tessdata Apache-2.0, Xenova CLIP MIT, @xenova/transformers Apache-2.0). 4. Vendored files (section 1b, full MIT texts). 5. Fonts (OFL 1.1 full text for Barlow Condensed and Michroma; Inter/JetBrains Mono noted as Google Fonts). 6. Model initialisations (timm Apache-2.0; torchvision BSD-3) and the training-data statement the owner approves. 7. Trademarks paragraph (corrected `docs/DISCLAIMERS.md` text) and the Pokémon artwork attribution. 8. "QR Code is a registered trademark of DENSO WAVE INCORPORATED".

## 5. Trademarks

- "SlabSense": used plainly, no ™/® anywhere, no filing recorded in the repo; domain slabsenseai.com; own logo system (`logo stuff/`, `src/components/HoloLogo/`, `public/slabsense-logo.png`, icons). The PWA manifest does not use it (H-03).
- Engraving Studio / cert page: own wordmark, flourishes and "S" badge (`public/slab/label.js:17-18,197`), QR to `slabsenseai.com/v/<cert>`; grade words GEM MINT / PRISTINE / MINT / ... are generic. No PSA/BGS/CGC/SGC/TAG trade-dress look-alike found in `label.js`, `studio.html`, `slabview.html` or the studio docs. Cert page copy says "SlabSense Cert" and lists grade/centering/defects; no "authenticated"/"guaranteed" wording. Default label text and the reference photo are a fan-made "POKÉMON x SPONGEBOB" card (H-20).

## Findings

| ID | Severity | file:line | Guideline / principle | Evidence | Proposed fix |
|---|---|---|---|---|---|
| H-01 | Major | `README.md:195-197`, `package.json` (no `license`), repo root (no LICENSE), GitHub public | Our protection; 5.2.1 (own rights) | Public repo with README "MIT" while TOS :66 says proprietary; no LICENSE; `license: null` on GitHub | Owner picks the licence; add `LICENSE` (proprietary "All rights reserved" unless open-sourcing), `"license": "UNLICENSED"` in package.json, delete the README MIT line; consider making the repo private |
| H-02 | Major | every file in `src/ api/ scripts/ training/ backend/ supabase/ public/*.html index.html` | Owner requirement; copyright notice | 0 headers (grep) | Header pass per section 4 rules once the owner supplies the text; skip vendored paths |
| H-03 | Major | `public/manifest.json:2-4`, `public/icon-192.svg`/`512` ("TG") | 5.2.1 trademarks; 2.3.1 metadata | App installs as "TAG Pre-Grader", "Pre-grade TCG cards using TAG grading criteria", TG monogram icon | Rename to SlabSense, new icon from the logo system; same for the native bundle display name |
| H-04 | Major | `src/components/CardViewer/RealisticSlab.jsx:1-70`, rendered via `CardViewer3D` at `src/App.jsx:2587` | 5.2.1 "Don't use protected third-party material such as trademarks ... without permission"; 5.2.5 look-alike | "authentic-looking grading slabs" with PSA red label + "PSA", "BECKETT" black label, CGC blue, SGC, TAG black/red, `certPrefix 'TAG-'` | One neutral SlabSense slab style; show company conversion as text with the disclaimer; remove brand colours/wordmarks and fake cert prefixes |
| H-05 | Major | `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md:40,183`; `scripts/Tag scraper/tag_proxy.py` (keys); `api/_lib/surfaceDeduction.js:7` | Contract / anti-circumvention risk; owner's "no exposure" requirement | 27,751 DIG reports pulled through TAG's encrypted app API; "check TAG terms" item never closed; no terms copy, no permission | Owner obtains a written legal view (or TAG's consent) before App Store launch; record the decision in the spec; stop further bulk pulls until then; never redistribute the images; keep the models' TAG dependence out of marketing copy |
| H-06 | Minor | `src/lib/__fixtures__/C1287305_front_1400.jpg` (git-tracked) | Copyright: redistribution of a TAG image in a public repo | `git ls-files` lists it; tests fetch it | Replace with an owner-shot card photo or fetch the fixture from R2 at test time; purge from history if the repo stays public |
| H-07 | Minor | `api/_lib/detectionPrompt.js:269-272,469` | Redistribution to a processor; 5.1.2 | Deep path sends "TAG-GRADED REFERENCE CARDS" images to Claude; UI factor "N TAG reference cards used" | Include in the H-05 review; reword the factor to "reference cards used" |
| H-08 | Major | `src/App.jsx:2413-2419,2053`, `vercel.json:32`, `scripts/card-db/tcgdex.mjs:6,49` | 5.2.1 third-party copyrighted works | Full-res Pokémon artwork from TCGdex is the 3D slab's front image and is persisted on scans; no rights, no attribution | Use the user's own photo in the 3D view; keep TCGdex art to small identification thumbnails with "Card images © The Pokémon Company, used for identification"; add the fair-use rationale to the review notes |
| H-09 | Note | `public/card-hashes.json`, `public/card-images/` (gitignored), `models/` (gitignored) | Data derived from Pokémon art | Names + hashes tracked; 18 GB art + 221 MB CLIP embeddings local only | Keep ignored; delete legacy `card-matcher.js`/`clip-matcher.js` paths (section D) and the hashes file when they go |
| H-10 | Minor | `docs/grading-research/sources/{PSA,BGS,CGC,SGC,TAG}_*_verbatim.md` | Copyright in web text; public repo = distribution | Full verbatim captures of five companies' pages tracked publicly | Keep them (they are the engine's citations) but out of the public tree: private repo, or private submodule / local-only with a hash recorded in GRADING_SYSTEM.md |
| H-11 | Minor | `src/App.jsx:334,657,696,3484`, `DamageReportModal.jsx:172`, `ExportCard.jsx:70` | Trademark/trade identity (TAG vocabulary) | "DINGS" (TAG's API term) is the product's defect term; footer "DINGS-based" | Prefer "defects" in user-facing copy for the native app; keep "ding" internally |
| H-12 | Minor | `src/App.jsx:1526-1528,2631-2641,3484`; `public/slabview.html`; `AuthModal.jsx:240` | 5.2.1; 2.3.1; disclaimer placement | Disclaimer is a one-time localStorage modal; footer names TAG only; absent on result/conversion views, cert page, slab label, store listing; Terms/Privacy not linked | Persistent one-line "Independent estimate · not affiliated with PSA, BGS, CGC, SGC or TAG" on grade result + conversion views and the cert page footer; About screen linking Terms, Privacy, Disclaimers, NOTICE; same sentence in the App Store description |
| H-13 | Minor | `docs/DISCLAIMERS.md:39-43` | Accuracy of the trademark notice | TAG expanded as "True Authentic Grading, LLC" (it is Technical Authentication & Grading, `sources/TAG_DIG_reports_calibration.md:7`); PSA owner named as Collectors Universe | Correct every owner line from each company's own site; this text becomes NOTICE section 7 |
| H-14 | Minor | `public/slab/vendor/*.js`, `SlabSense-Engraving-Studio.html:294,2583`, `src/services/cornerEdgeModels.js:194`, `src/lib/clip-matcher.js:103` | MIT/Apache notice retention | No NOTICE; `supabase.js` has no header; ORT wasm, tessdata, CLIP loaded at runtime with no attribution | Add `NOTICE.md` (section 4) and an in-app licences screen |
| H-15 | Minor | `package.json` deps `heic2any`; `src/lib/image-converter.js:48` | LGPL-3.0 in a client bundle (App Store relinking concern) | heic2any embeds libheif (LGPL-3.0); its only importer has no importer itself (dead) | Remove `heic2any` from dependencies (iOS decodes HEIC natively; web path uses the server); keep `heic-convert`/`libheif-js` dev-only |
| H-16 | Note | `node_modules` | Licence flags | `expand-template` MIT OR WTFPL (choose MIT), `rc` multi, `flatbuffers` Apache-2.0 via file, `libheif-js` LGPL dev-only | Record in NOTICE; nothing to change |
| H-17 | Note | `training/trainlib/models.py:20`, `card_model.py:27`, `detector.py:19`, `training/README.md:586-592` | Pretrained-weight provenance | timm ImageNet-pretrained ConvNeXt-T / MobileNetV3 (Apache-2.0) fine-tuned and shipped; COCO Faster R-CNN not shipped; Ultralytics AGPL avoided | NOTICE section 6; keep AGPL out of `training/` |
| H-18 | Note | `public/slab/fonts.js`, `src/App.jsx:3485` | SIL OFL 1.1 | Barlow Condensed + Michroma embedded without the OFL text; Inter/JetBrains Mono via Google Fonts | Put both OFL texts in NOTICE; consider self-hosting Inter/JetBrains Mono for the native app (offline, privacy) |
| H-19 | Note | `public/icon-*.svg`, `public/slabsense-logo.png`, `src/components/HoloLogo/`, `logo stuff/` | Own assets | All original; no third-party icon set | None (replace the TG monogram under H-03) |
| H-20 | Minor | `SlabSense Slab Engraving Studio/SlabSense-Engraving-Studio.html:98-101`, `Referances/slabsence spongebob.jpg`, `public/studio.html` | 5.2.1; counterfeit-adjacent appearance | Default label "PIKACHU V / 2024 POKÉMON x SPONGEBOB / BIKINI BOTTOM PROMO" (fan-made card) | Neutral placeholder text; keep `/studio` admin-only and out of the native app; studio refuses labels for cards flagged "custom/proxy" |
| H-21 | Note | `public/slab/label.js`, `public/slabview.html` | 5.2.5 look-alike check | Own wordmark/badge/QR; generic grade words; no company trade dress; no authenticity claims | Add the H-12 line to the cert page; nothing else |
| H-22 | Note | product-wide | Trademark protection of "SlabSense" | No ™/®, no filing recorded | Owner considers a USPTO filing (classes 9, 42); until then use "SlabSense™" in About/marketing only if the owner adopts it |
| H-23 | Note | `src/centercheck.com data.txt` (untracked, 448 KB) | Third-party service data in `src/` | Captured centeringcheck.com API response with a base64 card image | Delete (section M) |
| H-24 | Minor | `scripts/Tag scraper/` (13 GB, 4,633 TAG jpgs, untracked), `Mapping Defects/` (untracked), `.gitignore` | Accidental publication risk in a public repo | Not ignored by pattern; one `git add .` publishes TAG images | Add `scripts/Tag scraper/**`, `Mapping Defects/`, `*.jpg` under scripts to `.gitignore`; move raw TAG copies off the repo tree |
| H-25 | Note | `src/lib/card-db-client.js`, bucket `card-db` v9 | Data provenance | Card DB = names, set names, image hashes from TCGdex; no pixels in the bucket | Credit TCGdex (MIT API) in NOTICE; keep hashes-only design |
