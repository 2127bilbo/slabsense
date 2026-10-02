/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Browser parity check between the two Transformers.js runtimes (audit E-02 / D-01).
 * The card DB shards were embedded by the old package; the client may switch only if the same
 * images embed the same way. Runs in the browser because the v4 package's node entry needs a
 * native onnxruntime binding that does not load on the owner's PC.
 *
 * Serve: `npx vite --port 5175` → http://localhost:5175/scripts/harness/clip-parity/index.html
 * Images come through the dev server's /tcgdex-img proxy (same ids the card DB uses).
 * Needs `npm i -D @huggingface/transformers --legacy-peer-deps` first (not kept installed: its
 * node binding fails on the owner's PC and it adds 5 audit advisories' worth of weight).
 *
 * RESULT 2026-10-02 (4 cards): cosine old-vs-new q8 0.988–0.993, fp32 0.978–0.986. The bar is
 * 0.999, so the runtimes are NOT interchangeable: switching the client requires re-embedding the
 * whole card DB (scripts/card-db) with the new runtime first, then swapping both at once.
 */
const MODEL = 'Xenova/clip-vit-base-patch32';
const IMAGES = [
  '/tcgdex-img/en/sv/sv02/001/high.png',
  '/tcgdex-img/en/sv/sv01/001/high.png',
  '/tcgdex-img/en/sv/sv03/001/high.png',
  '/tcgdex-img/en/base/base1/4/high.png',
  '/tcgdex-img/en/xy/xy1/001/high.png',
  '/tcgdex-img/en/sm/sm1/001/high.png',
];
const out = document.getElementById('out');
const log = (s) => { out.textContent += '\n' + s; console.log(s); };
const l2 = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
async function toDataUrl(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = await r.blob();
  return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
}
window.__parity = { done: false, rows: [], min: null, error: null };
try {
  const t0 = performance.now();
  const old = await import('@xenova/transformers');
  old.env.allowLocalModels = false; old.env.useBrowserCache = true;
  const oldPipe = await old.pipeline('image-feature-extraction', MODEL);
  log(`old runtime ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const t1 = performance.now();
  const neu = await import('@huggingface/transformers');
  neu.env.allowLocalModels = false; neu.env.useBrowserCache = true;
  const newPipe = await neu.pipeline('image-feature-extraction', MODEL, { dtype: 'q8', device: 'wasm' });
  log(`new runtime ready in ${((performance.now() - t1) / 1000).toFixed(1)} s (q8, wasm)`);
  const newFp32 = await neu.pipeline('image-feature-extraction', MODEL, { dtype: 'fp32', device: 'wasm' });
  log('new runtime fp32 ready');
  let min = 1;
  for (const url of IMAGES) {
    let img; try { img = await toDataUrl(url); } catch (e) { log(`skip ${url}: ${e.message}`); continue; }
    const ta = performance.now(); const a = l2((await oldPipe(img, { pooling: 'mean', normalize: true })).data); const da = performance.now() - ta;
    const tb = performance.now(); const b = l2((await newPipe(img, { pooling: 'mean', normalize: true })).data); const db = performance.now() - tb;
    const f = l2((await newFp32(img, { pooling: 'mean', normalize: true })).data);
    const cf = cos(a, f);
    const c = cos(a, b); min = Math.min(min, c);
    const row = { url, dim: [a.length, b.length], cos: c, cosFp32: cf, msOld: Math.round(da), msNew: Math.round(db) };
    window.__parity.rows.push(row);
    log(`${url.replace('/tcgdex-img/', '')}  dim ${a.length}/${b.length}  cos q8 ${c.toFixed(5)} fp32 ${cf.toFixed(5)}  old ${row.msOld} ms  new ${row.msNew} ms`);
  }
  window.__parity.min = min;
  log(`\nmin cosine ${min.toFixed(5)} -> ${min >= 0.999 ? 'PARITY OK' : 'NOT INTERCHANGEABLE'}`);
} catch (e) {
  window.__parity.error = String(e?.stack || e);
  log('ERROR ' + (e?.stack || e));
} finally {
  window.__parity.done = true;
}
