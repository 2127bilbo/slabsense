# Card DB Shards + Identification Bake-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 21,899-card CLIP embedding database into versioned float16 shards in a public Supabase bucket with a weekly incremental update job, then run an offline bake-off of identification strategies on the 507 TAG photos and implement the winner.

**Architecture:** A tiny float16 codec (`src/lib/f16.js`) is shared by node scripts and the browser. `scripts/card-db/` holds the one-off initial build, the shared TCGDex helpers, and the incremental `update.mjs` that a GitHub Actions cron runs. `src/lib/clip-matcher.js` loads `manifest.json` + shards from the bucket with Cache API persistence and falls back to the bundled JSON. `scripts/harness/identify.mjs` scores four ranking variants against TAG truth and writes results like the grading harness.

**Tech Stack:** Node 24 ESM, `@xenova/transformers` (CLIP in node and browser), `canvas` 3.x (reuse one Image/canvas; see harness README for the leak), `@supabase/supabase-js` storage API, `tesseract.js` 7 (already a dependency), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-card-db-shards-and-id-bakeoff-design.md`

## Global Constraints

- Shards are append-only; a card id lives in exactly one shard; `manifest.json` is uploaded last.
- Pocket cards excluded: set `serie.id === 'tcgp'` (equivalently ids matching `/^[AB]\d/` in the existing DB).
- Embedding model stays `Xenova/clip-vit-base-patch32`, 512-dim, `{ pooling: 'mean', normalize: true }`.
- Float16 little-endian; decode without `Float16Array`.
- Secrets only via env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (node), `VITE_SUPABASE_URL` (browser). Never print keys.
- node-canvas: one shared `Image` and one shared canvas per process (see `scripts/harness/README.md`).
- Windows paths contain a space; quote paths, build with `path.join`.
- Never `git add -A`; the user's uncommitted `scripts/tag-dataset/tagdataset/*` edits stay untouched.
- Commit messages end with the attribution lines from the session reminder.
- Verified TCGDex shapes (2026-09-14): `GET /v2/en/sets` → `[{ id, name, logo, symbol, cardCount: { total, official } }]`; `GET /v2/en/sets/{id}` → `{ id, name, releaseDate, serie: { id, name }, cardCount: {...}, cards: [{ id, localId, name, image }] }`; image URL = `${image}/high.png` or `${image}/low.webp`.

---

### Task 1: float16 codec

**Files:**
- Create: `src/lib/f16.js`
- Create: `src/lib/f16.test.js`
- Modify: `package.json` (`test:lib` adds the new test)

**Interfaces:**
- Produces: `encodeF16(float32Array) → Uint8Array` (2 bytes per value, little-endian), `decodeF16(uint8ArrayOrArrayBuffer, byteOffset = 0, length = undefined) → Float32Array`.

- [ ] **Step 1: Write the failing test**

`src/lib/f16.test.js`:

```js
/** Run: node src/lib/f16.test.js */
import { encodeF16, decodeF16 } from './f16.js';
let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

const exact = new Float32Array([0, 1, -1, 0.5, -0.5, 2, 1024, -0.0625]);
const back = decodeF16(encodeF16(exact));
check('exactly representable values round-trip', exact.every((v, i) => back[i] === v), JSON.stringify(Array.from(back)));

let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const rand = new Float32Array(1000); for (let i = 0; i < 1000; i++) rand[i] = (rnd() * 2 - 1) * 0.25; // CLIP components are small
const r2 = decodeF16(encodeF16(rand));
let maxErr = 0; for (let i = 0; i < 1000; i++) maxErr = Math.max(maxErr, Math.abs(r2[i] - rand[i]));
check('1000 random small floats: max abs error < 1e-3', maxErr < 1e-3, `maxErr=${maxErr}`);
check('encoded length is 2 bytes per value', encodeF16(rand).length === 2000);

const buf = encodeF16(new Float32Array([1, 2, 3, 4]));
const slice = decodeF16(buf.buffer, buf.byteOffset + 2, 2);
check('decode with offset/length', slice.length === 2 && slice[0] === 2 && slice[1] === 3);

// unit vector stays ~unit after round trip
const u = new Float32Array(512); for (let i = 0; i < 512; i++) u[i] = rnd() - 0.5; let n = 0; for (const v of u) n += v * v; n = Math.sqrt(n); for (let i = 0; i < 512; i++) u[i] /= n;
const u2 = decodeF16(encodeF16(u)); let n2 = 0; for (const v of u2) n2 += v * v;
check('unit vector norm within 1e-3 after round trip', Math.abs(Math.sqrt(n2) - 1) < 1e-3, `norm=${Math.sqrt(n2)}`);

