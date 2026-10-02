#!/usr/bin/env node
/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * The card model -> crop -> centering model chain, measured on the real
 * hand-labelled phone photos in training/data/card-val.
 *
 * Per photo: the card model's corners, raw from the mask and after
 * full-resolution refinement (src/lib/card-mask.js), against the hand-placed
 * corners (error as % of the card's long side); then centering v2b on three
 * crops — raw, refined, hand-labelled — reporting how far the automatic crops'
 * ratios sit from the hand crop's (there is no TAG truth for these photos, so
 * agreement with the hand crop is the measure).
 *
 *   node --expose-gc scripts/harness/card-chain.mjs [--limit N] [--no-centering]
 */
import { createCanvas, Image } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { createCardRunner } from '../../src/lib/card-model-runner.js';
import { quadStats } from '../../src/lib/card-mask.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const VAL = path.join(ROOT, 'training', 'data', 'card-val');
const ONNX = path.join(ROOT, 'training', 'weights', 'onnx');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(opt('--limit', 0)) || 0;
const CENTERING = !args.includes('--no-centering');

let names = fs.readdirSync(VAL).filter((d) => fs.existsSync(path.join(VAL, d, 'labels.json'))).sort();
if (LIMIT) names = names.slice(0, LIMIT);
const runner = createCardRunner({ ort, createCanvas, baseUrl: ONNX + path.sep, executionProviders: ['wasm'] });
await runner.preload(CENTERING ? ['card', 'centering'] : ['card']);

/** Affine crop of a quad (tl, tr, bl define the parallelogram) to a W x H canvas — the same for every crop, so crops are comparable. */
function cropQuad(img, q, W, H) {
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  const [ax, ay] = q.tl, [bx, by] = q.tr, [cx, cy] = q.bl;
  // maps (u,v) in [0,1]^2 -> tl + u*(tr-tl) + v*(bl-tl); canvas needs the inverse for drawImage, so draw the image under the inverse transform
  const m = [(bx - ax) / W, (by - ay) / W, (cx - ax) / H, (cy - ay) / H, ax, ay];
  const det = m[0] * m[3] - m[1] * m[2];
  const inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  const e = -(inv[0] * m[4] + inv[2] * m[5]), f = -(inv[1] * m[4] + inv[3] * m[5]);
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(inv[0], inv[1], inv[2], inv[3], e, f);
  ctx.drawImage(img, 0, 0);
  return c;
}

const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

const rows = [];
const t0 = Date.now();
for (const [n, name] of names.entries()) {
  const labels = JSON.parse(fs.readFileSync(path.join(VAL, name, 'labels.json'), 'utf8'));
  const truthN = labels.sides.front.corners;
  const img = new Image(); img.src = fs.readFileSync(path.join(VAL, name, 'front.jpg'));
  const W = img.width, H = img.height;
  const truth = { tl: [truthN.tl.x * W, truthN.tl.y * H], tr: [truthN.tr.x * W, truthN.tr.y * H], br: [truthN.br.x * W, truthN.br.y * H], bl: [truthN.bl.x * W, truthN.bl.y * H] };
  const longSide = quadStats(truth).longSide;
  const full = createCanvas(W, H); const fctx = full.getContext('2d', { willReadFrequently: true }); fctx.drawImage(img, 0, 0);
  const pixels = { data: fctx.getImageData(0, 0, W, H).data, w: W, h: H };
  const row = { name, tags: labels.tags || [], longSide };
  try {
    const det = await runner.detectCard(img, { refine: 'logits', pixels });
    if (!det || !det.stats.cardLike) { row.failed = det ? 'not card-shaped' : 'no card'; }
    else {
      const err = (q) => ['tl', 'tr', 'br', 'bl'].map((k) => Math.hypot(q[k][0] - truth[k][0], q[k][1] - truth[k][1]) / longSide * 100);
      row.rawErr = err(det.quadRaw); row.refErr = err(det.quad); row.ms = det.ms; row.maskArea = det.maskArea;
      if (CENTERING) {
        const side = 'front';
        const cw = 896, ch = 1248;
        const [cHand, cRaw, cRef] = await Promise.all([truth, det.quadRaw, det.quad].map((q) => runner.measureCentering(cropQuad(img, q, cw, ch), side)));
        row.centering = { hand: cHand, raw: cRaw, refined: cRef };
      }
    }
  } catch (e) { row.failed = 'error: ' + (e.message || e); }
  rows.push(row);
  if (typeof global.gc === 'function') global.gc();
  if ((n + 1) % 10 === 0) process.stdout.write(`\r${n + 1}/${names.length}  ${Math.round((Date.now() - t0) / 1000)}s   `);
}
console.log('');

