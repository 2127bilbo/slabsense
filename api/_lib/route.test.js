import assert from 'node:assert/strict';
import { userRoute, preflight } from './route.js';

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
const res = () => { const r = { headers: {}, code: null, body: undefined, ended: false }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => { r.ended = true; return r; }; return r; };
const db = { auth: { getUser: async (t) => (t === 'good' ? { data: { user: { id: 'u1', email: 'a@b' } } } : { data: {}, error: new Error('bad') }) } };
const req = (over = {}) => ({ method: 'POST', headers: { authorization: 'Bearer good' }, body: {}, query: {}, ...over });

await ok('preflight answers OPTIONS and rejects other methods', async () => {
  const r = res(); assert.equal(preflight({ method: 'OPTIONS' }, r, { methods: ['POST'] }), true); assert.equal(r.code, 200); assert.equal(r.ended, true);
  assert.equal(r.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  const r2 = res(); assert.equal(preflight({ method: 'GET' }, r2, { methods: ['POST'] }), true); assert.equal(r2.code, 405);
  const r3 = res(); assert.equal(preflight({ method: 'POST' }, r3, { methods: ['POST'], origin: null }), false); assert.equal(r3.headers['Access-Control-Allow-Origin'], undefined);
});
await ok('a signed-in user reaches the handler with db and user', async () => {
  const h = userRoute({ db, label: 'T' }, async ({ user, db: d, res: r }) => r.status(200).json({ id: user.id, hasDb: !!d }));
  const r = res(); await h(req(), r); assert.deepEqual([r.code, r.body], [200, { id: 'u1', hasDb: true }]);
});
await ok('no or bad token → 401; a foreign userId in the body or query → 403', async () => {
  const h = userRoute({ db, label: 'T' }, async ({ res: r }) => r.status(200).json({}));
  let r = res(); await h(req({ headers: {} }), r); assert.equal(r.code, 401);
  r = res(); await h(req({ headers: { authorization: 'Bearer nope' } }), r); assert.equal(r.code, 401);
  r = res(); await h(req({ body: { userId: 'u2' } }), r); assert.equal(r.code, 403);
  r = res(); await h(req({ method: 'GET', query: { userId: 'u2' } }), r); assert.equal(r.code, 405); // GET not allowed by default
  const g = userRoute({ db, methods: ['GET'], label: 'T' }, async ({ res: rr }) => rr.status(200).json({}));
  r = res(); await g(req({ method: 'GET', query: { userId: 'u2' } }), r); assert.equal(r.code, 403);
  r = res(); await g(req({ method: 'GET', query: { userId: 'u1' } }), r); assert.equal(r.code, 200);
});
await ok('a thrown error becomes a labelled 500 and never leaks the stack', async () => {
  const h = userRoute({ db, label: 'Spend' }, async () => { throw new Error('boom'); });
  const orig = console.error; console.error = () => {};
  const r = res(); await h(req(), r); console.error = orig;
  assert.equal(r.code, 500); assert.equal(r.body.error, 'Spend failed'); assert.equal(r.body.message, 'boom');
});
await ok('server without Supabase env answers 500 server_not_configured', async () => {
  const h = userRoute({ label: 'T', db: null }, async ({ res: r }) => r.status(200).json({}));
  const saved = { a: process.env.SUPABASE_URL, b: process.env.VITE_SUPABASE_URL, c: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = res(); await h(req(), r);
  Object.assign(process.env, Object.fromEntries(Object.entries({ SUPABASE_URL: saved.a, VITE_SUPABASE_URL: saved.b, SUPABASE_SERVICE_ROLE_KEY: saved.c }).filter(([, v]) => v !== undefined)));
  assert.equal(r.code, 500); assert.equal(r.body.error, 'server_not_configured');
});
console.log(`${passed} passed, 0 failed`);