console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails** — `node src/lib/f16.test.js` → `Cannot find module './f16.js'`.

- [ ] **Step 3: Implement `src/lib/f16.js`**

```js
/**
 * IEEE 754 binary16 codec (little-endian), shared by node scripts and the browser.
 * No Float16Array dependency. Handles subnormals, ±0, ±Inf, NaN; rounds to nearest even.
 */
export function encodeF16(f32) {
  const src = f32 instanceof Float32Array ? f32 : Float32Array.from(f32);
  const out = new Uint8Array(src.length * 2);
  const dv = new DataView(out.buffer);
  const tmp = new DataView(new ArrayBuffer(4));
  for (let i = 0; i < src.length; i++) {
    tmp.setFloat32(0, src[i]);
    const x = tmp.getUint32(0);
    const sign = (x >>> 16) & 0x8000;
    let exp = (x >>> 23) & 0xff;
    let mant = x & 0x7fffff;
    let h;
    if (exp === 0xff) { h = sign | 0x7c00 | (mant ? 0x200 : 0); }            // Inf / NaN
    else {
      exp = exp - 127 + 15;
      if (exp >= 0x1f) { h = sign | 0x7c00; }                                 // overflow → Inf
      else if (exp <= 0) {                                                     // subnormal / zero
        if (exp < -10) h = sign;
        else { mant = (mant | 0x800000) >>> (1 - exp); const r = (mant >>> 13) + ((mant & 0x1fff) > 0x1000 || ((mant & 0x1fff) === 0x1000 && ((mant >>> 13) & 1)) ? 1 : 0); h = sign | r; }
      } else {
        let r = mant >>> 13; const rem = mant & 0x1fff;
        if (rem > 0x1000 || (rem === 0x1000 && (r & 1))) { r++; if (r === 0x400) { r = 0; exp++; } }
        h = exp >= 0x1f ? sign | 0x7c00 : sign | (exp << 10) | r;
      }
    }
    dv.setUint16(i * 2, h, true);
  }
  return out;
}

export function decodeF16(bytes, byteOffset = 0, length) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
  const base = bytes instanceof ArrayBuffer ? byteOffset : bytes.byteOffset + byteOffset;
  const n = length ?? Math.floor((buffer.byteLength - base) / 2);
  const dv = new DataView(buffer, base, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = dv.getUint16(i * 2, true);
    const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
    if (e === 0) out[i] = s * m * 2 ** -24;
    else if (e === 0x1f) out[i] = m ? NaN : s * Infinity;
    else out[i] = s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}
```

- [ ] **Step 4: Run tests** — `node src/lib/f16.test.js` → `5 passed, 0 failed`. Add `&& node src/lib/f16.test.js` to `test:lib` in `package.json`; `npm run test:lib` all green.

- [ ] **Step 5: Commit** — `git add src/lib/f16.js src/lib/f16.test.js package.json` → `feat: float16 codec for card DB shards`.

---

### Task 2: Bucket, TCGDex helpers, initial build + upload

**Files:**
- Create: `supabase/migrations/20260914_card_db_bucket.sql`
- Create: `scripts/card-db/tcgdex.mjs`
- Create: `scripts/card-db/storage.mjs`
- Create: `scripts/card-db/build-initial.mjs`
- Modify: `.gitignore` (`scripts/card-db/out/`), `package.json` (`cards:build-initial`)

**Interfaces:**
- `tcgdex.mjs`: `fetchSets() → [{id,name,total}]`, `fetchSet(id) → {id,name,serieId,releaseDate,total,cards:[{id,localId,name,image}]}`, `downloadImage(imageBase, destPath) → 'ok'|'missing'`, `isPocketSet(set) → boolean`, `POCKET_SERIES = 'tcgp'`.
- `storage.mjs`: `getClient()` (service role from env), `uploadFile(bucketPath, bufferOrString, contentType)`, `fetchManifest() → object|null` (public URL, no auth), `publicUrl(path)`.
- Shard writer used by Tasks 2 and 4: `writeShard(outDir, shardId, ids, cards, float32Matrix) → { f16Path, metaPath, bytes, sha256, count }` lives in `scripts/card-db/shards.mjs`.

- [ ] **Step 1: Migration**

