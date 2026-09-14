#!/usr/bin/env node
/**
 * Incremental card DB update: TCGDex diff → download new images → embed → new shard → manifest.
 * Idempotent: ids already in any shard are skipped; the manifest is uploaded last, so a failed
 * run leaves the previous version live.
 *
 *   node scripts/card-db/update.mjs [--dry-run] [--set <id>] [--save-images] [--retry-pending] [--max-new <n>]
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY. `.env.local` is read if present.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from './env.mjs';
import { fetchSets, fetchSet, downloadImage, isPocketSet, isPocketSetId } from './tcgdex.mjs';
import { fetchManifest, uploadFile, publicUrl } from './storage.mjs';
import { writeShard, nextShardId, DIM } from './shards.mjs';
import { embedImages } from './embed.mjs';

loadEnv();
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const ONLY = opt('--set', null);
const SAVE = args.includes('--save-images');
const RETRY = args.includes('--retry-pending');
const MAX = Number(opt('--max-new', 5000));
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Verify write credentials up front so a no-op run still proves the service key works.
if (!DRY) {
  const { getClient } = await import('./storage.mjs');
  const { error } = await getClient().storage.from('card-db').list('shards', { limit: 1 });
  if (error) throw new Error(`bucket access check failed (service role key?): ${error.message}`);
  console.log('bucket access: ok (service role)');
}

const manifest = await fetchManifest();
if (!manifest) throw new Error('no manifest in bucket; run build-initial first');
const known = new Set();
const where = new Map();   // id → { shard, row, name }  (for vector reuse on renames)
for (const s of manifest.shards) {
  const meta = await (await fetch(publicUrl(`shards/${s.id}.meta.json`))).json();
  meta.ids.forEach((id, row) => { known.add(id); where.set(id, { shard: s.id, row, name: meta.cards[id]?.name || null }); });
}
const retired = new Set(manifest.retired || []);
const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const shardCache = new Map();
async function rowVector(id) {
  const w = where.get(id); if (!w) return null;
  if (!shardCache.has(w.shard)) { const { decodeF16 } = await import('../../src/lib/f16.js'); shardCache.set(w.shard, decodeF16(await (await fetch(publicUrl(`shards/${w.shard}.f16`))).arrayBuffer())); }
  const f = shardCache.get(w.shard); return f.subarray(w.row * DIM, (w.row + 1) * DIM);
}
/**
 * TCGDex sometimes splits a subset into its own set (swsh12.5 GG cards → swsh12.5gg, TG → *tg,
 * SV → *sv). The new set usually has no images. If our DB holds the same card under the old id
 * (same name, same localId, old set id is a prefix of the new one), reuse its vector under the
 * new id and retire the old id instead of leaving the card pending forever.
 */
function findRenamedFrom(setId, card) {
  const m = setId.match(/^(.+?)(tg|gg|sv|cc|sh)$/i); if (!m) return null;
  const oldId = `${m[1]}-${card.localId}`;
  const w = where.get(oldId);
  return w && !retired.has(oldId) && normName(w.name) === normName(card.name) ? oldId : null;
}
const pendingById = Object.fromEntries((manifest.pending || []).map((p) => [p.id, p]));
console.log(`manifest v${manifest.version}: ${known.size} cards in ${manifest.shards.length} shards, ${Object.keys(pendingById).length} pending`);

const remote = (await fetchSets()).filter((s) => !ONLY || s.id === ONLY);
const pendingSets = new Set(Object.keys(pendingById).map((id) => id.split('-')[0]));
const toInspect = remote.filter((s) => !isPocketSetId(s.id) && ((manifest.sets[s.id] || 0) < s.total || (RETRY && pendingSets.has(s.id))));
console.log(`sets to inspect: ${toInspect.length} of ${remote.length}`);

