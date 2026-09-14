#!/usr/bin/env node
/**
 * One-off: convert the bundled JSON embedding chunks into float16 shards and publish them
 * to the `card-db` bucket. Drops digital-only TCG Pocket entries. No re-embedding.
 *
 *   node scripts/card-db/build-initial.mjs --dry-run   # write scripts/card-db/out/ only
 *   node scripts/card-db/build-initial.mjs             # also upload (refuses if a manifest exists)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.mjs';
import { writeShard, DIM } from './shards.mjs';
import { uploadFile, fetchManifest, publicUrl } from './storage.mjs';
import { fetchSets, isPocketSetId } from './tcgdex.mjs';

loadEnv();
const DRY = process.argv.includes('--dry-run');
const OUT = path.join(process.cwd(), 'scripts', 'card-db', 'out');
const SHARD_SIZE = 4000;

const db = {};
let model = null;
for (let i = 0; i < 5; i++) {
  const j = JSON.parse(fs.readFileSync(`public/models/clip_embeddings_${i}.json`, 'utf8'));
  model = j.model;
  Object.assign(db, j.embeddings);
}
const info = {};
for (const c of JSON.parse(fs.readFileSync('public/card-hashes.json', 'utf8')).cards) info[c.id] = { name: c.name, set: c.set, number: c.number };

// TCG Pocket (digital-only) ids: A1/A2/B1... sets and the P-A promo set.
const isPocketId = (id) => /^[AB]\d/.test(id) || /^P-A-/.test(id);
const all = Object.keys(db);
const keep = all.filter((id) => !isPocketId(id)).sort();
console.log(`in ${all.length}, dropped ${all.length - keep.length} Pocket, out ${keep.length}`);

// The JSON chunks were stored un-normalized (norm ≈ 10). Shard rows are L2-normalized so
// the client can search with a plain dot product. Cosine similarity is unchanged.
const normalize = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };

const shards = [];
const sets = {};
for (let s = 0; s * SHARD_SIZE < keep.length; s++) {
  const ids = keep.slice(s * SHARD_SIZE, (s + 1) * SHARD_SIZE);
  const m = new Float32Array(ids.length * DIM);
  ids.forEach((id, r) => {
    const e = db[id];
    if (e.length !== DIM) throw new Error(`${id}: dim ${e.length}`);
    m.set(normalize(e), r * DIM);
  });
  const cards = {};
  for (const id of ids) {
    cards[id] = info[id] || { name: null, set: id.split('-')[0], number: id.split('-').slice(1).join('-') };
    sets[cards[id].set] = (sets[cards[id].set] || 0) + 1;
  }
  const shardId = String(s + 1).padStart(4, '0');
  const w = writeShard(OUT, shardId, ids, cards, m);
  shards.push({ id: shardId, count: w.count, bytes: w.bytes, sha256: w.sha256 });
  console.log(`shard ${shardId}: ${w.count} cards, ${(w.bytes / 1048576).toFixed(1)} MB`);
}
const manifest = {
  version: 3, model, dim: DIM, count: keep.length, generated: new Date().toISOString(),
  shards, sets, excludedSeries: ['tcgp'], pending: [],
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// Set diff vs TCGDex (report only; the update job fills the gaps)
const remote = await fetchSets();
const behind = remote
  .filter((s) => !isPocketSetId(s.id) && (sets[s.id] || 0) < s.total)
  .map((s) => `${s.id} ${s.name}: have ${sets[s.id] || 0}/${s.total}`);
console.log(`sets behind TCGDex: ${behind.length}`);
for (const l of behind) console.log('  ' + l);

if (DRY) { console.log('dry run: nothing uploaded'); process.exit(0); }

const existing = await fetchManifest();
if (existing) throw new Error(`bucket already has manifest version ${existing.version}; refusing to overwrite (use update.mjs)`);
for (const s of shards) {
  await uploadFile(`shards/${s.id}.f16`, fs.readFileSync(path.join(OUT, `${s.id}.f16`)), 'application/octet-stream');
  await uploadFile(`shards/${s.id}.meta.json`, fs.readFileSync(path.join(OUT, `${s.id}.meta.json`)), 'application/json');
  console.log('uploaded', s.id);
}
await uploadFile('manifest.json', JSON.stringify(manifest, null, 1), 'application/json');
console.log(`published manifest version ${manifest.version}, ${manifest.count} cards → ${publicUrl('manifest.json')}`);