const ok = rows.filter((r) => !r.failed);
const failed = rows.filter((r) => r.failed);
const bowed = (r) => r.tags.includes('bowed');
const holder = (r) => r.tags.includes('sleeve');
console.log(`${rows.length} photos; failed ${failed.length} (${failed.map((r) => r.name + ': ' + r.failed).slice(0, 6).join('; ')}${failed.length > 6 ? '; …' : ''})\n`);
console.log('corner error, % of the card long side (mean of 4 corners per photo):');
console.log('| subset | photos | raw mean | raw p95 | refined mean | refined p95 | photos where refinement helped |');
console.log('|---|---|---|---|---|---|---|');
for (const [label, list] of [['all raw cards (no holder)', ok.filter((r) => !holder(r))], ['  of which bowed', ok.filter((r) => !holder(r) && bowed(r))], ['  of which not bowed', ok.filter((r) => !holder(r) && !bowed(r))], ['in a sleeve / holder', ok.filter(holder)]]) {
  if (!list.length) continue;
  const raw = list.map((r) => mean(r.rawErr)), ref = list.map((r) => mean(r.refErr));
  const helped = list.filter((r) => mean(r.refErr) < mean(r.rawErr)).length;
  console.log(`| ${label} | ${list.length} | ${r2(mean(raw))} | ${r2(pct(raw, 0.95))} | ${r2(mean(ref))} | ${r2(pct(ref, 0.95))} | ${helped} |`);
}
if (CENTERING) {
  const list = ok.filter((r) => !holder(r) && r.centering);
  const d = (k, ax) => list.map((r) => Math.abs(r.centering[k][ax] - r.centering.hand[ax]));
  console.log('\ncentering v2b: automatic crop vs the hand-labelled crop (ratio points, raw cards):');
  console.log('| crop | mean |L/R diff| | mean |T/B diff| | both within 1 pt | within 2 pts |');
  console.log('|---|---|---|---|---|');
  for (const k of ['raw', 'refined']) {
    const lr = d(k, 'lrRatio'), tb = d(k, 'tbRatio');
    const w = (t) => r2((100 * list.filter((r, i) => lr[i] <= t && tb[i] <= t).length) / list.length);
    console.log(`| ${k} | ${r2(mean(lr))} | ${r2(mean(tb))} | ${w(1)} % | ${w(2)} % |`);
  }
  console.log(`  centering ms per crop (wasm): ${Math.round(mean(list.map((r) => r.centering.hand.ms)))}; card model ms per photo incl. refinement: ${Math.round(mean(ok.map((r) => r.ms)))}`);
}
const out = path.join(here, 'results', `${new Date().toISOString().slice(0, 10)}-card-chain.json`);
fs.writeFileSync(out, JSON.stringify({ rows: rows.map((r) => ({ ...r, rawErr: r.rawErr?.map(r2), refErr: r.refErr?.map(r2), centering: r.centering && Object.fromEntries(Object.entries(r.centering).map(([k, v]) => [k, { lrRatio: r2(v.lrRatio), tbRatio: r2(v.tbRatio) }])) })) }, null, 1));
console.log(`wrote ${path.relative(ROOT, out)}`);
