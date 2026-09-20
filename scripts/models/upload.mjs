#!/usr/bin/env node
/**
 * Uploads the exported corner/edge models and the onnxruntime-web files they
 * need to the public `models` bucket, so the app can fetch them at runtime
 * instead of shipping 130 MB in the deploy.
 *
 *   node scripts/models/upload.mjs [--dry-run] [--bucket models] [--only models|ort]
 *
 * Supabase caps a single object at 50 MB on this project, and the fp16 models
 * are 53.6 MB, so anything over the cap is uploaded in parts and listed in
 * `models.json`; the browser fetches the parts and concatenates them
 * (src/services/cornerEdgeModels.js). Parts are immutable — a new model gets a
 * new filename — which also makes them safe to cache forever.
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or
 * .env.local. Secrets are never printed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const ONNX = path.join(ROOT, 'training', 'weights', 'onnx');
const ORT = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const BUCKET = opt('--bucket', 'models');
const ONLY = opt('--only', null);
const PART_SIZE = Number(opt('--part-size', 45 * 1024 * 1024)); // under the 50 MB object cap

// Read .env.local without printing anything from it.
for (const line of fs.existsSync(path.join(ROOT, '.env.local')) ? fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (env or .env.local)'); process.exit(1); }

/** The models the app runs, by task. The fp16 copies are the ones to ship. */
const MODELS = {
  corners: { file: 'corners-v3-phone-safe.fp16.onnx', contract: 'corners-v3-phone-safe.json' },
  edges: { file: 'edges-v2-phone-safe.fp16.onnx', contract: 'edges-v2-phone-safe.json' },
};
// Only the two runtime builds the app asks for: the JSEP build backs WebGPU, the
// plain one backs WASM-only devices. Each needs its loader beside it.
const ORT_FILES = [
  'ort.min.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
];
const CONTENT_TYPE = { '.onnx': 'application/octet-stream', '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.json': 'application/json' };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

// ── plan ────────────────────────────────────────────────────────────────────
/** @type {{dest:string, body:Buffer, type:string}[]} */
const uploads = [];
const manifest = { generatedAt: new Date().toISOString(), partSize: PART_SIZE, models: {} };

if (ONLY !== 'ort') {
  for (const [task, m] of Object.entries(MODELS)) {
    const file = path.join(ONNX, m.file);
    const contract = path.join(ONNX, m.contract);
    if (!fs.existsSync(file)) { console.error(`missing ${file}`); process.exit(1); }
    const bytes = fs.readFileSync(file);
    const parts = [];
    for (let off = 0, i = 0; off < bytes.length; off += PART_SIZE, i++) {
      const slice = bytes.subarray(off, Math.min(off + PART_SIZE, bytes.length));
      const dest = bytes.length > PART_SIZE ? `${m.file}.part${i}` : m.file;
      uploads.push({ dest, body: slice, type: CONTENT_TYPE['.onnx'] });
      parts.push({ path: dest, bytes: slice.length });
    }
    manifest.models[task] = { file: m.file, bytes: bytes.length, sha256: sha256(bytes), parts };
    if (fs.existsSync(contract)) uploads.push({ dest: m.contract, body: fs.readFileSync(contract), type: CONTENT_TYPE['.json'] });
  }
  uploads.push({ dest: 'models.json', body: Buffer.from(JSON.stringify(manifest, null, 2)), type: CONTENT_TYPE['.json'] });
}
if (ONLY !== 'models') {
  for (const f of ORT_FILES) {
    const file = path.join(ORT, f);
    if (!fs.existsSync(file)) { console.error(`missing ${file}`); process.exit(1); }
    uploads.push({ dest: `ort/${f}`, body: fs.readFileSync(file), type: CONTENT_TYPE[path.extname(f)] || 'application/octet-stream' });
  }
}

const total = uploads.reduce((s, u) => s + u.body.length, 0);
console.log(`bucket ${BUCKET}: ${uploads.length} objects, ${mb(total)}${DRY ? ' (dry run)' : ''}`);
for (const u of uploads) console.log(`  ${u.dest.padEnd(42)} ${mb(u.body.length)}`);
if (DRY) process.exit(0);

// ── upload ──────────────────────────────────────────────────────────────────
const supabase = createClient(URL_, KEY, { auth: { persistSession: false } });
const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
if (listErr) { console.error('listBuckets failed:', listErr.message); process.exit(1); }
if (!buckets.some((b) => b.name === BUCKET)) {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error) { console.error('createBucket failed:', error.message); process.exit(1); }
  console.log(`created public bucket ${BUCKET}`);
}

let failed = 0;
for (const u of uploads) {
  const { error } = await supabase.storage.from(BUCKET).upload(u.dest, u.body, {
    upsert: true,
    contentType: u.type,
    cacheControl: '31536000', // immutable: a new model gets a new filename
  });
  if (error) { failed++; console.error(`  x ${u.dest}: ${error.message}`); }
  else console.log(`  uploaded ${u.dest} (${mb(u.body.length)})`);
}
console.log(failed ? `${failed} upload(s) failed` : `done — public base ${URL_}/storage/v1/object/public/${BUCKET}`);
process.exit(failed ? 1 : 0);
