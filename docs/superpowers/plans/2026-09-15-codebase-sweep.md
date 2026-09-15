# Codebase sweep (non-grading) — 2026-09-15

Corrective actions found while working in the centering tool and identification code this week.
Grading-engine and detector items are excluded: they change when the learned models land.
Ordered so nothing has to be revisited.

## Applied in this sweep

| # | Item | Fix | Verification |
|---|------|-----|--------------|
| 1 | Pixel re-rank silently loses candidates: reference images from assets.tcgdex.net fail CORS in the browser (missing or duplicated `Access-Control-Allow-Origin`), so `pixelBoosts` returns 0 for them. The offline bake-off never saw this (Node has no CORS). | Serve reference images same-origin through a Vercel rewrite `/tcgdex-img/*` → assets.tcgdex.net (no serverless slot used) and a matching Vite dev proxy. Only the pixel comparison uses the proxy; thumbnails stay direct. | Headless identification in dev with a candidate image fetched through the proxy; after deploy, `curl` the proxied URL on the live site. |
| 2 | GitHub Actions warn that Node 20 action runtimes are deprecated. | Bump checkout / setup-node / cache / upload-artifact to v5; job Node 22. | Trigger `card-db-update` with `workflow_dispatch`, check the log has no deprecation warning and the manifest step runs. |
| 3 | Git warns about line endings on every commit (index is LF, working copy CRLF, no attributes file). | Add `.gitattributes` with `* text=auto` and binary rules. | `git status` shows no mass changes after adding it. |
| 4 | Dead code after the centering-tab rework: `loadTrainingBounds` / `saveTrainingBounds`, and the bounds-derivation branch in `run()` that only fired when a card had manual centering but no crop (impossible now). | Remove. | Build + full round trip (capture → analyze → centering tab). |
| 5 | Vision maps for the crop are built twice (App after analysis, tool again on Emboss/Hi-pass/Edge). | Pass the app's maps into the tool when it reopens from the centering tab. | Reopen from the tab, tap Emboss: map appears without "Building view…". |

## Noted, not changed (bundle)

- Main chunk is 680 kB minified (192 kB gzip): React, Supabase client, the app. The CLIP runtime (828 kB) and tesseract are already lazy chunks loaded only when identification runs; html2canvas is lazy. Further splitting (3D viewer, export) is possible but low value on a returning-user PWA with cached assets.

## Grading-side notes for later (from the 2026-09-13 review, not fixed by model upgrades)

These stay on the list because a learned model replaces the detectors, not the plumbing around them:

- **F6** silent perfect-centering fallback on the analysis error path: a failed analysis should show an error, not a 50/50 card.
- **F7** the 507-card calibration data is not wired into anything; either drive thresholds from it or delete it.
- **F8** display and table issues in the grade tab (see the review doc).
- **F9** detector tests exist in the harness now, but the App-level analysis path (`analyzeCardFull`, `run`) still has no automated test.
- `centeringData.outer` / `outerCorners` are always the full crop rectangle since the tool crops first; the fields are misleading and should be dropped once nothing reads them (the `run()` branch that did is removed in this sweep).
- App.jsx (~3,500 lines after this week) still holds the capture flow, grade tab, centering tab and analysis helpers. Split by tab before the model work touches the grade tab.

Items that the model work does absorb: F3 (severity mismatch), F4 (light backgrounds / holo allowances), F5 (5-defect cliff), F10 (creases, dents, scratches invisible to the software path).