```sql
-- Public bucket for the card identification database (manifest + float16 shards).
-- Anyone can read; only the service role writes (the weekly update job).
insert into storage.buckets (id, name, public)
values ('card-db', 'card-db', true)
on conflict (id) do nothing;

drop policy if exists "public read card-db" on storage.objects;
create policy "public read card-db" on storage.objects
  for select using (bucket_id = 'card-db');
```
The owner applies it (Supabase SQL editor). Everything after Step 4 needs it.

- [ ] **Step 2: `scripts/card-db/tcgdex.mjs`**

```js
import fs from 'node:fs'; import path from 'node:path';
const API = 'https://api.tcgdex.net/v2/en';
export const POCKET_SERIES = 'tcgp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { 'user-agent': 'slabsense-card-db/1.0' } });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    await sleep(500 * (i + 1));
  }
  throw new Error(`GET ${url} failed after ${tries} tries`);
}
export async function fetchSets() {
  const sets = await getJson(`${API}/sets`);
  return sets.map((s) => ({ id: s.id, name: s.name, total: s.cardCount?.total ?? 0 }));
}
export async function fetchSet(id) {
  const s = await getJson(`${API}/sets/${encodeURIComponent(id)}`);
  if (!s) return null;
  return { id: s.id, name: s.name, serieId: s.serie?.id ?? null, releaseDate: s.releaseDate ?? null,
    total: s.cardCount?.total ?? s.cards?.length ?? 0,
    cards: (s.cards || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null })) };
}
export const isPocketSet = (set) => set.serieId === POCKET_SERIES || /^[AB]\d/.test(set.id);
/** Downloads `${imageBase}/high.png`. Returns 'ok' | 'missing'. */
export async function downloadImage(imageBase, destPath) {
  if (!imageBase) return 'missing';
  const r = await fetch(`${imageBase}/high.png`);
  if (r.status === 404 || r.status === 403) return 'missing';
  if (!r.ok) throw new Error(`image ${imageBase}: HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(await r.arrayBuffer()));
  return 'ok';
}
```

- [ ] **Step 3: `scripts/card-db/storage.mjs` and `shards.mjs`**

`storage.mjs`:
```js
import { createClient } from '@supabase/supabase-js';
export const BUCKET = 'card-db';
const url = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
export function publicUrl(p) { return `${url()}/storage/v1/object/public/${BUCKET}/${p}`; }
export function getClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url() || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url(), key, { auth: { persistSession: false } });
}
export async function uploadFile(p, body, contentType) {
  const { error } = await getClient().storage.from(BUCKET).upload(p, body, { contentType, upsert: true, cacheControl: '3600' });
  if (error) throw new Error(`upload ${p}: ${error.message}`);
}
export async function fetchManifest() {
  const r = await fetch(publicUrl('manifest.json') + `?t=${Date.now()}`);
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
  return r.json();
}
```
`.env.local` already holds `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the calibration script reads it); scripts load it with a 10-line parser identical to `scripts/analyze_tag_calibration.cjs` lines 14–21, exported from `scripts/card-db/env.mjs`.

`shards.mjs`:
```js
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { encodeF16 } from '../../src/lib/f16.js';
export const DIM = 512;
export function writeShard(outDir, shardId, ids, cards, matrix) {
  if (matrix.length !== ids.length * DIM) throw new Error('matrix/ids length mismatch');
  fs.mkdirSync(outDir, { recursive: true });
  const bytes = encodeF16(matrix);
  const f16Path = path.join(outDir, `${shardId}.f16`), metaPath = path.join(outDir, `${shardId}.meta.json`);
  fs.writeFileSync(f16Path, bytes);
  const meta = { shard: shardId, dim: DIM, count: ids.length, ids, cards: Object.fromEntries(ids.map((id) => [id, cards[id]])) };
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  return { f16Path, metaPath, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), count: ids.length };
}
export const nextShardId = (manifest) => String((manifest?.shards?.length || 0) + 1).padStart(4, '0');
```

- [ ] **Step 4: `scripts/card-db/build-initial.mjs`**

