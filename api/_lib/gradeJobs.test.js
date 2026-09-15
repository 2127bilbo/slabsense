/** Run: node api/_lib/gradeJobs.test.js */
import { runGradeJob, captureHandler, sanitizeRequest } from './gradeJobs.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

/** Fake db: RPC-based credits + an ai_grade_jobs table with the in-flight unique rule. */
function fakeDb({ jobsTable = true, balance = 5 } = {}) {
  const t = { profiles: [{ id: 'u1', credits_balance: balance, subscription_status: 'hobby', credits_expire_at: null }], credit_transactions: [], ai_grade_jobs: [] };
  let seq = 0;
  const db = {
    t,
    async rpc(name, a) {
      if (name === 'spend_credits') {
        const p = t.profiles[0]; if (p.credits_balance < a.p_cost) return { data: { success: false, error: 'insufficient_credits', credits_required: a.p_cost, credits_remaining: p.credits_balance }, error: null };
        p.credits_balance -= a.p_cost; const id = `tx${++seq}`; t.credit_transactions.push({ id, user_id: 'u1', amount: -a.p_cost, transaction_type: `grade_${a.p_grade_type}` });
        return { data: { success: true, credits_spent: a.p_cost, credits_remaining: p.credits_balance, transaction_id: id }, error: null };
      }
      if (name === 'refund_credits') {
        const tx = t.credit_transactions.find((x) => x.id === a.p_transaction_id); if (!tx || tx.refunded_at) return { data: { success: true, already_refunded: true, credits_refunded: 0 }, error: null };
        tx.refunded_at = 1; t.profiles[0].credits_balance += Math.abs(tx.amount);
        return { data: { success: true, credits_refunded: Math.abs(tx.amount), credits_remaining: t.profiles[0].credits_balance }, error: null };
      }
      return { data: null, error: { code: '42883' } };
    },
    from(table) {
      const q = { filters: [], op: 'select', payload: null };
      const api = {
        insert(row) { q.op = 'insert'; q.payload = row; return api; },
        update(p) { q.op = 'update'; q.payload = p; return api; },
        select() { return api; },
        eq(k, v) { q.filters.push((r) => r[k] === v); return api; },
        in(k, vs) { q.filters.push((r) => vs.includes(r[k])); return api; },
        limit() { return api; },
        then(res, rej) {
          if (table === 'ai_grade_jobs' && !jobsTable) return res({ data: null, error: { code: '42P01', message: 'relation "ai_grade_jobs" does not exist' } });
          const rows = t[table];
          if (q.op === 'insert') {
            if (table === 'ai_grade_jobs' && rows.some((r) => r.user_id === q.payload.user_id && r.card_key === q.payload.card_key && r.grade_type === q.payload.grade_type && ['queued', 'running'].includes(r.status))) return res({ data: null, error: { code: '23505', message: 'duplicate' } });
            rows.push({ ...q.payload }); return res({ data: [q.payload], error: null });
          }
          const hits = rows.filter((r) => q.filters.every((f) => f(r)));
          if (q.op === 'update') { hits.forEach((r) => Object.assign(r, q.payload)); return res({ data: hits, error: null }); }
          return res({ data: hits, error: null });
        },
      };
      return api;
    },
  };
  return db;
}
const user = { id: 'u1' };
const body = { jobId: '11111111-1111-4111-8111-111111111111', cardKey: 'abc', frontUrl: 'https://x/f.jpg', frontCentering: { lrRatio: 50, tbRatio: 50 }, secret: 'nope' };

console.log('— success path');
{
  const db = fakeDb();
  const r = await runGradeJob({ db, user, gradeType: 'deep', body, run: async () => ({ status: 200, body: { success: true, analysis: { overall: { grade: 8 } } } }) });
  check('200 with jobId, transactionId and creditsRemaining', r.status === 200 && r.body.jobId === body.jobId && r.body.transactionId === 'tx1' && r.body.creditsRemaining === 3, JSON.stringify(r.body));
  const job = db.t.ai_grade_jobs[0];
  check('job stored as done with the result and sanitized request', job.status === 'done' && job.result.analysis.overall.grade === 8 && job.request.frontUrl && job.request.secret === undefined, JSON.stringify(job));
  check('credit stays spent', db.t.profiles[0].credits_balance === 3);
}

