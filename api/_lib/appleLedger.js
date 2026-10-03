/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * ============================================================================
 * APPLE PURCHASES → CREDIT LEDGER — appleLedger.js
 * ============================================================================
 * The decision logic between Apple's decoded transactions / notifications and
 * our ledger, kept pure so it is unit-tested with fixtures. `applyToDb` performs
 * the resulting operations with the service-role client; every grant is
 * idempotent on `apple:<transactionId>` (migration 20261002_apple_iap.sql), so
 * Apple's at-least-once delivery and a client retrying `verify` are harmless.
 *
 * Inputs are the library's decoded payloads (`@apple/app-store-server-library`):
 *   transaction: { transactionId, originalTransactionId, productId, type,
 *                  purchaseDate, expiresDate, revocationDate, environment,
 *                  quantity, appAccountToken }
 *   notification: { notificationType, subtype }
 *
 * See docs/superpowers/plans/2026-10-02-3b-payments.md for the event table.
 * ============================================================================
 */
import { productByAppleId, productKeyByAppleId } from '../../src/lib/products.js';

export const SUBSCRIPTION_TYPE = 'Auto-Renewable Subscription';
export const CONSUMABLE_TYPE = 'Consumable';

/** Notification types that mean "a period was paid for" and carry a new transaction. */
const GRANTING = new Set(['SUBSCRIBED', 'DID_RENEW', 'OFFER_REDEEMED', 'ONE_TIME_CHARGE']);
/** Types that end access now. */
const ENDING = new Set(['EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REVOKE']);

export const externalId = (transactionId) => `apple:${transactionId}`;

/**
 * Decide what the ledger should do for one decoded transaction.
 * @param {object} tx decoded transaction
 * @param {{notificationType?:string, subtype?:string}} [note] the notification it arrived in (none for a client verify)
 * @returns {{ops: object[], status: object|null, reason: string}}
 */
export function decide(tx, note = {}) {
  const product = productByAppleId(tx.productId);
  const key = productKeyByAppleId(tx.productId);
  const ops = [];
  if (!product) return { ops, status: null, reason: `unknown product ${tx.productId}` };
  const type = note.notificationType || null;
  const sub = note.subtype || null;
  const refunded = type === 'REFUND' || (tx.revocationDate != null && tx.revocationDate > 0);

  if (product.kind === 'consumable') {
    if (refunded) {
      ops.push({ op: 'revoke', externalId: externalId(tx.transactionId), reason: `apple ${type || 'revocation'}` });
      return { ops, status: null, reason: 'consumable refunded' };
    }
    // a verify from the client (no notification) or ONE_TIME_CHARGE: grant once
    ops.push({ op: 'grant', bucket: 'pack', amount: product.credits * (tx.quantity || 1), externalId: externalId(tx.transactionId), description: `${product.name} (App Store)` });
    return { ops, status: null, reason: 'consumable purchase' };
  }

  // subscription
  if (refunded) {
    ops.push({ op: 'revoke', externalId: externalId(tx.transactionId), reason: `apple ${type || 'revocation'}` });
    return { ops, status: { subscription_status: 'free', subscription_source: 'apple', subscription_renews_at: null }, reason: 'subscription refunded' };
  }
  if (type && ENDING.has(type)) {
    return { ops, status: { subscription_status: 'expired', subscription_source: 'apple', subscription_renews_at: null }, reason: `subscription ${type}` };
  }
  if (type === 'DID_FAIL_TO_RENEW') {
    // GRACE_PERIOD keeps access until Apple says GRACE_PERIOD_EXPIRED; otherwise billing retry, access as Apple grants it
    return { ops, status: { subscription_status: sub === 'GRACE_PERIOD' ? 'grace' : 'billing_retry', subscription_source: 'apple' }, reason: `subscription ${type}/${sub || ''}` };
  }
  if (type === 'DID_CHANGE_RENEWAL_STATUS' || type === 'DID_CHANGE_RENEWAL_PREF' || type === 'RENEWAL_EXTENDED') {
    return { ops, status: { subscription_source: 'apple', ...(tx.expiresDate ? { subscription_renews_at: new Date(tx.expiresDate).toISOString() } : {}) }, reason: `subscription ${type}` };
  }
  // A client-sent (verify/restore) transaction whose period is over changes nothing: an old trial or
  // lapsed plan must not bring back access (review finding #1). Notifications carry their own meaning.
  if (!type && tx.expiresDate && tx.expiresDate < Date.now()) return { ops, status: null, reason: 'expired transaction (no change)' };
  if (!type || GRANTING.has(type)) {
    const expiresAt = tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
    // Introductory free trial (offerType 1 = introductory offer, no charge): the trial allowance only.
    const isTrial = !!product.trial && (tx.offerDiscountType === 'FREE_TRIAL' || (tx.offerType === 1 && !(tx.price > 0)));
    const amount = isTrial ? product.trial.grades : product.allowance;
    ops.push({ op: 'grant', bucket: 'sub', amount, externalId: externalId(tx.transactionId), description: isTrial ? `${product.name} trial (App Store)` : `${product.name} ${product.period} (App Store)`, expiresAt });
    return { ops, status: { subscription_status: isTrial ? 'trialing' : key, ...(isTrial ? { used_trial: true } : {}), subscription_source: 'apple', subscription_renews_at: expiresAt, apple_original_transaction_id: tx.originalTransactionId }, reason: isTrial ? 'trial started' : `subscription ${type || 'verify'}` };
  }
  return { ops, status: null, reason: `ignored ${type}/${sub || ''}` };
}

