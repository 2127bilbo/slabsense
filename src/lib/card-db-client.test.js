/**
 * Shard client test. Serves scripts/card-db/out/ (produced by `npm run cards:build-initial -- --dry-run`)
 * over a local HTTP server and checks loading + search. Skips with a message when that folder is absent.
 * Run: node src/lib/card-db-client.test.js
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCardDb, topK } from './card-db-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', '..', 'scripts', 'card-db', 'out');
let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

if (!fs.existsSync(path.join(OUT, 'manifest.json'))) {
  console.log('  (skipped: scripts/card-db/out/manifest.json not found; run `npm run cards:build-initial -- --dry-run`)');
  process.exit(0);
}

const srv = http.createServer((req, res) => {
  const f = path.join(OUT, req.url.replace(/^\//, '').replace(/^shards\//, ''));
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': f.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${srv.address().port}`;

console.log('— loadCardDb over HTTP');
let progress = 0;
const db = await loadCardDb({ baseUrl, onProgress: () => progress++ });
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
check('count matches manifest', db.ids.length === manifest.count && db.matrix.length === manifest.count * db.meta.dim);
check('progress called once per shard', progress === manifest.shards.length, `got ${progress}`);
check('no Pocket ids present', !db.ids.some((id) => /^[AB]\d/.test(id) || /^P-A-/.test(id)));
check('cards carry names', db.ids.slice(0, 50).every((id) => db.cards[id] && typeof db.cards[id].set === 'string'));
let n = 0; for (let i = 0; i < db.meta.dim; i++) n += db.matrix[i] * db.matrix[i];
check('rows are unit length', Math.abs(Math.sqrt(n) - 1) < 2e-3, `norm=${Math.sqrt(n)}`);

console.log('— topK');
for (const id of ['base1-4', 'sv02-001']) {
  const r = db.ids.indexOf(id);
  check(`${id} present`, r >= 0);
  if (r < 0) continue;
  const q = db.matrix.subarray(r * db.meta.dim, (r + 1) * db.meta.dim);
  const hits = topK(db, q, 5);
  check(`${id} is its own top-1 (${hits[0].s.toFixed(3)})`, hits[0].id === id && hits.length === 5);
  check(`${id} results sorted descending`, hits.every((h, i) => i === 0 || hits[i - 1].s >= h.s));
}

srv.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
