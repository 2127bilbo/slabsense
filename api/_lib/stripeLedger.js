/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * ============================================================================
 * STRIPE (WEB) PURCHASES → CREDIT LEDGER — stripeLedger.js
 * ============================================================================
 * The web catalogue is the same three products as the iOS app (src/lib/products.js):
 * one monthly allowance and two packs. Decisions are pure so they are unit-tested
 * with Stripe-shaped fixtures; `applyToDb` runs the resulting operations with the
 * service role through the same idempotent ledger functions the Apple route uses
 * (grant_credits / revoke_credits, migration 20261002_apple_iap.sql).
 *
 * Event table:
 *   checkout.session.completed (mode payment, paid)  → grant pack credits once per session
 *   checkout.session.completed (mode subscription)   → link customer + subscription id only
 *   invoice.paid (any billing reason)                → grant the period allowance once per invoice,
 *                                                      status = plan, renews_at = period end
 *   invoice.payment_failed                           → status past_due
 *   customer.subscription.updated                    → status from Stripe's status / cancel flag
 *   customer.subscription.deleted                    → status expired
 *   charge.refunded                                  → revoke what is left of that purchase
 *
 * Stripe API 2025-03-31 ("basil") moved `invoice.subscription`; see invoiceSubscriptionId.
 * ============================================================================
 */
import { PRODUCTS } from '../../src/lib/products.js';

/** Price ids from the environment, keyed by product key (plus the physical slab). */
export function priceMap(env = process.env) {
  const m = {};
  for (const [key, p] of Object.entries(PRODUCTS)) { const v = env[p.stripeEnv]; if (v) m[key] = v; }
  if (env.STRIPE_PRICE_SLAB) m.slab = env.STRIPE_PRICE_SLAB;
  return m;
}
export function productKeyForPrice(priceId, env = process.env) {
  const m = priceMap(env);
  return Object.keys(m).find((k) => m[k] === priceId) || null;
}
export const ext = {
  session: (id) => `stripe:cs:${id}`,
  invoice: (id) => `stripe:in:${id}`,
};

/** The subscription id on an invoice, across the API versions we have seen. */
export function invoiceSubscriptionId(invoice) {
  return invoice?.parent?.subscription_details?.subscription
    || invoice?.subscription
    || invoice?.lines?.data?.find((l) => l.subscription)?.subscription
    || invoice?.lines?.data?.find((l) => l.parent?.subscription_item_details?.subscription)?.parent.subscription_item_details.subscription
    || null;
}
/** The price id billed on an invoice. */
export function invoicePriceId(invoice) {
  const line = invoice?.lines?.data?.[0];
  return line?.price?.id || line?.pricing?.price_details?.price || line?.plan?.id || null;
}
/** Period end (ms) of the first line, else now + 30 days. */
export function invoicePeriodEnd(invoice) {
  const end = invoice?.lines?.data?.[0]?.period?.end;
  return end ? end * 1000 : Date.now() + 30 * 86400e3;
}