```js
#!/usr/bin/env node
/** One-off: JSON chunks → float16 shards → bucket. `--dry-run` writes locally only. */
import fs from 'node:fs'; import path from 'node:path';
import { loadEnv } from './env.mjs'; loadEnv();
import { writeShard, DIM } from './shards.mjs';
import { uploadFile, fetchManifest } from './storage.mjs';
import { fetchSets } from './tcgdex.mjs';
const DRY = process.argv.includes('--dry-run');
const OUT = path.join(process.cwd(), 'scripts', 'card-db', 'out');
const SHARD_SIZE = 4000;

const db = {}; let model = null;
for (let i = 0; i < 5; i++) { const j = JSON.parse(fs.readFileSync(`public/models/clip_embeddings_${i}.json`, 'utf8')); model = j.model; Object.assign(db, j.embeddings); }
const info = {}; for (const c of JSON.parse(fs.readFileSync('public/card-hashes.json', 'utf8')).cards) info[c.id] = { name: c.name, set: c.set, number: c.number };
const all = Object.keys(db); const keep = all.filter((id) => !/^[AB]\d/.test(id)).sort();
console.log(`in ${all.length}, dropped ${all.length - keep.length} Pocket, out ${keep.length}`);

const shards = []; const sets = {};
for (let s = 0; s * SHARD_SIZE < keep.length; s++) {
  const ids = keep.slice(s * SHARD_SIZE, (s + 1) * SHARD_SIZE);
  const m = new Float32Array(ids.length * DIM);
  ids.forEach((id, r) => { const e = db[id]; if (e.length !== DIM) throw new Error(`${id}: dim ${e.length}`); m.set(e, r * DIM); });
  const cards = {}; for (const id of ids) { cards[id] = info[id] || { name: null, set: id.split('-')[0], number: id.split('-').slice(1).join('-') }; sets[cards[id].set] = (sets[cards[id].set] || 0) + 1; }
  const shardId = String(s + 1).padStart(4, '0');
  const w = writeShard(OUT, shardId, ids, cards, m);
  shards.push({ id: shardId, count: w.count, bytes: w.bytes, sha256: w.sha256 });
  console.log(`shard ${shardId}: ${w.count} cards, ${(w.bytes / 1048576).toFixed(1)} MB`);
}
const manifest = { version: 3, model, dim: DIM, count: keep.length, generated: new Date().toISOString(), shards, sets, excludedSeries: ['tcgp'], pending: [] };
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// set diff vs TCGDex (report only)
const remote = await fetchSets();
const missing = remote.filter((s) => !/^[AB]\d/.test(s.id) && (sets[s.id] || 0) < s.total).map((s) => `${s.id} ${s.name}: have ${sets[s.id] || 0}/${s.total}`);
console.log(`sets behind TCGDex: ${missing.length}`); for (const l of missing) console.log('  ' + l);

if (DRY) { console.log('dry run: nothing uploaded'); process.exit(0); }
const existing = await fetchManifest(); if (existing) throw new Error(`bucket already has manifest version ${existing.version}; refusing to overwrite (use update.mjs)`);
for (const s of shards) { await uploadFile(`shards/${s.id}.f16`, fs.readFileSync(path.join(OUT, `${s.id}.f16`)), 'application/octet-stream'); await uploadFile(`shards/${s.id}.meta.json`, fs.readFileSync(path.join(OUT, `${s.id}.meta.json`)), 'application/json'); console.log('uploaded', s.id); }
await uploadFile('manifest.json', JSON.stringify(manifest, null, 1), 'application/json');
console.log(`published manifest version ${manifest.version}, ${manifest.count} cards`);
```

- [ ] **Step 5: Dry run** — `node scripts/card-db/build-initial.mjs --dry-run`. Expected: `in 21899, dropped 2248 Pocket, out 19651`, 5 shards (~3.9 MB each), a manifest in `scripts/card-db/out/`, and a "sets behind TCGDex" list that includes me03, me04, me05.

- [ ] **Step 6: Node round-trip check** — decode shard 0001, take the first id, compare its decoded vector to the JSON vector: max abs diff < 1e-3, and a dot-product search against all decoded shards returns that id as top-1.

- [ ] **Step 7: Apply the migration (owner), then real run** — `node scripts/card-db/build-initial.mjs` → `published manifest version 3, 19651 cards`. Verify `curl -sI <publicUrl>/manifest.json` returns 200.

- [ ] **Step 8: Commit** — `.gitignore` gets `scripts/card-db/out/`; `package.json` gets `"cards:build-initial": "node scripts/card-db/build-initial.mjs"`. `git add supabase/migrations/20260914_card_db_bucket.sql scripts/card-db/*.mjs .gitignore package.json` → `feat(card-db): float16 shard bucket, initial build from JSON chunks`.

---

