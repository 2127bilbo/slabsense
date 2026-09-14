# Studio Queue & Admin Routes Implementation Plan (Plan C of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed in as admin, `/studio` shows the paid slabs; one click renders the label from the record, Download SVG stores the SVG and marks the slab engraved, Mark shipped finishes it — and the public cert page shows exactly the label that was engraved.

**Architecture:** A JWT-verifying auth helper (`api/_lib/auth.js`) gates three new serverless routes (`api/slabs/config|queue|status`) and hardens the slab checkout. The studio (`public/slab/studio.js`) gains a signed-in **queue mode** beside the existing manual mode, using the same Supabase accounts as the app via a vendored supabase-js. At engrave time the studio posts the label text and settings it used; they are stored on the `slabs` row and the cert page renders from them, so what's engraved and what's shown can't drift.

**Tech Stack:** Vercel serverless (ESM), Supabase (auth JWT verification with the service-role client, storage bucket `slab-labels`), vendored `@supabase/supabase-js` UMD in the static studio, plain-node `.cjs` verification scripts with fakes, headless Chrome for the studio harness.

**Spec:** `docs/superpowers/specs/2026-09-12-slab-integration-design.md` §6 (studio), §8 (routes), §3.3 (bucket), §9/§10. Plans A and B are merged on `main` (`766997b`).

## Global Constraints

- Branch `feat/studio-queue` from `main`. Commit after every task. No push until the end.
- Admin = `ADMIN_USER_IDS` env (comma-separated Supabase user ids). Every admin route verifies `Authorization: Bearer <supabase access token>` with `db.auth.getUser(token)` and checks membership; anything else → 401 (no/invalid token) or 403 (not admin). Never trust a user id from the request body on these routes.
- Slab checkout (`priceKey === 'slab'`) requires a bearer token; the paying `userId` is the token's user, not the body's. Other price keys keep today's behaviour.
- Status transitions are only `paid → engraved` (requires the SVG + label text + settings) and `engraved → shipped`. Anything else → 409 `bad_transition`.
- The SVG is stored at `slab-labels/<cert>.svg` (private bucket, service role only); `slabs.label_svg_path` = that path; `engraved_at` / `shipped_at` stamped server-side.
- `slabs.label_text jsonb` (the exact `{name,l2,l3,l4,cert,grade,gradeWord}` rendered) and `slabs.label_settings jsonb` (the settings object minus `secret`) are written at engrave time and exposed through `slab_public`; the cert page prefers them over `fromScan`/defaults when present.
- Queue mode always renders with `useToken:false` (the public page URL must be `<base><cert>` exactly) and with `certPos`, fonts, dividers etc. from the admin's saved studio settings — that is what gets stored as `label_settings`.
- Manual mode is unchanged (TEST- certs, no server calls).
- No external CDN: `@supabase/supabase-js` is vendored to `public/slab/vendor/supabase.js`.
- Repo is `"type": "module"`; scripts under `scripts/` are `.cjs`; route tests inject fakes via `makeHandler(deps)`; no env/network in tests.
- Migrations are applied by pasting into the Supabase SQL editor.

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260914_slab_label.sql` | `label_text`, `label_settings` on `slabs`; recreate `slab_public` with them |
| `api/_lib/auth.js` | `bearerToken(req)`, `requireUser(deps, req)`, `requireAdmin(deps, req)`, `sendAuthError(res, err)` |
| `api/_lib/slabs.js` | + `QUEUE_SELECT`, `flattenQueueRow(raw)`, `assertTransition(from, to)`, `statusPatch(to, now)`, `sanitizeSettings(s)` |
| `api/slabs/config.js` | GET public Supabase URL + anon key (for the static studio) |
| `api/slabs/queue.js` | GET admin: rows by status (+ search) |
| `api/slabs/status.js` | POST admin: transition + SVG upload |
| `api/stripe/create-checkout.js` | slab branch takes the user from the bearer token |
| `src/services/slabs.js` | `orderSlab` sends the bearer token |
| `public/slab/vendor/supabase.js` | vendored supabase-js UMD |
| `public/studio.html`, `public/slab/studio.js` | sign-in bar, queue panel, queue render/engrave/ship actions |
| `public/slab/slabview.js` | render from `label_text` / `label_settings` when present |
| `scripts/verify-auth.cjs`, `scripts/verify-slabs-routes.cjs`, `scripts/verify-studio-queue.cjs` | tests |
| `docs/superpowers/runbooks/slab-order-setup.md` | admin env var, queue how-to, go-live section |

---

### Task 1: Migration — label text/settings on the slab

**Files:** Create `supabase/migrations/20260914_slab_label.sql`

- [ ] **Step 1: Write it**

```sql
-- 20260914_slab_label.sql — what was engraved: the exact label text and settings, stored at engrave time.
-- Apply in the Supabase SQL editor after 20260913_slab_images.sql. Safe to re-run.

alter table slabs add column if not exists label_text jsonb;
alter table slabs add column if not exists label_settings jsonb;

drop view if exists slab_public;
create view slab_public with (security_invoker = false) as
select
  s.cert, s.status, s.paid_at, s.engraved_at, s.shipped_at,
  c.card_name, c.card_set, c.card_number, c.card_game, c.card_info,
  c.grade_value, c.grade_label, c.subgrades, c.front_centering, c.back_centering, c.dings,
  s.front_image_url, s.back_image_url,
  s.label_text, s.label_settings
from slabs s
join scans c on c.id = s.scan_id;

