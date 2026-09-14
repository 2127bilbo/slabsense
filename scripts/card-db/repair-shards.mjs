#!/usr/bin/env node
/**
 * One-off repair (2026-09-14): shards 0006 and 0007 were published with un-normalized rows
 * (norm ≈ 9) and dominated every search. Shards are append-only, so instead of rewriting them
 * this script normalizes their rows into a NEW shard, publishes a manifest that references the
 * new shard instead of the broken ones, and removes the broken files.
 *
 *   node scripts/card-db/repair-shards.mjs 0006 0007
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.mjs';
import { decodeF16 } from '../../src/lib/f16.js';
import { fetchManifest, uploadFile, publicUrl, getClient, BUCKET } from './storage.mjs';
import { writeShard, nextShardId, DIM } from './shards.mjs';

loadEnv();
const bad = process.argv.slice(2);
if (!bad.length) throw new Error('usage: repair-shards.mjs <shardId> [<shardId> ...]');

const manifest = await fetchManifest();
const ids = [], cards = {}; let rows = [];
for (const id of bad) {
  if (!manifest.shards.some((s) => s.id === id)) throw new Error(`shard ${id} not in manifest`);
  const f = decodeF16(await (await fetch(publicUrl(`shards/${id}.f16`))).arrayBuffer());
  const meta = await (await fetch(publicUrl(`shards/${id}.meta.json`))).json();
  for (let r = 0; r < meta.count; r++) {
    let n = 0; for (let i = 0; i < DIM; i++) n += f[r * DIM + i] ** 2; n = Math.sqrt(n) || 1;
    rows.push(Float32Array.from(f.subarray(r * DIM, (r + 1) * DIM), (v) => v / n));
  }
  ids.push(...meta.ids); Object.assign(cards, meta.cards);
  console.log(`read ${id}: ${meta.count} rows`);
}
const matrix = new Float32Array(ids.length * DIM); rows.forEach((v, r) => matrix.set(v, r * DIM));
const shardId = nextShardId(manifest);
const out = path.join(process.cwd(), 'scripts', 'card-db', 'out');
const w = writeShard(out, shardId, ids, cards, matrix);
await uploadFile(`shards/${shardId}.f16`, fs.readFileSync(w.f16Path), 'application/octet-stream');
await uploadFile(`shards/${shardId}.meta.json`, fs.readFileSync(w.metaPath), 'application/json');
const next = {
  ...manifest,
  version: manifest.version + 1,
  generated: new Date().toISOString(),
  shards: [...manifest.shards.filter((s) => !bad.includes(s.id)), { id: shardId, count: w.count, bytes: w.bytes, sha256: w.sha256 }],
};
next.count = next.shards.reduce((s, x) => s + x.count, 0);
await uploadFile('manifest.json', JSON.stringify(next, null, 1), 'application/json');
console.log(`published v${next.version}: shard ${shardId} (${w.count} rows) replaces ${bad.join(', ')}; ${next.count} cards`);
const { error } = await getClient().storage.from(BUCKET).remove(bad.flatMap((id) => [`shards/${id}.f16`, `shards/${id}.meta.json`]));
console.log(error ? `cleanup warning: ${error.message}` : `removed ${bad.join(', ')} from the bucket`);
