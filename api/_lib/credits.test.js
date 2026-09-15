/** Run: node api/_lib/credits.test.js — exercises RPC and legacy paths against an in-memory fake Supabase client. */
import { spendWithDb, refundWithDb, isMissingFunction } from './credits.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

/** Minimal fake of the supabase-js query builder: from().select/insert/update ... .eq/.like/.limit/.single, thenable. */
class FakeDb {
  constructor({ rpcMissing = false, failTxInsert = false } = {}) {
    this.tables = { profiles: [], credit_transactions: [] };
    this.rpcMissing = rpcMissing; this.failTxInsert = failTxInsert; this.rpcCalls = [];
    this.seq = 0;
  }
  async rpc(name, args) {
    this.rpcCalls.push({ name, args });
    if (this.rpcMissing) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    if (name === 'spend_credits') {
      const p = this.tables.profiles.find((r) => r.id === args.p_user_id);
      if (!p) return { data: { success: false, error: 'user_not_found' }, error: null };
      if (['lifetime', 'beta_lifetime'].includes(p.subscription_status)) {
        const id = `tx${++this.seq}`; this.tables.credit_transactions.push({ id, user_id: p.id, amount: 0, transaction_type: `grade_${args.p_grade_type}` });
        return { data: { success: true, credits_spent: 0, credits_remaining: 'unlimited', transaction_id: id, is_lifetime: true }, error: null };
      }
      if ((p.credits_balance || 0) < args.p_cost) return { data: { success: false, error: 'insufficient_credits', credits_required: args.p_cost, credits_remaining: p.credits_balance || 0 }, error: null };
      p.credits_balance -= args.p_cost;
      const id = `tx${++this.seq}`; this.tables.credit_transactions.push({ id, user_id: p.id, amount: -args.p_cost, transaction_type: `grade_${args.p_grade_type}` });
      return { data: { success: true, credits_spent: args.p_cost, credits_remaining: p.credits_balance, transaction_id: id, is_lifetime: false }, error: null };
    }
    if (name === 'refund_credits') {
      const tx = this.tables.credit_transactions.find((t) => t.id === args.p_transaction_id);
      if (!tx || tx.user_id !== args.p_user_id) return { data: { success: false, error: 'transaction_not_found' }, error: null };
      if (tx.refunded_at) return { data: { success: true, already_refunded: true, credits_refunded: 0 }, error: null };
      tx.refunded_at = 'now';
      const p = this.tables.profiles.find((r) => r.id === args.p_user_id); p.credits_balance += Math.abs(tx.amount);
      return { data: { success: true, credits_refunded: Math.abs(tx.amount), credits_remaining: p.credits_balance }, error: null };
    }
    return { data: null, error: { code: '42883', message: 'unknown function' } };
  }
  from(table) {
    const db = this; const q = { table, filters: [], op: 'select', payload: null, limitN: null, single: false };
    const api = {
      select() { if (q.op === 'insert') q.returning = true; else q.op = 'select'; return api; },
      insert(row) { q.op = 'insert'; q.payload = row; return api; },
      update(patch) { q.op = 'update'; q.payload = patch; return api; },
      eq(k, v) { q.filters.push((r) => r[k] === v); return api; },
      like(k, pat) { const needle = pat.replace(/%/g, ''); q.filters.push((r) => String(r[k] || '').includes(needle)); return api; },
      order() { return api; }, limit(n) { q.limitN = n; return api; },
      single() { q.single = true; return api; },
      then(resolve, reject) { return Promise.resolve(db.exec(q)).then(resolve, reject); },
    };
    return api;
  }
  exec(q) {
    const rows = this.tables[q.table];
    if (q.op === 'insert') {
      if (q.table === 'credit_transactions' && this.failTxInsert) return { data: null, error: { message: 'insert failed' } };
      const row = { id: `tx${++this.seq}`, ...q.payload }; rows.push(row);
      return { data: q.single ? row : [row], error: null };
    }
    let hits = rows.filter((r) => q.filters.every((f) => f(r)));
    if (q.op === 'update') { for (const r of hits) Object.assign(r, q.payload); return { data: hits, error: null }; }
    if (q.limitN) hits = hits.slice(0, q.limitN);
    if (q.single) return hits.length ? { data: hits[0], error: null } : { data: null, error: { message: 'no rows' } };
    return { data: hits, error: null };
  }
}