revoke select on slab_public from anon, authenticated;
```

- [ ] **Step 2: Static check** — `node -e "const s=require('fs').readFileSync('supabase/migrations/20260914_slab_label.sql','utf8');const v=s.match(/create view[\s\S]*?from slabs/)[0];console.log(v.split(',').length,'columns;',/label_text/.test(v)&&/label_settings/.test(v)?'has label cols':'MISSING')"` → `20 columns; has label cols`.
- [ ] **Step 3: Commit** — `git checkout -b feat/studio-queue && git add supabase/migrations/20260914_slab_label.sql && git commit -m "feat(db): store engraved label text and settings on slabs; expose via slab_public"`

---

### Task 2: `api/_lib/auth.js`

**Files:** Create `api/_lib/auth.js`, `scripts/verify-auth.cjs`

**Interfaces (Produces):**
```js
export function bearerToken(req)                    // → string|null from Authorization: Bearer …
export async function requireUser({ db }, req)      // → { id, email }  | throws AuthError(401,'unauthorized')
export async function requireAdmin({ db, adminIds }, req) // → user | throws AuthError(403,'forbidden')
export function adminIdsFromEnv(env)                // → Set of ids from env.ADMIN_USER_IDS
export class AuthError extends Error { status; code }
export function sendAuthError(res, err)             // res.status(err.status).json({error: err.code}); rethrows non-AuthError
```

- [ ] **Step 1: Test**

`scripts/verify-auth.cjs`:
```js
(async()=>{
const {bearerToken,requireUser,requireAdmin,adminIdsFromEnv,AuthError,sendAuthError}=await import('../api/_lib/auth.js');
let bad=0;const fail=(m,...x)=>{console.log('FAIL',m,...x);bad++;};
const req=(h)=>({headers:h||{}});
if(bearerToken(req({authorization:'Bearer abc'}))!=='abc')fail('bearer');
if(bearerToken(req({Authorization:'bearer xyz'}))!=='xyz')fail('bearer case');
if(bearerToken(req({}))!==null)fail('no header');
const db={auth:{getUser:async(t)=>t==='good'?{data:{user:{id:'u1',email:'a@b'}},error:null}:{data:{user:null},error:{message:'bad'}}}};
let u=await requireUser({db},req({authorization:'Bearer good'}));if(u.id!=='u1')fail('requireUser ok',u);
for(const h of [{},{authorization:'Bearer nope'}]){try{await requireUser({db},req(h));fail('requireUser should throw',h);}catch(e){if(!(e instanceof AuthError)||e.status!==401)fail('401',e);}}
const adminIds=adminIdsFromEnv({ADMIN_USER_IDS:' u1 , u9 '});if(!adminIds.has('u1')||!adminIds.has('u9')||adminIds.size!==2)fail('adminIds',adminIds);
if(adminIdsFromEnv({}).size!==0)fail('adminIds empty');
u=await requireAdmin({db,adminIds},req({authorization:'Bearer good'}));if(u.id!=='u1')fail('admin ok');
try{await requireAdmin({db,adminIds:new Set(['u2'])},req({authorization:'Bearer good'}));fail('admin should 403');}catch(e){if(e.status!==403||e.code!=='forbidden')fail('403',e);}
try{await requireAdmin({db,adminIds},req({}));fail('admin no token should 401');}catch(e){if(e.status!==401)fail('401 admin',e);}
const res={code:0,body:null,status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
sendAuthError(res,new AuthError(403,'forbidden'));if(res.code!==403||res.body.error!=='forbidden')fail('sendAuthError');
let rethrown=false;try{sendAuthError(res,new Error('boom'));}catch(e){rethrown=e.message==='boom';}if(!rethrown)fail('sendAuthError rethrows');
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
```

- [ ] **Step 2: Run → `Cannot find module`.**
- [ ] **Step 3: Implement**

```js
/** api/_lib/auth.js — Supabase JWT verification for serverless routes. Inject `db` (service-role client). */
export class AuthError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

export function bearerToken(req) {
  const h = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1] : null;
}

export async function requireUser({ db }, req) {
  const token = bearerToken(req);
  if (!token) throw new AuthError(401, 'unauthorized');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new AuthError(401, 'unauthorized');
  return { id: data.user.id, email: data.user.email };
}

export function adminIdsFromEnv(env) {
  return new Set(String(env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

export async function requireAdmin({ db, adminIds }, req) {
  const user = await requireUser({ db }, req);
  if (!adminIds.has(user.id)) throw new AuthError(403, 'forbidden');
  return user;
}

export function sendAuthError(res, err) {
  if (err instanceof AuthError) return res.status(err.status).json({ error: err.code });
  throw err;
}
```

- [ ] **Step 4: Run → `PASS`.  Commit:** `git add api/_lib/auth.js scripts/verify-auth.cjs && git commit -m "feat(api): Supabase JWT auth helper with admin allow-list"`

---

### Task 3: Queue/status/config routes + lib additions

**Files:** Modify `api/_lib/slabs.js`; create `api/slabs/config.js`, `api/slabs/queue.js`, `api/slabs/status.js`, `scripts/verify-slabs-routes.cjs`

**Interfaces (Produces):**
- `GET /api/slabs/config` → `200 { supabaseUrl, anonKey }` (public; values are public by design).
- `GET /api/slabs/queue?status=paid|engraved|shipped[&q=text]` (admin) → `200 { rows: [ {cert,status,paid_at,engraved_at,shipped_at,shipping,front_image_url,back_image_url,label_svg_path,label_text,label_settings, scan:{id,card_name,card_set,card_number,card_game,card_info,grade_value,grade_label}} ] }` ordered by `paid_at` asc for `paid`, desc otherwise; `q` filters by cert or card name (case-insensitive substring, server-side after fetch, max 200 rows).
- `POST /api/slabs/status` (admin) body `{ cert, status:'engraved', svg, label_text, label_settings }` or `{ cert, status:'shipped' }` → `200 { slab }`; `404 not_found`; `409 bad_transition`; `400 svg_required`.
- Lib: `assertTransition(from,to)` throws `Error('bad_transition')`; `statusPatch(to, now=new Date())` → `{status, engraved_at|shipped_at}`; `sanitizeSettings(s)` → copy without `secret`, `useToken:false`; `flattenQueueRow(raw)` → the row shape above (supabase join comes back as `raw.scans`).

- [ ] **Step 1: Test** — `scripts/verify-slabs-routes.cjs`:
```js
(async()=>{
const L=await import('../api/_lib/slabs.js');
const {makeHandler:mkQueue}=await import('../api/slabs/queue.js');
const {makeHandler:mkStatus}=await import('../api/slabs/status.js');
const {makeHandler:mkConfig}=await import('../api/slabs/config.js');
let bad=0;const fail=(m,...x)=>{console.log('FAIL',m,...x);bad++;};
function res(){return {code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;},end(){return this;}};}
// lib
try{L.assertTransition('paid','engraved');L.assertTransition('engraved','shipped');}catch(e){fail('good transitions',e);}
for(const [a,b] of [['paid','shipped'],['engraved','engraved'],['shipped','paid'],['paid','paid']]){let t=false;try{L.assertTransition(a,b);}catch(e){t=e.message==='bad_transition';}if(!t)fail('bad transition '+a+'>'+b);}
const now=new Date('2026-09-14T10:00:00Z');
if(JSON.stringify(L.statusPatch('engraved',now))!=='{"status":"engraved","engraved_at":"2026-09-14T10:00:00.000Z"}')fail('patch engraved');
if(JSON.stringify(L.statusPatch('shipped',now))!=='{"status":"shipped","shipped_at":"2026-09-14T10:00:00.000Z"}')fail('patch shipped');
const san=L.sanitizeSettings({W:69,secret:'s3',useToken:true,base:'x/'});if('secret' in san||san.useToken!==false||san.W!==69)fail('sanitize',san);
const flat=L.flattenQueueRow({cert:'SS26-00001',status:'paid',scans:{id:'s1',card_name:'Glaceon',grade_value:9}});if(flat.scan.card_name!=='Glaceon'||'scans' in flat||flat.cert!=='SS26-00001')fail('flatten',flat);
// fakes
const admin={auth:{getUser:async(t)=>t==='adm'?{data:{user:{id:'u1'}},error:null}:t==='usr'?{data:{user:{id:'u2'}},error:null}:{data:{user:null},error:{message:'x'}}}};
const rows=[{cert:'SS26-00001',status:'paid',paid_at:'2026-09-13',scans:{id:'s1',card_name:'Glaceon'}},{cert:'SS26-00002',status:'paid',paid_at:'2026-09-14',scans:{id:'s2',card_name:'Pikachu'}}];
function fakeDb(){const st={rows:rows.map(r=>({...r})),updates:[],uploads:[]};
  const q=(t)=>{let f=[],ord=null;const b={select:()=>b,eq:(k,v)=>{f.push([k,v]);return b;},order:(k,o)=>{ord=[k,o];return b;},limit:()=>b,
    maybeSingle:async()=>({data:st.rows.find(r=>f.every(([k,v])=>r[k]===v))||null,error:null}),
    update:(patch)=>({eq:async(k,v)=>{const r=st.rows.find(r=>r[k]===v);if(r)Object.assign(r,patch);st.updates.push({patch,k,v});return {data:null,error:null};}}),
    then:(ok)=>ok({data:st.rows.filter(r=>f.every(([k,v])=>r[k]===v)),error:null})};
    return b;};
  return {st,auth:admin.auth,from:q,storage:{from:(bk)=>({upload:async(p,body,o)=>{st.uploads.push({bk,p,len:String(body).length,o});return {data:{path:p},error:null};}})}};
}
const deps=(db)=>({db,adminIds:new Set(['u1'])});
// config
let r=res();await mkConfig({env:{VITE_SUPABASE_URL:'https://x.supabase.co',VITE_SUPABASE_ANON_KEY:'anon'}})({method:'GET',headers:{}},r);
if(r.code!==200||r.body.supabaseUrl!=='https://x.supabase.co'||r.body.anonKey!=='anon')fail('config',r.body);
// queue auth
let db=fakeDb();r=res();await mkQueue(deps(db))({method:'GET',headers:{},query:{status:'paid'}},r);if(r.code!==401)fail('queue 401',r.code);
r=res();await mkQueue(deps(db))({method:'GET',headers:{authorization:'Bearer usr'},query:{status:'paid'}},r);if(r.code!==403)fail('queue 403',r.code);
r=res();await mkQueue(deps(db))({method:'GET',headers:{authorization:'Bearer adm'},query:{status:'paid'}},r);
if(r.code!==200||r.body.rows.length!==2||r.body.rows[0].scan.card_name!=='Glaceon')fail('queue rows',r.code,r.body);
r=res();await mkQueue(deps(db))({method:'GET',headers:{authorization:'Bearer adm'},query:{status:'paid',q:'pika'}},r);if(r.body.rows.length!==1||r.body.rows[0].cert!=='SS26-00002')fail('queue search',r.body);
r=res();await mkQueue(deps(db))({method:'GET',headers:{authorization:'Bearer adm'},query:{status:'bogus'}},r);if(r.code!==400)fail('queue bad status',r.code);
// status: engrave
const svg='<?xml version="1.0"?><svg/>';const lt={name:'GLACEON',cert:'SS26-00001',grade:'9',gradeWord:'MINT'};
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'engraved'}},r);if(r.code!==400||r.body.error!=='svg_required')fail('svg required',r.code,r.body);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'engraved',svg,label_text:lt,label_settings:{W:69,secret:'z',useToken:true}}},r);
if(r.code!==200||r.body.slab.status!=='engraved'||!r.body.slab.engraved_at)fail('engrave',r.code,r.body);
if(db.st.uploads.length!==1||db.st.uploads[0].bk!=='slab-labels'||db.st.uploads[0].p!=='SS26-00001.svg'||db.st.uploads[0].o.contentType!=='image/svg+xml')fail('svg upload',db.st.uploads);
const up=db.st.updates.find(u=>u.patch.status==='engraved').patch;if(up.label_svg_path!=='SS26-00001.svg'||up.label_text.name!=='GLACEON'||'secret' in up.label_settings||up.label_settings.useToken!==false)fail('engrave patch',up);
// status: bad transition, ship, not found
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'engraved',svg,label_text:lt,label_settings:{}}},r);if(r.code!==409)fail('re-engrave 409',r.code);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-00001',status:'shipped'}},r);if(r.code!==200||r.body.slab.status!=='shipped'||!r.body.slab.shipped_at)fail('ship',r.code,r.body);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer adm'},body:{cert:'SS26-99999',status:'shipped'}},r);if(r.code!==404)fail('status 404',r.code);
r=res();await mkStatus(deps(db))({method:'POST',headers:{authorization:'Bearer usr'},body:{cert:'SS26-00002',status:'shipped'}},r);if(r.code!==403)fail('status 403',r.code);
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
```

- [ ] **Step 2: Run → fails (`Cannot find module`).**
- [ ] **Step 3: Lib additions** (append to `api/_lib/slabs.js`):

```js
/* ---- queue / status (Plan C) ---- */
export const QUEUE_SELECT = 'cert,status,paid_at,engraved_at,shipped_at,shipping,front_image_url,back_image_url,label_svg_path,label_text,label_settings,scans(id,card_name,card_set,card_number,card_game,card_info,grade_value,grade_label)';
export const SLAB_LABEL_BUCKET = 'slab-labels';
const TRANSITIONS = { paid: 'engraved', engraved: 'shipped' };