const newCards = [];
const setInfo = {};
for (const s of toInspect) {
  const set = await fetchSet(s.id);
  await sleep(250);
  if (!set || isPocketSet(set)) continue;
  setInfo[set.id] = set;
  for (const c of set.cards) {
    if (known.has(c.id)) continue;
    const renamedFrom = findRenamedFrom(set.id, c);
    if (renamedFrom) { newCards.push({ ...c, set: set.id, renamedFrom }); continue; }   // vector reuse, no download
    if (pendingById[c.id]) { if (RETRY && c.image) newCards.push({ ...c, set: set.id }); continue; } // retry only once TCGDex has an image
    newCards.push({ ...c, set: set.id });
  }
}
const renames = newCards.filter((c) => c.renamedFrom);
if (renames.length) console.log(`renamed ids (vector reused, old id retired): ${renames.length}`);
console.log(`new cards: ${newCards.length}${newCards.length > MAX ? ` (capped to ${MAX} this run)` : ''}`);
const batch = newCards.slice(0, MAX);
for (const [id, s] of Object.entries(setInfo)) { const n = batch.filter((c) => c.set === id).length; if (n) console.log(`  ${id} ${s.name}: +${n}`); }
if (DRY) { console.log('dry run: nothing downloaded or published'); process.exit(0); }
if (!batch.length) { console.log('nothing to do'); process.exit(0); }

// Download (4 at a time)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-db-'));
const ok = [];
const pending = { ...pendingById };
const reused = [];   // { card, vector }
for (const c of batch.filter((x) => x.renamedFrom)) { const v = await rowVector(c.renamedFrom); if (v) { reused.push({ card: c, vector: Float32Array.from(v) }); delete pending[c.id]; retired.add(c.renamedFrom); } }
const queue = batch.filter((x) => !x.renamedFrom);
let active = 0;
await new Promise((resolve) => {
  const next = () => {
    if (!queue.length && !active) return resolve();
    while (active < 4 && queue.length) {
      const c = queue.shift();
      active++;
      const dest = SAVE ? path.join(process.cwd(), 'public', 'card-images', c.set, `${c.localId}.png`) : path.join(tmp, `${c.id}.png`);
      downloadImage(c.image, dest)
        .then((r) => { if (r === 'ok') { ok.push({ ...c, path: dest }); delete pending[c.id]; } else pending[c.id] = { id: c.id, reason: c.image ? 'image 404' : 'no image on TCGDex', since: pending[c.id]?.since || today() }; })
        .catch((e) => { pending[c.id] = { id: c.id, reason: e.message, since: pending[c.id]?.since || today() }; })
        .finally(() => { active--; next(); });
    }
  };
  next();
});
console.log(`downloaded ${ok.length}, reused ${reused.length}, pending ${Object.keys(pending).length}`);
if (!ok.length && !reused.length) { console.log('nothing to embed; manifest unchanged'); process.exit(0); }

// Embed → shard → upload → manifest
const embedded = ok.length ? await embedImages(ok.map((c) => c.path), (d, t) => console.log(`  embedded ${d}/${t}`)) : new Float32Array(0);
const all = [...ok, ...reused.map((r) => r.card)];
const matrix = new Float32Array(all.length * DIM);
matrix.set(embedded, 0);
reused.forEach((r, i) => matrix.set(r.vector, (ok.length + i) * DIM));
const ids = all.map((c) => c.id);
const cards = Object.fromEntries(all.map((c) => [c.id, { name: c.name, set: c.set, number: c.localId }]));
const shardId = nextShardId(manifest);
const out = path.join(process.cwd(), 'scripts', 'card-db', 'out');
const w = writeShard(out, shardId, ids, cards, matrix);
await uploadFile(`shards/${shardId}.f16`, fs.readFileSync(w.f16Path), 'application/octet-stream');
await uploadFile(`shards/${shardId}.meta.json`, fs.readFileSync(w.metaPath), 'application/json');
const sets = { ...manifest.sets };
for (const c of all) sets[c.set] = (sets[c.set] || 0) + 1;
const next = {
  ...manifest,
  version: manifest.version + 1,
  count: manifest.count + all.length,       // retired ids still occupy rows; the client zeroes them
  generated: new Date().toISOString(),
  shards: [...manifest.shards, { id: shardId, count: w.count, bytes: w.bytes, sha256: w.sha256 }],
  sets,
  pending: Object.values(pending),
  retired: [...retired],
  nextShard: Number(shardId) + 1,
};
await uploadFile('manifest.json', JSON.stringify(next, null, 1), 'application/json');
console.log(`published v${next.version}: +${ok.length} embedded, +${reused.length} renamed in shard ${shardId}, ${next.count} rows, ${next.retired.length} retired, ${next.pending.length} pending`);
