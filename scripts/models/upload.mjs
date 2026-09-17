#!/usr/bin/env node
/**
 * Uploads the exported corner/edge models and the onnxruntime-web files they
 * need to the public `models` bucket, so the app can fetch them at runtime
 * instead of shipping 130 MB in the deploy.
 *
 *   node scripts/models/upload.mjs [--dry-run] [--bucket models] [--only models|ort]
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or
 * .env.local. Secrets are never printed.
 */
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

// Read .env.local without printing anything from it.
for (const line of fs.existsSync(path.join(ROOT, '.env.local')) ? fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (env or .env.local)'); process.exit(1); }

/** published path -> local file. The fp16 copies are what the app runs. */
const MODEL_FILES = {
  'corners-v2.fp16.onnx': path.join(ONNX, 'corners-v2.fp16.onnx'),
  'edges-v1.fp16.onnx': path.join(ONNX, 'edges-v1.fp16.onnx'),
  'corners-v2.json': path.join(ONNX, 'corners-v2.json'),
  'edges-v1.json': path.join(ONNX, 'edges-v1.json'),
};
// Only the two builds the app asks for: the JSEP build backs WebGPU, the plain
// one backs WASM-only devices. Each needs its loader beside it.
const ORT_FILES = {
  'ort/ort.min.mjs': path.join(ORT, 'ort.min.mjs'),
  'ort/ort-wasm-simd-threaded.jsep.wasm': path.join(ORT, 'ort-wasm-simd-threaded.jsep.wasm'),
  'ort/ort-wasm-simd-threaded.jsep.mjs': path.join(ORT, 'ort-wasm-simd-threaded.jsep.mjs'),
  'ort/ort-wasm-simd-threaded.wasm': path.join(ORT, 'ort-wasm-simd-threaded.wasm'),
  'ort/ort-wasm-simd-threaded.mjs': path.join(ORT, 'ort-wasm-simd-threaded.mjs'),
};
const CONTENT_TYPE = { '.onnx': 'application/octet-stream', '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.json': 'application/json' };

const plan = { ...(ONLY === 'ort' ? {} : MODEL_FILES), ...(ONLY === 'models' ? {} : ORT_FILES) };
const missing = Object.entries(plan).filter(([, f]) => !fs.existsSync(f));
if (missing.length) { console.error('missing locally:\n  ' + missing.map(([k]) => k).join('\n  ')); process.exit(1); }

const total = Object.values(plan).reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`bucket ${BUCKET}: ${Object.keys(plan).length} files, ${(total / 1048576).toFixed(1)} MB${DRY ? ' (dry run)' : ''}`);
for (const [dest, file] of Object.entries(plan)) console.log(`  ${dest.padEnd(42)} ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
if (DRY) process.exit(0);

const supabase = createClient(URL_, KEY, { auth: { persistSession: false } });
const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
if (listErr) { console.error('listBuckets failed:', listErr.message); process.exit(1); }
if (!buckets.some((b) => b.name === BUCKET)) {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error) { console.error('createBucket failed:', error.message); process.exit(1); }
  console.log(`created public bucket ${BUCKET}`);
}

let failed = 0;
for (const [dest, file] of Object.entries(plan)) {
  const body = fs.readFileSync(file);
  const { error } = await supabase.storage.from(BUCKET).upload(dest, body, {
    upsert: true,
    contentType: CONTENT_TYPE[path.extname(dest)] || 'application/octet-stream',
    cacheControl: '31536000', // immutable: a new model gets a new filename
  });
  if (error) { failed++; console.error(`  x ${dest}: ${error.message}`); }
  else console.log(`  uploaded ${dest}`);
}
console.log(failed ? `${failed} upload(s) failed` : `done — public base ${URL_}/storage/v1/object/public/${BUCKET}`);
process.exit(failed ? 1 : 0);