### Task 3: Client loads shards from the bucket

**Files:**
- Modify: `src/lib/clip-matcher.js` (`loadEmbeddings`, `loadCardInfo`, `findMatches`, `computeEmbedding` unchanged)
- Create: `src/lib/card-db-client.js`

**Interfaces:**
- `card-db-client.js`: `loadCardDb({ baseUrl, onProgress }) → { matrix: Float32Array, ids: string[], cards: {id:{name,set,number}}, meta: {version, model, dim, count, source:'bucket'|'bundled'} }`.
- `clip-matcher.js` keeps its exported names; `findMatches(queryEmbedding, cardInfo, topK)` keeps its signature and ignores `cardInfo` when the DB carries names.

- [ ] **Step 1: `src/lib/card-db-client.js`**

```js
import { decodeF16 } from './f16.js';
const CACHE = 'slabsense-card-db-v1';
async function cachedFetch(url, expectSha) {
  let cache = null; try { cache = await caches.open(CACHE); } catch { /* no Cache API */ }
  if (cache) { const hit = await cache.match(url); if (hit) return hit; }
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  if (cache) { try { await cache.put(url, r.clone()); } catch { /* quota */ } }
  return r;
}
export async function loadCardDb({ baseUrl, onProgress = null }) {
  const mUrl = `${baseUrl}/manifest.json`;
  const mr = await fetch(mUrl, { cache: 'no-cache' }); if (!mr.ok) throw new Error(`manifest: HTTP ${mr.status}`);
  const manifest = await mr.json();
  const dim = manifest.dim; const matrix = new Float32Array(manifest.count * dim); const ids = []; const cards = {};
  let row = 0, done = 0;
  for (const s of manifest.shards) {
    const [bin, meta] = await Promise.all([
      cachedFetch(`${baseUrl}/shards/${s.id}.f16`).then((r) => r.arrayBuffer()),
      cachedFetch(`${baseUrl}/shards/${s.id}.meta.json`).then((r) => r.json()),
    ]);
    const f = decodeF16(bin); if (f.length !== meta.count * dim) throw new Error(`shard ${s.id}: size mismatch`);
    matrix.set(f, row * dim); row += meta.count; ids.push(...meta.ids); Object.assign(cards, meta.cards);
    if (onProgress) onProgress({ step: 'embeddings', done: ++done, total: manifest.shards.length });
  }
  return { matrix, ids, cards, meta: { version: manifest.version, model: manifest.model, dim, count: manifest.count, source: 'bucket' } };
}
```
Shard URLs include the shard id, and shards never change, so the Cache API entries stay valid across manifest versions; a new version only fetches shard ids not yet cached.

- [ ] **Step 2: Rewire `clip-matcher.js`**

Replace the module-level `embeddingsDb`/`cardInfoDb` object usage with a `cardDb` holder `{ matrix, ids, cards, meta }`:

