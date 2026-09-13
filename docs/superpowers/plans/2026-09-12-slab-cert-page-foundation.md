# Slab Cert-Page Foundation Implementation Plan (Plan A of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `slabs` table, extract the label engine into a shared module, and deliver a public `/v/<cert>` page that renders the slab composite and the full grading report.

**Architecture:** The studio's single HTML file is split into data files (fonts, frame), three vendored libraries, and one engine module `public/slab/label.js` exposing `window.SlabLabel`. `public/studio.html` becomes a thin UI over that engine (manual mode only in this plan — queue mode is Plan C). `public/slabview.html` reads `api/slab?cert=` (a serverless route over the `slab_public` view) and renders a layered 2D composite plus the report.

**Tech Stack:** Vite/React app (untouched), Vercel serverless (`api/*.js`, ESM, `export default async function handler(req,res)`), Supabase (Postgres + `card-images` public bucket), vanilla ES5-style JS in the static pages, headless Chrome + `jsqr` for verification.

**Spec:** `docs/superpowers/specs/2026-09-12-slab-integration-design.md` (sections 2, 3, 5, 7, 8 are implemented here; 4 and 6 are Plans B and C).

## Global Constraints

- Cert format: `SS` + two-digit year + `-` + five-digit global sequence, e.g. `SS26-00001` (spec §3.1).
- QR payload: `<base><cert>`, `base = "slabsenseai.com/v/"`, upper-cased when compact encoding is on (spec §5).
- Label geometry must not change during extraction: the default render must decode to `SLABSENSEAI.COM/V/<cert>` at version 2-Q with 0.44 mm modules (the studio's current output).
- `slab_public` exposes exactly the columns listed in spec §3.2 and nothing else.
- Static pages live under `public/`; `vercel.json` gains the rewrites in spec §2.
- The repo is `"type": "module"`; serverless routes and scripts under `scripts/` use `.cjs` when they need `require`.
- Migrations are applied by pasting the file into the Supabase SQL editor (there is no CLI setup); the file is still committed under `supabase/migrations/`.
- Source of truth for the studio during this plan: `SlabSense Slab Engraving Studio/SlabSense-Engraving-Studio.html` (3168 lines). Line numbers below refer to that file as it is at the start of the plan; **verify each range with `sed -n` before cutting** — if a range has shifted, find the section by its comment header instead.
- Commit after every task. Work on branch `feat/slab-cert-page`.

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260912_slabs.sql` | `slab_cert_seq`, `next_cert()`, `slabs` table, RLS, `slab_public` view, `slab-labels` bucket |
| `public/slab/vendor/qrcode.js` | qrcode-generator 1.4.4 (verbatim from studio lines 282–2581) |
| `public/slab/vendor/opentype.js` | opentype.js 1.3.4 (studio lines 2582–2585) |
| `public/slab/vendor/polygon-clipping.js` | polygon-clipping 0.15.7 (studio lines 2591–2616) |
| `public/slab/fonts.js` | `var FONT_B64 = {...}` (studio line 2587) |
| `public/slab/frame.js` | `var MARK_PATH`, `var FRAME` (studio lines 2588–2589) |
| `public/slab/label.js` | Engine: geometry, QR, contour union, SVG/canvas → `window.SlabLabel` |
| `public/studio.html` | Studio UI (manual mode), loads the above |
| `public/slabview.html` | Public cert page |
| `public/slab/plate-straight.png` | Empty-slab plate |
| `api/slab.js` | `GET /api/slab?cert=` over `slab_public` |
| `scripts/verify-label.cjs` + `scripts/verify-label.html` | Renders the default label through `label.js`, rasterises, decodes the QR |
| `scripts/plate-measure.cjs` | Finds the label and card windows in the plate image |
| `scripts/fixtures/slab-public.json` | A `slab_public` row for page tests |
| `vercel.json` | rewrites |

---

### Task 1: `slabs` migration

**Files:**
- Create: `supabase/migrations/20260912_slabs.sql`

**Interfaces:**
- Produces: table `slabs`, function `next_cert()`, view `slab_public`, bucket `slab-labels`. Later tasks (`api/slab.js`) select from `slab_public` by `cert`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260912_slabs.sql — slabbing orders, cert numbers, public cert view
-- Apply in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS / OR REPLACE throughout).

create sequence if not exists slab_cert_seq;

create or replace function next_cert() returns text
language sql volatile as $$
  select 'SS' || to_char(now() at time zone 'utc', 'YY') || '-' || lpad(nextval('slab_cert_seq')::text, 5, '0');
$$;

create table if not exists slabs (
  id                 uuid primary key default gen_random_uuid(),
  cert               text unique not null default next_cert(),
  scan_id            uuid not null references scans(id),
  user_id            uuid not null references profiles(id),
  status             text not null default 'paid' check (status in ('paid','engraved','shipped')),
  stripe_session_id  text unique,
  shipping           jsonb,
  label_svg_path     text,
  slab_image_path    text,
  paid_at            timestamptz not null default now(),
  engraved_at        timestamptz,
  shipped_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists slabs_status_idx on slabs(status, paid_at);
create index if not exists slabs_scan_idx on slabs(scan_id);

alter table slabs enable row level security;
drop policy if exists "owner reads own slabs" on slabs;
create policy "owner reads own slabs" on slabs for select using (auth.uid() = user_id);
-- No insert/update policies: only the service role (webhook, admin routes) writes.

-- Public projection: the ONLY thing the anonymous cert page reads.
create or replace view slab_public with (security_invoker = false) as
select
  s.cert, s.status, s.paid_at, s.engraved_at, s.shipped_at,
  c.card_name, c.card_set, c.card_number, c.card_game, c.card_info,
  c.grade_value, c.grade_label, c.subgrades, c.front_centering, c.back_centering, c.dings,
  c.user_card_image, c.enhanced_front_path, c.enhanced_back_path, c.front_image_path, c.back_image_path
from slabs s
join scans c on c.id = s.scan_id;

-- Label SVGs, private; written by admin routes only.
insert into storage.buckets (id, name, public)
values ('slab-labels', 'slab-labels', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Apply it in the Supabase SQL editor**

Paste the whole file, run. Expected: "Success. No rows returned".

If it errors with `column c.card_info does not exist`, the `card_info` column was never migrated: run `alter table scans add column if not exists card_info jsonb;` first (the app already writes it — see `src/services/scans.js:94`), then re-run the file.

- [ ] **Step 3: Verify the sequence and the view**

Run in the SQL editor (uses any existing scan; roll back so no real slab is created):

```sql
begin;
  insert into slabs (scan_id, user_id)
    select id, user_id from scans order by created_at desc limit 1
    returning cert;
  insert into slabs (scan_id, user_id)
    select id, user_id from scans order by created_at desc limit 1
    returning cert;
  select cert, status, card_name, grade_value from slab_public order by cert;
rollback;
```

Expected: two certs of the form `SS26-0000N` and `SS26-0000N+1`; the view rows show the scan's name and grade; no `user_id` column exists in the view (`select user_id from slab_public` must fail).

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/slab-cert-page
git add supabase/migrations/20260912_slabs.sql
git commit -m "feat(db): slabs table, cert sequence, slab_public view"
```

---

### Task 2: Split the studio into vendor libraries and data files

**Files:**
- Create: `public/slab/vendor/qrcode.js`, `public/slab/vendor/opentype.js`, `public/slab/vendor/polygon-clipping.js`, `public/slab/fonts.js`, `public/slab/frame.js`
- Create: `scripts/split-studio.cjs` (one-off; kept for traceability)

**Interfaces:**
- Produces globals when loaded in a page in this order: `qrcode`, `opentype`, `polygonClipping`, `FONT_B64`, `MARK_PATH`, `FRAME`.

- [ ] **Step 1: Confirm the line ranges**

```bash
grep -nE '^<script|^</script>|^var FONT_B64|^var MARK_PATH|^var FRAME' "SlabSense Slab Engraving Studio/SlabSense-Engraving-Studio.html" | cut -c1-60
```

Expected (adjust the script in Step 2 if different):
```
282:<script>/* qrcode-generator 1.4.4 ...
2581:</script>
2582:<script>/* opentype.js 1.3.4 ...
2585:</script>
2586:<script>
2587:var FONT_B64 = {...
2588:var MARK_PATH = ...
2589:var FRAME = {...
2590:</script>
2591:<script>/* polygon-clipping 0.15.7 ...
2616:</script>
2617:<script>
3166:</script>
```

- [ ] **Step 2: Write the split script**

```js
// scripts/split-studio.cjs — one-off: carve the vendored libraries and data out of the studio file
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'SlabSense Slab Engraving Studio', 'SlabSense-Engraving-Studio.html');
const OUT = path.join(__dirname, '..', 'public', 'slab');
const lines = fs.readFileSync(SRC, 'utf8').split('\n');
const L = (a, b) => lines.slice(a - 1, b).join('\n') + '\n';            // 1-based inclusive
const strip = s => s.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');

fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'vendor', 'qrcode.js'), strip(L(282, 2581)));
fs.writeFileSync(path.join(OUT, 'vendor', 'opentype.js'), strip(L(2582, 2585)));
fs.writeFileSync(path.join(OUT, 'vendor', 'polygon-clipping.js'), strip(L(2591, 2616)));
fs.writeFileSync(path.join(OUT, 'fonts.js'), L(2587, 2587));
fs.writeFileSync(path.join(OUT, 'frame.js'), L(2588, 2589));
fs.writeFileSync(path.join(__dirname, 'studio-app.extracted.js'), strip(L(2617, 3166)));   // engine+UI, consumed by Task 3/4
console.log('split done');
```

- [ ] **Step 3: Run it and check each file parses**

```bash
node scripts/split-studio.cjs
for f in public/slab/vendor/qrcode.js public/slab/vendor/opentype.js public/slab/vendor/polygon-clipping.js public/slab/fonts.js public/slab/frame.js; do node -e "new Function(require('fs').readFileSync('$f','utf8'));console.log('ok $f')"; done
node -e "const v=require('vm'),fs=require('fs');const c={window:{}};v.createContext(c);['public/slab/vendor/qrcode.js','public/slab/vendor/opentype.js','public/slab/vendor/polygon-clipping.js','public/slab/fonts.js','public/slab/frame.js'].forEach(f=>v.runInContext(fs.readFileSync(f,'utf8'),c));console.log(typeof c.qrcode,typeof c.opentype,typeof c.polygonClipping,Object.keys(c.FONT_B64).length,'fonts',Object.keys(c.FRAME).length,'frame pieces')"
```

Expected: five `ok` lines, then `function object object 7 fonts 7 frame pieces`. (opentype's UMD may attach to `this`/`window`; if `typeof c.opentype` prints `undefined`, check `typeof c.window.opentype` instead — the browser will get it either way.)

- [ ] **Step 4: Commit**

```bash
git add scripts/split-studio.cjs public/slab/vendor public/slab/fonts.js public/slab/frame.js
git commit -m "refactor(slab): vendor label libraries and data as separate files"
```

`scripts/studio-app.extracted.js` is scratch input for the next two tasks — do not commit it.

---

### Task 3: `public/slab/label.js` — the engine, with a verification harness

**Files:**
- Create: `public/slab/label.js`
- Create: `scripts/verify-label.html`, `scripts/verify-label.cjs`
- Modify: `package.json` (devDependencies `jsqr`, `pngjs`; script `verify:label`)

**Interfaces:**
- Consumes: globals from Task 2.
- Produces `window.SlabLabel`:
  ```js
  SlabLabel.ready                               // Promise<void>, fonts parsed
  SlabLabel.defaults                            // frozen copy of DEF (label settings)
  SlabLabel.GRADES                              // [["10","PRISTINE"], ...]
  SlabLabel.fromScan(scan, cert)                // → {name,l2,l3,l4,cert,grade,gradeWord}
  SlabLabel.payload(input, settings)            // → Promise<{url, alnum}>   (HMAC token when settings.useToken)
  SlabLabel.build(input, settings, url, alnum)  // → {shapes, svg, stats, warnings, qr:{N,module}, g}  or null if payload too long
  SlabLabel.drawCanvas(canvas, shapes, settings, ink)
  SlabLabel.qrOnlySVG(built, settings)          // → svg string of just the QR
  ```
  `input` = `{name,l2,l3,l4,cert,grade,gradeWord}`; `settings` = an object shaped like `defaults`.

- [ ] **Step 1: Write the harness page (the test) first**

`scripts/verify-label.html`:
```html
<!doctype html><meta charset="utf-8"><title>verify-label</title>
<script src="../public/slab/vendor/qrcode.js"></script>
<script src="../public/slab/vendor/opentype.js"></script>
<script src="../public/slab/vendor/polygon-clipping.js"></script>
<script src="../public/slab/fonts.js"></script>
<script src="../public/slab/frame.js"></script>
<script src="../public/slab/label.js"></script>
<pre id="out"></pre><pre id="meta"></pre><pre id="err"></pre>
<script>
(function(){
  var q=new URLSearchParams(location.search), settings={}, input={name:"PIKACHU V",l2:"2024 POKÉMON x SPONGEBOB",l3:"BIKINI BOTTOM PROMO #001",l4:"SPECIAL ILLUSTRATION RARE",cert:"SS26-00001",grade:"10",gradeWord:"PRISTINE"};
  for(var k in SlabLabel.defaults)settings[k]=SlabLabel.defaults[k];
  q.forEach(function(v,k){ if(k in input)input[k]=v; else if(k in settings)settings[k]=(typeof settings[k]==="number")?parseFloat(v):(typeof settings[k]==="boolean")?v==="true":v; });
  SlabLabel.ready.then(function(){ return SlabLabel.payload(input,settings); }).then(function(p){
    var b=SlabLabel.build(input,settings,p.url,p.alnum);
    if(!b){document.getElementById("err").textContent="BUILD_NULL";return;}
    document.getElementById("out").textContent=b.svg;
    document.getElementById("meta").textContent=JSON.stringify({url:p.url,version:b.stats.version,level:b.stats.level,modules:b.qr.N,moduleMM:b.qr.module,qrMM:b.stats.qrMM,W:settings.W,H:settings.H});
  }).catch(function(e){document.getElementById("err").textContent="ERR "+(e&&e.stack||e);});
})();
</script>
```

`scripts/verify-label.cjs`:
```js
// Renders the label through public/slab/label.js in headless Chrome, rasterises the SVG, decodes the QR.
// Usage: node scripts/verify-label.cjs [key=value ...]   e.g. node scripts/verify-label.cjs grade=8.5 gradeWord=NM-MT+
const fs=require('fs'),cp=require('child_process'),path=require('path'),os=require('os');
const jsQR=require('jsqr'),{PNG}=require('pngjs');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const here=__dirname.split(path.sep).join('/');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'verify-label-'));
const qs=process.argv.slice(2).map(encodeURIComponent).map(s=>s.replace('%3D','=')).join('&');
function chrome(args){return cp.execFileSync(CHROME,['--headless=new','--disable-gpu','--allow-file-access-from-files','--user-data-dir='+tmp+'/profile','--hide-scrollbars','--virtual-time-budget=6000',...args],{encoding:'utf8',maxBuffer:64e6,stdio:['ignore','pipe','ignore']});}
const dom=chrome(['--dump-dom','file:///'+here+'/verify-label.html'+(qs?'?'+qs:'')]);
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
const err=(dom.match(/<pre id="err">([\s\S]*?)<\/pre>/)||[])[1];
if(err&&err.trim()){console.error('HARNESS:',dec(err).slice(0,800));process.exit(2);}
const svg=dec((dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)||[])[1]||'');
const meta=JSON.parse(dec((dom.match(/<pre id="meta">([\s\S]*?)<\/pre>/)||[])[1]||'{}'));
if(!svg.startsWith('<?xml')){console.error('NO SVG');process.exit(2);}
const W=parseFloat(svg.match(/width="([\d.]+)mm"/)[1]),H=parseFloat(svg.match(/height="([\d.]+)mm"/)[1]),PX=20;
const inner=svg.replace(/^<\?xml[^>]*>\s*/,'').replace(/<svg /,'<svg style="width:'+(W*PX)+'px;height:'+(H*PX)+'px;display:block" ').replace(/fill="#[0-9a-f]{3,6}"/gi,'fill="#000"').replace(/stroke="#[0-9a-f]{3,6}"/gi,'stroke="#000"');
fs.writeFileSync(tmp+'/view.html','<!doctype html><meta charset=utf-8><body style="margin:0;background:#fff">'+inner+'</body>');
chrome(['--window-size='+Math.ceil(W*PX)+','+Math.ceil(H*PX),'--screenshot='+tmp+'/label.png','file:///'+tmp.split(path.sep).join('/')+'/view.html']);
const png=PNG.sync.read(fs.readFileSync(tmp+'/label.png'));
const r=jsQR(png.data,png.width,png.height,{inversionAttempts:'attemptBoth'});
const ok=!!r&&r.data===meta.url;
console.log(JSON.stringify({...meta,decoded:r?r.data:null,ok}));
if(process.env.KEEP)console.log('artifacts in',tmp);else fs.rmSync(tmp,{recursive:true,force:true});
process.exit(ok?0:1);
```

Add to `package.json`:
```json
"devDependencies": { "...": "...", "jsqr": "^1.4.0", "pngjs": "^7.0.0" },
"scripts": { "...": "...", "verify:label": "node scripts/verify-label.cjs" }
```

- [ ] **Step 2: Install and run it to see it fail**

```bash
npm install
npm run verify:label
```
Expected: exit 2 with `HARNESS: ERR ReferenceError: SlabLabel is not defined` (label.js does not exist yet).

- [ ] **Step 3: Write `public/slab/label.js`**

Build it from `scripts/studio-app.extracted.js` (Task 2 output). Open that file and copy, **unchanged**, these definitions in this order into the module skeleton below where marked `/* >>> paste ... <<< */`:

1. `var ART`, `var GRADES`, `var SRC`, `var HDR_TOP`, `var DEF` (extracted lines beginning `var ART=`, `var GRADES=`, `var SRC={`, `var HDR_TOP=`, `var DEF={` — the studio's 2620–2644).
2. `function n3`, `function n2`, `function esc`, `function pad` (studio 2654–2656).
3. The fonts block: `var F={}`, `function ab`, `function loadFonts`, `function run`, `function tw`, `function flattenPath`, `function ringArea`, `function glyphRings`, `function tp`, `function fit` (studio 2692–2753).
4. The QR block: `var ALNUM` … `function qrShapes` (studio 2755–2819).
5. The frame block: `function piece`, `function frame`, `function capOf` (studio 2821–2866).
6. `function geometry` (studio 2868–2926).
7. The render block: `var PAL_K`, `var PAL_L`, `function applyT`, `function drawCanvas`, `function toSVG` (studio 2928–2971).
8. The payload block: `var AL`, `function token` (studio 2973–2982).

Two edits are required inside the pasted code:
- In `toSVG`, replace `S.color==="layers"` with `cfg.color==="layers"` and `S.grpLayers` with `cfg.grpLayers` (the engine has no `S`; `cfg` carries the settings).
- In `frame()`/`geometry()` nothing changes — they already read `cfg`.

Skeleton:
```js
/* public/slab/label.js — SlabSense label engine.
   Requires globals: qrcode, opentype, polygonClipping, FONT_B64, MARK_PATH, FRAME (load in that order).
   Exposes window.SlabLabel. Pure: no DOM except the canvas handed to drawCanvas. */
(function(root){
"use strict";
/* >>> paste 1: ART, GRADES, SRC, HDR_TOP, DEF <<< */
/* >>> paste 2: n3, n2, esc, pad <<< */
/* >>> paste 3: fonts + text layout (F, ab, loadFonts, run, tw, flattenPath, ringArea, glyphRings, tp, fit) <<< */
/* >>> paste 4: QR (ALNUM … qrShapes) <<< */
/* >>> paste 5: frame (piece, frame, capOf) <<< */
/* >>> paste 6: geometry <<< */
/* >>> paste 7: render (PAL_K, PAL_L, applyT, drawCanvas, toSVG) — with the two S→cfg edits <<< */
/* >>> paste 8: payload (AL, token) <<< */

function cfgOf(input,settings){
  var c={};for(var k in DEF)c[k]=(k in settings)?settings[k]:DEF[k];
  c.logoPct=Math.max(0,Math.min(30,c.logoPct))/100;
  c.name=input.name||"";c.l2=input.l2||"";c.l3=input.l3||"";c.l4=input.l4||"";
  c.cert=input.cert||"";c.grade=String(input.grade||"");c.gradeWord=input.gradeWord||"";
  return c;
}
function payload(input,settings){
  var cert=input.cert||"", s=settings||DEF;
  return token(cert,s.useToken?s.secret:"").then(function(t){
    var url=(s.base||DEF.base)+cert+(s.useToken&&t?"-"+t:"");
    if(s.compact!==false)url=url.toUpperCase();
    return {url:url,alnum:s.compact!==false&&ALNUM.test(url)};
  });
}
function build(input,settings,url,alnum){
  var cfg=cfgOf(input,settings||{});
  var built=buildQR(url,alnum,cfg.ec,cfg.logoPct);
  if(!built)return null;
  var g=geometry(cfg,built.q), mod=g.qr.module;
  var maxN=Math.floor(Math.min(g.availW,g.availH)/0.5)-8, vMax=Math.floor((maxN-21)/4)+1;
  var bl=levelsFor(cfg.ec,cfg.logoPct), bLevel=bl[bl.length-1];
  var budget=vMax>=1?capacity(Math.min(vMax,20),bLevel,alnum):0;
  var warnings=[];
  if(mod<0.38)warnings.push(["bad","Modules at "+mod.toFixed(3)+" mm will not scan reliably. The QR column between the dividers is "+(g.f.d2-g.f.d1).toFixed(1)+" mm wide — that is the limit. Shorten the verify URL"+(vMax>=1?" to about "+budget+" characters":"")+", move the cert under the card text, or widen the column in Settings › Layout."]);
  else if(mod<0.5)warnings.push(["warn","Modules at "+mod.toFixed(3)+" mm are under the 0.5 mm comfort threshold. Engrave a test tile and scan it before running a batch."]);
  else warnings.push(["ok","Modules at "+mod.toFixed(3)+" mm — comfortably scannable."]);
  if(vMax>=1&&url.length>budget)warnings.push(["warn","Payload is "+url.length+" characters; at 0.5 mm modules this column holds v"+Math.min(vMax,20)+"-"+bLevel+" ("+budget+" ch). Every character you cut buys module size."]);
  if(cfg.logoPct>0)warnings.push([cfg.logoPct>0.25?"warn":"info","Centre mark hides "+Math.round(cfg.logoPct*cfg.logoPct*100)+" % of the code"+(cfg.logoPct>0.25?" and forces error-correction H (a bigger code). Keep it at 25 % or under to stay at level Q.":" — level "+built.level+" recovers "+({L:7,M:15,Q:25,H:30})[built.level]+" %.")]);
  if(cfg.dot==="dot")warnings.push(["warn","Dot modules put less ink per cell than squares — harder to read on an engrave."]);
  if(cfg.useToken&&!cfg.secret)warnings.push(["warn","Check token is on but the signing secret is empty — no token was appended."]);
  if(g.shrink<0.72)warnings.push(["warn","Card text was shrunk to "+Math.round(g.shrink*100)+" % to fit the column. Shorten the longest line if it looks small."]);
  if(cfg.compact===false)warnings.push(["warn","Compact encoding is off — an uppercase URL buys a whole QR version."]);
  warnings.push(["info","Quiet zone of "+g.need.toFixed(1)+" mm is reserved on all four sides of the QR and comes from bare substrate. A frosted engrave on clear acrylic is low contrast — scan against the backing the slab will actually have."]);
  return {shapes:g.shapes, svg:toSVG(g.shapes,cfg), g:g, cfg:cfg, qr:{N:g.qr.N,module:g.qr.module,obj:built.q},
    stats:{version:built.version,level:built.level,modules:g.qr.N,moduleMM:n3(mod),qrMM:n3(g.qs),payloadLen:url.length,budget:budget,budgetVersion:vMax>=1?"v"+Math.min(vMax,20)+"-"+bLevel:null,bind:g.bind,shrink:n3(g.shrink),url:url},
    warnings:warnings};
}
function qrOnlySVG(built,settings){
  var q=qrShapes(built.qr.obj,0,0,built.g.qs,built.cfg);
  var c={};for(var k in built.cfg)c[k]=built.cfg[k];c.W=built.g.qs;c.H=built.g.qs;
  return toSVG(q.shapes,c);
}
/* Label text from a `scans` / `slab_public` row. One place; keep the studio and the cert page identical. */
function fromScan(row,cert){
  var info=row.card_info||{};
  var up=function(s){return s==null?"":String(s).toUpperCase().trim();};
  var year=info.year||(String(row.card_set||"").match(/\b(19|20)\d{2}\b/)||[])[0]||"";
  var game=({pokemon:"POKÉMON",mtg:"MAGIC",yugioh:"YU-GI-OH!",sports:"",other:""})[row.card_game]||"";
  var setName=up(info.setName||row.card_set).replace(/\b(19|20)\d{2}\b/,"").trim();
  if(game&&setName.indexOf(game)>=0)game="";                    // "2024 POKÉMON X SPONGEBOB", not "POKÉMON POKÉMON…"
  var number=row.card_number||info.cardNumber||"";
  var gv=row.grade_value==null?"":String(row.grade_value).replace(/\.0$/,"");
  var gl=up(row.grade_label).replace(/\s*\(.*\)$/,"");           // "Pristine (Black Label)" → "PRISTINE"
  return {
    name:up(row.card_name||info.name),
    l2:[year,game,setName].filter(Boolean).join(" ").replace(/\s+/g," "),
    l3:[up(info.variant),number?"#"+number:""].filter(Boolean).join(" "),
    l4:up(info.rarity),
    cert:cert, grade:gv, gradeWord:gl
  };
}
var readyResolve, ready=new Promise(function(r){readyResolve=r;});
function init(){ try{loadFonts();readyResolve();}catch(e){ready=Promise.reject(e);} }
var defaults={};for(var k in DEF)defaults[k]=DEF[k];
root.SlabLabel={ready:ready,defaults:Object.freeze(defaults),GRADES:GRADES,fromScan:fromScan,payload:payload,build:build,drawCanvas:drawCanvas,qrOnlySVG:qrOnlySVG,
  _internal:{geometry:geometry,toSVG:toSVG,capOf:capOf,levelsFor:levelsFor,capacity:capacity}};
if(typeof qrcode==="undefined"||typeof opentype==="undefined"||typeof polygonClipping==="undefined"||typeof FONT_B64==="undefined"||typeof FRAME==="undefined")
  ready=root.SlabLabel.ready=Promise.reject(new Error("label.js: a dependency is missing (load qrcode, opentype, polygon-clipping, fonts, frame first)"));
else init();
})(typeof window!=="undefined"?window:this);
```

- [ ] **Step 4: Run the harness until it passes**

```bash
npm run verify:label
```
Expected: `{"url":"SLABSENSEAI.COM/V/SS26-00001","version":2,"level":"Q","modules":25,"moduleMM":0.44,"qrMM":11,...,"ok":true}` and exit 0. If `ok` is false, run with `KEEP=1` and open the kept `label.png`.

Then the regression set, all must print `"ok":true`:
```bash
node scripts/verify-label.cjs grade=8.5 gradeWord=NM-MT+ "name=CHARIZARD VMAX RAINBOW RARE ALT ART"
node scripts/verify-label.cjs grade=4.5 gradeWord=VG-EX+ wordFont=mi
node scripts/verify-label.cjs certPos=card
node scripts/verify-label.cjs logoPct=0
node scripts/verify-label.cjs useToken=true secret=test-secret
```

- [ ] **Step 5: Unit-test `fromScan` in node**

`scripts/verify-fromscan.cjs`:
```js
// fromScan needs no fonts, so it can run in plain node by evaluating label.js with stub globals.
const fs=require('fs'),vm=require('vm');
const ctx={window:{},qrcode:function(){},opentype:{parse:function(){throw new Error('stub');}},polygonClipping:{},FONT_B64:{},MARK_PATH:"",FRAME:{_art:{x:0,y:0,w:1,h:1},corner:{box:[0,0,0,0]},edgeMid:{box:[0,0,0,0]},divider:{box:[0,0,0,0]}}};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/slab/label.js','utf8'),ctx);
const f=ctx.SlabLabel.fromScan;
const row={card_name:"Pikachu V",card_set:"2024 Pokémon x SpongeBob",card_number:"001",card_game:"pokemon",card_info:{rarity:"Special Illustration Rare",variant:"Bikini Bottom Promo"},grade_value:10,grade_label:"Pristine (Black Label)"};
const out=f(row,"SS26-00001");
const expect={name:"PIKACHU V",l2:"2024 POKÉMON X SPONGEBOB",l3:"BIKINI BOTTOM PROMO #001",l4:"SPECIAL ILLUSTRATION RARE",cert:"SS26-00001",grade:"10",gradeWord:"PRISTINE"};
let bad=0;for(const k in expect)if(out[k]!==expect[k]){console.log('MISMATCH',k,JSON.stringify(out[k]),'expected',JSON.stringify(expect[k]));bad++;}
const half=f({card_name:"x",grade_value:8.5,grade_label:"NM-MT+",card_game:"mtg"},"SS26-00002");
if(half.grade!=="8.5"||half.gradeWord!=="NM-MT+"||half.l2!=="MAGIC"){console.log('MISMATCH half-grade/mtg',half);bad++;}
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
```
Run: `node scripts/verify-fromscan.cjs`. Expected: `PASS`. (If it prints `MISMATCH l2 "2024 POKÉMON POKÉMON X SPONGEBOB"`, the game-dedupe line in `fromScan` was omitted.)

- [ ] **Step 6: Commit**

```bash
git add public/slab/label.js scripts/verify-label.html scripts/verify-label.cjs scripts/verify-fromscan.cjs package.json package-lock.json
git commit -m "feat(slab): extract label engine into public/slab/label.js with QR round-trip verification"
```

---

### Task 4: `public/studio.html` — the studio as a shell over the engine

**Files:**
- Create: `public/studio.html`
- Reference: `scripts/studio-app.extracted.js` (Task 2), studio HTML lines 1–281 (markup + CSS)

**Interfaces:**
- Consumes `SlabLabel` (Task 3).
- Produces `window.SlabStudio = { ready, set(fields), render(), getSVG(), getState(), advanceCert() }` — same surface as today, used by the verification wrapper below.

- [ ] **Step 1: Write the smoke test (wrapper) first**

`scripts/verify-studio.cjs`:
```js
// Loads public/studio.html headless, drives it through window.SlabStudio, checks the SVG matches label.js output
const fs=require('fs'),cp=require('child_process'),path=require('path'),os=require('os');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.join(__dirname,'..').split(path.sep).join('/');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'verify-studio-'));
fs.writeFileSync(tmp+'/w.html',`<!doctype html><meta charset="utf-8">
<iframe id="f" src="file:///${root}/public/studio.html" style="width:1400px;height:900px"></iframe>
<pre id="out"></pre><pre id="err"></pre>
<script>
document.getElementById('f').addEventListener('load',function(){
  var w=document.getElementById('f').contentWindow,api=w.SlabStudio,log=[];
  if(!api){document.getElementById('err').textContent='NO_API';return;}
  Promise.resolve(api.ready)
  .then(function(){log.push(['cert',api.getState().cert]);log.push(['svgStarts',api.getSVG().slice(0,5)]);api.advanceCert();return api.render();})
  .then(function(){log.push(['afterAdvance',api.getState().cert]);return api.set({grade:'8.5 NM-MT+'});})
  .then(function(){var s=api.getState();log.push(['grade',s.version+'-'+s.level+' '+s.moduleMM]);document.getElementById('out').textContent=JSON.stringify(log);})
  .catch(function(e){document.getElementById('err').textContent='ERR '+(e&&e.stack||e);});
});
</script>`);
const dom=cp.execFileSync(CHROME,['--headless=new','--disable-gpu','--allow-file-access-from-files','--user-data-dir='+tmp+'/p','--virtual-time-budget=8000','--dump-dom','file:///'+tmp.split(path.sep).join('/')+'/w.html'],{encoding:'utf8',maxBuffer:64e6,stdio:['ignore','pipe','ignore']});
const dec=s=>s.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const err=(dom.match(/<pre id="err">([\s\S]*?)<\/pre>/)||[])[1];if(err&&err.trim()){console.error(dec(err).slice(0,600));process.exit(2);}
const log=JSON.parse(dec((dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)||[])[1]));
console.log(JSON.stringify(log));
const m=Object.fromEntries(log);
const ok=m.cert==='TEST-00001'&&m.svgStarts==='<?xml'&&m.afterAdvance==='TEST-00002'&&/^2-Q 0\.44/.test(m.grade);
fs.rmSync(tmp,{recursive:true,force:true});process.exit(ok?0:1);
```
Run: `node scripts/verify-studio.cjs`. Expected: exit 2, `NO_API` (page doesn't exist yet — Chrome shows an error page).

- [ ] **Step 2: Build `public/studio.html`**

Copy studio lines 1–281 (everything up to and including `</dialog>`) into the new file, then make these edits in the markup:
- In `<head>`, after `</style>`, add nothing; before `</body>` add the script tags:
  ```html
  <script src="slab/vendor/qrcode.js"></script>
  <script src="slab/vendor/opentype.js"></script>
  <script src="slab/vendor/polygon-clipping.js"></script>
  <script src="slab/fonts.js"></script>
  <script src="slab/frame.js"></script>
  <script src="slab/label.js"></script>
  <script src="slab/studio.js"></script>
  </body></html>
  ```
- Cert counter section hint: change the text under "Cert counter" to `Manual mode uses the TEST- prefix. Real certs are minted by the database when an order is paid.`
- Under the title, change `.sub` to: `Manual mode — for test tiles and one-offs. Paid orders arrive in the queue (coming next).`

Then write `public/slab/studio.js` from `scripts/studio-app.extracted.js`: keep the UI half (studio lines 2646–2690 settings/persistence, 2984–3165 render/export/wiring) and delete everything the engine now owns (lines 2620–2644, 2654–2656 except keep `esc` and `pad`, 2692–2982). Concretely the file is:

```js
/* public/slab/studio.js — studio UI over SlabLabel (manual mode) */
(function(){
"use strict";
var DEF=SlabLabel.defaults, GRADES=SlabLabel.GRADES;
var NUM=["W","H","frameScale","headerScale","hdrX","hdrY","div1","div2","textL","colGap","outlineW","logoPct","qrMM","certDigits","certNext"];
var STR=["certPos","base","ec","dot","eye","secret","certPrefix","color","backdrop","gradeFont","wordFont"];
var BOOL=["showBoxes","gradeOutline","compact","qrAuto","useToken","grpLayers"];
var CARD=["name","l2","l3","l4"];
var KEY="ss-studio-v4";
var LOCAL_DEF={certPrefix:"TEST-",certDigits:5,certNext:1};      // manual-mode counter, never the SS sequence
var el={};NUM.concat(STR,BOOL,CARD,["cert","gradeSel"]).forEach(function(i){el[i]=document.getElementById(i);});
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function pad(n,d){var s=String(Math.max(0,Math.floor(n)));while(s.length<d)s="0"+s;return s;}
function allDefaults(){var o={};for(var k in DEF)o[k]=DEF[k];for(var k2 in LOCAL_DEF)o[k2]=LOCAL_DEF[k2];return o;}
var S=allDefaults(), certOverride=null;
function counterCert(){return S.certPrefix+pad(S.certNext,S.certDigits);}
function currentCert(){return certOverride!==null?certOverride:counterCert();}
```
…then paste, unchanged from the extracted file: `settingsToUI`, `uiToSettings`, `save`, `load` (replace `for(var k in DEF)S[k]=DEF[k];` inside `load` with `S=allDefaults();` and `typeof DEF[k2]` with `typeof S[k2]`), `cfgFrom` (delete its `c.logoPct=` line — the engine does that), `refreshCertUI`, `st`, the export block (`dl`, `offer`, `fb`, `safeName`, `advanceCert`, `downloadSVG` and all `addEventListener` handlers), the cert-override block, the settings-drawer block, the wiring block, and the `window.SlabStudio` API. Replace `render()` with:

```js
var cur=null,curSVG="",seq=0;
function render(){
  uiToSettings(); save();
  document.getElementById("owOut").textContent=S.outlineW.toFixed(2);
  document.getElementById("fsOut").textContent=Math.round(S.frameScale*100);
  document.getElementById("hsOut").textContent=Math.round(S.headerScale*100);
  document.getElementById("stage").className="stage "+S.backdrop;
  if(certOverride===null||document.activeElement!==el.cert)refreshCertUI();
  var my=++seq, input=cfgFrom();
  return SlabLabel.payload(input,S).then(function(p){
    if(my!==seq)return;
    var b=SlabLabel.build(input,S,p.url,p.alnum);
    if(!b){document.getElementById("payload").textContent="Payload too long for a QR code.";return;}
    cur={built:b,input:input,url:p.url};curSVG=b.svg;
    var cv=document.getElementById("cv");cv.width=1600;cv.height=Math.round(1600*S.H/S.W);
    SlabLabel.drawCanvas(cv,b.shapes,b.cfg,S.backdrop==="light"?"#1b1d22":"#ffffff");
    var t=b.stats;
    document.getElementById("stats").innerHTML=[st("v"+t.version+"-"+t.level,"QR version · EC"),st(t.modules+"×"+t.modules,"modules"),
      st(t.moduleMM.toFixed(3)+" mm","module size"),st(t.qrMM.toFixed(1)+" mm","QR footprint"),st(t.payloadLen+" ch","payload"),
      st(t.budgetVersion?t.budget+" ch":"—","fits @ 0.5 mm ("+(t.budgetVersion||"none")+")"),st(t.bind,"limited by")].join("");
    document.getElementById("warns").innerHTML=b.warnings.map(function(w){return '<div class="note '+w[0]+'">'+esc(w[1])+'</div>';}).join("");
    document.getElementById("payload").textContent=p.url;
  });
}
```
In the pasted export handlers replace `cur.cfg.cert` with `cur.input.cert`, and the QR-only handler body with `offer("slabsense-"+safeName(cur.input.cert)+"-qr.svg",SlabLabel.qrOnlySVG(cur.built,S));`. In `fitQR` replace `cur.g` with `cur.built.g` and `cur.cfg` with `cur.built.cfg`. In `dlPNG` replace `cur.cfg` with `cur.built.cfg` and `cur.g.shapes` with `cur.built.shapes`, and call `SlabLabel.drawCanvas`. In `getState` return `{url:cur.url,cert:cur.input.cert,version:cur.built.stats.version,level:cur.built.stats.level,modules:cur.built.stats.modules,moduleMM:cur.built.stats.moduleMM,qrMM:cur.built.stats.qrMM,bind:cur.built.stats.bind,W:S.W,H:S.H,shrink:cur.built.stats.shrink}`. The final line becomes `SlabLabel.ready.then(function(){load();return render();}).then(readyResolve,function(e){document.getElementById("payload").textContent="Label engine failed to load: "+e.message;});`.

- [ ] **Step 3: Run the studio smoke test and the phone-width screenshot**

```bash
node scripts/verify-studio.cjs
```
Expected: `[["cert","TEST-00001"],["svgStarts","<?xml"],["afterAdvance","TEST-00002"],["grade","2-Q 0.44"]]`, exit 0.

```bash
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars --window-size=1400,900 --virtual-time-budget=5000 --screenshot=studio.png "file:///G:/Grading App/SlabSense/public/studio.html"
```
Open `studio.png`: the label preview must look identical to the old studio (centred wordmark, 11 mm QR with S-mark, PRISTINE over 10). Delete the screenshot afterwards.

- [ ] **Step 4: Commit**

```bash
git add public/studio.html public/slab/studio.js scripts/verify-studio.cjs
git commit -m "feat(slab): studio.html as a shell over the shared label engine (manual mode, TEST- certs)"
```

---

### Task 5: `api/slab.js` — public cert read

**Files:**
- Create: `api/slab.js`
- Create: `scripts/verify-api-slab.cjs`

**Interfaces:**
- Produces `GET /api/slab?cert=SS26-00001` → `200 { slab: <slab_public row> }`, `404 { error: "not_found" }`, `400 { error: "cert_required" }`. `makeHandler(db)` is exported for tests; `db` is anything with `.from(table).select(cols).eq(col,val).maybeSingle()`.

- [ ] **Step 1: Write the test with a fake db**

`scripts/verify-api-slab.cjs`:
```js
(async()=>{
const {makeHandler}=await import('../api/slab.js');
function res(){const r={code:200,body:null,headers:{}};r.setHeader=(k,v)=>{r.headers[k]=v;};r.status=c=>{r.code=c;return r;};r.json=b=>{r.body=b;return r;};r.end=()=>r;return r;}
const row={cert:'SS26-00001',status:'paid',card_name:'Pikachu V',grade_value:10};
const db={from:(t)=>({select:()=>({eq:(c,v)=>({maybeSingle:async()=>({data:(t==='slab_public'&&v==='SS26-00001')?row:null,error:null})})})})};
const h=makeHandler(db);let bad=0;
let r=res();await h({method:'GET',query:{cert:'SS26-00001'}},r);if(r.code!==200||r.body.slab.card_name!=='Pikachu V'){console.log('FAIL found',r.code,r.body);bad++;}
r=res();await h({method:'GET',query:{cert:'ss26-00001'}},r);if(r.code!==200){console.log('FAIL case-insensitive',r.code);bad++;}
r=res();await h({method:'GET',query:{cert:'SS26-99999'}},r);if(r.code!==404||r.body.error!=='not_found'){console.log('FAIL 404',r.code,r.body);bad++;}
r=res();await h({method:'GET',query:{}},r);if(r.code!==400){console.log('FAIL 400',r.code);bad++;}
r=res();await h({method:'POST',query:{cert:'SS26-00001'}},r);if(r.code!==405){console.log('FAIL 405',r.code);bad++;}
r=res();await h({method:'GET',query:{cert:'SS26-00001'}},r);if(r.headers['Cache-Control']!=='public, max-age=60'){console.log('FAIL cache header',r.headers);bad++;}
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
})();
```
Run: `node scripts/verify-api-slab.cjs`. Expected: fails with `Cannot find module '../api/slab.js'`.

- [ ] **Step 2: Write the route**

```js
/**
 * GET /api/slab?cert=SS26-00001
 * Public read of one slab through the slab_public view (no user id, no shipping — see migration 20260912_slabs.sql).
 */
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 10 };

const CERT_RE = /^[A-Z]{2,4}\d{2}-\d{5}$/;

export function makeHandler(db) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const cert = String(req.query?.cert || '').trim().toUpperCase();
    if (!cert) return res.status(400).json({ error: 'cert_required' });
    if (!CERT_RE.test(cert)) return res.status(404).json({ error: 'not_found' });

    const { data, error } = await db.from('slab_public').select('*').eq('cert', cert).maybeSingle();
    if (error) {
      console.error('[api/slab] query failed:', error);
      return res.status(500).json({ error: 'query_failed' });
    }
    if (!data) return res.status(404).json({ error: 'not_found' });

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ slab: data });
  };
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://localhost',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing'
);
export default makeHandler(supabase);
```

- [ ] **Step 3: Run the test**

`node scripts/verify-api-slab.cjs` → `PASS`.

- [ ] **Step 4: Commit**

```bash
git add api/slab.js scripts/verify-api-slab.cjs
git commit -m "feat(api): public GET /api/slab?cert= over slab_public"
```

---

### Task 6: Plate asset and window measurement

**Files:**
- Create: `public/slab/plate-straight.png`
- Create: `scripts/plate-measure.cjs`
- Source: `SlabSense Slab Engraving Studio/Referances/Empty Slab/empty slab straight no logo.jpg`

**Interfaces:**
- Produces two rectangles, as fractions of plate width/height, consumed as constants by Task 7: `LABEL_WIN` (the black label window inside the label frame) and `CARD_WIN` (the black card well).

- [ ] **Step 1: Convert the plate to PNG**

```bash
node -e "
const {createCanvas,loadImage}=require('canvas');const fs=require('fs');
loadImage('SlabSense Slab Engraving Studio/Referances/Empty Slab/empty slab straight no logo.jpg').then(im=>{
 const c=createCanvas(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);
 // crush JPEG noise in the backdrop so screen-blend leaves it fully transparent
 const d=x.getImageData(0,0,c.width,c.height);for(let i=0;i<d.data.length;i+=4){if(d.data[i]<18&&d.data[i+1]<18&&d.data[i+2]<18){d.data[i]=d.data[i+1]=d.data[i+2]=0;}}x.putImageData(d,0,0);
 fs.writeFileSync('public/slab/plate-straight.png',c.toBuffer('image/png'));console.log(im.width+'x'+im.height);});"
```
Expected: prints `987x1024` (or the source's size) and the PNG exists.

- [ ] **Step 2: Write the measurement script**

```js
// scripts/plate-measure.cjs — finds the label window and the card well in the plate:
// the two largest fully-dark axis-aligned rectangles bounded by bright (acrylic) edges.
const {createCanvas,loadImage}=require('canvas');
loadImage('public/slab/plate-straight.png').then(im=>{
  const W=im.width,H=im.height,c=createCanvas(W,H),x=c.getContext('2d');x.drawImage(im,0,0);
  const d=x.getImageData(0,0,W,H).data, lum=(i)=>d[i*4]*0.3+d[i*4+1]*0.59+d[i*4+2]*0.11;
  const dark=new Uint8Array(W*H);for(let i=0;i<W*H;i++)dark[i]=lum(i)<40?1:0;
  // row profile along the plate's vertical centreline (cx) — dark runs separated by bright lines
  const cx=Math.round(W/2), runs=[];let start=-1;
  for(let y=0;y<H;y++){const isD=dark[y*W+cx];if(isD&&start<0)start=y;if(!isD&&start>=0){if(y-start>H*0.05)runs.push([start,y]);start=-1;}}
  if(start>=0&&H-start>H*0.05)runs.push([start,H]);
  // for each run, widen left/right along its middle row until a bright pixel
  const boxes=runs.map(([y0,y1])=>{const ym=Math.round((y0+y1)/2);let x0=cx,x1=cx;while(x0>0&&dark[ym*W+x0-1])x0--;while(x1<W-1&&dark[ym*W+x1+1])x1++;return {x:x0/W,y:y0/H,w:(x1-x0+1)/W,h:(y1-y0)/H,aspect:(x1-x0+1)/(y1-y0)};});
  console.log(JSON.stringify(boxes,null,1));
});
```
Run: `node scripts/plate-measure.cjs`. Expected: a list in which the first box above the plate's middle has `aspect` ≈ 3.2 (the label window, 69 : 21.4) and the box below it has `aspect` ≈ 0.72 (card well, 2.5 : 3.5). Ignore any run that touches `y:0` or `y+h:1` (that's the backdrop outside the slab). If the aspect is off by more than 10 %, the threshold `40` is picking up the frame lines: lower it to `25` and re-run.

- [ ] **Step 3: Record the constants**

Copy the two boxes into `scripts/plate-windows.json`:
```json
{ "LABEL_WIN": { "x": 0.00, "y": 0.00, "w": 0.00, "h": 0.00 }, "CARD_WIN": { "x": 0.00, "y": 0.00, "w": 0.00, "h": 0.00 } }
```
with the measured values (four decimals). Task 7 pastes these into `slabview.html`.

- [ ] **Step 4: Commit**

```bash
git add public/slab/plate-straight.png scripts/plate-measure.cjs scripts/plate-windows.json
git commit -m "feat(slab): empty-slab plate asset with measured label and card windows"
```

---

### Task 7: `public/slabview.html` — composite + report

**Files:**
- Create: `public/slabview.html`, `public/slab/slabview.js`
- Create: `scripts/fixtures/slab-public.json`, `scripts/verify-slabview.cjs`

**Interfaces:**
- Consumes: `GET /api/slab?cert=` (Task 5), `SlabLabel` (Task 3), `plate-straight.png` + window constants (Task 6).
- Dev hook: `?src=<url>` overrides the API URL so the page can be tested from a local JSON file.

- [ ] **Step 1: Fixture and screenshot test first**

`scripts/fixtures/slab-public.json`:
```json
{ "slab": {
  "cert": "SS26-00001", "status": "engraved", "paid_at": "2026-09-10T15:00:00Z", "engraved_at": "2026-09-11T18:30:00Z", "shipped_at": null,
  "card_name": "Pikachu V", "card_set": "2024 Pokémon x SpongeBob", "card_number": "001", "card_game": "pokemon",
  "card_info": { "rarity": "Special Illustration Rare", "variant": "Bikini Bottom Promo", "year": "2024" },
  "grade_value": 10, "grade_label": "Pristine",
  "subgrades": { "centering": 10, "corners": 10, "edges": 10, "surface": 9.5 },
  "front_centering": { "lr": "52/48", "tb": "51/49" }, "back_centering": { "lr": "55/45", "tb": "50/50" },
  "dings": [ { "type": "SURFACE", "severity": "minor", "location": "lower left", "note": "faint print line" } ],
  "user_card_image": "../SlabSense Slab Engraving Studio/Referances/slabsence spongebob.jpg",
  "enhanced_front_path": null, "enhanced_back_path": null, "front_image_path": null, "back_image_path": null
} }
```
(The image path is relative to `public/` and only works under `file://` in the test; real rows carry absolute `card-images` URLs.)

`scripts/verify-slabview.cjs`:
```js
// Screenshots the cert page in three states from a local fixture; asserts the DOM reached each state.
const fs=require('fs'),cp=require('child_process'),path=require('path');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=path.join(__dirname,'..').split(path.sep).join('/');
const page=(q)=>'file:///'+root+'/public/slabview.html?'+q;
const fix='file:///'+root+'/scripts/fixtures/slab-public.json';
function run(name,q,width){const out=`${root}/scripts/out-slabview-${name}.png`;
  const dom=cp.execFileSync(CHROME,['--headless=new','--disable-gpu','--allow-file-access-from-files','--hide-scrollbars','--window-size='+width+',1400','--virtual-time-budget=6000','--dump-dom','--screenshot='+out,page(q)],{encoding:'utf8',maxBuffer:64e6,stdio:['ignore','pipe','ignore']});
  const state=(dom.match(/data-state="([a-z-]+)"/)||[])[1];console.log(name,'state=',state,'→',out);return state;}
let bad=0;
if(run('found','cert=SS26-00001&src='+encodeURIComponent(fix),1200)!=='found')bad++;
if(run('found-phone','cert=SS26-00001&src='+encodeURIComponent(fix),500)!=='found')bad++;
if(run('notfound','cert=SS26-99999&src='+encodeURIComponent('file:///'+root+'/scripts/fixtures/nope.json'),1200)!=='not-found')bad++;
if(run('nocert','',1200)!=='not-found')bad++;
console.log(bad?'FAIL':'PASS — inspect the PNGs');process.exit(bad?1:0);
```
Run: `node scripts/verify-slabview.cjs`. Expected: all states `undefined`, `FAIL` (page missing).

- [ ] **Step 2: Write `public/slabview.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SlabSense Cert</title>
<style>
  :root{--bg:#0b0c10;--panel:#14161c;--fg:#e9ecf1;--muted:#98a0ae;--line:#262b34;--accent:#7ea5ff;--ok:#7fd3a1;--warn:#f0bd6d}
  *{box-sizing:border-box}html,body{margin:0}
  body{background:var(--bg);color:var(--fg);font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.5;padding:0 16px 64px}
  .wrap{max-width:960px;margin:0 auto}
  header{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid var(--line)}
  header .brand{font-weight:700;letter-spacing:.02em}header .brand span{font-weight:300}
  .cert{font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--muted)}
  main{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:28px;align-items:start;padding-top:24px}
  @media (max-width:800px){main{grid-template-columns:minmax(0,1fr)}}
  .slab{position:relative;width:100%;aspect-ratio:987/1024;background:#000;border-radius:14px;overflow:hidden;isolation:isolate}
  .slab .card{position:absolute;object-fit:cover;filter:blur(.25px) contrast(.94) brightness(.96);box-shadow:inset 0 0 0 1px rgba(0,0,0,.6)}
  .slab .well{position:absolute;box-shadow:inset 0 2px 8px rgba(0,0,0,.85),inset 0 -1px 3px rgba(0,0,0,.6);pointer-events:none}
  .slab .plate{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:screen;pointer-events:none}
  .slab canvas.label{position:absolute;filter:drop-shadow(0 0 .6px rgba(255,255,255,.9)) drop-shadow(0 0 3px rgba(255,255,255,.25));pointer-events:none}
  .toggle{display:flex;gap:8px;margin-top:10px}.toggle button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--fg);cursor:pointer}.toggle button[aria-pressed=true]{border-color:var(--accent)}
  .grade{display:flex;align-items:baseline;gap:14px;margin:0 0 6px}.grade b{font-size:64px;font-weight:300;line-height:1}.grade span{font-size:18px;letter-spacing:.08em;text-transform:uppercase}
  h1{font-size:22px;margin:0 0 2px}.sub{color:var(--muted);margin:0 0 18px}
  .status{display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid var(--line);font-size:13px;margin-bottom:18px}
  .status.shipped{border-color:var(--ok);color:var(--ok)}.status.engraved{border-color:var(--accent);color:var(--accent)}.status.paid{border-color:var(--warn);color:var(--warn)}
  section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px}
  section h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
  .kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}.kv div b{display:block;font-size:20px;font-weight:600}.kv div span{font-size:12px;color:var(--muted)}
  ul.dings{margin:0;padding-left:18px}ul.dings li{margin:4px 0}ul.dings em{color:var(--muted);font-style:normal}
  .images{display:grid;grid-template-columns:1fr 1fr;gap:10px}.images img{width:100%;border-radius:8px;background:#000}
  .empty{padding:80px 0;text-align:center;color:var(--muted)}
  [hidden]{display:none!important}
</style>
</head>
<body data-state="loading">
<div class="wrap">
  <header><div class="brand">slab<span>sense</span></div><div class="cert" id="hdrCert"></div></header>
  <div id="loading" class="empty">Loading…</div>
  <div id="notfound" class="empty" hidden><p>No slab with that cert number.</p><p class="cert" id="nfCert"></p></div>
  <main id="main" hidden>
    <div>
      <div class="slab" id="slab">
        <img class="card" id="card" alt="" hidden>
        <div class="well" id="well"></div>
        <img class="plate" src="slab/plate-straight.png" alt="">
        <canvas class="label" id="label"></canvas>
      </div>
      <div class="toggle"><button id="btnFront" aria-pressed="true">Front</button><button id="btnBack" aria-pressed="false">Back</button></div>
    </div>
    <div>
      <p class="grade"><b id="gradeNum"></b><span id="gradeWord"></span></p>
      <h1 id="name"></h1><p class="sub" id="setline"></p>
      <span class="status" id="status"></span>
      <section><h2>Subgrades</h2><div class="kv" id="subgrades"></div></section>
      <section><h2>Centering</h2><div class="kv" id="centering"></div></section>
      <section><h2>Defects found</h2><ul class="dings" id="dings"></ul><p id="nodings" class="sub" hidden>None recorded.</p></section>
      <section><h2>Images</h2><div class="images" id="images"></div></section>
      <section><h2>Cert</h2><div class="kv" id="dates"></div></section>
    </div>
  </main>
</div>
<script src="slab/vendor/qrcode.js"></script>
<script src="slab/vendor/opentype.js"></script>
<script src="slab/vendor/polygon-clipping.js"></script>
<script src="slab/fonts.js"></script>
<script src="slab/frame.js"></script>
<script src="slab/label.js"></script>
<script src="slab/slabview.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `public/slab/slabview.js`**

Replace the four `LABEL_WIN`/`CARD_WIN` numbers with the values from `scripts/plate-windows.json`.

```js
/* public/slab/slabview.js — public cert page: composite + report */
(function(){
"use strict";
var LABEL_WIN={x:0.0000,y:0.0000,w:0.0000,h:0.0000};   // from scripts/plate-windows.json
var CARD_WIN ={x:0.0000,y:0.0000,w:0.0000,h:0.0000};
var q=new URLSearchParams(location.search), cert=(q.get("cert")||"").trim().toUpperCase();
var api=q.get("src")||("/api/slab?cert="+encodeURIComponent(cert));
var $=function(id){return document.getElementById(id);};
function setState(s){document.body.setAttribute("data-state",s);$("loading").hidden=s!=="loading";$("notfound").hidden=s!=="not-found";$("main").hidden=s!=="found";}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function pct(r){return {left:(r.x*100)+"%",top:(r.y*100)+"%",width:(r.w*100)+"%",height:(r.h*100)+"%"};}
function place(el,r){var p=pct(r);el.style.left=p.left;el.style.top=p.top;el.style.width=p.width;el.style.height=p.height;}
function fmtDate(s){return s?new Date(s).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}):"—";}
var STATUS={paid:"Paid — awaiting engraving",engraved:"Engraved — awaiting shipping",shipped:"Shipped"};

function drawLabel(row){
  var input=SlabLabel.fromScan(row,row.cert), s=SlabLabel.defaults;
  return SlabLabel.payload(input,s).then(function(p){
    var b=SlabLabel.build(input,s,p.url,p.alnum); if(!b)return;
    var cv=$("label"), slab=$("slab"), pxW=Math.round(slab.clientWidth*LABEL_WIN.w*3);  // 3× for crisp downscale
    cv.width=pxW; cv.height=Math.round(pxW*s.H/s.W); place(cv,LABEL_WIN);
    SlabLabel.drawCanvas(cv,b.shapes,b.cfg,"#ffffff");
  });
}
function showSide(row,side){
  var src=side==="front"?(row.user_card_image||row.enhanced_front_path||row.front_image_path):(row.enhanced_back_path||row.back_image_path);
  var img=$("card"); img.hidden=!src; if(src)img.src=src; place(img,CARD_WIN); place($("well"),CARD_WIN);
  $("btnFront").setAttribute("aria-pressed",side==="front");$("btnBack").setAttribute("aria-pressed",side==="back");
}
function kv(el,obj,fmt){el.innerHTML=Object.keys(obj||{}).map(function(k){var v=obj[k];if(v&&typeof v==="object")v=Object.values(v).join(" / ");return '<div><b>'+esc(fmt?fmt(v):v)+'</b><span>'+esc(k.replace(/_/g," "))+'</span></div>';}).join("")||'<div><span>Not recorded</span></div>';}
function render(row){
  var input=SlabLabel.fromScan(row,row.cert);
  document.title="SlabSense "+row.cert+" — "+input.name;
  $("hdrCert").textContent=row.cert;
  $("gradeNum").textContent=input.grade;$("gradeWord").textContent=input.gradeWord;
  $("name").textContent=input.name;$("setline").textContent=[input.l2,input.l3,input.l4].filter(Boolean).join(" · ");
  var st=$("status");st.textContent=STATUS[row.status]||row.status;st.className="status "+row.status;
  kv($("subgrades"),row.subgrades);
  kv($("centering"),{front:row.front_centering,back:row.back_centering});
  var d=row.dings||[];$("dings").innerHTML=d.map(function(x){return '<li>'+esc(x.type||"defect")+(x.severity?' <em>('+esc(x.severity)+')</em>':'')+(x.location?' — '+esc(x.location):'')+(x.note?': '+esc(x.note):'')+'</li>';}).join("");$("nodings").hidden=d.length>0;
  var imgs=[["Front",row.user_card_image||row.enhanced_front_path||row.front_image_path],["Back",row.enhanced_back_path||row.back_image_path]].filter(function(x){return x[1];});
  $("images").innerHTML=imgs.map(function(x){return '<figure style="margin:0"><img src="'+esc(x[1])+'" alt="'+esc(x[0])+'"><figcaption class="sub">'+esc(x[0])+'</figcaption></figure>';}).join("")||'<p class="sub">No images on file.</p>';
  kv($("dates"),{paid:row.paid_at,engraved:row.engraved_at,shipped:row.shipped_at},fmtDate);
  showSide(row,"front");
  $("btnFront").onclick=function(){showSide(row,"front");};$("btnBack").onclick=function(){showSide(row,"back");};
  setState("found");
  return SlabLabel.ready.then(function(){return drawLabel(row);});
}
if(!cert){$("nfCert").textContent="";setState("not-found");}
else fetch(api).then(function(r){if(!r.ok)throw new Error("status "+r.status);return r.json();})
  .then(function(j){if(!j||!j.slab)throw new Error("empty");return render(j.slab);})
  .catch(function(){$("nfCert").textContent=cert;setState("not-found");});
window.addEventListener("resize",function(){if(document.body.getAttribute("data-state")==="found"&&window.__row)drawLabel(window.__row);});
})();
```
Note for the resize handler: set `window.__row=row;` as the first line of `render(row)`.

- [ ] **Step 4: Run the page test and inspect**

`node scripts/verify-slabview.cjs` → `found`, `found`, `not-found`, `not-found`, `PASS`. Open `scripts/out-slabview-found.png`: the card sits inside the well under the acrylic highlights, the engraved label reads white on black in the label window with the QR and S-mark, PRISTINE over 10 on the right. Open `out-slabview-found-phone.png`: single column, no horizontal overflow. If the label or card is visibly offset from the plate's windows, the `plate-windows.json` values are wrong — re-run Task 6 Step 2 with a lower threshold. Delete the PNGs (`git` must not see them): add `scripts/out-*.png` to `.gitignore`.

- [ ] **Step 5: Commit**

```bash
git add public/slabview.html public/slab/slabview.js scripts/fixtures/slab-public.json scripts/verify-slabview.cjs .gitignore
git commit -m "feat(slab): public cert page with slab composite and full grading report"
```

---

### Task 8: Rewrites, deploy check, docs

**Files:**
- Modify: `vercel.json`
- Modify: `SlabSense Slab Engraving Studio/README-studio.md` (create) — one paragraph pointing at `public/studio.html`

- [ ] **Step 1: Add the rewrites (order matters — before the SPA catch-all)**

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/v/:cert", "destination": "/slabview.html?cert=:cert" },
    { "source": "/studio", "destination": "/studio.html" },
    { "source": "/queue", "destination": "/studio.html" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- [ ] **Step 2: Local end-to-end with `vercel dev`**

```bash
npx vercel dev --listen 3000
```
In another shell, with a real cert created by running the Task 1 Step 3 insert **without** the rollback (this is the first real slab row; note its cert):
```bash
curl -s "http://localhost:3000/api/slab?cert=SS26-00001" | head -c 300
```
Expected: `{"slab":{"cert":"SS26-00001",...` . Then open `http://localhost:3000/v/SS26-00001` in a browser: the page renders the real scan with its `card-images` URL, and `http://localhost:3000/studio` shows the studio. Scan the on-screen QR with a phone: it must open `slabsenseai.com/v/SS26-00001` (404 until deployed — the URL is what matters).

- [ ] **Step 3: Write the pointer README**

`SlabSense Slab Engraving Studio/README-studio.md`:
```markdown
# Slab Engraving Studio

The live studio is `public/studio.html` in the app (served at `/studio`); its label engine is `public/slab/label.js`, shared with the public cert page `public/slabview.html` (`/v/<cert>`).

`SlabSense-Engraving-Studio.html` in this folder is the last self-contained offline build and is kept as a fallback only — do not edit it; change `public/slab/*` and run `npm run verify:label`.
```

- [ ] **Step 4: Commit and push the branch**

```bash
git add vercel.json "SlabSense Slab Engraving Studio/README-studio.md"
git commit -m "feat(slab): /v/:cert and /studio rewrites; studio README pointer"
git push -u origin feat/slab-cert-page
```

After deploy, add `SUPABASE_SERVICE_ROLE_KEY` is already present in Vercel (it is, per `api/credits`); nothing new is required for this plan. Visit `https://slabsenseai.com/v/SS26-00001` and scan the physical test tile's QR.

---

## Self-review

**Spec coverage (sections implemented by this plan):** §2 files + rewrites → Tasks 2, 3, 4, 7, 8. §3.1 table/sequence → Task 1. §3.2 view → Task 1. §3.3 bucket → Task 1 (created; written to in Plan C). §5 engine surface + `fromScan` → Task 3. §7 cert page (composite, report, states, mobile) → Task 7. §8 `api/slab` → Task 5. §9 error handling: 404/empty states → Tasks 5, 7; FK-blocked scan delete is inherent in Task 1's `references scans(id)` (the app-side "hide delete" is Plan B/C scope). §10 testing: label round-trip → Task 3; cert sequence → Task 1 Step 3; page screenshots → Task 7; webhook/admin tests belong to Plans B/C. §4 and §6 are deliberately Plans B and C.

**Not covered here, on purpose:** Stripe price, "Get it slabbed", webhook insert (Plan B); studio queue mode, admin gate, `api/slabs/queue|status`, SVG upload (Plan C).

**Type consistency:** `SlabLabel.build` returns `{shapes,svg,g,cfg,qr:{N,module,obj},stats,warnings}` and both `studio.js` (Task 4) and `slabview.js` (Task 7) read `b.shapes`, `b.cfg`, `b.stats.*`, `b.warnings` exactly as defined. `qrOnlySVG(built,settings)` uses `built.qr.obj`, `built.g.qs`, `built.cfg`. `fromScan(row,cert)` output keys match the `input` shape consumed by `payload`/`build`. `makeHandler(db)` is the only export the API test uses.