/** Resolve the user for a transaction: the appAccountToken we set at purchase, else a known original transaction. */
export async function resolveUser(db, tx) {
  if (tx.appAccountToken && /^[0-9a-f-]{36}$/i.test(tx.appAccountToken)) return tx.appAccountToken.toLowerCase();
  const { data } = await db.from('apple_transactions').select('user_id').eq('original_transaction_id', tx.originalTransactionId).not('user_id', 'is', null).limit(1).maybeSingle();
  if (data?.user_id) return data.user_id;
  const { data: p } = await db.from('profiles').select('id').eq('apple_original_transaction_id', tx.originalTransactionId).maybeSingle();
  return p?.id || null;
}

/** Record the transaction, run the ledger ops, update the profile's subscription fields. */
export async function applyToDb(db, { tx, note = {}, userId }) {
  const d = decide(tx, note);
  const row = {
    transaction_id: String(tx.transactionId), original_transaction_id: String(tx.originalTransactionId), user_id: userId,
    product_id: tx.productId, type: tx.type, environment: tx.environment || null, quantity: tx.quantity || 1,
    purchased_at: tx.purchaseDate ? new Date(tx.purchaseDate).toISOString() : null,
    expires_at: tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null,
    revoked_at: tx.revocationDate ? new Date(tx.revocationDate).toISOString() : null,
    last_notification: [note.notificationType, note.subtype].filter(Boolean).join('/') || 'verify',
    raw: tx, updated_at: new Date().toISOString(),
  };
  const { error: upErr } = await db.from('apple_transactions').upsert(row, { onConflict: 'transaction_id' });
  if (upErr) throw new Error(`apple_transactions: ${upErr.message}`);
  const results = [];
  if (!userId) return { ...d, results, applied: false, reason: d.reason + ' (no user)' };
  for (const op of d.ops) {
    if (op.op === 'grant') {
      const { data, error } = await db.rpc('grant_credits', { p_user_id: userId, p_amount: op.amount, p_bucket: op.bucket, p_external_id: op.externalId, p_description: op.description, p_expires_at: op.expiresAt || null });
      if (error) throw new Error(`grant_credits: ${error.message}`);
      results.push({ ...op, result: data });
    } else if (op.op === 'revoke') {
      const { data, error } = await db.rpc('revoke_credits', { p_user_id: userId, p_external_id: op.externalId, p_reason: op.reason });
      if (error) throw new Error(`revoke_credits: ${error.message}`);
      results.push({ ...op, result: data });
    }
  }
  if (d.status) {
    const { error } = await db.from('profiles').update(d.status).eq('id', userId);
    if (error) throw new Error(`profiles: ${error.message}`);
  }
  return { ...d, results, applied: true };
}
