#!/usr/bin/env node
/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Live check of the card-images bucket rules (migration 20261003_free_grades.sql), run AFTER the
 * migration is applied. Signs in as a test account and tries the uploads the rules must allow and
 * refuse; removes whatever it managed to write.
 *
 *   TEST_EMAIL=... TEST_PASSWORD=... node scripts/storage/verify-card-images-rules.mjs
 * (or put TEST_EMAIL / TEST_PASSWORD in .env.local). Use the App Review demo account.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const file = (() => { try { return Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); } catch { return {}; } })();
const E = { ...file, ...process.env };
for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'TEST_EMAIL', 'TEST_PASSWORD']) if (!E[k]) { console.error(`${k} is required`); process.exit(2); }

const db = createClient(E.VITE_SUPABASE_URL, E.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error: authErr } = await db.auth.signInWithPassword({ email: E.TEST_EMAIL, password: E.TEST_PASSWORD });
if (authErr) { console.error('sign-in failed:', authErr.message); process.exit(2); }
const uid = auth.user.id;
const jpg = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
const written = [];
let failures = 0;

async function attempt(label, path, body, expectOk) {
  const { error } = await db.storage.from('card-images').upload(path, body, { upsert: true, contentType: body.type });
  const ok = !error;
  if (ok) written.push(path);
  const pass = ok === expectOk;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${ok ? 'allowed' : `refused (${error.message})`}`);
}

const { data: scan } = await db.from('scans').select('id').eq('user_id', uid).limit(1).maybeSingle();
await attempt('grade upload folder', `${uid}/deep-analysis/verify_${Date.now()}.jpg`, jpg, true);
if (scan) await attempt('own saved card folder', `${uid}/${scan.id}/verify_${Date.now()}.jpg`, jpg, true);
else console.log('SKIP  own saved card folder (account has no saved card)');
await attempt('folder of a card that does not exist', `${uid}/${randomUUID()}/verify.jpg`, jpg, false);
await attempt('loose file in own root', `${uid}/verify.jpg`, jpg, false);
await attempt("another user's folder", `${randomUUID()}/deep-analysis/verify.jpg`, jpg, false);
await attempt('non-image file', `${uid}/deep-analysis/verify.txt`, new Blob(['x'], { type: 'text/plain' }), false);

if (written.length) await db.storage.from('card-images').remove(written);
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
