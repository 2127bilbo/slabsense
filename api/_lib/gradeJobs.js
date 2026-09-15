/**
 * api/_lib/gradeJobs.js — durable, one-shot AI grade jobs.
 *
 * runGradeJob() wraps an analysis endpoint:
 *   1. spend the credit for the authenticated user (atomic, see credits.js)
 *   2. create an ai_grade_jobs row (status running) keyed by user + card + tier;
 *      a second request for the same card while one is running is refused (409) and
 *      the credit just spent is refunded
 *   3. run the analysis
 *   4. on success store the result on the job; on any failure refund server-side and
 *      store the error
 * The client never spends or refunds credits itself any more. If the table from
 * supabase/migrations/20260915_ai_grade_jobs.sql is missing, job tracking is skipped
 * but spend / run / refund still work.
 */
import { randomUUID } from 'node:crypto';
import { spendWithDb, refundWithDb } from './credits.js';

const REQUEST_KEYS = [
  'frontUrl', 'backUrl', 'frontOriginalUrl', 'backOriginalUrl', 'frontCroppedUrl', 'backCroppedUrl',
  'cardGame', 'cardType', 'frontCentering', 'backCentering', 'cardKey',
];

const isMissingTable = (e) => !!e && (e.code === '42P01' || /relation .* does not exist|Could not find the table/i.test(String(e.message || '')));
const isUniqueViolation = (e) => !!e && e.code === '23505';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeRequest(body) {
  const out = {};
  for (const k of REQUEST_KEYS) if (body && body[k] !== undefined) out[k] = body[k];
  return out;
}

/** @returns {{ id: string, disabled?: boolean, conflictJobId?: string }} */
export async function createJob(db, { id, userId, gradeType, cardKey, transactionId, request }) {
  const jobId = id && UUID_RE.test(id) ? id : randomUUID();
  const { error } = await db.from('ai_grade_jobs').insert({
    id: jobId, user_id: userId, grade_type: gradeType, card_key: cardKey || 'unknown',
    status: 'running', transaction_id: transactionId || null, request: request || {},
    started_at: new Date().toISOString(),
  });
  if (!error) return { id: jobId };
  if (isMissingTable(error)) { console.warn('[gradeJobs] ai_grade_jobs missing — job tracking disabled; apply 20260915_ai_grade_jobs.sql'); return { id: jobId, disabled: true }; }
  if (isUniqueViolation(error)) {
    const { data } = await db.from('ai_grade_jobs').select('id')
      .eq('user_id', userId).eq('card_key', cardKey || 'unknown').eq('grade_type', gradeType)
      .in('status', ['queued', 'running']).limit(1);
    return { id: jobId, conflictJobId: data?.[0]?.id || null };
  }
  throw error;
}

export async function finishJob(db, job, result) {
  if (!job || job.disabled) return;
  const { error } = await db.from('ai_grade_jobs')
    .update({ status: 'done', result, finished_at: new Date().toISOString() }).eq('id', job.id);
  if (error) console.error('[gradeJobs] finishJob failed:', error.message);
}

export async function failJob(db, job, message) {
  if (!job || job.disabled) return;
  const { error } = await db.from('ai_grade_jobs')
    .update({ status: 'error', error: String(message || 'failed').slice(0, 500), finished_at: new Date().toISOString() }).eq('id', job.id);
  if (error) console.error('[gradeJobs] failJob failed:', error.message);
}

/**
 * @param {object} o
 * @param {object} o.db        service-role client
 * @param {{id:string}} o.user authenticated user
 * @param {'ai'|'deep'} o.gradeType
 * @param {object} o.body      request body (jobId, cardKey, and the analysis inputs)
 * @param {() => Promise<{status:number, body:object}>} o.run  the analysis; 200 + body.success means success
 * @returns {Promise<{status:number, body:object}>}
 */
export async function runGradeJob({ db, user, gradeType, body, run }) {
  const userId = user.id;
  const cardKey = typeof body?.cardKey === 'string' ? body.cardKey.slice(0, 128) : null;

  const sp = await spendWithDb(db, { userId, gradeType, scanId: null });
  if (sp.status !== 200) return sp;
  const transactionId = sp.body.transactionId;

  const job = await createJob(db, { id: body?.jobId, userId, gradeType, cardKey, transactionId, request: sanitizeRequest(body) });
  if (job.conflictJobId !== undefined) {
    await refundWithDb(db, { userId, transactionId, reason: `Duplicate ${gradeType} grade request` }).catch(() => null);
    return { status: 409, body: { error: 'in_flight', message: 'This grade is already running for this card.', jobId: job.conflictJobId } };
  }

  let out;
  try { out = await run(); }
  catch (e) { out = { status: 500, body: { error: 'Analysis failed', message: e?.message || String(e) } }; }

  if (out?.status === 200 && out.body?.success) {
    await finishJob(db, job, out.body);
    return { status: 200, body: { ...out.body, jobId: job.id, transactionId, creditsRemaining: sp.body.creditsRemaining } };
  }

  const reason = `${gradeType} grade failed: ${out?.body?.error || out?.body?.message || `HTTP ${out?.status}`}`.slice(0, 200);
  const rf = await refundWithDb(db, { userId, transactionId, reason }).catch((e) => { console.error('[gradeJobs] refund failed:', e?.message); return null; });
  await failJob(db, job, reason);
  return { status: out?.status || 500, body: { ...(out?.body || {}), jobId: job.id, refunded: rf?.status === 200 } };
}

/** Adapts an (req, res)-style handler so runGradeJob can capture its status and JSON. */
export function captureHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      _status: 200,
      setHeader() {}, status(c) { this._status = c; return this; },
      json(b) { resolve({ status: this._status, body: b }); return this; },
      end() { resolve({ status: this._status, body: {} }); return this; },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
