import assert from 'node:assert/strict';
import { decide, externalId } from './appleLedger.js';
import { PRODUCTS } from '../../src/lib/products.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const now = Date.now();
const subTx = (over = {}) => ({ transactionId: '2000000000000001', originalTransactionId: '2000000000000000', productId: PRODUCTS.sub_monthly.appleId, type: 'Auto-Renewable Subscription', purchaseDate: now, expiresDate: now + 30 * 86400e3, environment: 'Sandbox', quantity: 1, appAccountToken: '11111111-2222-3333-4444-555555555555', ...over });
const packTx = (over = {}) => ({ transactionId: '2000000000000009', originalTransactionId: '2000000000000009', productId: PRODUCTS.pack_20.appleId, type: 'Consumable', purchaseDate: now, environment: 'Sandbox', quantity: 1, ...over });

ok('client verify of a subscription grants the allowance for the period and activates the plan', () => {
  const d = decide(subTx());
  assert.equal(d.ops.length, 1);
  assert.deepEqual([d.ops[0].op, d.ops[0].bucket, d.ops[0].amount, d.ops[0].externalId], ['grant', 'sub', PRODUCTS.sub_monthly.allowance, externalId('2000000000000001')]);
  assert.equal(d.status.subscription_status, 'sub_monthly');
  assert.equal(d.status.apple_original_transaction_id, '2000000000000000');
  assert.ok(d.ops[0].expiresAt && d.status.subscription_renews_at === d.ops[0].expiresAt);
});
ok('DID_RENEW with a new transaction id grants again; the same id is a different op key only once', () => {
  const a = decide(subTx({ transactionId: 'A' }), { notificationType: 'DID_RENEW' });
  const b = decide(subTx({ transactionId: 'B' }), { notificationType: 'DID_RENEW' });
  assert.equal(a.ops[0].externalId, 'apple:A'); assert.equal(b.ops[0].externalId, 'apple:B');
});
ok('EXPIRED and GRACE_PERIOD_EXPIRED end access without touching credits', () => {
  for (const t of ['EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REVOKE']) {
    const d = decide(subTx(), { notificationType: t });
    assert.equal(d.ops.length, 0); assert.equal(d.status.subscription_status, 'expired');
  }
});
ok('DID_FAIL_TO_RENEW with GRACE_PERIOD keeps access as grace', () => {
  assert.equal(decide(subTx(), { notificationType: 'DID_FAIL_TO_RENEW', subtype: 'GRACE_PERIOD' }).status.subscription_status, 'grace');
  assert.equal(decide(subTx(), { notificationType: 'DID_FAIL_TO_RENEW' }).status.subscription_status, 'billing_retry');
});
ok('REFUND of a subscription revokes the remaining allowance and frees the plan', () => {
  const d = decide(subTx({ revocationDate: now }), { notificationType: 'REFUND' });
  assert.equal(d.ops[0].op, 'revoke'); assert.equal(d.status.subscription_status, 'free');
});
ok('a consumable pack grants its credits once, times quantity', () => {
  const d = decide(packTx({ quantity: 2 }), { notificationType: 'ONE_TIME_CHARGE' });
  assert.deepEqual([d.ops[0].op, d.ops[0].bucket, d.ops[0].amount], ['grant', 'pack', 40]);
  assert.equal(d.status, null);
});
ok('a refunded consumable is revoked, never granted', () => {
  const d = decide(packTx({ revocationDate: now }), { notificationType: 'REFUND' });
  assert.equal(d.ops.length, 1); assert.equal(d.ops[0].op, 'revoke');
});
ok('unknown product ids do nothing', () => {
  const d = decide(packTx({ productId: 'com.other.thing' }));
  assert.equal(d.ops.length, 0); assert.match(d.reason, /unknown product/);
});
ok('renewal-preference changes only update the renewal date', () => {
  const d = decide(subTx(), { notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_DISABLED' });
  assert.equal(d.ops.length, 0); assert.ok(d.status.subscription_renews_at);
});
console.log(`${passed} passed, 0 failed`);