- `loadEmbeddings()`: try `loadCardDb({ baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/card-db` })`; on any error `console.warn('[CLIPMatcher] bucket DB unavailable, using bundled JSON:', e.message)` and run the existing chunked-JSON code, converting it into the same `{ matrix, ids, cards }` shape (names from `card-hashes.json` as today; `meta.source = 'bundled'`).
- `loadCardInfo()`: returns `cardDb.cards` when source is bucket; existing fetch otherwise.
- `findMatches(query, _cardInfo, topK)`: dot product over `matrix` rows (query normalized once), keep a top-K by partial sort, then build the same result objects (`id, name, number, set, image, similarity, confidence`) using `cardDb.cards[id]` and the existing `getSeriesFromSetId`.
- `getEmbeddingsMeta()` returns `cardDb.meta`.

- [ ] **Step 3: Node smoke test** — `src/lib/card-db-client.test.js` (node, uses `undici`-free global fetch and a Cache API shim `globalThis.caches = undefined`): loads the bucket DB with `VITE_SUPABASE_URL` from `.env.local`, checks `count === 19651`, then for the JSON vector of `sv02-001` computes the top-1 by dot product over the matrix and asserts it is `sv02-001`. Add to `test:lib` guarded by env presence (skip with a message when the URL is missing).

- [ ] **Step 4: Browser check** — `npm run dev`, identify a card with DevTools Network open: `manifest.json` + 5 `.f16` + 5 `.meta.json` download once (~22 MB total), reload and identify again: shards served from Cache API, no `.f16` network hits. Console shows `Loaded 19651 embeddings`. Confirm the same top match as before the change on one known card.

- [ ] **Step 5: Build + commit** — `npm run build` clean. `git add src/lib/card-db-client.js src/lib/card-db-client.test.js src/lib/clip-matcher.js package.json` → `feat(card-db): app loads card embeddings from bucket shards with JSON fallback`.

---

### Task 4: Incremental update job + GitHub Actions

**Files:**
- Create: `scripts/card-db/update.mjs`, `scripts/card-db/embed.mjs`
- Create: `.github/workflows/card-db-update.yml`
- Modify: `package.json` (`cards:update`), `scripts/harness/README.md` (pointer)

**Interfaces:**
- `embed.mjs`: `embedImages(paths, onProgress) → Float32Array(paths.length × 512)` using `@xenova/transformers` with `env.cacheDir = models/transformers-cache`, `env.allowLocalModels = true`.
- `update.mjs` flags: `--dry-run`, `--set <id>`, `--save-images`, `--retry-pending`, `--max-new <n>` (default 5000).

- [ ] **Step 1: `embed.mjs`**

```js
import path from 'node:path';
import { pipeline, env } from '@xenova/transformers';
env.cacheDir = path.join(process.cwd(), 'models', 'transformers-cache'); env.allowLocalModels = true;
let extractor = null;
export async function embedImages(paths, onProgress = null) {
  extractor ||= await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
  const out = new Float32Array(paths.length * 512);
  for (let i = 0; i < paths.length; i++) {
    const r = await extractor(paths[i], { pooling: 'mean', normalize: true });
    if (r.data.length !== 512) throw new Error(`${paths[i]}: dim ${r.data.length}`);
    out.set(r.data, i * 512);
    if (onProgress && (i % 50 === 49 || i === paths.length - 1)) onProgress(i + 1, paths.length);
  }
  return out;
}
```

- [ ] **Step 2: `update.mjs`**

```js
#!/usr/bin/env node
/** Weekly incremental update: TCGDex diff → download new images → embed → new shard → manifest. */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { loadEnv } from './env.mjs'; loadEnv();
import { fetchSets, fetchSet, downloadImage, isPocketSet } from './tcgdex.mjs';
import { fetchManifest, uploadFile, publicUrl } from './storage.mjs';
import { writeShard, nextShardId, DIM } from './shards.mjs';
import { embedImages } from './embed.mjs';
const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run'), ONLY = opt('--set', null), SAVE = args.includes('--save-images'), RETRY = args.includes('--retry-pending'), MAX = Number(opt('--max-new', 5000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const manifest = await fetchManifest(); if (!manifest) throw new Error('no manifest in bucket; run build-initial first');
const known = new Set(); for (const s of manifest.shards) { const meta = await (await fetch(publicUrl(`shards/${s.id}.meta.json`))).json(); for (const id of meta.ids) known.add(id); }
const pendingById = Object.fromEntries((manifest.pending || []).map((p) => [p.id, p]));
console.log(`manifest v${manifest.version}: ${known.size} cards, ${Object.keys(pendingById).length} pending`);