export function assertTransition(from, to) {
  if (TRANSITIONS[from] !== to) throw new Error('bad_transition');
}
export function statusPatch(to, now = new Date()) {
  const p = { status: to };
  if (to === 'engraved') p.engraved_at = now.toISOString();
  if (to === 'shipped') p.shipped_at = now.toISOString();
  return p;
}
/** Settings stored with the slab: never the signing secret, never a token in the public URL. */
export function sanitizeSettings(s) {
  const out = {};
  for (const k in (s || {})) if (k !== 'secret') out[k] = s[k];
  out.useToken = false;
  return out;
}
export function flattenQueueRow(raw) {
  const { scans, ...rest } = raw;
  return { ...rest, scan: scans || null };
}
```

`api/slabs/config.js`:
```js
/** GET /api/slabs/config — public Supabase connection values for the static studio page. */
export const config = { maxDuration: 5 };
export function makeHandler({ env }) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    return res.status(200).json({ supabaseUrl: env.VITE_SUPABASE_URL || env.SUPABASE_URL || '', anonKey: env.VITE_SUPABASE_ANON_KEY || '' });
  };
}
export default makeHandler({ env: process.env });
```

`api/slabs/queue.js`:
```js
/** GET /api/slabs/queue?status=paid|engraved|shipped[&q=] — admin only. */
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, adminIdsFromEnv, sendAuthError } from '../_lib/auth.js';
import { QUEUE_SELECT, flattenQueueRow } from '../_lib/slabs.js';

