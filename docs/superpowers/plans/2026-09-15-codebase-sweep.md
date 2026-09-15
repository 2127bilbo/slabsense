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

## To do: fill pending card-DB entries from TAG images (agreed 2026-09-15, not started)

Wait until the owner's TAG pull is finished (do not add API load to TAG meanwhile).

- Registry = the manifest `pending` list (TCGDex ids with no image; 1,248 on 2026-09-15). TCGDex has fronts only, so fronts only.
- `scripts/card-db/fill-pending.mjs` (run on the PC first, later in the weekly Action): for each pending id fetch name/number/set from TCGDex; look the card up in the TAG index in R2 by name + number numerator + year, set name as fuzzy tiebreaker; cards without a number (e.g. Ancient Mew `miscp-001`) match on name + year and are flagged for review. Grade preference 10P → 10 → 9.5 → 9. Download the TAG front, auto-crop (studio background, easy), upload to `card-db/supplemental/{id}.jpg`. Write a review file listing every match with both set names before anything is embedded.
- Display naming follows TAG's wording (owner's call; users see TAG names on slabs anyway).
- `update.mjs`: a pending id with a supplemental file is embedded from that file (same path as a TCGDex image), appended to a shard, removed from pending. Supplemental files stay in the bucket as provenance for future re-embeds.
- Expect trainer-kit cards (475 pending) to stay pending; promos / subset cards should mostly resolve. Run the intersection first and report the count.

## AI grading + credits rework (applied 2026-09-15)

Triggered by: AI + Deep tapped back to back → both charged, one shown; Deep 6.5 vs AI 3 on the same creased card.

| # | Item | Fix |
|---|------|-----|
| 1 | Credit endpoints took `userId` from the body (no auth); refund accepted raw amounts, never checked repeats, extended expiry 30 days; spend was a non-atomic read-modify-write and returned no transaction id when the log insert failed (the "charged, no refund possible" case). | `supabase/migrations/20260915_credits_atomic.sql`: `spend_credits()` / `refund_credits()` (row-locked, idempotent, service-role only). `api/_lib/credits.js` calls them and falls back to a fail-closed legacy path until the migration is applied. All three credit endpoints verify the Supabase JWT. Costs come from `src/lib/grade-tiers.js` only. |
| 2 | AI endpoints were unauthenticated and free; the client spent before calling and refunded only on some branches; no request timeout; Deep had no `maxDuration`. | `api/_lib/gradeJobs.js` wraps both endpoints: auth → spend → `ai_grade_jobs` row → run → store result, or refund server-side + store error. `supabase/migrations/20260915_ai_grade_jobs.sql` (one in-flight job per user+card+tier; users can read their own rows). Client (`postGrade`) sends the JWT, has hard timeouts (150 s / 320 s) and polls the job row after a timeout/network drop/409. Deep `maxDuration: 300`, AI 120. |
| 3 | One-shot + durable: results tied to user + card, survive leaving the page. | Card key = SHA-256 of both photos. Jobs the browser started are remembered in localStorage; on return, finished jobs show a "Load it" banner that restores the photos from the bucket, re-runs the software analysis and applies the stored result. Buttons stay disabled while a job runs; the server refuses duplicates. Status `queued` is reserved for a future worker queue. |
| 4 | Crease cap was severity-gated (a "minor" crease had no cap); Deep pass 2 was told to "calibrate severities" and that "removing a false positive is as valuable", so it softened pass-1 creases. | Engine 1.1: any crease caps at 6, severe+ at 5 (CGC/SGC likewise). Pass-2 prompt forbids removing/softening structural findings; `mergeStructural()` enforces it in code. Deep always uses the balanced JSON parser (a detection without a `defects` array is a parse failure), pass 1 gets 3000 tokens, references load in one query. |
| 5 | Display: AI view never showed caps; Dings/Analysis panels showed software numbers in AI modes; AI defects never reached the damage map (`defects.details` vs `items`); saves preferred AI over Deep regardless of view; software subgrade colours used a 0-120 scale; two divergent reset paths (Deep button stuck disabled after one Deep grade; `setCroppingFor3D` undefined on New). | "Limited by" line under AI/Deep grades; Dings/Notes follow the active mode; damage map reads `items`; save uses the viewed grade; one `resetGradingState()`. |
| 6 | Dead code: `api/ai-config.json` (never read, named the wrong model), `runMultiProvider` family with the old "give a grade" prompt, v1 `deepGradingAnalysis` client function, price strings in four places. | Removed / unified. |

**Migrations to apply (Supabase SQL editor, in order):** `20260915_credits_atomic.sql`, `20260915_ai_grade_jobs.sql`. The app works before they are applied (legacy credit path, job tracking skipped) but one-shot/durable jobs need the second one.

## To do: one shared grading rule set + per-company differences table (session with the owner, at the PC)

