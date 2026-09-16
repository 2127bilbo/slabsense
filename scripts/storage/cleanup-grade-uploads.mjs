/**
 * Delete temporary AI-grade uploads from the `card-images` bucket.
 *
 * Every AI / Deep grade uploads the photos to `<user>/standard-analysis/` or `<user>/deep-analysis/`
 * so the model can fetch them. They are only needed while the job runs and, for a while after, for
 * the "Load it" restore banner. This removes any such file older than --days (default 7) that no
 * ai_grade_jobs row from the last --days references. Saved-card images (`<user>/<scanId>/…`) are
 * never touched.
 *
 *   node scripts/storage/cleanup-grade-uploads.mjs [--days 7] [--dry-run]
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY. Falls back to .env.local.
 * Runs weekly from .github/workflows/card-db-update.yml.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const DAYS = Number(opt('--days', 7));
const DRY = args.includes('--dry-run');
const BUCKET = 'card-images';

function env() {
  const e = { ...process.env };
  if (!(e.SUPABASE_URL || e.VITE_SUPABASE_URL) || !e.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
        if (!line.includes('=') || line.startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!e[k]) e[k] = v;
      }
    } catch { /* no .env.local */ }
  }
  return e;
}

const E = env();
const url = E.SUPABASE_URL || E.VITE_SUPABASE_URL;
if (!url || !E.SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(2); }
const db = createClient(url, E.SUPABASE_SERVICE_ROLE_KEY);

async function walk(prefix, out) {
  let offset = 0;
  for (;;) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    if (!data || !data.length) break;
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null || e.metadata === null) await walk(path, out);        // folder
      else out.push({ path, size: e.metadata?.size || 0, at: new Date(e.created_at) });
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

const cutoff = Date.now() - DAYS * 86400e3;
const files = await walk('', []);
const uploads = files.filter((f) => /\/(standard|deep)-analysis\//.test(f.path));

// Keep anything a recent job still points at (restore banner)
const { data: jobs, error: jobsErr } = await db.from('ai_grade_jobs').select('request, created_at').gte('created_at', new Date(cutoff).toISOString());
if (jobsErr && !/does not exist|Could not find/i.test(jobsErr.message)) throw new Error(`jobs: ${jobsErr.message}`);
const referenced = new Set((jobs || []).flatMap((j) => Object.values(j.request || {}).filter((v) => typeof v === 'string')));
const isReferenced = (p) => { for (const u of referenced) if (u.includes(p)) return true; return false; };

const targets = uploads.filter((f) => f.at.getTime() < cutoff && !isReferenced(f.path));
const mb = (n) => (n / 1048576).toFixed(0);
console.log(`bucket ${BUCKET}: ${files.length} files, ${mb(files.reduce((a, f) => a + f.size, 0))} MB; grading uploads ${uploads.length} (${mb(uploads.reduce((a, f) => a + f.size, 0))} MB)`);
console.log(`older than ${DAYS} days and unreferenced: ${targets.length} files, ${mb(targets.reduce((a, f) => a + f.size, 0))} MB${DRY ? ' (dry run — nothing deleted)' : ''}`);

if (!DRY && targets.length) {
  let removed = 0;
  for (let i = 0; i < targets.length; i += 100) {
    const batch = targets.slice(i, i + 100).map((f) => f.path);
    const { data, error } = await db.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`remove: ${error.message}`);
    removed += (data || []).length;
  }
  console.log(`removed ${removed} files`);
}
