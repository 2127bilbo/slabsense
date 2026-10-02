/**
 * ============================================================================
 * ACCOUNT LIFECYCLE — api/account.js
 * ============================================================================
 * Server-side account deletion, per-scan file purge and data export, with the
 * service role. Before this route, "Delete Account" ran in the browser under
 * row-level security and only removed scan rows (audit A-04 / F-01 / L-01):
 * the profile, the auth user, every stored image, credits, jobs and the Stripe
 * customer all survived and the user could sign straight back in.
 *
 *   POST /api/account   { action: 'delete' }                 — delete everything, then the auth user
 *   POST /api/account   { action: 'purge-scan', scanId }     — remove a scan's stored images
 *   POST /api/account   { action: 'export' }                 — JSON of the user's data
 *
 * Identity always comes from the bearer token. Apple 5.1.1(v): in-app deletion
 * must be complete, not a request.
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { requireUser, sendAuthError } from './_lib/auth.js';

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IMAGE_BUCKET = 'card-images';

function db() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }); }

/** Every object under a prefix in a bucket, recursing into folders. */
export async function listAllObjects(storage, bucket, prefix) {
  const out = [];
  const walk = async (dir) => {
    let offset = 0;
    for (;;) {
      const { data, error } = await storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error) throw new Error(`list ${bucket}/${dir}: ${error.message}`);
      if (!data || !data.length) break;
      for (const entry of data) {
        const p = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.id === null && !entry.metadata) await walk(p); // folder placeholder
        else out.push(p);
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  };
  await walk(prefix);
  return out;
}

async function removeObjects(storage, bucket, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`remove ${bucket}: ${error.message}`);
  }
  return paths.length;
}

/** Cancel the Stripe subscription, if any; never block deletion on Stripe. */
async function cancelStripe(profile) {
  if (!process.env.STRIPE_SECRET_KEY) return { skipped: 'no stripe key' };
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const out = {};
  try { if (profile?.subscription_id) { await stripe.subscriptions.cancel(profile.subscription_id); out.subscriptionCancelled = true; } } catch (e) { out.subscriptionError = e.message; }
  try { if (profile?.stripe_customer_id) { await stripe.customers.del(profile.stripe_customer_id); out.customerDeleted = true; } } catch (e) { out.customerError = e.message; }
  return out;
}

/**
 * Delete a user completely. Order matters: files, then rows that reference the profile,
 * then the profile, then the auth user (which would cascade anyway, but explicit is
 * auditable). Slab orders are kept for the physical cert record with the user detached and the
 * shipping address purged (migration 20261002_account_deletion.sql).
 */
export async function deleteUserCompletely(client, userId) {
  const report = { userId, files: 0 };
  const { data: profile } = await client.from('profiles').select('stripe_customer_id, subscription_id').eq('id', userId).maybeSingle();
  report.stripe = await cancelStripe(profile);
  const paths = await listAllObjects(client.storage, IMAGE_BUCKET, userId);
  report.files = await removeObjects(client.storage, IMAGE_BUCKET, paths);
  // slabs: keep the cert, detach the person, drop the address
  const { data: slabs } = await client.from('slabs').update({ user_id: null, scan_id: null, shipping: null }).eq('user_id', userId).select('id');
  report.slabsDetached = slabs?.length || 0;
  for (const table of ['ai_grade_jobs', 'credit_transactions', 'card_identifications', 'scans']) {
    const { error, count } = await client.from(table).delete({ count: 'exact' }).eq('user_id', userId);
    if (error && !/does not exist/.test(error.message)) throw new Error(`${table}: ${error.message}`);
    report[table] = count ?? 0;
  }
  const { error: pErr } = await client.from('profiles').delete().eq('id', userId);
  if (pErr) throw new Error(`profiles: ${pErr.message}`);
  const { error: aErr } = await client.auth.admin.deleteUser(userId);
  if (aErr) throw new Error(`auth user: ${aErr.message}`);
  report.authUserDeleted = true;
  return report;
}

export async function purgeScanFiles(client, userId, scanId) {
  const { data: scan } = await client.from('scans').select('id').eq('id', scanId).eq('user_id', userId).maybeSingle();
  // the scan row may already be gone (client deletes it first); the path is ours either way
  const paths = await listAllObjects(client.storage, IMAGE_BUCKET, `${userId}/${scanId}`);
  return { scanId, existed: Boolean(scan), files: await removeObjects(client.storage, IMAGE_BUCKET, paths) };
}

export async function exportUserData(client, userId) {
  const pick = async (table, cols = '*') => { const { data, error } = await client.from(table).select(cols).eq('user_id', userId); return error ? [] : data; };
  const { data: profile } = await client.from('profiles').select('id, display_name, username, preferred_company, created_at, credits_balance, credits_expire_at, subscription_status').eq('id', userId).maybeSingle();
  const files = await listAllObjects(client.storage, IMAGE_BUCKET, userId);
  const signed = [];
  for (let i = 0; i < files.length; i += 100) {
    const { data } = await client.storage.from(IMAGE_BUCKET).createSignedUrls(files.slice(i, i + 100), 3600);
    for (const s of data || []) if (s.signedUrl) signed.push({ path: s.path, url: s.signedUrl });
  }
  return {
    exportedAt: new Date().toISOString(),
    profile,
    scans: await pick('scans'),
    creditTransactions: await pick('credit_transactions'),
    gradeJobs: await pick('ai_grade_jobs', 'id, kind, status, created_at, finished_at'),
    slabs: await pick('slabs', 'cert, status, paid_at, engraved_at, shipped_at'),
    images: signed,
    note: 'Image links are valid for one hour.',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server_not_configured' });
  const client = db();
  let user;
  try { user = await requireUser({ db: client }, req); } catch (e) { return sendAuthError(res, e); }
  const action = req.body?.action;
  try {
    if (action === 'delete') {
      if (req.body?.confirm !== 'DELETE') return res.status(400).json({ error: 'confirm_required' });
      const report = await deleteUserCompletely(client, user.id);
      console.log('[account] deleted', JSON.stringify(report));
      return res.status(200).json({ ok: true, report });
    }
    if (action === 'purge-scan') {
      const scanId = String(req.body?.scanId || '');
      if (!/^[0-9a-f-]{36}$/i.test(scanId)) return res.status(400).json({ error: 'scan_id_required' });
      return res.status(200).json({ ok: true, ...(await purgeScanFiles(client, user.id, scanId)) });
    }
    if (action === 'export') {
      res.setHeader('Content-Disposition', 'attachment; filename="slabsense-export.json"');
      return res.status(200).json(await exportUserData(client, user.id));
    }
    return res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    console.error('[account]', action, e?.message || e);
    return res.status(500).json({ error: 'account_action_failed', message: String(e?.message || e) });
  }
}
