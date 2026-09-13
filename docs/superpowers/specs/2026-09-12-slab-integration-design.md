# SlabSense slabbing pipeline — design

**Date:** 2026-09-12
**Status:** approved in conversation, awaiting written review
**Scope:** connect the Slab Engraving Studio to the SlabSense app so that a paid slabbing order produces a cert number, a laser-ready label, a public cert page (`/v/<cert>`) with the full grading report and a photoreal slab image, and an admin queue for engraving and shipping.

## 1. Goals

1. Paying is the only customer input. After checkout nothing is typed by hand: the cert is minted, the label is generated from the scan record, the order appears in the laser queue.
2. Anyone who scans the QR on a slab lands on a public page showing the entire grading report (TAG-style): card, grade, subgrades, centering, dings, both images, cert, status.
3. The label geometry has one source of truth shared by the studio and the cert page.
4. Admin work (engrave, ship) happens in one place, gated to an allow-list.

### Non-goals (this spec)

- Angled / 3D slab renders, server-rendered share images (later phase).
- Multiple admins or a role system.
- Non-US shipping, shipping-rate options, tax.
- Migrating existing physical slabs (there are none in the field yet).

## 2. Architecture

```
Customer (React app)        Vercel serverless (api/)             Supabase
─────────────────────       ────────────────────────             ─────────────────────────
"Get it slabbed"  ───────►  stripe/create-checkout (SLAB)        scans (exists)
                            stripe/webhook ──────────────────►  slabs  ← cert minted here
Admin (studio.html) ─────►  slabs/queue, slabs/status ────────►  slabs, storage: slab-labels
Anyone (/v/<cert>)  ─────►  slab?cert= ──────────────────────►  slab_public (view)
```

Static pages under `public/` (Vercel serves static files before the SPA rewrite):

| File | Purpose |
|---|---|
| `public/slab/label.js` | Label engine: fonts, frame data, geometry, QR, contour union, SVG/canvas render. Extracted from the studio unchanged in behaviour. |
| `public/slab/qrcode.js`, `opentype.js`, `polygon-clipping.js` | The three libraries, as separate files (no more inlining). |
| `public/studio.html` | Studio shell: queue mode (admin) + manual mode. |
| `public/slabview.html` | Public cert page. |
| `public/slab/plate-straight.png` | Empty-slab photo plate (from "empty slab straight no logo"), black backdrop. |

`vercel.json` rewrites: `/v/:cert` → `/slabview.html?cert=:cert`, `/queue` and `/studio` → `/studio.html`.

## 3. Data model

### 3.1 `slabs` table (new migration)

```sql
create sequence slab_cert_seq;

create or replace function next_cert() returns text language sql as $$
  select 'SS' || to_char(now(), 'YY') || '-' || lpad(nextval('slab_cert_seq')::text, 5, '0');
$$;

create table slabs (
  id                 uuid primary key default gen_random_uuid(),
  cert               text unique not null default next_cert(),
  scan_id            uuid not null references scans(id),
  user_id            uuid not null references profiles(id),
  status             text not null default 'paid' check (status in ('paid','engraved','shipped')),
  stripe_session_id  text unique,
  shipping           jsonb,                 -- Stripe session.shipping_details, verbatim
  label_svg_path     text,                  -- storage path once engraved
  slab_image_path    text,                  -- reserved for the rendered share image (later)
  paid_at            timestamptz not null default now(),
  engraved_at        timestamptz,
  shipped_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index slabs_status_idx on slabs(status, paid_at);
create index slabs_scan_idx on slabs(scan_id);
alter table slabs enable row level security;
create policy "owner reads own slabs" on slabs for select using (auth.uid() = user_id);
-- inserts/updates only via service role (webhook, admin routes)
```

Cert format: `SS` + two-digit year at mint time + five-digit global sequence (`SS26-00001`). The sequence does not reset per year; the year is informational.

### 3.2 `slab_public` view

The only thing the anonymous cert page can read. Joins `slabs` → `scans` and exposes exactly:

`cert, status, paid_at, engraved_at, shipped_at, card_name, card_set, card_number, card_game, grade_value, grade_label, subgrades, front_centering, back_centering, dings, front_image_url, back_image_url`

Not exposed: `user_id`, `shipping`, `stripe_session_id`, notes, anything from `profiles`.

Amended by Plan B (2026-09-13): images are copied to cert-keyed objects in the public `slab-images` bucket at mint time; the view never exposes per-user storage paths.

### 3.3 Storage

Bucket `slab-labels` (private). Object key `<cert>.svg`. Written by the studio through `api/slabs/status` (service role), never directly from the browser.

## 4. Payment → cert

- New Stripe price, env `STRIPE_PRICE_SLAB`, price key `slab` in `api/stripe/create-checkout.js`.
- Checkout session for `slab`: `mode: 'payment'`, `shipping_address_collection: { allowed_countries: ['US'] }`, `metadata: { user_id, price_id, scan_id }`, success URL back to the app's collection view with `?slab=<scan_id>&success=true` (exact route confirmed in the plan).
- `api/stripe/webhook.js`, `checkout.session.completed`: when `metadata.price_id === STRIPE_PRICE_SLAB`, insert into `slabs` `{ scan_id, user_id, stripe_session_id: session.id, shipping: session.shipping_details }`. Idempotent on `stripe_session_id` (unique) — a replayed event is a no-op. Existing credit/subscription handling is untouched.
- App: a "Get it slabbed" button on a saved, graded scan (CollectionView card detail). Disabled with a note if the scan lacks `grade_value` or a front image. After success, the card detail shows "Slab ordered · cert SS26-00001 · status".

## 5. Label engine (`public/slab/label.js`)

Pure extraction of the studio's current logic — no geometry changes in this project. Public surface:

```js
SlabLabel.ready                       // Promise: fonts parsed
SlabLabel.defaults                    // the studio's DEF object
SlabLabel.build(input, settings)      // → { shapes, svg, stats, warnings, qr }
SlabLabel.drawCanvas(canvas, shapes, settings, ink)
```

`input = { name, l2, l3, l4, cert, grade, gradeWord }`. `settings` = today's Settings object (trim, header nudges, dividers, QR options, fonts, colour/layers). Settings persist in the studio's localStorage as now. The cert page always renders with `SlabLabel.defaults`, so the defaults in `label.js` *are* the production label: when a setting is changed for real (not an experiment) it is changed in `label.js`, and the studio's "Restore defaults" brings the admin back to it. The QR payload is `<base><cert>` with `base = "slabsenseai.com/v/"`.

Card text mapping from a scan row, in one shared function `SlabLabel.fromScan(scan, cert)`:

| Label line | Source |
|---|---|
| name | `card_name` |
| l2 | `<year> <game> <set>` — year parsed from `card_set` if present, else omitted |
| l3 | `card_set` variant/number line: `#<card_number>` appended |
| l4 | rarity if present in the scan JSON, else blank |
| grade / gradeWord | `grade_value` (trailing `.0` stripped), `grade_label` upper-cased; `10P` → `10` / `PRISTINE` |

All strings upper-cased; the studio's `fit()` still shrinks long lines. The exact composition of l2/l3 is the one place the plan should verify against real scan rows before locking.

## 6. Studio (`public/studio.html`)

Two modes, chosen by auth state.

