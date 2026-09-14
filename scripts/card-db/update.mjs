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
import { writeShard, nextShardId } from './shards.mjs';
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

const manifest = await fetchManifest();
if (!manifest) throw new Error('no manifest in bucket; run build-initial first');
const known = new Set();
for (const s of manifest.shards) {
  const meta = await (await fetch(publicUrl(`shards/${s.id}.meta.json`))).json();
  for (const id of meta.ids) known.add(id);
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
  for (const c of set.cards) if (!known.has(c.id) && (RETRY || !pendingById[c.id])) newCards.push({ ...c, set: set.id });
}
console.log(`new cards: ${newCards.length}${newCards.length > MAX ? ` (capped to ${MAX} this run)` : ''}`);
const batch = newCards.slice(0, MAX);
for (const [id, s] of Object.entries(setInfo)) { const n = batch.filter((c) => c.set === id).length; if (n) console.log(`  ${id} ${s.name}: +${n}`); }
if (DRY) { console.log('dry run: nothing downloaded or published'); process.exit(0); }
if (!batch.length) { console.log('nothing to do'); process.exit(0); }

// Download (4 at a time)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-db-'));
const ok = [];
const pending = { ...pendingById };
const queue = [...batch];
let active = 0;
await new Promise((resolve) => {
  const next = () => {
    if (!queue.length && !active) return resolve();
    while (active < 4 && queue.length) {
      const c = queue.shift();
      active++;
      const dest = SAVE ? path.join(process.cwd(), 'public', 'card-images', c.set, `${c.localId}.png`) : path.join(tmp, `${c.id}.png`);
      downloadImage(c.image, dest)
        .then((r) => { if (r === 'ok') { ok.push({ ...c, path: dest }); delete pending[c.id]; } else pending[c.id] = { id: c.id, reason: 'image 404', since: pending[c.id]?.since || today() }; })
        .catch((e) => { pending[c.id] = { id: c.id, reason: e.message, since: pending[c.id]?.since || today() }; })
        .finally(() => { active--; next(); });
    }
  };
  next();
});
console.log(`downloaded ${ok.length}, pending ${Object.keys(pending).length}`);
if (!ok.length) { console.log('nothing to embed; manifest unchanged'); process.exit(0); }

// Embed → shard → upload → manifest
const matrix = await embedImages(ok.map((c) => c.path), (d, t) => console.log(`  embedded ${d}/${t}`));
const ids = ok.map((c) => c.id);
const cards = Object.fromEntries(ok.map((c) => [c.id, { name: c.name, set: c.set, number: c.localId }]));
const shardId = nextShardId(manifest);
const out = path.join(process.cwd(), 'scripts', 'card-db', 'out');
const w = writeShard(out, shardId, ids, cards, matrix);
await uploadFile(`shards/${shardId}.f16`, fs.readFileSync(w.f16Path), 'application/octet-stream');
await uploadFile(`shards/${shardId}.meta.json`, fs.readFileSync(w.metaPath), 'application/json');
const sets = { ...manifest.sets };
for (const c of ok) sets[c.set] = (sets[c.set] || 0) + 1;
const next = {
  ...manifest,
  version: manifest.version + 1,
  count: manifest.count + ok.length,
  generated: new Date().toISOString(),
  shards: [...manifest.shards, { id: shardId, count: w.count, bytes: w.bytes, sha256: w.sha256 }],
  sets,
  pending: Object.values(pending),
};
await uploadFile('manifest.json', JSON.stringify(next, null, 1), 'application/json');
console.log(`published v${next.version}: +${ok.length} cards in shard ${shardId}, ${next.count} total, ${next.pending.length} pending`);