/** @returns {{ops: object[], status: object|null, reason: string}} */
export function decideCheckout(session, env = process.env) {
  const key = productKeyForPrice(session?.metadata?.price_id, env) || session?.metadata?.price_key || null;
  const product = PRODUCTS[key];
  if (!product) return { ops: [], status: null, reason: `unknown product ${session?.metadata?.price_key || session?.metadata?.price_id}` };
  if (product.kind === 'consumable') {
    if (session.payment_status && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return { ops: [], status: null, reason: `pack not paid (${session.payment_status})` };
    return {
      ops: [{ op: 'grant', bucket: 'pack', amount: product.credits, externalId: ext.session(session.id), description: `${product.name} (web)`, paymentRef: session.payment_intent || null }],
      status: { stripe_customer_id: session.customer || undefined }, reason: 'pack purchase',
    };
  }
  // subscription: the allowance is granted on invoice.paid; here we only record the link
  return { ops: [], status: { stripe_customer_id: session.customer || undefined, subscription_id: session.subscription || undefined, subscription_source: 'stripe' }, reason: 'subscription checkout (allowance on invoice.paid)' };
}

export function decideInvoicePaid(invoice, env = process.env) {
  const key = productKeyForPrice(invoicePriceId(invoice), env);
  const product = PRODUCTS[key];
  if (!product || product.kind !== 'subscription') return { ops: [], status: null, reason: `invoice for unknown or non-subscription price ${invoicePriceId(invoice)}` };
  const expiresAt = new Date(invoicePeriodEnd(invoice)).toISOString();
  // A free trial starts with a $0 invoice for the first period: grant the trial allowance and mark
  // the account trialing; the first paid invoice (or any later one) grants the full allowance.
  const trial = !!product.trial && !(invoice.amount_paid > 0) && !(invoice.amount_due > 0)
    && (invoice.billing_reason === 'subscription_create' || invoice.billing_reason === 'subscription_update');
  const amount = trial ? product.trial.grades : product.allowance;
  return {
    ops: [{ op: 'grant', bucket: 'sub', amount, externalId: ext.invoice(invoice.id), description: trial ? `${product.name} trial (web)` : `${product.name} ${product.period} (web)`, expiresAt, paymentRef: invoice.payment_intent || null }],
    status: { subscription_status: trial ? 'trialing' : key, subscription_source: 'stripe', subscription_id: invoiceSubscriptionId(invoice) || undefined, subscription_renews_at: expiresAt },
    reason: trial ? 'trial started' : `subscription paid (${invoice.billing_reason || 'invoice'})`,
  };
}

export function decideInvoiceFailed() {
  return { ops: [], status: { subscription_status: 'past_due', subscription_source: 'stripe' }, reason: 'invoice payment failed' };
}

export function decideSubscriptionUpdated(subscription, env = process.env) {
  const key = productKeyForPrice(subscription?.items?.data?.[0]?.price?.id, env);
  const st = subscription?.status;
  let status;
  if (st === 'trialing') status = 'trialing';
  else if (st === 'active') status = key || 'active';
  else if (st === 'past_due' || st === 'unpaid') status = 'past_due';
  else if (st === 'canceled' || st === 'incomplete_expired') status = 'expired';
  else status = undefined;
  const endTs = subscription?.current_period_end || (st === 'trialing' ? subscription?.trial_end : null);
  const periodEnd = endTs ? new Date(endTs * 1000).toISOString() : undefined;
  return { ops: [], status: { ...(status ? { subscription_status: status } : {}), subscription_source: 'stripe', subscription_id: subscription?.id, ...(periodEnd ? { subscription_renews_at: periodEnd } : {}) }, reason: `subscription ${st}${subscription?.cancel_at_period_end ? ' (cancels at period end)' : ''}` };
}

export function decideSubscriptionDeleted() {
  return { ops: [], status: { subscription_status: 'expired', subscription_id: null, subscription_renews_at: null, subscription_source: 'stripe' }, reason: 'subscription deleted' };
}

export function decideChargeRefunded(charge) {
  if (!charge?.refunded && !(charge?.amount_refunded > 0)) return { ops: [], status: null, reason: 'charge not refunded' };
  return { ops: [{ op: 'revokeByPayment', paymentRef: charge.payment_intent, reason: 'stripe refund' }], status: null, reason: 'charge refunded' };
}

/** Find the profile for a Stripe customer id. */
export async function userForCustomer(db, customerId) {
  if (!customerId) return null;
  const { data } = await db.from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle();
  return data?.id || null;
}

/** Run a decision against the database. `userId` may be null for an unknown customer. */
export async function applyToDb(db, { decision, userId }) {
  const results = [];
  if (!userId) return { ...decision, results, applied: false, reason: decision.reason + ' (no user)' };
  for (const op of decision.ops) {
    if (op.op === 'grant') {
      const { data, error } = await db.rpc('grant_credits', { p_user_id: userId, p_amount: op.amount, p_bucket: op.bucket, p_external_id: op.externalId, p_description: op.description, p_expires_at: op.expiresAt || null, p_payment_ref: op.paymentRef || null });
      if (error) throw new Error(`grant_credits: ${error.message}`);
      results.push({ ...op, result: data });
    } else if (op.op === 'revokeByPayment') {
      const { data, error } = await db.rpc('revoke_credits_by_payment', { p_user_id: userId, p_payment_ref: op.paymentRef, p_reason: op.reason });
      if (error) throw new Error(`revoke_credits_by_payment: ${error.message}`);
      results.push({ ...op, result: data });
    }
  }
  if (decision.status) {
    const status = Object.fromEntries(Object.entries(decision.status).filter(([, v]) => v !== undefined));
    if (Object.keys(status).length) {
      const { error } = await db.from('profiles').update(status).eq('id', userId);
      if (error) throw new Error(`profiles: ${error.message}`);
    }
  }
  return { ...decision, results, applied: true };
}
