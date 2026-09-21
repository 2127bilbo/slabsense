#!/usr/bin/env node
/**
 * Tests the learned centering model (centering_rgb) against TAG's DIG centering
 * on the harness cards, side by side with the app's pixel detector.
 *
 * The model takes an image cropped to the card and predicts the four
 * card-edge-to-frame distances in per-mille; ratios are l/(l+r) and t/(t+b).
 * The harness photos are already trimmed to the card, so they go in whole.
 *
 *   node --expose-gc scripts/harness/centering-model.mjs [--limit N] [--file centering_rgb-v1.fp16.onnx]
 *                                                        [--jitter]   (also measure crop-error sensitivity)
 */
import { createCanvas, Image } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { rgbaToTensor } from '../../src/lib/tag-crops.js';
import { analyzePixels } from '../../src/lib/detectors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PHOTOS = path.join(ROOT, 'scripts', 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map');
const ONNX = path.join(ROOT, 'training', 'weights', 'onnx');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(opt('--limit', 0)) || 0;
const FILE = opt('--file', 'centering_rgb-v1.fp16.onnx');
const JITTER = args.includes('--jitter');
const W = 896, H = 1248;

const gt = JSON.parse(fs.readFileSync(path.join(here, 'ground-truth.json'), 'utf8'));
const splits = JSON.parse(fs.readFileSync(path.join(here, 'card-splits.json'), 'utf8'));
let certs = Object.keys(gt.certs).filter((c) => gt.certs[c].centering.front.lrRatio != null && gt.certs[c].centering.back.lrRatio != null);
if (LIMIT) certs = certs.slice(0, LIMIT);

const session = await ort.InferenceSession.create(path.join(ONNX, FILE), { executionProviders: ['wasm'] });
const ctx = createCanvas(W, H).getContext('2d', { willReadFrequently: true });
const sharedImg = new Image();

/** Run the model on a card rectangle of `source`; returns { l, r, t, b } per-mille and the ratios. */
async function predict(source, rect, side) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, W, H);
  const images = rgbaToTensor(ctx.getImageData(0, 0, W, H).data, W, H);
  const out = await session.run({
    images: new ort.Tensor('float32', images, [1, 3, H, W]),
    sides: new ort.Tensor('float32', new Float32Array([side === 'back' ? 1 : 0]), [1, 1]),
  });
  const [l, r, t, b] = Array.from(out.logits.data).map((v) => 1000 / (1 + Math.exp(-v)));
  return { l, r, t, b, lrRatio: (100 * l) / (l + r), tbRatio: (100 * t) / (t + b) };
}

/** The app's pixel detector on a 1400 px copy, for the same photo. */
function detectorCentering(img, side) {
  const s = Math.min(1, 1400 / Math.max(img.width, img.height));
  const w = Math.round(img.width * s), h = Math.round(img.height * s);
  const c = createCanvas(w, h); const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
  return analyzePixels({ data: cx.getImageData(0, 0, w, h).data, w, h }, side, null, null).centering;
}

const rows = [];
const t0 = Date.now();
for (const [n, cert] of certs.entries()) {
  const g = gt.certs[cert];
  for (const side of ['front', 'back']) {
    try { sharedImg.src = fs.readFileSync(path.join(PHOTOS, side === 'front' ? 'Front' : 'Back', g.images[side])); } catch (e) { console.warn(`
skip ${cert} ${side}: ${e.message}`); continue; }
    if (!sharedImg.complete || !sharedImg.width) { console.warn(`
skip ${cert} ${side}: image did not decode`); continue; }
    const full = { x: 0, y: 0, w: sharedImg.width, h: sharedImg.height };
    const m = await predict(sharedImg, full, side);
    const d = detectorCentering(sharedImg, side);
    const row = { cert, side, held: splits[cert] !== 'train', tag: g.centering[side], model: m, detector: d };
    if (JITTER) {
      // crop error: each edge moved by an independent +-3% (positive = crop outside the card)
      const j = () => (Math.random() * 2 - 1) * 0.03;
      const jl = j() * full.w, jr = j() * full.w, jt = j() * full.h, jb = j() * full.h;
      row.jittered = await predict(sharedImg, { x: -jl, y: -jt, w: full.w + jl + jr, h: full.h + jt + jb }, side);
    }
    rows.push(row);
  }
  sharedImg.src = '';
  if (typeof global.gc === 'function') global.gc();
  if ((n + 1) % 25 === 0) process.stdout.write(`\r${n + 1}/${certs.length}  ${Math.round((Date.now() - t0) / 1000)}s   `);
}
console.log('');

const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const errs = (list, pick) => ({
  lr: r2(mean(list.map((r) => Math.abs(pick(r).lrRatio - r.tag.lrRatio)))),
  tb: r2(mean(list.map((r) => Math.abs(pick(r).tbRatio - r.tag.tbRatio)))),
  within1: r2((100 * list.filter((r) => Math.abs(pick(r).lrRatio - r.tag.lrRatio) <= 1 && Math.abs(pick(r).tbRatio - r.tag.tbRatio) <= 1).length) / list.length),
  within2: r2((100 * list.filter((r) => Math.abs(pick(r).lrRatio - r.tag.lrRatio) <= 2 && Math.abs(pick(r).tbRatio - r.tag.tbRatio) <= 2).length) / list.length),
});
const detOk = (r) => r.detector && Number.isFinite(r.detector.lrRatio) && Number.isFinite(r.detector.tbRatio);
console.log(`${rows.length} sides (${rows.filter((r) => r.held).length} held out); error = |predicted ratio - TAG DIG ratio| in ratio points (a 55/45 card is 5 points off centre)\n`);
console.log('| source | sides | mean |L/R error| | mean |T/B error| | both within 1 pt | both within 2 pts |');
console.log('|---|---|---|---|---|---|');
for (const [name, list, pick] of [
  ['model, all', rows, (r) => r.model],
  ['model, held out', rows.filter((r) => r.held), (r) => r.model],
  ['app detector, all', rows.filter(detOk), (r) => r.detector],
  ...(JITTER ? [['model, crop edges jittered +-3%', rows, (r) => r.jittered]] : []),
]) {
  const e = errs(list, pick);
  console.log(`| ${name} | ${list.length} | ${e.lr} | ${e.tb} | ${e.within1} % | ${e.within2} % |`);
}
for (const side of ['front', 'back']) {
  const e = errs(rows.filter((r) => r.side === side), (r) => r.model);
  console.log(`  model ${side}: L/R ${e.lr}  T/B ${e.tb}  within 1 pt ${e.within1} %`);
}
const out = path.join(here, 'results', `${new Date().toISOString().slice(0, 10)}-centering-model.json`);
fs.writeFileSync(out, JSON.stringify({ file: FILE, rows: rows.map((r) => ({ cert: r.cert, side: r.side, held: r.held, tag: r.tag, model: { lrRatio: r2(r.model.lrRatio), tbRatio: r2(r.model.tbRatio), l: r2(r.model.l), r: r2(r.model.r), t: r2(r.model.t), b: r2(r.model.b) }, detector: detOk(r) ? { lrRatio: r2(r.detector.lrRatio), tbRatio: r2(r.detector.tbRatio) } : null, ...(r.jittered ? { jittered: { lrRatio: r2(r.jittered.lrRatio), tbRatio: r2(r.jittered.tbRatio) } } : {}) })) }, null, 1));
console.log(`wrote ${path.relative(ROOT, out)}`);
