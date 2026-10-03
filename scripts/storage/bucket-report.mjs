#!/usr/bin/env node
/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Read-only storage report: every bucket's settings, object count and total size, and the
 * biggest top-level folders. Uses the service role from .env.local; prints no secrets.
 *   node scripts/storage/bucket-report.mjs
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const db = createClient(env.VITE_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

async function walk(bucket, prefix, acc, depth) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const it of data) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) await walk(bucket, p, acc, depth + 1);
      else {
        const size = it.metadata?.size || 0;
        acc.count++; acc.bytes += size;
        const top = p.split('/')[0];
        acc.top[top] = (acc.top[top] || 0) + size;
        const ext = (p.split('.').pop() || '').toLowerCase();
        acc.ext[ext] = (acc.ext[ext] || 0) + size;
      }
    }
    if (data.length < 1000) break;
  }
}

const { data: buckets, error } = await db.storage.listBuckets();
if (error) throw error;
for (const b of buckets) {
  const acc = { count: 0, bytes: 0, top: {}, ext: {} };
  await walk(b.id, '', acc, 0);
  console.log(`\n${b.id}  public=${b.public}  file_size_limit=${b.file_size_limit ?? 'none'}  mime=${(b.allowed_mime_types || ['any']).join(',')}`);
  console.log(`  ${acc.count} objects, ${mb(acc.bytes)}`);
  const tops = Object.entries(acc.top).sort((a, c) => c[1] - a[1]).slice(0, 5).map(([k, v]) => `${k.length > 12 ? k.slice(0, 8) + '…' : k} ${mb(v)}`);
  if (tops.length) console.log(`  biggest top-level: ${tops.join(' · ')}`);
  console.log(`  by type: ${Object.entries(acc.ext).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${mb(v)}`).join(' · ')}`);
}
