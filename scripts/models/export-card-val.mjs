#!/usr/bin/env node
/**
 * Pulls every "keep originals for training" capture out of the card-images
 * bucket into training/data/card-val/<scanId>/{front.jpg, back.jpg, labels.json},
 * the real-photo validation set for the card model
 * (training/HANDOFF-card-and-centering.md, Step 10.3).
 *
 *   node scripts/models/export-card-val.mjs [--out training/data/card-val] [--user <id>]
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or
 * .env.local. Secrets are never printed. Re-running only downloads new scans.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('--out', 'training/data/card-val'));
const ONLY_USER = opt('--user', null);
const BUCKET = 'card-images';
const FOLDER = 'training';

for (const line of fs.existsSync(path.join(ROOT, '.env.local')) ? fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (env or .env.local)'); process.exit(1); }
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

async function list(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const users = (await list('')).filter((e) => e.id === null).map((e) => e.name).filter((u) => !ONLY_USER || u === ONLY_USER);
let scans = 0, files = 0, skipped = 0;
for (const user of users) {
  for (const scan of (await list(user)).filter((e) => e.id === null)) {
    const entries = await list(`${user}/${scan.name}/${FOLDER}`);
    if (!entries.some((e) => e.name === 'labels.json')) continue;
    const dest = path.join(OUT, scan.name);
    if (fs.existsSync(path.join(dest, 'labels.json'))) { skipped++; continue; }
    fs.mkdirSync(dest, { recursive: true });
    for (const e of entries) {
      const { data, error } = await db.storage.from(BUCKET).download(`${user}/${scan.name}/${FOLDER}/${e.name}`);
      if (error) { console.warn(`  ${scan.name}/${e.name}: ${error.message}`); continue; }
      fs.writeFileSync(path.join(dest, e.name), Buffer.from(await data.arrayBuffer()));
      files++;
    }
    scans++;
  }
}
const total = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((d) => fs.existsSync(path.join(OUT, d, 'labels.json'))).length : 0;
console.log(`downloaded ${scans} new scans (${files} files), ${skipped} already present; ${total} labelled scans in ${path.relative(ROOT, OUT)}`);