export const config = { maxDuration: 10 };
const STATUSES = ['paid', 'engraved', 'shipped'];

export function makeHandler({ db, adminIds }) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    try { await requireAdmin({ db, adminIds }, req); } catch (e) { return sendAuthError(res, e); }
    const status = String(req.query?.status || 'paid');
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'bad_status' });
    const q = String(req.query?.q || '').trim().toLowerCase();
    const { data, error } = await db.from('slabs').select(QUEUE_SELECT).eq('status', status)
      .order('paid_at', { ascending: status === 'paid' }).limit(200);
    if (error) { console.error('[slabs/queue]', error); return res.status(500).json({ error: 'query_failed' }); }
    let rows = (data || []).map(flattenQueueRow);
    if (q) rows = rows.filter((r) => r.cert.toLowerCase().includes(q) || String(r.scan?.card_name || '').toLowerCase().includes(q));
    return res.status(200).json({ rows });
  };
}
const supabase = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://localhost', process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing');
export default makeHandler({ db: supabase, adminIds: adminIdsFromEnv(process.env) });
```

`api/slabs/status.js`:
```js
/** POST /api/slabs/status — admin only. {cert,status:'engraved',svg,label_text,label_settings} | {cert,status:'shipped'} */
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, adminIdsFromEnv, sendAuthError } from '../_lib/auth.js';
import { assertTransition, statusPatch, sanitizeSettings, SLAB_LABEL_BUCKET } from '../_lib/slabs.js';

export const config = { maxDuration: 10 };