**Queue mode** (signed in as admin — Supabase auth in the page, `api/slabs/*` checks the JWT's user id against `ADMIN_USER_IDS`):

- Tabs: **To engrave** (`paid`, oldest first), **To ship** (`engraved`, with shipping address and a copy button), **Done** (`shipped`, search by cert / card name).
- Selecting a row renders the label from `fromScan(...)`. The four text lines are editable for that render (typos in card data happen) but the cert is read-only.
- **Download SVG**: downloads, uploads the SVG to `slab-labels/<cert>.svg` via `api/slabs/status` (`{ cert, status: 'engraved', svg }`), row moves to To ship. A failed upload keeps the download but shows the error and leaves the status unchanged.
- **Mark shipped**: `api/slabs/status` `{ cert, status: 'shipped' }`.
- Settings drawer as today (label settings are the admin's, stored in localStorage).

**Manual mode** (not signed in, or "Manual" tab): today's studio. Cert numbers use the prefix `TEST-` and a local counter; the `SS` sequence is never touched outside the database.

## 7. Cert page (`public/slabview.html`)

Route `/v/<cert>`. Loads `api/slab?cert=` (service role, reads `slab_public`, 404 → "No slab with that cert"). Renders:

1. **Slab composite** — layered 2D, straight-on:
   - card photo (`user_card_image` → `enhanced_front_path` → `front_image_path`), positioned in the plate's card window, with a slight blur/contrast pull (behind acrylic) and an inner shadow at the well edge;
   - `plate-straight.png` over it with `mix-blend-mode: screen` (black backdrop drops out, acrylic edges/highlights land on top);
   - the label: `SlabLabel.build(fromScan(row), defaults)` drawn white on the label window with a soft glow;
   - front/back toggle (back = `enhanced_back_path` / `back_image_path`, label mirrored is *not* attempted — the back shows the plate only).
   Window and label rectangles are measured once from the plate and stored as constants in the page.
2. **Report** — grade + designation large; subgrades; front/back centering; dings list; cert, status ("Paid — awaiting engraving" / "Engraved — awaiting shipping" / "Shipped"), dates.
3. States: loading, not found, image missing (plate with empty window).

Mobile first; the composite scales to width.

## 8. API routes

| Route | Auth | Does |
|---|---|---|
| `GET api/slab?cert=` | none | `slab_public` row as JSON, image URLs made absolute/signed. Cache 60 s. |
| `GET api/slabs/queue?status=` | admin | rows joined with scan fields the studio needs |
| `POST api/slabs/status` | admin | `{cert, status, svg?}`; validates transition `paid→engraved→shipped`; uploads SVG when present; stamps `engraved_at` / `shipped_at` |
| `POST api/stripe/create-checkout` | user | existing, gains `slab` price + `scan_id` |
| `POST api/stripe/webhook` | Stripe | existing, gains slab insert |

Admin check: `Authorization: Bearer <supabase jwt>` → `supabase.auth.getUser` → id ∈ `ADMIN_USER_IDS` (comma-separated env). Anything else → 403.

## 9. Error handling

- Webhook insert failure → log + return 500 so Stripe retries; unique `stripe_session_id` makes retries safe.
- Scan deleted after purchase → `slabs.scan_id` FK blocks the delete; the app hides delete for scans with a slab.
- `api/slab` for a cert that exists but has no front image → page renders the plate with an empty window and a note.
- Studio offline / API down → queue shows the error; manual mode still works.

## 10. Testing

- **Label engine**: the existing scratch harness (export SVG → rasterise → decode with jsQR) is moved into the repo as `scripts/verify-label.cjs` and run against `label.js` directly in node (opentype + polygon-clipping are node-friendly), no browser needed. Default config must decode; module size reported.
- **Webhook**: unit test of the handler with a fixture `checkout.session.completed` payload carrying the slab price → one `slabs` row, second delivery → no second row.
- **Cert sequence**: migration test that two inserts get consecutive certs.
- **Admin gate**: request without JWT / with non-admin JWT → 403.
- **Pages**: headless-Chrome screenshots of `/v/<cert>` (found, not found, no image) and the studio queue at desktop and 390 px.

## 11. Phases

1. Migration: `slabs`, `next_cert()`, `slab_public`, `slab-labels` bucket.
2. Extract `label.js` + libraries; studio.html and a bare slabview render from it; `scripts/verify-label.cjs` green.
3. `api/slab` + slabview composite + report.
4. Stripe `slab` price, "Get it slabbed", webhook insert.
5. Studio queue mode, admin gate, `api/slabs/queue` + `status`, SVG to storage.
6. Later: server-rendered slab PNG (share/OG), angled plate, QR-scan handoff into the app.

Phases 1–3 yield a scannable `/v/<cert>` page; 4–5 close the loop.