Owner's view (2026-09-15): the TAG rules are the grounded ones (DIG reports); the other companies were
over-complicated, and some of the research docs were AI-fetched from forums rather than the companies'
own pages. Main real difference between companies is centering strictness (BGS harshest at 10 / Black Label).

Inventory for that session:
- Engine: `src/lib/gradingEngine.js` §5 — `convertPSA/BGS/CGC/SGC` each has its own combination
  method (lowest-wins, four-subgrade 0.5 rule, holistic +1.0 centering compensation, lowest + 3-category
  penalty) plus its own caps; `COMPANY_CENTERING` table (per grade: max front dev, max back dev);
  `ALLOWED_SUBGRADES`, labels. Rationale doc: `docs/COMPANY_OFFSETS.md`. Crease/tear caps were
  inconsistent until 2026-09-15 (now every company ≤ 7 on any crease).
- Research: `docs/grading-research/{PSA,BGS,CGC,SGC,TAG}_STANDARDS.md`, `*_DEFECT_WEIGHTS.md`,
  `ALL_GRADING_COMPANIES_REFERENCE.md`, `TAG_DIG_CALIBRATION_DATA.md`. None of the standards docs cite a
  source URL; `BGS_DEFECT_WEIGHTS.md` mentions forums. Treat all non-TAG numbers as unverified until
  checked against the company's own published standard.
- Proposed shape: (1) shared rules = defect deductions + structural caps (crease/tear/stain/extreme) +
  defect-count caps, applied once; (2) per-company table = centering thresholds by grade (incl. the 10 /
  Black Label rule), allowed grade steps, labels, and the one combination method that company actually
  documents; (3) tests that assert the same defect list orders the companies as expected.
- Steps: owner pulls the official standard pages for each company → we fill the table together →
  replace the four convert functions with one table-driven function → keep TAG untouched.
- Progress: **PSA captured verbatim** → `docs/grading-research/sources/PSA_gradingstandards_verbatim.md`
  (live 2026-09-15 for Gem Mint 10, Wayback 2023 for the rest; psacard.com blocks scripted readers).
  Engine aligned 2026-09-15: PSA any crease ≤ 4 (was 6), severe ≤ 2; any corner wear ≤ 8, 3+ corners ≤ 7;
  major tear → 1; centering rows for 4 → 1.5 added (85/15, 90/10).
- **CGC captured verbatim** → `docs/grading-research/sources/CGC_gradingscale_verbatim.md` (cgccards.com,
  2026-09-15). Engine aligned the same day: creases 4.5 / 4 / 3.5 / 2.5 / 1 by severity and count; corner,
  edge, print, scratch and stain severities mapped to the grades that name them; centering rows per the page.
  BGS and SGC next.
- **TAG captured verbatim** → `docs/grading-research/sources/TAG_scale_and_rubric_verbatim.md` (taggrading.com
  scale + rubric, 2026-09-15). Score→grade table matched the engine exactly. Centering did NOT: the engine's
  front table was one band harsh between 57/43 and 60/40 (rubric: Mint 9 = ~60/40), had no steps for 5.5 → 1.5,
  and the TCG back table dropped 9 and 8.5 one band early; 10P is ~51/49 (DIG reports agree). Fixed 2026-09-15.
- **SGC captured verbatim** → `docs/grading-research/sources/SGC_gradingscale_verbatim.md` (gosgc.com grade
  selector, 2026-09-15). SGC publishes one "X/Y or better" figure per grade and no back tolerance; engine now
  constrains the front only. Creases 5 / 4 / 3 / 2 by severity; corner/edge/print/scratch/stain caps per the text;
  the old unverified "three categories hit → −0.5" rule removed.
- **BGS captured verbatim** → `docs/grading-research/sources/BGS_gradingstandards_verbatim.md` (beckett.com chart
  via Wayback 2025-12-10; live site was on a maintenance page). Centering per grade incl. Pristine 50/50 front +
  55/45 back; creases 4 / 3 / 1; corners, edges, print, scuffing, stains, tears per the chart. Beckett does NOT
  publish the four-subgrade combination formula; the engine's "lowest + 0.5" rule stays but is marked unverified.
- **Purge done 2026-09-15 (owner's instruction):** all unverified grading-service research deleted; only
  `docs/grading-research/sources/*` (verbatim captures) and the owner's TAG DIG calibration data remain.
  `docs/COMPANY_OFFSETS.md` carries a SUPERSEDED banner (it still documents the combination methods).

Not done (noted): `GradeResultDisplay.jsx` is still imported but unrendered while the Grade tab hand-rolls three blocks; `cardType: 'modern_holo'` is still hard-coded for the Deep reference pool; a worker-based queue (and a "rush" credit tier) can sit on `ai_grade_jobs.status = 'queued'` later.