export function makeHandler({ db, adminIds, now }) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    try { await requireAdmin({ db, adminIds }, req); } catch (e) { return sendAuthError(res, e); }
    const body = req.body || {};
    const cert = String(body.cert || '').trim().toUpperCase();
    const to = String(body.status || '');
    if (!cert) return res.status(400).json({ error: 'cert_required' });
    const { data: slab, error } = await db.from('slabs').select('*').eq('cert', cert).maybeSingle();
    if (error) { console.error('[slabs/status]', error); return res.status(500).json({ error: 'query_failed' }); }
    if (!slab) return res.status(404).json({ error: 'not_found' });
    try { assertTransition(slab.status, to); } catch { return res.status(409).json({ error: 'bad_transition', from: slab.status }); }
    const patch = statusPatch(to, now ? now() : new Date());
    if (to === 'engraved') {
      if (typeof body.svg !== 'string' || !body.svg.startsWith('<?xml')) return res.status(400).json({ error: 'svg_required' });
      if (!body.label_text || typeof body.label_text !== 'object') return res.status(400).json({ error: 'label_text_required' });
      const path = `${cert}.svg`;
      const up = await db.storage.from(SLAB_LABEL_BUCKET).upload(path, body.svg, { contentType: 'image/svg+xml', upsert: true });
      if (up.error) { console.error('[slabs/status] upload', up.error); return res.status(500).json({ error: 'upload_failed' }); }
      patch.label_svg_path = path;
      patch.label_text = body.label_text;
      patch.label_settings = sanitizeSettings(body.label_settings);
    }
    const upd = await db.from('slabs').update(patch).eq('cert', cert);
    if (upd.error) { console.error('[slabs/status] update', upd.error); return res.status(500).json({ error: 'update_failed' }); }
    return res.status(200).json({ slab: { ...slab, ...patch } });
  };
}
const supabase = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://localhost', process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing');
export default makeHandler({ db: supabase, adminIds: adminIdsFromEnv(process.env) });
```
(Vercel parses JSON bodies for `api/*.js` by default; the SVG is ~400 KB — under the 4.5 MB body limit.)

- [ ] **Step 4: Run → `PASS`. Also `node scripts/verify-slabs-lib.cjs` still `PASS`.  Commit:** `git add api/_lib/slabs.js api/slabs scripts/verify-slabs-routes.cjs && git commit -m "feat(api): admin slab queue and status routes; public studio config"`

---

### Task 4: Slab checkout takes the user from the token

**Files:** Modify `api/stripe/create-checkout.js`, `src/services/slabs.js`

- [ ] **Step 1:** In `create-checkout.js` import `{ requireUser, sendAuthError }` from `../_lib/auth.js`. At the top of the `if (priceKey === SLAB_PRICE_KEY) {` branch — before `if (!scanId)` — add:
```js
      let payer;
      try { payer = await requireUser({ db: supabase }, req); } catch (e) { return sendAuthError(res, e); }
      if (payer.id !== userId) return res.status(403).json({ error: 'user_mismatch' });
```
(The rest of the branch keeps using `userId`, now proven to equal the token's user. The customer get-or-create above already ran for `userId`; that is fine because the mismatch case returns before any session is created.)

- [ ] **Step 2:** In `src/services/slabs.js` `orderSlab`: before the fetch, `const { data: { session } } = await supabase.auth.getSession(); if (!session) throw new Error('Please sign in again.');` and add `Authorization: \`Bearer ${session.access_token}\`` to the request headers.

- [ ] **Step 3:** `node --check api/stripe/create-checkout.js && npm run build` (both succeed). **Commit:** `git add api/stripe/create-checkout.js src/services/slabs.js && git commit -m "fix(stripe): slab checkout requires a signed-in user matching the scan owner"`

---

### Task 5: Studio queue mode

**Files:** Create `public/slab/vendor/supabase.js`; modify `public/studio.html`, `public/slab/studio.js`; create `scripts/verify-studio-queue.cjs`

**Interfaces:**
- Consumes `/api/slabs/config`, `/api/slabs/queue`, `/api/slabs/status` (Task 3), `SlabLabel`.
- Produces on `window.SlabStudio`: `queue.setRows(rows)` (test hook: render a queue without the network), `queue.select(cert)`, `queue.mode()` → `'manual'|'queue'`, `getEngravePayload()` → `{cert, svg, label_text, label_settings}`.

- [ ] **Step 1: Vendor supabase-js** — `curl -sL -o public/slab/vendor/supabase.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js` and confirm `head -c 200` shows a UMD header and `grep -c "createClient" public/slab/vendor/supabase.js` > 0. (Loaded in the page as `window.supabase.createClient`.)

- [ ] **Step 2: Test first** — `scripts/verify-studio-queue.cjs` (serve `public/` over HTTP like `verify-slabview.cjs`; stub the network inside the page):
```js
// Drives the studio's queue mode with stubbed API/auth: rows appear, selecting one renders the label from
// the record with the real SS cert, the engrave payload carries svg + label_text + sanitized settings.
const fs=require('fs'),cp=require('child_process'),path=require('path'),http=require('http');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.join(__dirname,'..'),MIME={'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);const f=u==='/__wrap.html'?path.join(__dirname,'__studio-wrap.html'):path.join(root,'public',u);
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d);});});
const rows=[{cert:'SS26-00001',status:'paid',paid_at:'2026-09-13T23:30:10Z',shipping:{name:'Bob',address:{line1:'1 Main St',city:'Indy',state:'IN',postal_code:'46201',country:'US'}},front_image_url:null,scan:{id:'s1',card_name:'Glaceon',card_set:'2008 Pokémon Majestic Dawn',card_number:'5',card_game:'pokemon',card_info:{rarity:'Holo Rare'},grade_value:9,grade_label:'Mint'}}];
fs.writeFileSync(path.join(__dirname,'__studio-wrap.html'),`<!doctype html><meta charset="utf-8"><iframe id="f" src="/studio.html?queue=1" style="width:1400px;height:900px"></iframe><pre id="out"></pre><pre id="err"></pre>
<script>
document.getElementById('f').addEventListener('load',function(){var w=document.getElementById('f').contentWindow,api=w.SlabStudio,log=[];
 Promise.resolve(api.ready).then(function(){ api.queue.setRows(${JSON.stringify(rows)}); log.push(['mode',api.queue.mode()]); log.push(['rows',w.document.querySelectorAll('#queueList .qrow').length]);
   return api.queue.select('SS26-00001'); }).then(function(){ var s=api.getState(); log.push(['cert',s.cert]); log.push(['url',s.url]); log.push(['name',w.document.getElementById('name').value]);
   var p=api.getEngravePayload(); log.push(['svg',p.svg.slice(0,5)]); log.push(['lt',p.label_text.name+'/'+p.label_text.grade+'/'+p.label_text.gradeWord]); log.push(['token',String(p.label_settings.useToken)+'/'+('secret' in p.label_settings)]);
   log.push(['ship',w.document.getElementById('queueShip').textContent.indexOf('46201')>=0]);
   document.getElementById('out').textContent=JSON.stringify(log);}).catch(function(e){document.getElementById('err').textContent='ERR '+(e&&e.stack||e);});});
</script>`);
server.listen(4176,()=>{cp.execFile(CHROME,['--headless=new','--disable-gpu','--virtual-time-budget=10000','--dump-dom','http://localhost:4176/__wrap.html'],{encoding:'utf8',maxBuffer:64e6},(err,dom)=>{
  const dec=s=>s.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const e=(dom.match(/<pre id="err">([\s\S]*?)<\/pre>/)||[])[1];if(e&&e.trim()){console.log(dec(e).slice(0,600));server.close();process.exit(2);}
  const log=JSON.parse(dec((dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)||[])[1]));console.log(JSON.stringify(log));const m=Object.fromEntries(log);
  const ok=m.mode==='queue'&&m.rows===1&&m.cert==='SS26-00001'&&m.url==='SLABSENSEAI.COM/V/SS26-00001'&&m.name==='GLACEON'&&m.svg==='<?xml'&&m.lt==='GLACEON/9/MINT'&&m.token==='false/false'&&m.ship===true;
  fs.unlinkSync(path.join(__dirname,'__studio-wrap.html'));server.close();process.exit(ok?0:1);});});
```
`?queue=1` puts the page in queue mode without a session (test-only: rows come from `setRows`, and network calls are skipped when `location.hostname==='localhost'` and `queue=1` is present). Run → fails (no `api.queue`).

- [ ] **Step 3: Markup** (`public/studio.html`) — in `.top`, before the Settings button, add:
```html
      <div class="auth" id="auth">
        <form id="signin" class="signin"><input type="email" id="authEmail" placeholder="admin email" autocomplete="username"><input type="password" id="authPass" placeholder="password" autocomplete="current-password"><button type="submit" class="sm">Sign in</button></form>
        <div id="signedIn" hidden><span id="authWho"></span> <button type="button" class="sm" id="signout">Sign out</button></div>
        <div class="modes" id="modes" hidden><button type="button" class="sm" id="modeQueue" aria-pressed="true">Queue</button><button type="button" class="sm" id="modeManual" aria-pressed="false">Manual</button></div>
      </div>
```
Add a new first `<details class="grp" open id="queuePanel" hidden>` inside the left panel:
```html
      <details class="grp" open id="queuePanel" hidden>
        <summary>Queue</summary>
        <div class="body">
          <div class="presets"><button type="button" data-qstatus="paid" aria-pressed="true">To engrave</button><button type="button" data-qstatus="engraved" aria-pressed="false">To ship</button><button type="button" data-qstatus="shipped" aria-pressed="false">Done</button></div>
          <label class="f"><span>Search</span><input type="text" id="queueSearch" placeholder="cert or card name" autocomplete="off"></label>
          <div id="queueList" class="qlist"></div>
          <div id="queueDetail" hidden>
            <p class="hint" id="queueMeta"></p>
            <pre id="queueShip" class="ship"></pre>
            <div class="btns" style="margin-top:8px"><button type="button" class="sm" id="copyShip">Copy address</button><button type="button" class="sm primary" id="markShipped" hidden>Mark shipped</button></div>
          </div>
          <p class="hint" id="queueMsg"></p>
        </div>
      </details>
```
CSS to add: `.auth{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.signin{display:flex;gap:6px}.signin input{width:150px}.modes button[aria-pressed=true]{border-color:var(--accent)}.qlist{max-height:260px;overflow:auto;border:1px solid var(--line2);border-radius:8px}.qrow{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:8px 10px;border-bottom:1px solid var(--line2);cursor:pointer;font-size:13px}.qrow:hover,.qrow[aria-selected=true]{background:var(--panel2)}.qrow b{font-weight:600}.qrow span{color:var(--muted);font-size:11.5px}.ship{margin:6px 0 0;padding:8px 10px;background:var(--panel2);border:1px solid var(--line2);border-radius:8px;font:12px ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}`.
Script tags: add `<script src="slab/vendor/supabase.js"></script>` before `slab/studio.js`. Change the `.sub` text to: `Queue mode: sign in to see paid slabs, render each label from the record, and mark them engraved and shipped. Manual mode is for test tiles (TEST- certs).`

- [ ] **Step 4: `studio.js` queue mode** — add after the existing wiring, before the `window.SlabStudio` block:

```js
/* ================= queue mode (admin) ================= */
var Q={mode:"manual",rows:[],status:"paid",selected:null,client:null,session:null,testing:false};
var qs=new URLSearchParams(location.search);
Q.testing=qs.get("queue")==="1"&&/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
function qEl(id){return document.getElementById(id);}
function authHeaders(){return Q.session?{"Authorization":"Bearer "+Q.session.access_token}:{};}
function api(path,opts){
  opts=opts||{};opts.headers=Object.assign({"Content-Type":"application/json"},authHeaders(),opts.headers||{});
  return fetch(path,opts).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j;});});
}
function setMode(m){
  Q.mode=m;
  qEl("queuePanel").hidden=m!=="queue";
  qEl("modeQueue").setAttribute("aria-pressed",m==="queue");qEl("modeManual").setAttribute("aria-pressed",m==="manual");
  el.cert.readOnly=true; qEl("certEdit").hidden=m==="queue"; qEl("certReset").hidden=true;
  if(m==="manual"){Q.selected=null;certOverride=null;queueGrade=null;render();}
}
var queueGrade=null;                      // {grade,gradeWord} from the record while a queue row is selected
function renderQueueList(){
  var list=qEl("queueList"), q=(qEl("queueSearch").value||"").toLowerCase();
  var rows=Q.rows.filter(function(r){return !q||r.cert.toLowerCase().indexOf(q)>=0||String(r.scan&&r.scan.card_name||"").toLowerCase().indexOf(q)>=0;});
  list.innerHTML=rows.map(function(r){var sc=r.scan||{};var d=r.status==="paid"?r.paid_at:(r.status==="engraved"?r.engraved_at:r.shipped_at);
    return '<div class="qrow" data-cert="'+esc(r.cert)+'" aria-selected="'+(Q.selected&&Q.selected.cert===r.cert)+'"><b>'+esc(sc.card_name||"(no name)")+'</b><b>'+esc(r.cert)+'</b><span>'+esc(String(sc.grade_value==null?"":sc.grade_value)+" "+(sc.grade_label||""))+'</span><span>'+esc(d?new Date(d).toLocaleDateString():"")+'</span></div>';}).join("")||'<div class="qrow"><span>Nothing here.</span></div>';
  Array.prototype.forEach.call(list.querySelectorAll(".qrow[data-cert]"),function(n){n.addEventListener("click",function(){selectQueueRow(n.getAttribute("data-cert"));});});
}
function fmtShip(sh){if(!sh)return "(no shipping address on the order)";var a=sh.address||{};return [sh.name,a.line1,a.line2,[a.city,a.state,a.postal_code].filter(Boolean).join(", "),a.country].filter(Boolean).join("\n");}
function selectQueueRow(cert){
  var r=Q.rows.find(function(x){return x.cert===cert;}); if(!r)return Promise.resolve();
  Q.selected=r; renderQueueList();
  var input=r.label_text||SlabLabel.fromScan(Object.assign({},r.scan||{},{cert:r.cert}),r.cert);
  el.name.value=input.name||"";el.l2.value=input.l2||"";el.l3.value=input.l3||"";el.l4.value=input.l4||"";
  certOverride=r.cert; queueGrade={grade:input.grade,gradeWord:input.gradeWord};
  var idx=-1;GRADES.forEach(function(g,i){if(idx<0&&g[0]===input.grade&&g[1]===input.gradeWord)idx=i;});if(idx>=0)el.gradeSel.value=idx;
  qEl("queueDetail").hidden=false;qEl("queueMeta").textContent=r.cert+" · "+(r.status==="paid"?"paid ":r.status+" ")+new Date(r.paid_at).toLocaleString();
  qEl("queueShip").textContent=fmtShip(r.shipping);qEl("markShipped").hidden=r.status!=="engraved";
  return render();
}
function loadQueue(){
  if(Q.testing)return Promise.resolve();
  qEl("queueMsg").textContent="Loading…";
  return api("/api/slabs/queue?status="+Q.status).then(function(j){Q.rows=j.rows;qEl("queueMsg").textContent=j.rows.length+" slab"+(j.rows.length===1?"":"s");renderQueueList();})
    .catch(function(e){qEl("queueMsg").textContent="Queue failed: "+e.message;});
}
function engravePayload(){
  var lt={name:el.name.value,l2:el.l2.value,l3:el.l3.value,l4:el.l4.value,cert:currentCert(),grade:queueGrade?queueGrade.grade:"",gradeWord:queueGrade?queueGrade.gradeWord:""};
  var s={};for(var k in S)if(k!=="secret")s[k]=S[k];s.useToken=false;
  return {cert:lt.cert,svg:curSVG,label_text:lt,label_settings:s};
}
function markEngraved(){
  var p=engravePayload();
  return api("/api/slabs/status",{method:"POST",body:JSON.stringify(Object.assign({status:"engraved"},p))})
    .then(function(){qEl("queueMsg").textContent=p.cert+" marked engraved.";Q.selected=null;qEl("queueDetail").hidden=true;return loadQueue();})
    .catch(function(e){qEl("queueMsg").textContent="Could not mark engraved: "+e.message+" — the SVG was downloaded; retry from the list.";});
}
qEl("markShipped").addEventListener("click",function(){
  if(!Q.selected)return;var cert=Q.selected.cert;
  api("/api/slabs/status",{method:"POST",body:JSON.stringify({cert:cert,status:"shipped"})})
    .then(function(){qEl("queueMsg").textContent=cert+" marked shipped.";Q.selected=null;qEl("queueDetail").hidden=true;return loadQueue();})
    .catch(function(e){qEl("queueMsg").textContent="Could not mark shipped: "+e.message;});
});
qEl("copyShip").addEventListener("click",function(){navigator.clipboard.writeText(qEl("queueShip").textContent).catch(function(){});});
Array.prototype.forEach.call(document.querySelectorAll("[data-qstatus]"),function(b){b.addEventListener("click",function(){
  Q.status=b.getAttribute("data-qstatus");Array.prototype.forEach.call(document.querySelectorAll("[data-qstatus]"),function(x){x.setAttribute("aria-pressed",x===b);});Q.selected=null;qEl("queueDetail").hidden=true;loadQueue();});});