const remote = (await fetchSets()).filter((s) => !ONLY || s.id === ONLY);
const toFetch = remote.filter((s) => !/^[AB]\d/.test(s.id) && ((manifest.sets[s.id] || 0) < s.total || (RETRY && Object.values(pendingById).some((p) => p.id.startsWith(s.id + '-')))));
console.log(`sets to inspect: ${toFetch.length} of ${remote.length}`);
const newCards = []; const setInfo = {};
for (const s of toFetch) {
  const set = await fetchSet(s.id); await sleep(250); if (!set || isPocketSet(set)) continue;
  setInfo[set.id] = set;
  for (const c of set.cards) if (!known.has(c.id) && (RETRY || !pendingById[c.id])) newCards.push({ ...c, set: set.id });
}
console.log(`new cards: ${newCards.length}` + (newCards.length > MAX ? ` (capped to ${MAX})` : ''));
const batch = newCards.slice(0, MAX);
if (DRY) { for (const [id, s] of Object.entries(setInfo)) console.log(`  ${id} ${s.name}: +${batch.filter((c) => c.set === id).length}`); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-db-')); const ok = []; const pending = { ...pendingById };
let active = 0; const queue = [...batch];
await new Promise((resolve) => { const next = () => { if (!queue.length && !active) return resolve(); while (active < 4 && queue.length) { const c = queue.shift(); active++;
  const dest = SAVE ? path.join('public', 'card-images', c.set, `${c.localId}.png`) : path.join(tmp, `${c.id}.png`);
  downloadImage(c.image, dest).then((r) => { if (r === 'ok') { ok.push({ ...c, path: dest }); delete pending[c.id]; } else pending[c.id] = { id: c.id, reason: 'image 404', since: new Date().toISOString().slice(0, 10) }; })
    .catch((e) => { pending[c.id] = { id: c.id, reason: e.message, since: new Date().toISOString().slice(0, 10) }; }).finally(() => { active--; next(); }); } }; next(); });
console.log(`downloaded ${ok.length}, pending ${Object.keys(pending).length}`);
if (!ok.length) { console.log('nothing to embed'); process.exit(0); }

const matrix = await embedImages(ok.map((c) => c.path), (d, t) => console.log(`  embedded ${d}/${t}`));
const ids = ok.map((c) => c.id); const cards = Object.fromEntries(ok.map((c) => [c.id, { name: c.name, set: c.set, number: c.localId }]));
const shardId = nextShardId(manifest); const out = path.join(process.cwd(), 'scripts', 'card-db', 'out');
const w = writeShard(out, shardId, ids, cards, matrix);
await uploadFile(`shards/${shardId}.f16`, fs.readFileSync(w.f16Path), 'application/octet-stream');
await uploadFile(`shards/${shardId}.meta.json`, fs.readFileSync(w.metaPath), 'application/json');
const sets = { ...manifest.sets }; for (const c of ok) sets[c.set] = (sets[c.set] || 0) + 1;
const next = { ...manifest, version: manifest.version + 1, count: manifest.count + ok.length, generated: new Date().toISOString(), shards: [...manifest.shards, { id: shardId, count: w.count, bytes: w.bytes, sha256: w.sha256 }], sets, pending: Object.values(pending) };
await uploadFile('manifest.json', JSON.stringify(next, null, 1), 'application/json');
console.log(`published v${next.version}: +${ok.length} cards in shard ${shardId}, ${next.count} total, ${next.pending.length} pending`);
```

- [ ] **Step 3: Dry run then one set** — `node scripts/card-db/update.mjs --dry-run` lists me03/me04/me05 with counts. Then `node scripts/card-db/update.mjs --set me03 --save-images` → a new shard 0006 and manifest v4. Re-run the same command: `new cards: 0`, exits without publishing (idempotence). Then the full run for the remaining sets.

- [ ] **Step 4: Workflow**

```yaml
name: card-db-update
on:
  schedule: [{ cron: '0 9 * * 1' }]
  workflow_dispatch: {}
jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - uses: actions/cache@v4
        with: { path: models/transformers-cache, key: clip-vit-base-patch32-v1 }
      - run: node scripts/card-db/update.mjs | tee update-summary.txt
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      - uses: actions/upload-artifact@v4
        with: { name: update-summary, path: update-summary.txt }
```
`npm ci` installs `canvas` prebuilt binaries on ubuntu; `@xenova/transformers` downloads the model on first run (cached after). The owner adds the two repo secrets.

- [ ] **Step 5: Commit** — `git add scripts/card-db/update.mjs scripts/card-db/embed.mjs .github/workflows/card-db-update.yml package.json scripts/harness/README.md` → `feat(card-db): incremental TCGDex update job + weekly GitHub Actions cron`.

---

### Task 5: Identification bake-off

**Files:**
- Modify: `scripts/harness/export_ground_truth.py` (`--names` writes `scripts/harness/id-truth.json`)
- Create: `scripts/harness/identify.mjs`
- Create: `scripts/harness/results/<date>-identify.json`, `.md`
- Modify: `package.json` (`harness:identify`)

**Interfaces:**
- `id-truth.json`: `{ cert: { name, number, set, year, image } }` for the 507 local fronts.
- Variants as in spec §5.1; metrics as in §5.2.

- [ ] **Step 1: Truth export** — add to `export_ground_truth.py`: when `--names` is passed, also write `id-truth.json` with `card_name, card_number, set_name, year` and the front image basename per cert. Run it.

- [ ] **Step 2: `identify.mjs`** (node; one shared canvas/Image; DB from the bucket via `card-db-client.js` with `globalThis.caches` undefined)

Core loop per cert: embed the cached 1400-px front with `embed.mjs` (one call), top-20 by dot product, then:

```js
const statusCurrent = (top) => top >= 0.85 ? 'high' : top >= 0.75 ? 'medium' : 'unknown';
const statusMargin = (top, second) => (top >= 0.80 && top - second >= 0.03) ? 'high' : top >= 0.75 ? 'medium' : 'unknown';
```
- `ocr`: tesseract.js worker (`createWorker('eng')`, `tessedit_char_whitelist: '0123456789/'`, PSM 7) on the bottom 9% strip of the crop, left half and right half separately (vintage numbers sit bottom-right, modern bottom-left); regex `(\d{1,3})\s*/\s*(\d{1,3})`; boost +0.15 for candidates whose `number` (leading zeros stripped) equals the read numerator.
- `pixel`: for each candidate, load `public/card-images/{set}/{number}.png` (skip → NCC 0), resize both to 500×700 on the shared canvas, take rows 637–700 full width, luminance, local contrast normalize (15 px box mean/std via integral images), NCC with best of ±6 px horizontal shift; boost +0.25 × max(0, ncc).
- Truth match: `norm(name)` equality (lowercase alphanumerics) and numerator equality; `inDb` = some card in `cards` with that name and number.

Metrics and output exactly per spec §5.2, written as `results/<date>-identify.json` / `.md`, with a coverage list of not-in-DB cards grouped by TAG set name.

- [ ] **Step 3: Run** — `npm run harness:identify` (expect ~2 minutes for CLIP + pixel; OCR adds ~1 s per card, so ~10 minutes). Read the `.md`.

- [ ] **Step 4: Commit results** → `feat(harness): identification bake-off + 2026-09-14 results`.

- [ ] **Step 5: Decision** — the owner reads the results and picks per spec §5.3. Task 6 implements that pick.

---

### Task 6: Implement the winner + identification logging

**Files:**
- Modify: `src/lib/clip-matcher.js` (status rule and/or re-rank)
- Create: `supabase/migrations/20260914_card_identifications.sql`
- Modify: `src/components/CardIdentifier/CardIdentifier.jsx` (log on confirm/pick), `src/services/scans.js` (`logIdentification`)

- [ ] **Step 1: Migration**

```sql
create table if not exists public.card_identifications (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  db_version int,
  status text not null,               -- high | medium | unknown | manual
  top5 jsonb not null,                -- [{ id, similarity }]
  chosen_id text,                     -- what the user confirmed/picked (null = skipped)
  variant text not null               -- current | margin | ocr | pixel
);
alter table public.card_identifications enable row level security;
create policy "insert own identifications" on public.card_identifications for insert with check (auth.uid() = user_id or user_id is null);
```

- [ ] **Step 2: Winner in `clip-matcher.js`** — one of: (A2) replace `getConfidence` + status with the margin rule; (B) after `findMatches`, OCR the bottom strip with the existing tesseract dependency in a canvas and boost; (C) after `findMatches`, fetch the 20 candidates' `low.webp`, NCC on the strip in a canvas, boost. Whichever it is, `matchCard()` returns `variant` in its result.

- [ ] **Step 3: Logging** — `scans.js`: `export async function logIdentification({ userId, dbVersion, status, top5, chosenId, variant })` inserting into `card_identifications`, errors swallowed with a `console.warn`. `CardIdentifier.jsx` calls it when the user confirms the top match, picks a candidate, or completes a manual search (`status: 'manual'`).

- [ ] **Step 4: Verify** — `npm run test:lib`, `npm run build`, browser: identify three cards, confirm rows appear in `card_identifications`.

- [ ] **Step 5: Commit** → `feat(identify): <winner> re-ranking + identification logging` and push per the owner's choice.

---

## Self-review notes

- Spec §4.1 layout/manifest → T2 (`shards.mjs`, `build-initial`); §4.2 → T2; §4.3 → T3; §4.4/§4.5 → T4; §4.6 tests → T1 S1, T2 S6, T3 S3–S4; §5 → T5; §5.3 implementation + logging → T6; §6 files → covered; follow-up JSON deletion is deliberately not a task here.
- Names consistent across tasks: `encodeF16/decodeF16` (T1→T2,T3), `writeShard/nextShardId/DIM` (T2→T4), `fetchSets/fetchSet/downloadImage/isPocketSet` (T2→T4), `fetchManifest/uploadFile/publicUrl` (T2→T4), `embedImages` (T4→T5), `loadCardDb` (T3→T5).
- Pocket exclusion uses the id regex for the existing DB (no serie info there) and `serie.id` for new sets; both are stated in Global Constraints.
