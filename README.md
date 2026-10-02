# SlabSense

**Card pre-grading estimates from your phone, and a path to a grading rig.**

SlabSense photographs a trading card, measures centering, corners, edges and surface, and reports an estimated grade on the PSA, BGS, CGC, SGC and TAG scales. The free grade runs on-device; the paid **AI Grade** adds a full surface inspection and a written report.

> **Disclaimer.** SlabSense is not affiliated with PSA, BGS/Beckett, CGC, SGC or TAG. Every grade is an estimate, not a professional grade. Full text: `docs/legal/` (rendered at `/disclaimers`, `/terms`, `/privacy`).

Live at [slabsenseai.com](https://www.slabsenseai.com). Current state of the project: `docs/STATUS.md`.

## What it does

- **Capture.** Live viewfinder with an on-device card detector that outlines the card and auto-snaps after a steady lock; or upload photos.
- **Centering.** One editor for the card edge and the artwork edge; the card and centering models pre-place both lines, the user confirms.
- **Free grade (on-device).** Corner and edge models (fp16 ONNX from the models bucket), centering from the editor, the grading engine in `src/lib/gradingEngine.js`. The one grading document is `docs/GRADING_SYSTEM.md`.
- **AI Grade (paid, one credit).** Two Claude passes with TAG-graded reference cards, a structural floor, the slot table from the on-device models, and a tiled native-resolution surface pass per side. Surface severity comes from a regressor trained on TAG deductions, not from the model's guess.
- **Card identification.** CLIP embedding in the browser against a bucket-served card database (TCGDex ids), re-ranked by OCR of the set number and a pixel match.
- **Collection.** Saved cards with images, grades per company, 3D view, export card, damage report.
- **Slabs.** Physical slab orders through Stripe, an engraving studio queue, public cert pages.
- **Billing.** Three products shared by web and iOS (`src/lib/products.js`): a monthly plan and two packs of AI Grades. Stripe on the web, Apple in-app purchase in the iOS app; one credit ledger (`grant_credits` / `spend_credits` / `revoke_credits`).

## Stack

React 18 + Vite PWA · Vercel serverless API (`api/`, 11 functions) · Supabase (auth, Postgres, storage buckets for images, models and the card DB) · Anthropic Claude for the paid grade · Stripe and Apple StoreKit 2 for purchases · ONNX Runtime Web for the on-device models · PyTorch training pipeline in `training/` fed by the TAG dataset tooling in `scripts/tag-dataset/`.

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in Supabase at minimum; see the file for every variable
npm run dev                     # http://localhost:5173
```

Checks:

```bash
npm run check                   # ESLint (0 errors expected) + the library test suite
npm run lint
npm run test:lib
npx vite build
```

Other scripts (see `package.json`): `cards:update` (weekly card-DB job), `models:upload`, `harness` and `harness:identify` (accuracy harnesses against TAG-graded cards), `storage:cleanup`, `verify:label`.

Local data that is too big for the repo (TAG photos, the 18 GB reference card images, `card-hashes.json`) lives in `../SlabSense-data`, or wherever `SLABSENSE_DATA_DIR` points.

## Repository map

```
src/                 app (App.jsx, components/, lib/ engine + models + tools, services/ API + Supabase)
api/                 Vercel functions; api/_lib/ shared, tested modules (credits, ledgers, prompts, surface pass)
supabase/migrations/ schema, RLS and the credit ledger functions
public/              static pages (studio, slab view), legal pages rendered from docs/legal
scripts/             card-db job, harnesses, model export/upload, Playwright drivers (verify-*.cjs), TAG dataset tooling
training/            model training, weights, export manifests (training/MODEL-ROADMAP.md)
docs/                STATUS.md, GRADING_SYSTEM.md, RIG-PLAN.md, legal/, audits/, superpowers/ (plans, specs, runbooks)
```

## Where to read next

- `docs/STATUS.md` — what is live, what is open, who owes what
- `docs/GRADING_SYSTEM.md` — the grading engine, measured accuracy, every company scale with its source
- `docs/RIG-PLAN.md` — the fixed capture rig that replaces the paid path with our own models
- `docs/superpowers/plans/2026-10-01-app-store-readiness.md` — the iOS release program and its audit (`docs/audits/`)
- `docs/superpowers/runbooks/slab-order-setup.md` — deploy, migrations, Stripe prices and go-live, slab studio

## License

Proprietary. All rights reserved. The code, models and grading methodology are owned by SlabSense; see the Terms of Use in `docs/legal/`.