qEl("queueSearch").addEventListener("input",renderQueueList);
qEl("modeQueue").addEventListener("click",function(){setMode("queue");loadQueue();});
qEl("modeManual").addEventListener("click",function(){setMode("manual");});

/* auth: same Supabase accounts as the app; the session persists in localStorage via supabase-js */
function initAuth(){
  if(Q.testing){qEl("auth").hidden=true;setMode("queue");return Promise.resolve();}
  return fetch("/api/slabs/config").then(function(r){return r.json();}).then(function(c){
    if(!c.supabaseUrl||!window.supabase){qEl("queueMsg").textContent="Studio config unavailable — manual mode only.";return;}
    Q.client=window.supabase.createClient(c.supabaseUrl,c.anonKey);
    function apply(session){Q.session=session;qEl("signin").hidden=!!session;qEl("signedIn").hidden=!session;qEl("modes").hidden=!session;
      if(session){qEl("authWho").textContent=session.user.email||"";setMode("queue");loadQueue();}else setMode("manual");}
    Q.client.auth.getSession().then(function(r){apply(r.data.session);});
    Q.client.auth.onAuthStateChange(function(_e,session){apply(session);});
    qEl("signin").addEventListener("submit",function(e){e.preventDefault();Q.client.auth.signInWithPassword({email:qEl("authEmail").value,password:qEl("authPass").value}).then(function(r){if(r.error)qEl("queueMsg").textContent="Sign-in failed: "+r.error.message;});});
    qEl("signout").addEventListener("click",function(){Q.client.auth.signOut();});
  }).catch(function(){qEl("queueMsg").textContent="Studio config unavailable — manual mode only.";});
}
```
Then wire the existing pieces: in `cfgFrom()`, after the grade lookup, `if(Q.mode==="queue"&&queueGrade){c.grade=queueGrade.grade;c.gradeWord=queueGrade.gradeWord;}`; in `render()`, when `Q.mode==="queue"` pass `Object.assign({},S,{useToken:false})` to `SlabLabel.payload`/`build` instead of `S`; in `downloadSVG()`, after `offer(...)` resolves `ok`, do `if(Q.mode==="queue"&&Q.selected)return markEngraved(); advanceCert(cert);` (queue downloads never touch the manual counter). Extend `window.SlabStudio` with `queue:{setRows:function(rows){Q.rows=rows;setMode("queue");renderQueueList();},select:selectQueueRow,mode:function(){return Q.mode;}},getEngravePayload:engravePayload`. In the boot line, call `initAuth()` after `load()` and before the first `render()`.

- [ ] **Step 5: Verify** — `node scripts/verify-studio-queue.cjs` → the log line then exit 0; `node scripts/verify-studio.cjs` still `PASS` (manual mode untouched: no `?queue=1`, config fetch fails on `file://` and falls back to manual); `npm run verify:label` `PASS`. Screenshot `public/studio.html?queue=1` over the local server (reuse the server in the test with `KEEP=1`, or a one-off) and view it: the Queue panel with one row, the label rendered with `SS26-00001`, the shipping block. Delete the screenshot.