console.log('— failure path refunds server-side');
{
  const db = fakeDb();
  const r = await runGradeJob({ db, user, gradeType: 'ai', body, run: async () => ({ status: 500, body: { error: 'No JSON in response' } }) });
  check('error status passes through with refunded flag', r.status === 500 && r.body.refunded === true && r.body.jobId === body.jobId, JSON.stringify(r.body));
  check('balance restored, job marked error', db.t.profiles[0].credits_balance === 5 && db.t.ai_grade_jobs[0].status === 'error' && /No JSON/.test(db.t.ai_grade_jobs[0].error));
  const thrown = await runGradeJob({ db, user, gradeType: 'ai', body: { ...body, jobId: undefined, cardKey: 'other' }, run: async () => { throw new Error('boom'); } });
  check('thrown error → 500, refunded, job error', thrown.status === 500 && thrown.body.refunded === true && db.t.profiles[0].credits_balance === 5, JSON.stringify(thrown.body));
}

console.log('— one-shot: duplicate in-flight request is refused and refunded');
{
  const db = fakeDb();
  let release; const gate = new Promise((r) => { release = r; });
  const first = runGradeJob({ db, user, gradeType: 'deep', body, run: async () => { await gate; return { status: 200, body: { success: true } }; } });
  await new Promise((r) => setTimeout(r, 10));
  const second = await runGradeJob({ db, user, gradeType: 'deep', body: { ...body, jobId: '22222222-2222-4222-8222-222222222222' }, run: async () => ({ status: 200, body: { success: true } }) });
  check('second request → 409 with the running job id', second.status === 409 && second.body.error === 'in_flight' && second.body.jobId === body.jobId, JSON.stringify(second.body));
  check('second request charged then refunded (net one deduction)', db.t.profiles[0].credits_balance === 3, String(db.t.profiles[0].credits_balance));
  release(); const r1 = await first;
  check('first request completes normally', r1.status === 200 && db.t.ai_grade_jobs.length === 1 && db.t.ai_grade_jobs[0].status === 'done');
  const third = await runGradeJob({ db, user, gradeType: 'deep', body: { ...body, jobId: '33333333-3333-4333-8333-333333333333' }, run: async () => ({ status: 200, body: { success: true } }) });
  check('after completion the same card can be graded again', third.status === 200 && db.t.ai_grade_jobs.length === 2);
}

console.log('— insufficient credits stops before any job');
{
  const db = fakeDb({ balance: 1 });
  const r = await runGradeJob({ db, user, gradeType: 'deep', body, run: async () => ({ status: 200, body: { success: true } }) });
  check('402 passthrough, no job row', r.status === 402 && db.t.ai_grade_jobs.length === 0);
}

console.log('— jobs table missing (pre-migration)');
{
  const db = fakeDb({ jobsTable: false });
  const r = await runGradeJob({ db, user, gradeType: 'ai', body, run: async () => ({ status: 200, body: { success: true } }) });
  check('still spends, runs and returns 200 with a jobId', r.status === 200 && !!r.body.jobId, JSON.stringify(r.body));
  const f = await runGradeJob({ db, user, gradeType: 'ai', body, run: async () => ({ status: 429, body: { error: 'Rate limited' } }) });
  check('still refunds on failure', f.status === 429 && f.body.refunded === true && db.t.profiles[0].credits_balance === 4);
}

console.log('— captureHandler + sanitizeRequest');
{
  const out = await captureHandler(async (req, res) => res.status(418).json({ error: 'teapot', got: req.body.x }), { body: { x: 1 } });
  check('captures status and json from a (req,res) handler', out.status === 418 && out.body.got === 1);
  check('sanitizeRequest keeps only known keys', JSON.stringify(Object.keys(sanitizeRequest({ frontUrl: 'a', password: 'b', cardKey: 'c' }))) === '["frontUrl","cardKey"]');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
