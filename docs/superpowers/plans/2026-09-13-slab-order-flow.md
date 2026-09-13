# Slab Order Flow Implementation Plan (Plan B of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer clicks "Get it slabbed" on a graded card, pays through Stripe Checkout (US shipping collected), and the webhook mints a cert, copies the card images to cert-keyed files, and creates the `slabs` row — with no manual step.

**Architecture:** All slab-specific server logic lives in one testable module `api/_lib/slabs.js` (`slabSessionParams`, `mintSlab`, `copySlabImages`) with injected `db`/`storage`/`fetch`; the existing `create-checkout` and `webhook` routes gain thin branches that call it. A second migration adds cert-keyed image columns + a public `slab-images` bucket and re-points `slab_public` at them (fixing Plan A's deferred `user_id`-in-URL leak). The React collection view gets a button and a status line; the cert page reads the new image columns.

**Tech Stack:** Vercel serverless (ESM), Stripe Node SDK (already installed), Supabase (service role in `api/`, anon + RLS in the app), React 18, plain-node `.cjs` verification scripts with fakes.

**Spec:** `docs/superpowers/specs/2026-09-12-slab-integration-design.md` — §4 (payment → cert), §3.1/§3.2 amendments below, §7 image source. Plan A (`docs/superpowers/plans/2026-09-12-slab-cert-page-foundation.md`) is merged on `main`.

## Global Constraints

- Branch `feat/slab-order` from `main`. Commit after every task. No push until the end (controller asks).
- The database is the only thing that mints certs (`slabs.cert default next_cert()`); nothing in this plan calls `next_cert()` directly or writes `cert`.
- Idempotency: `mintSlab` must **select by `stripe_session_id` first** and return the existing row if found — never insert-then-catch-conflict (that would burn a cert number on a replayed webhook).
- Stripe price key is the string `slab`; the price id comes from env `STRIPE_PRICE_SLAB`. Checkout `mode: 'payment'`, `shipping_address_collection: { allowed_countries: ['US'] }`, metadata `{ user_id, price_id, price_key: 'slab', scan_id }`.
- Images are copied at mint time to the **public** bucket `slab-images` as `<cert>/front.jpg` and `<cert>/back.jpg`; `slab_public` exposes `front_image_url` / `back_image_url` and **no longer exposes any `scans.*_image*` column** (spec §3.2 amendment: closes the `user_id`-in-path leak recorded in Plan A's ledger).
- Image copy failure must not lose the order: the row is inserted first; a failed copy leaves the URL columns null and is logged with the cert.
- Webhook retry safety: if processing throws, the `stripe_events` claim row for that event is deleted before returning 500 so Stripe's retry is processed, not dropped as a duplicate.
- Server routes keep the house style (`export const config`, CORS headers, `createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)`).
- Repo is `"type": "module"`; verification scripts under `scripts/` are `.cjs` using dynamic `import()`; tests use fakes — no network, no env.
- Migrations are applied by pasting into the Supabase SQL editor; the file is committed under `supabase/migrations/`.
- Do not change label geometry or `public/slab/label.js`.

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260913_slab_images.sql` | `front_image_url`/`back_image_url` on `slabs`; public `slab-images` bucket + read policy; recreate `slab_public` |
| `api/_lib/slabs.js` | `slabSessionParams()`, `pickImages()`, `copySlabImages()`, `mintSlab()` — pure, dependency-injected |
| `api/stripe/create-checkout.js` | gains the `slab` price key branch (scan ownership check, shipping collection) |
| `api/stripe/webhook.js` | `checkout.session.completed` with `price_key === 'slab'` → `mintSlab`; claim-row cleanup on failure |
| `src/services/slabs.js` | `orderSlab(userId, scanId)`, `getSlabForScan(scanId)` |
| `src/components/Collection/CollectionView.jsx` | "Get it slabbed" button + slab status line in the card detail header area |
| `public/slab/slabview.js`, `scripts/fixtures/*.json` | read `front_image_url` / `back_image_url` |
| `scripts/verify-slabs-lib.cjs` | fake-db/storage/fetch tests for `api/_lib/slabs.js` |
| `docs/superpowers/runbooks/slab-order-setup.md` | Stripe product/price + env var + first live test checklist |

---

### Task 1: Migration — cert-keyed images and the amended public view

**Files:**
- Create: `supabase/migrations/20260913_slab_images.sql`

**Interfaces:**
- Produces: `slabs.front_image_url text`, `slabs.back_image_url text`; bucket `slab-images` (public read); `slab_public` now selects `s.front_image_url, s.back_image_url` and none of `scans.user_card_image/enhanced_*/front_image_path/back_image_path`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260913_slab_images.sql — cert-keyed slab images; slab_public stops exposing per-user image paths.
-- Apply in the Supabase SQL editor after 20260912_slabs.sql. Safe to re-run.

alter table slabs add column if not exists front_image_url text;
alter table slabs add column if not exists back_image_url text;

-- Public bucket: the cert page and anyone with the URL can read; only the service role writes.
insert into storage.buckets (id, name, public)
values ('slab-images', 'slab-images', true)
on conflict (id) do update set public = true;

drop policy if exists "public read slab-images" on storage.objects;
create policy "public read slab-images" on storage.objects
  for select using (bucket_id = 'slab-images');

-- Column set changes, so the view must be dropped (create or replace cannot remove columns).
drop view if exists slab_public;
create view slab_public with (security_invoker = false) as
select
  s.cert, s.status, s.paid_at, s.engraved_at, s.shipped_at,
  c.card_name, c.card_set, c.card_number, c.card_game, c.card_info,
  c.grade_value, c.grade_label, c.subgrades, c.front_centering, c.back_centering, c.dings,
  s.front_image_url, s.back_image_url
from slabs s
join scans c on c.id = s.scan_id;

-- The cert page reads through api/slab (service role); no direct anon/authenticated access.
revoke select on slab_public from anon, authenticated;
```

- [ ] **Step 2: Static check**

Read the file back: every statement terminated; `drop view` precedes `create view`; the view lists exactly 18 columns (5 slab status/date, 11 scan grading/card, 2 image URLs) and no `scans` image column. Run `node -e "const s=require('fs').readFileSync('supabase/migrations/20260913_slab_images.sql','utf8');const v=s.match(/create view[\s\S]*?from slabs/)[0];console.log((v.match(/user_card_image|enhanced_|image_path/)||['no scans image columns'])[0])"` → `no scans image columns`.

- [ ] **Step 3: Human step (pending Bob)** — paste into the SQL editor, expect "Success. No rows returned", then `select column_name from information_schema.columns where table_name='slab_public' order by ordinal_position;` shows `front_image_url`, `back_image_url` last and no `user_card_image`.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/slab-order
git add supabase/migrations/20260913_slab_images.sql
git commit -m "feat(db): cert-keyed slab images; slab_public no longer exposes per-user image paths"
```

---

### Task 2: `api/_lib/slabs.js` with fake-backed tests

**Files:**
- Create: `api/_lib/slabs.js`
- Create: `scripts/verify-slabs-lib.cjs`

**Interfaces (Produces):**
```js
// api/_lib/slabs.js  (ESM)
export const SLAB_PRICE_KEY = 'slab';
export function slabSessionParams({ customerId, userId, scanId, priceId, successUrl, cancelUrl })
  // → Stripe Checkout params object (mode payment, US shipping, metadata incl. scan_id)
export function pickImages(scan)
  // → { front: url|null, back: url|null }  front = user_card_image → enhanced_front_path → front_image_path; back = enhanced_back_path → back_image_path
export async function copySlabImages({ storage, fetchImpl }, cert, images)
  // → { front_image_url, back_image_url } (null for any side that had no source or failed; never throws)
export async function mintSlab({ db, storage, fetchImpl, log }, { scanId, userId, stripeSessionId, shipping })
  // → { slab, created:boolean }  — select by stripe_session_id first; insert; copy images; update URLs
```
`db` is a supabase-js-like client (`from().select().eq().maybeSingle()`, `from().insert().select().single()`, `from().update().eq()`); `storage` is `supabase.storage` (`from(bucket).upload(path, buffer, {contentType, upsert})`, `from(bucket).getPublicUrl(path)`); `fetchImpl` is `fetch`.

- [ ] **Step 1: Write the failing test**

`scripts/verify-slabs-lib.cjs`:
```js
(async()=>{
const {slabSessionParams,pickImages,copySlabImages,mintSlab,SLAB_PRICE_KEY}=await import('../api/_lib/slabs.js');
let bad=0;const fail=(m,...x)=>{console.log('FAIL',m,...x);bad++;};

// slabSessionParams
const p=slabSessionParams({customerId:'cus_1',userId:'u1',scanId:'s1',priceId:'price_slab',successUrl:'https://x/ok',cancelUrl:'https://x/no'});
if(p.mode!=='payment')fail('mode',p.mode);
if(!p.shipping_address_collection||p.shipping_address_collection.allowed_countries.join()!=='US')fail('shipping',p.shipping_address_collection);
if(p.metadata.scan_id!=='s1'||p.metadata.price_key!==SLAB_PRICE_KEY||p.metadata.user_id!=='u1'||p.metadata.price_id!=='price_slab')fail('metadata',p.metadata);
if(p.line_items.length!==1||p.line_items[0].price!=='price_slab'||p.line_items[0].quantity!==1)fail('line_items',p.line_items);
if(p.customer!=='cus_1'||p.success_url!=='https://x/ok'||p.cancel_url!=='https://x/no')fail('urls');

// pickImages
if(JSON.stringify(pickImages({user_card_image:'a',enhanced_front_path:'b',front_image_path:'c',enhanced_back_path:'d',back_image_path:'e'}))!=='{"front":"a","back":"d"}')fail('pick 1');
if(JSON.stringify(pickImages({front_image_path:'c',back_image_path:'e'}))!=='{"front":"c","back":"e"}')fail('pick 2');
if(JSON.stringify(pickImages({}))!=='{"front":null,"back":null}')fail('pick 3');

// fakes
function fakeStorage(){const up=[];return {uploads:up,from:(b)=>({upload:async(path,buf,opts)=>{up.push({b,path,len:buf.length,opts});return {data:{path},error:null};},getPublicUrl:(path)=>({data:{publicUrl:'https://cdn/'+b+'/'+path}})})};}
const fetchOk=async(url)=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer,headers:{get:()=>'image/jpeg'}});
const fetchBad=async(url)=>({ok:false,status:404});

// copySlabImages
let st=fakeStorage();
let r=await copySlabImages({storage:st,fetchImpl:fetchOk},'SS26-00007',{front:'https://src/f.jpg',back:'https://src/b.jpg'});
if(r.front_image_url!=='https://cdn/slab-images/SS26-00007/front.jpg'||r.back_image_url!=='https://cdn/slab-images/SS26-00007/back.jpg')fail('copy urls',r);
if(st.uploads.length!==2||st.uploads[0].path!=='SS26-00007/front.jpg'||st.uploads[0].opts.contentType!=='image/jpeg'||st.uploads[0].opts.upsert!==true)fail('copy uploads',st.uploads);
st=fakeStorage();r=await copySlabImages({storage:st,fetchImpl:fetchBad},'SS26-00008',{front:'https://src/f.jpg',back:null});
if(r.front_image_url!==null||r.back_image_url!==null||st.uploads.length!==0)fail('copy failure tolerated',r,st.uploads);

// mintSlab fake db
function fakeDb(state){
  state.slabs=state.slabs||[];state.updates=[];
  const rowFor=(t,f,v)=>t==='slabs'?state.slabs.find(x=>x[f]===v)||null:(t==='scans'&&state.scan&&state.scan[f]===v?state.scan:null);
  return {calls:state,from:(t)=>({
    select:()=>({eq:(f,v)=>({maybeSingle:async()=>({data:rowFor(t,f,v),error:null})})}),
    insert:(row)=>({select:()=>({single:async()=>{if(t!=='slabs')throw new Error('insert '+t);const s={id:'slab_'+(state.slabs.length+1),cert:'SS26-0000'+(state.slabs.length+1),status:'paid',...row};state.slabs.push(s);return {data:s,error:null};}})}),
    update:(patch)=>({eq:async(f,v)=>{state.updates.push({t,patch,f,v});const s=rowFor(t,f,v);if(s)Object.assign(s,patch);return {data:null,error:null};}})
  })};
}
const scan={id:'scan1',user_id:'u1',user_card_image:'https://src/f.jpg',back_image_path:'https://src/b.jpg'};
let db=fakeDb({scan});st=fakeStorage();const logs=[];
r=await mintSlab({db,storage:st,fetchImpl:fetchOk,log:(...a)=>logs.push(a.join(' '))},{scanId:'scan1',userId:'u1',stripeSessionId:'cs_1',shipping:{name:'Bob',address:{country:'US'}}});
if(!r.created||r.slab.cert!=='SS26-00001'||r.slab.scan_id!=='scan1'||r.slab.user_id!=='u1'||r.slab.stripe_session_id!=='cs_1'||!r.slab.shipping)fail('mint create',r);
if(r.slab.front_image_url!=='https://cdn/slab-images/SS26-00001/front.jpg'||r.slab.back_image_url!=='https://cdn/slab-images/SS26-00001/back.jpg')fail('mint image urls',r.slab);
if(db.calls.updates.length!==1||db.calls.updates[0].f!=='id')fail('mint update by id',db.calls.updates);
// replay: same session id → existing row, no insert, no upload
const before=db.calls.slabs.length,ups=st.uploads.length;
r=await mintSlab({db,storage:st,fetchImpl:fetchOk,log:()=>{}},{scanId:'scan1',userId:'u1',stripeSessionId:'cs_1',shipping:null});
if(r.created||db.calls.slabs.length!==before||st.uploads.length!==ups||r.slab.cert!=='SS26-00001')fail('mint replay',r);
// scan missing → throws (order must not be silently dropped)
let threw=false;try{await mintSlab({db:fakeDb({}),storage:fakeStorage(),fetchImpl:fetchOk,log:()=>{}},{scanId:'nope',userId:'u1',stripeSessionId:'cs_2',shipping:null});}catch(e){threw=/scan/i.test(e.message);}
if(!threw)fail('mint missing scan throws');
// scan owned by someone else → throws
threw=false;try{await mintSlab({db:fakeDb({scan}),storage:fakeStorage(),fetchImpl:fetchOk,log:()=>{}},{scanId:'scan1',userId:'u2',stripeSessionId:'cs_3',shipping:null});}catch(e){threw=/owner|belong/i.test(e.message);}
if(!threw)fail('mint wrong owner throws');
// image copy failure → row still created, urls null, logged
db=fakeDb({scan});r=await mintSlab({db,storage:fakeStorage(),fetchImpl:fetchBad,log:(...a)=>logs.push(a.join(' '))},{scanId:'scan1',userId:'u1',stripeSessionId:'cs_4',shipping:null});
if(!r.created||r.slab.front_image_url!==null)fail('mint tolerates copy failure',r);
if(!logs.some(l=>/image/i.test(l)&&/SS26-/.test(l)))fail('copy failure logged with cert',logs);

console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
```

- [ ] **Step 2: Run it to see it fail** — `node scripts/verify-slabs-lib.cjs` → `Cannot find module '../api/_lib/slabs.js'`.

- [ ] **Step 3: Write the module**

```js
/**
 * api/_lib/slabs.js — slabbing orders: Checkout params, cert minting, cert-keyed image copies.
 * Pure and dependency-injected so it can be tested with fakes (scripts/verify-slabs-lib.cjs).
 */
export const SLAB_PRICE_KEY = 'slab';
export const SLAB_IMAGE_BUCKET = 'slab-images';

export function slabSessionParams({ customerId, userId, scanId, priceId, successUrl, cancelUrl }) {
  return {
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'payment',
    shipping_address_collection: { allowed_countries: ['US'] },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: userId, price_id: priceId, price_key: SLAB_PRICE_KEY, scan_id: scanId },
  };
}

/** Which of a scan's images the slab should carry. Front prefers the user's crop; back the enhanced photo. */
export function pickImages(scan) {
  return {
    front: scan.user_card_image || scan.enhanced_front_path || scan.front_image_path || null,
    back: scan.enhanced_back_path || scan.back_image_path || null,
  };
}

async function copyOne({ storage, fetchImpl }, cert, side, url) {
  if (!url) return null;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`fetch ${side} image: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/jpeg';
  const path = `${cert}/${side}.jpg`;
  const { error } = await storage.from(SLAB_IMAGE_BUCKET).upload(path, buf, { contentType, upsert: true });
  if (error) throw new Error(`upload ${side} image: ${error.message || error}`);
  return storage.from(SLAB_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Copies front/back to slab-images/<cert>/. Never throws: a failed side yields null. */
export async function copySlabImages(deps, cert, images) {
  const out = { front_image_url: null, back_image_url: null };
  const log = deps.log || console.error;
  for (const side of ['front', 'back']) {
    try { out[`${side}_image_url`] = await copyOne(deps, cert, side, images[side]); }
    catch (e) { log(`[slabs] ${cert}: ${side} image copy failed: ${e.message}`); }
  }
  return out;
}

/**
 * Mint a slab for a paid Checkout session. Idempotent on stripe_session_id (select first — never
 * insert-then-conflict, which would burn a cert number on webhook replays).
 */
export async function mintSlab({ db, storage, fetchImpl, log = console.error }, { scanId, userId, stripeSessionId, shipping }) {
  const existing = await db.from('slabs').select('*').eq('stripe_session_id', stripeSessionId).maybeSingle();
  if (existing.error) throw new Error(`slabs lookup failed: ${existing.error.message || existing.error}`);
  if (existing.data) return { slab: existing.data, created: false };

  const scanRes = await db.from('scans').select('*').eq('id', scanId).maybeSingle();
  if (scanRes.error) throw new Error(`scan lookup failed: ${scanRes.error.message || scanRes.error}`);
  const scan = scanRes.data;
  if (!scan) throw new Error(`scan ${scanId} not found`);
  if (scan.user_id !== userId) throw new Error(`scan ${scanId} does not belong to the paying user`);

  const ins = await db.from('slabs')
    .insert({ scan_id: scanId, user_id: userId, stripe_session_id: stripeSessionId, shipping: shipping || null })
    .select().single();
  if (ins.error) throw new Error(`slab insert failed: ${ins.error.message || ins.error}`);
  const slab = ins.data;

  const urls = await copySlabImages({ storage, fetchImpl, log }, slab.cert, pickImages(scan));
  const upd = await db.from('slabs').update(urls).eq('id', slab.id);
  if (upd.error) log(`[slabs] ${slab.cert}: image url update failed: ${upd.error.message || upd.error}`);
  return { slab: { ...slab, ...urls }, created: true };
}
```

- [ ] **Step 4: Run to green** — `node scripts/verify-slabs-lib.cjs` → `PASS`.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/slabs.js scripts/verify-slabs-lib.cjs
git commit -m "feat(slabs): order lib — checkout params, idempotent cert mint, cert-keyed image copy"
```

---

### Task 3: Wire the Stripe routes

**Files:**
- Modify: `api/stripe/create-checkout.js` (price map, request validation, session params)
- Modify: `api/stripe/webhook.js` (`handleCheckoutComplete` branch; claim cleanup in the catch)

**Interfaces:**
- Consumes: `SLAB_PRICE_KEY`, `slabSessionParams`, `mintSlab` from Task 2.
- Produces: `POST /api/stripe/create-checkout` with body `{ userId, priceKey: 'slab', scanId, successUrl, cancelUrl }` → `{ success, sessionId, url }`; 400 `scan_required` / 403 `scan_not_owned` / 400 `scan_not_graded`.

- [ ] **Step 1: create-checkout — add the price and the branch**

In the `PRICES` map add `slab: process.env.STRIPE_PRICE_SLAB,`. Add the import at the top: `import { SLAB_PRICE_KEY, slabSessionParams } from '../_lib/slabs.js';`. Read `scanId` from the body alongside the others: `const { userId, priceKey, quantity = 1, successUrl, cancelUrl, scanId } = req.body;`.

Immediately after the existing customer get-or-create block (after `customerId` is known) insert:

```js
    // Slabbing order: one card, shipping collected, cert minted by the webhook.
    if (priceKey === SLAB_PRICE_KEY) {
      if (!scanId) return res.status(400).json({ error: 'scan_required' });
      const { data: scan, error: scanErr } = await supabase
        .from('scans').select('id, user_id, grade_value, user_card_image, enhanced_front_path, front_image_path')
        .eq('id', scanId).maybeSingle();
      if (scanErr || !scan) return res.status(404).json({ error: 'scan_not_found' });
      if (scan.user_id !== userId) return res.status(403).json({ error: 'scan_not_owned' });
      if (scan.grade_value == null) return res.status(400).json({ error: 'scan_not_graded' });
      if (!(scan.user_card_image || scan.enhanced_front_path || scan.front_image_path)) return res.status(400).json({ error: 'scan_has_no_image' });
      const base = process.env.VITE_APP_URL || 'https://slabsenseai.com';
      const session = await stripe.checkout.sessions.create(slabSessionParams({
        customerId, userId, scanId, priceId,
        successUrl: successUrl || `${base}/?slab_ordered=1`,
        cancelUrl: cancelUrl || `${base}/?slab_canceled=1`,
      }));
      return res.status(200).json({ success: true, sessionId: session.id, url: session.url });
    }
```

- [ ] **Step 2: webhook — mint on slab purchase; keep retries alive**

Import at the top: `import { SLAB_PRICE_KEY, mintSlab } from '../_lib/slabs.js';`.

In `handleCheckoutComplete(session)`, right after the `console.log('[Webhook] Checkout complete:' ...)` line and **before** the profile lookup, insert:

```js
  if (session.metadata?.price_key === SLAB_PRICE_KEY) {
    const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
    const { slab, created } = await mintSlab(
      { db: supabase, storage: supabase.storage, fetchImpl: fetch },
      { scanId: session.metadata.scan_id, userId, stripeSessionId: session.id, shipping }
    );
    console.log(`[Webhook] Slab ${created ? 'minted' : 'already existed'}: ${slab.cert} for scan ${slab.scan_id}`);
    return;
  }
```

In the top-level handler's `catch (err)` block, before `return res.status(500)...`, add:

```js
    // Release the idempotency claim so Stripe's retry is processed instead of dropped as a duplicate.
    await supabase.from('stripe_events').delete().eq('id', event.id);
```

- [ ] **Step 3: Static verification** (the routes construct Stripe/Supabase clients at import time, so they are exercised live in Task 6, not by unit tests here)

```bash
node -e "import('./api/_lib/slabs.js').then(m=>console.log(Object.keys(m).join(',')))"
node --check api/stripe/create-checkout.js && node --check api/stripe/webhook.js && echo syntax ok
grep -n "SLAB_PRICE_KEY\|slabSessionParams\|mintSlab\|stripe_events').delete" api/stripe/create-checkout.js api/stripe/webhook.js
```
Expected: the exports list; `syntax ok`; four grep hits (two per file, plus the delete line).

- [ ] **Step 4: Commit**

```bash
git add api/stripe/create-checkout.js api/stripe/webhook.js
git commit -m "feat(stripe): slab price key with shipping collection; webhook mints the cert; retries survive handler failures"
```

---

### Task 4: App — order button and status

**Files:**
- Create: `src/services/slabs.js`
- Modify: `src/components/Collection/CollectionView.jsx` (imports; card-detail header; a status/order block under the header)

**Interfaces:**
- Consumes: `POST /api/stripe/create-checkout` (Task 3); `slabs` table via the app's supabase client under the owner RLS policy.
- Produces: `orderSlab(userId, scanId) → Promise<{url}>`, `getSlabForScan(scanId) → Promise<{cert,status,paid_at,engraved_at,shipped_at}|null>`.

- [ ] **Step 1: Service**

`src/services/slabs.js`:
```js
/**
 * Slabbing orders — client side. The cert is minted by the Stripe webhook; the app only starts
 * Checkout and reads the resulting row (owner-only via RLS).
 */
import { supabase, isSupabaseConfigured } from './supabase.js';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export const SLAB_STATUS_TEXT = {
  paid: 'Paid — awaiting engraving',
  engraved: 'Engraved — awaiting shipping',
  shipped: 'Shipped',
};

export async function orderSlab(userId, scanId) {
  const response = await fetch(`${API_BASE}/api/stripe/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId, scanId, priceKey: 'slab',
      successUrl: `${window.location.origin}/?slab_ordered=1`,
      cancelUrl: `${window.location.origin}/?slab_canceled=1`,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to start slab checkout');
  return data;
}

export async function getSlabForScan(scanId) {
  if (!isSupabaseConfigured() || !scanId) return null;
  const { data, error } = await supabase
    .from('slabs').select('cert, status, paid_at, engraved_at, shipped_at')
    .eq('scan_id', scanId).order('paid_at', { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error('[Slabs] lookup failed:', error); return null; }
  return data;
}

export function certUrl(cert) { return `${window.location.origin}/v/${cert}`; }
```
Check `credits.js` for how `API_BASE` is defined there and use the identical expression.

- [ ] **Step 2: CollectionView**

Add the import: `import { orderSlab, getSlabForScan, SLAB_STATUS_TEXT, certUrl } from '../../services/slabs.js';`

Add state near the other `useState` calls: `const [slab, setSlab] = useState(null); const [slabBusy, setSlabBusy] = useState(false);`

Add an effect that loads the slab whenever the selected card changes:
```jsx
  useEffect(() => {
    let alive = true;
    setSlab(null);
    if (selectedCard?.id) getSlabForScan(selectedCard.id).then((s) => { if (alive) setSlab(s); });
    return () => { alive = false; };
  }, [selectedCard?.id]);
```

Add a handler:
```jsx
  const handleOrderSlab = async () => {
    if (!selectedCard || slabBusy) return;
    setSlabBusy(true);
    try {
      const { url } = await orderSlab(userId, selectedCard.id);
      window.location.href = url;
    } catch (err) {
      console.error('Slab order failed:', err);
      alert(`Could not start checkout: ${err.message}`);
      setSlabBusy(false);
    }
  };
```

Directly under the sticky "Card Details" header `<div>` (inside `{/* Content */}` before the grade toggle), render:
```jsx
          {/* Slabbing */}
          <div style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid #1f2229', borderRadius: 10, background: '#0f1116', fontFamily: sans, fontSize: 13 }}>
            {slab ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>Slab {slab.cert}</div>
                  <div style={{ color: '#98a0ae' }}>{SLAB_STATUS_TEXT[slab.status] || slab.status}</div>
                </div>
                <a href={certUrl(slab.cert)} target="_blank" rel="noreferrer" style={{ color: '#7ea5ff' }}>View cert page ↗</a>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ color: '#98a0ae' }}>
                  {selectedCard.grade_value == null ? 'Grade this card to order a slab.' : 'Have SlabSense engrave and ship this card in a slab.'}
                </div>
                <button
                  onClick={handleOrderSlab}
                  disabled={slabBusy || selectedCard.grade_value == null || !(selectedCard.user_card_image || selectedCard.enhanced_front_path || selectedCard.front_image_path)}
                  style={{ background: '#2f6fe4', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontFamily: sans, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: slabBusy ? 0.6 : 1 }}
                >
                  {slabBusy ? 'Opening checkout…' : 'Get it slabbed'}
                </button>
              </div>
            )}
          </div>
```
(`sans` is the component's existing font constant; reuse it. The disabled condition mirrors the server's checks.)

- [ ] **Step 3: Verify it builds and renders**

```bash
npm run build 2>&1 | tail -3
```
Expected: `✓ built in …` with no errors. Then `npm run dev`, open the collection, select a graded card: the "Get it slabbed" box appears under the header; on an ungraded card the button is disabled with the "Grade this card…" text. Clicking with `STRIPE_PRICE_SLAB` unset shows the "Could not start checkout" alert (expected until Task 6). Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/services/slabs.js src/components/Collection/CollectionView.jsx
git commit -m "feat(app): Get it slabbed button and slab status on the card detail"
```

---

### Task 5: Cert page reads the cert-keyed images

**Files:**
- Modify: `public/slab/slabview.js` (`showSide`, images section)
- Modify: `scripts/fixtures/slab-public.json`, `scripts/fixtures/slab-public-noimage.json`

- [ ] **Step 1: Update the fixtures first**

In both fixtures remove the five keys `user_card_image`, `enhanced_front_path`, `enhanced_back_path`, `front_image_path`, `back_image_path` and add `"front_image_url"` / `"back_image_url"`: in `slab-public.json` set `"front_image_url": "/__ref/slabsence spongebob.jpg", "back_image_url": null`; in `slab-public-noimage.json` both `null`. Run `node scripts/verify-slabview.cjs` → the `found` runs still say `state= found label= drawn` but the page shows "No images on file" (the old keys are gone) — that is the failing state to fix.

- [ ] **Step 2: Update `slabview.js`**

In `showSide(row, side)`: `var src = side==="front" ? row.front_image_url : row.back_image_url;`. In the images section of `render(row)`: `var imgs=[["Front",row.front_image_url],["Back",row.back_image_url]].filter(function(x){return x[1];});`. No other reference to the old column names may remain: `grep -n "user_card_image\|enhanced_\|image_path" public/slab/slabview.js` → no output.

- [ ] **Step 3: Verify** — `node scripts/verify-slabview.cjs` → `PASS`; open `scripts/out-slabview-found.png`: card in the well and one "Front" image in the report; `out-slabview-noimage.png`: empty well, "No images on file".

- [ ] **Step 4: Commit**

```bash
git add public/slab/slabview.js scripts/fixtures/slab-public.json scripts/fixtures/slab-public-noimage.json
git commit -m "feat(slabview): show cert-keyed slab images"
```

---

### Task 6: Runbook and live test

**Files:**
- Create: `docs/superpowers/runbooks/slab-order-setup.md`

- [ ] **Step 1: Write the runbook**

```markdown
# Slab order — one-time setup and first live test

## Stripe (dashboard)
1. Products → Add product: "SlabSense slabbing" · one-time price (USD) · copy the **Price ID** (`price_…`). Use test mode first, then repeat in live mode.
2. Developers → Webhooks: the existing endpoint `https://slabsenseai.com/api/stripe/webhook` must include `checkout.session.completed` (it already does for credits).

## Vercel
- Environment variable `STRIPE_PRICE_SLAB` = the Price ID (test id on Preview, live id on Production). Redeploy.

## Supabase
- Apply `supabase/migrations/20260912_slabs.sql` (Plan A) then `supabase/migrations/20260913_slab_images.sql` in the SQL editor.

## First test (Stripe test mode)
1. In the app, open a graded card → **Get it slabbed** → Checkout opens with a shipping form. Pay with card `4242 4242 4242 4242`, any future date, any CVC, a US address.
2. Back in the app the card detail shows `Slab SS26-0000N · Paid — awaiting engraving`.
3. SQL editor: `select cert, status, front_image_url, back_image_url, shipping->'address'->>'postal_code' as zip from slabs order by paid_at desc limit 1;` — the URLs point at `slab-images/<cert>/…`.
4. Open `https://slabsenseai.com/v/<cert>`: the card photo, the label, the report and the "Paid — awaiting engraving" status.
5. Stripe dashboard → Webhooks → the event shows `200`. If it shows `500`, read the Vercel function log; the event will be retried and processed once the cause is fixed.

## Cleaning up test orders
`delete from slabs where cert = 'SS26-0000N';` then, if you want the numbering to restart, `alter sequence slab_cert_seq restart with 1;` and remove the test files from the `slab-images` bucket.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/slab-order-setup.md
git commit -m "docs(slabs): order setup runbook"
```

- [ ] **Step 3: Live test (human, after merge + deploy)** — follow the runbook. This is the only end-to-end verification of the Stripe routes; record the outcome (cert minted, images copied, webhook 200) in the PR or the ledger.

---

## Self-review

**Spec coverage:** §4 payment → cert: price key + shipping collection (Task 3), webhook mint idempotent on session id (Task 2 select-first + Task 3), "Get it slabbed" button with disabled states and post-purchase status (Task 4). §3.2 amendment + Plan A deferral (images no longer expose `user_id` paths): Task 1 view + Task 2 copy + Task 5 page. §9 "webhook insert failure → 500 so Stripe retries": Task 3's claim cleanup makes that true. §10 webhook unit test with a fixture payload: replaced by fake-backed tests of `mintSlab` (the route files instantiate Stripe at import and cannot be imported without secrets) plus the runbook's live test — a documented deviation.

**Not in this plan:** studio queue mode, admin routes, `label_svg_path` writes (Plan C); the app's handling of `?slab_ordered=1` on return (the status line refreshes when the card is reopened — acceptable for v1).

**Type consistency:** `mintSlab` returns `{slab, created}`; the webhook logs `slab.cert`/`slab.scan_id`. `pickImages` keys `front`/`back` feed `copySlabImages`, which returns `front_image_url`/`back_image_url` — the same names the migration adds and `slabview.js` reads. `orderSlab` posts `priceKey: 'slab'`, matching `SLAB_PRICE_KEY` and the `PRICES` key.