- [ ] **Step 6: Commit** — `git add public/slab/vendor/supabase.js public/studio.html public/slab/studio.js scripts/verify-studio-queue.cjs && git commit -m "feat(studio): admin queue mode — sign in, render from the record, mark engraved/shipped"`

---

### Task 6: Cert page renders what was engraved

**Files:** Modify `public/slab/slabview.js`; extend `scripts/fixtures/slab-public.json`

- [ ] **Step 1:** In the fixture add `"label_text": {"name":"PIKACHU V (ENGRAVED)","l2":"2024 POKÉMON X SPONGEBOB","l3":"BIKINI BOTTOM PROMO #001","l4":"SPECIAL ILLUSTRATION RARE","cert":"SS26-00001","grade":"10","gradeWord":"PRISTINE"}` and `"label_settings": {"wordFont":"mi","gradeFont":"i3","logoPct":24,"useToken":false}`; the noimage fixture gets `"label_text": null, "label_settings": null`.
- [ ] **Step 2:** In `slabview.js`: `function labelInput(row){return row.label_text&&row.label_text.cert===row.cert?row.label_text:SlabLabel.fromScan(row,row.cert);}` and in `labelSettings()` start from `Object.assign({}, SlabLabel.defaults, row.label_settings||{})` (pass `row` in), still overriding `H` for the window aspect and forcing `useToken:false`. Use `labelInput(row)` in `drawLabel` and for the header/name/set line in `render` (so the page's title matches the engraved name).
- [ ] **Step 3:** Extend `scripts/verify-slabview.cjs`: for the `found` run, also assert the dumped DOM contains `PIKACHU V (ENGRAVED)` (the `<h1 id="name">`). Run → `PASS`; view `out-slabview-found.png` — the label and header show the engraved name.
- [ ] **Step 4: Commit** — `git add public/slab/slabview.js scripts/fixtures/slab-public.json scripts/fixtures/slab-public-noimage.json scripts/verify-slabview.cjs && git commit -m "feat(slabview): render the label text and settings that were engraved"`

---

### Task 7: Runbook

**Files:** Modify `docs/superpowers/runbooks/slab-order-setup.md`

- [ ] **Step 1:** Add sections:
```markdown
## Admin access to the studio queue
- Find your user id: Supabase → Authentication → Users → your email → copy the UUID.
- Vercel env `ADMIN_USER_IDS` = that UUID (comma-separate more later). Redeploy.
- Apply `supabase/migrations/20260914_slab_label.sql`.
- Open https://www.slabsenseai.com/studio → sign in with your app email/password → **Queue**.

## Working the queue
1. **To engrave**: click a row → the label renders from the record (edit the four text lines if the scan's name is missing or wrong — the edited text is what gets stored and shown on the cert page). **Download SVG** saves the file for LightBurn and marks the slab *engraved*.
2. **To ship**: the shipping address is shown with a copy button. After it's in the mail, **Mark shipped**.
3. **Done**: searchable history. The cert page shows the same status the whole way.
If "Could not mark engraved" appears, the SVG still downloaded — fix the cause (usually signed out) and click the row again; it stays in To engrave until the server confirms.

## Going live (after testing)
Change together in Vercel, then redeploy: `STRIPE_SECRET_KEY` → live key; `STRIPE_PRICE_SLAB` → the live-mode price id; `STRIPE_WEBHOOK_SECRET` → the **live** endpoint's secret, and make sure that endpoint's URL is `https://www.slabsenseai.com/api/stripe/webhook` (the apex domain redirects and Stripe won't follow) and that it subscribes to `checkout.session.completed`. Then clean up test data: `delete from slabs where cert like 'SS26-%';` `alter sequence slab_cert_seq restart with 1;` and empty the `slab-images` and `slab-labels` buckets.
```
- [ ] **Step 2: Commit** — `git add docs/superpowers/runbooks/slab-order-setup.md && git commit -m "docs(runbook): admin queue setup, working the queue, going live"`

---

## Self-review

**Spec coverage:** §6 queue mode (tabs, render from record, editable lines, Download → engraved with SVG stored, Mark shipped, settings drawer stays) → Task 5 (+ Task 3 routes); manual mode unchanged → Task 5 constraint; §8 routes `queue`/`status` with admin JWT gate → Tasks 2–3; `config` is an addition needed because the studio is a static page; §3.3 bucket write path → Task 3; Plan B deferral (JWT on checkout) → Task 4; "what was engraved is what's shown" → Tasks 1, 3, 6; runbook → Task 7. Not in scope: multi-admin roles; resizing copied images (still deferred); the app ignoring `?slab_ordered=1`.

**Type consistency:** `requireAdmin({db, adminIds}, req)` used identically in `queue.js`/`status.js`; `statusPatch` keys `engraved_at`/`shipped_at` match the migration columns; `engravePayload()` produces `{cert, svg, label_text, label_settings}` = exactly what `status.js` reads; `label_text.cert === row.cert` guard in the cert page; `QUEUE_SELECT` embeds `scans(...)` which `flattenQueueRow` renames to `scan`, and the studio reads `r.scan`.
