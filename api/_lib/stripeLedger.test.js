/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import assert from 'node:assert/strict';
import { priceMap, productKeyForPrice, invoiceSubscriptionId, invoicePriceId, decideCheckout, decideInvoicePaid, decideSubscriptionUpdated, decideSubscriptionDeleted, decideChargeRefunded, decideInvoiceFailed, ext } from './stripeLedger.js';
import { PRODUCTS } from '../../src/lib/products.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const env = { STRIPE_PRICE_PLUS_MONTHLY: 'price_plus', STRIPE_PRICE_GRADES_5: 'price_5', STRIPE_PRICE_GRADES_20: 'price_20', STRIPE_PRICE_SLAB: 'price_slab' };

ok('price map is keyed by product key from the catalogue env names', () => {
  assert.deepEqual(priceMap(env), { sub_monthly: 'price_plus', pack_5: 'price_5', pack_20: 'price_20', slab: 'price_slab' });
  assert.equal(productKeyForPrice('price_20', env), 'pack_20'); assert.equal(productKeyForPrice('price_x', env), null);
});
ok('a paid pack checkout grants once per session with the payment ref', () => {
  const d = decideCheckout({ id: 'cs_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', customer: 'cus_1', metadata: { price_id: 'price_5', price_key: 'pack_5' } }, env);
  assert.equal(d.ops.length, 1);
  assert.deepEqual([d.ops[0].bucket, d.ops[0].amount, d.ops[0].externalId, d.ops[0].paymentRef], ['pack', PRODUCTS.pack_5.credits, ext.session('cs_1'), 'pi_1']);
});
ok('an unpaid pack checkout grants nothing', () => {
  assert.equal(decideCheckout({ id: 'cs_2', payment_status: 'unpaid', metadata: { price_id: 'price_5' } }, env).ops.length, 0);
});
ok('a subscription checkout only links; the allowance comes from invoice.paid', () => {
  const d = decideCheckout({ id: 'cs_3', mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', metadata: { price_id: 'price_plus' } }, env);
  assert.equal(d.ops.length, 0); assert.equal(d.status.subscription_id, 'sub_1');
});
ok('invoice.paid grants the period allowance once per invoice, expiring at period end', () => {
  const inv = { id: 'in_1', billing_reason: 'subscription_create', payment_intent: 'pi_9', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ price: { id: 'price_plus' }, period: { end: 1_800_000_000 } }] } };
  const d = decideInvoicePaid(inv, env);
  assert.equal(d.ops[0].bucket, 'sub'); assert.equal(d.ops[0].amount, PRODUCTS.sub_monthly.allowance); assert.equal(d.ops[0].externalId, ext.invoice('in_1'));
  assert.equal(d.ops[0].expiresAt, new Date(1_800_000_000 * 1000).toISOString()); assert.equal(d.status.subscription_status, 'sub_monthly'); assert.equal(d.status.subscription_id, 'sub_1');
});
ok('subscription id is read from the basil location, the legacy field, or the line item', () => {
  assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'a' } } }), 'a');
  assert.equal(invoiceSubscriptionId({ subscription: 'b' }), 'b');
  assert.equal(invoiceSubscriptionId({ lines: { data: [{ subscription: 'c' }] } }), 'c');
  assert.equal(invoiceSubscriptionId({ lines: { data: [{ parent: { subscription_item_details: { subscription: 'd' } } }] } }), 'd');
  assert.equal(invoicePriceId({ lines: { data: [{ pricing: { price_details: { price: 'price_plus' } } }] } }), 'price_plus');
});
ok('a non-subscription invoice grants nothing', () => {
  assert.equal(decideInvoicePaid({ id: 'in_2', lines: { data: [{ price: { id: 'price_5' } }] } }, env).ops.length, 0);
});
ok('subscription updates map Stripe status to ours; deleted expires; failed is past_due', () => {
  assert.equal(decideSubscriptionUpdated({ id: 'sub_1', status: 'active', items: { data: [{ price: { id: 'price_plus' } }] }, current_period_end: 1_800_000_000 }, env).status.subscription_status, 'sub_monthly');
  assert.equal(decideSubscriptionUpdated({ id: 'sub_1', status: 'past_due', items: { data: [] } }, env).status.subscription_status, 'past_due');
  assert.equal(decideSubscriptionUpdated({ id: 'sub_1', status: 'canceled', items: { data: [] } }, env).status.subscription_status, 'expired');
  assert.equal(decideSubscriptionDeleted().status.subscription_status, 'expired');
  assert.equal(decideInvoiceFailed().status.subscription_status, 'past_due');
});
ok('a refunded charge revokes by payment intent; an unrefunded one does nothing', () => {
  assert.deepEqual(decideChargeRefunded({ refunded: true, payment_intent: 'pi_1' }).ops[0], { op: 'revokeByPayment', paymentRef: 'pi_1', reason: 'stripe refund' });
  assert.equal(decideChargeRefunded({ refunded: false, amount_refunded: 0 }).ops.length, 0);
});
console.log(`${passed} passed, 0 failed`);