const user = (over = {}) => ({ id: 'u1', credits_balance: 5, credits_expire_at: null, subscription_status: 'hobby', ...over });

console.log('— helpers');
check('isMissingFunction detects PostgREST 202 and 42883', isMissingFunction({ code: 'PGRST202' }) && isMissingFunction({ code: '42883' }) && !isMissingFunction({ code: '23505' }));

console.log('— RPC path');
{
  const db = new FakeDb(); db.tables.profiles.push(user());
  const r = await spendWithDb(db, { userId: 'u1', gradeType: 'deep' });
  check('spend deep via RPC → 200, 2 credits, tx id', r.status === 200 && r.body.creditsSpent === 2 && r.body.creditsRemaining === 3 && !!r.body.transactionId, JSON.stringify(r));
  check('RPC received the tier cost from grade-tiers', db.rpcCalls[0].args.p_cost === 2);
  const rr = await refundWithDb(db, { userId: 'u1', transactionId: r.body.transactionId, reason: 'test' });
  check('refund via RPC restores balance', rr.status === 200 && rr.body.creditsRefunded === 2 && rr.body.creditsRemaining === 5, JSON.stringify(rr));
  const again = await refundWithDb(db, { userId: 'u1', transactionId: r.body.transactionId });
  check('second refund is a no-op', again.status === 200 && again.body.creditsRefunded === 0 && again.body.alreadyRefunded === true, JSON.stringify(again));
  const other = await refundWithDb(db, { userId: 'u2', transactionId: r.body.transactionId });
  check('refund by another user → 404', other.status === 404);
  const bad = await spendWithDb(db, { userId: 'u1', gradeType: 'ultra' });
  check('unknown tier → 400', bad.status === 400);
  db.tables.profiles[0].credits_balance = 1;
  const poor = await spendWithDb(db, { userId: 'u1', gradeType: 'deep' });
  check('insufficient → 402 with required/remaining', poor.status === 402 && poor.body.creditsRequired === 2 && poor.body.creditsRemaining === 1, JSON.stringify(poor));
  const dbL = new FakeDb(); dbL.tables.profiles.push(user({ subscription_status: 'beta_lifetime' }));
  const life = await spendWithDb(dbL, { userId: 'u1', gradeType: 'ai' });
  check('lifetime → 0 spent, unlimited, still has a tx id', life.status === 200 && life.body.creditsSpent === 0 && life.body.isLifetime && !!life.body.transactionId, JSON.stringify(life));
}

console.log('— legacy path (migration not applied)');
{
  const db = new FakeDb({ rpcMissing: true }); db.tables.profiles.push(user());
  const r = await spendWithDb(db, { userId: 'u1', gradeType: 'ai' });
  check('legacy spend → 200, balance 4, tx id', r.status === 200 && r.body.creditsRemaining === 4 && !!r.body.transactionId, JSON.stringify(r));
  const rr = await refundWithDb(db, { userId: 'u1', transactionId: r.body.transactionId, reason: 'AI grading failed' });
  check('legacy refund → balance 5', rr.status === 200 && rr.body.creditsRefunded === 1 && rr.body.creditsRemaining === 5, JSON.stringify(rr));
  const again = await refundWithDb(db, { userId: 'u1', transactionId: r.body.transactionId });
  check('legacy refund is idempotent (marker)', again.status === 200 && again.body.creditsRefunded === 0 && again.body.alreadyRefunded === true && db.tables.profiles[0].credits_balance === 5, JSON.stringify(again));
  const other = await refundWithDb(db, { userId: 'u2', transactionId: r.body.transactionId });
  check('legacy refund by another user → 404', other.status === 404);
  const dbF = new FakeDb({ rpcMissing: true, failTxInsert: true }); dbF.tables.profiles.push(user());
  const f = await spendWithDb(dbF, { userId: 'u1', gradeType: 'deep' });
  check('legacy spend fails closed when the log insert fails (balance restored, 500)', f.status === 500 && dbF.tables.profiles[0].credits_balance === 5, JSON.stringify(f));
  const dbE = new FakeDb({ rpcMissing: true }); dbE.tables.profiles.push(user({ credits_expire_at: '2020-01-01T00:00:00Z' }));
  const e = await spendWithDb(dbE, { userId: 'u1', gradeType: 'ai' });
  check('legacy expired → 402', e.status === 402 && dbE.tables.profiles[0].credits_balance === 5);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
