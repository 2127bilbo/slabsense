/**
 * ============================================================================
 * APPLE IN-APP PURCHASES — api/apple.js
 * ============================================================================
 *   POST /api/apple?action=verify         { signedTransaction }        (bearer user)
 *   POST /api/apple?action=restore        { signedTransactions: [] }   (bearer user)
 *   POST /api/apple?action=notifications  { signedPayload }            (App Store Server Notifications V2)
 *
 * Every signed payload is verified against Apple's root certificates with the
 * official @apple/app-store-server-library before anything touches the ledger
 * (api/_lib/appleLedger.js). Identity for verify/restore is the bearer token,
 * cross-checked against the appAccountToken the client set at purchase.
 *
 * Env: APPLE_BUNDLE_ID (default com.slabsense.app), APPLE_APP_APPLE_ID (numeric,
 * from App Store Connect), APPLE_ENVIRONMENT ('Production' | 'Sandbox').
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceDb } from './_lib/route.js';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { requireUser, sendAuthError } from './_lib/auth.js';
import { applyToDb, resolveUser } from './_lib/appleLedger.js';
import { APPLE_BUNDLE_ID } from '../src/lib/products.js';

export const config = { maxDuration: 30 };

const here = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let verifierCache = null;
export function verifier(env = process.env) {
  if (verifierCache) return verifierCache;
  const roots = ['AppleRootCA-G3.cer', 'AppleRootCA-G2.cer'].map((f) => fs.readFileSync(path.join(here, '_lib', 'apple-roots', f)));
  const environment = (env.APPLE_ENVIRONMENT || 'Production') === 'Sandbox' ? Environment.SANDBOX : Environment.PRODUCTION;
  const appAppleId = env.APPLE_APP_APPLE_ID ? Number(env.APPLE_APP_APPLE_ID) : undefined;
  verifierCache = new SignedDataVerifier(roots, true, environment, env.APPLE_BUNDLE_ID || APPLE_BUNDLE_ID, appAppleId);
  return verifierCache;
}

async function verifyTransactionForUser(db, v, signedTransaction, userId) {
  const tx = await v.verifyAndDecodeTransaction(signedTransaction);
  if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== userId) {
    const err = new Error('transaction belongs to another account'); err.status = 403; throw err;
  }
  return applyToDb(db, { tx, note: {}, userId });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server_not_configured' });
  const db = serviceDb();
  const action = req.query?.action || req.body?.action;
  let v;
  try { v = verifier(); } catch (e) { console.error('[apple] verifier', e.message); return res.status(500).json({ error: 'verifier_not_configured' }); }

  try {
    if (action === 'notifications') {
      // Apple retries on non-2xx; answer 200 only once the ledger is updated or the event is ignorable.
      const decoded = await v.verifyAndDecodeNotification(req.body?.signedPayload);
      const data = decoded.data || {};
      const note = { notificationType: decoded.notificationType, subtype: decoded.subtype };
      if (!data.signedTransactionInfo) { console.log('[apple] notification without transaction', note); return res.status(200).json({ ok: true, ignored: true }); }
      const tx = await v.verifyAndDecodeTransaction(data.signedTransactionInfo);
      const userId = await resolveUser(db, tx);
      const out = await applyToDb(db, { tx, note, userId });
      console.log('[apple] notification', note, tx.transactionId, out.reason, userId ? '' : '(no user yet)');
      return res.status(200).json({ ok: true, applied: out.applied, reason: out.reason });
    }
    let user;
    try { user = await requireUser({ db }, req); } catch (e) { return sendAuthError(res, e); }
    if (action === 'verify') {
      if (!req.body?.signedTransaction) return res.status(400).json({ error: 'signedTransaction_required' });
      const out = await verifyTransactionForUser(db, v, req.body.signedTransaction, user.id);
      return res.status(200).json({ ok: true, reason: out.reason, results: out.results });
    }
    if (action === 'restore') {
      const list = Array.isArray(req.body?.signedTransactions) ? req.body.signedTransactions.slice(0, 200) : [];
      const results = [];
      for (const s of list) { try { results.push(await verifyTransactionForUser(db, v, s, user.id)); } catch (e) { results.push({ error: e.message }); } }
      return res.status(200).json({ ok: true, count: results.length, results: results.map((r) => r.reason || r.error) });
    }
    return res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    const status = e.status || 400;
    console.error('[apple]', action, e?.message || e);
    return res.status(status).json({ error: 'apple_verification_failed', message: String(e?.message || e) });
  }
}
