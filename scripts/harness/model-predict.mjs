#!/usr/bin/env node
/**
 * Runs the corner and edge models over every harness card and caches the raw
 * per-slot predictions, so threshold calibration (model-sweep.mjs) can be redone
 * in seconds without re-running inference.
 *
 *   node --expose-gc scripts/harness/model-predict.mjs [--limit N] [--out file] [--resume]
 *
 * Crops come from src/lib/tag-crops.js at the photo's native resolution, which
 * is where TAG's own 550 px crops live; verify-crops.mjs proves the framing
 * matches TAG's published crops.
 */
import { createCanvas, Image } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { createCornerEdgeRunner } from '../../src/lib/corner-edge-runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PHOTOS = path.join(ROOT, 'scripts', 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map');
const ONNX = path.join(ROOT, 'training', 'weights', 'onnx');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(opt('--limit', 0)) || 0;
const OUT = opt('--out', path.join(here, 'results', 'model-predictions.json'));
const RESUME = args.includes('--resume');
const MAX_DIM = Number(opt('--max-dim', 0)) || 0; // simulate a phone upload by capping the long side

const gt = JSON.parse(fs.readFileSync(path.join(here, 'ground-truth.json'), 'utf8'));
let certs = Object.keys(gt.certs);
if (LIMIT) certs = certs.slice(0, LIMIT);

const store = RESUME && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { meta: {}, cards: {} };
store.meta = {
  generatedAt: new Date().toISOString(),
  models: { corners: 'corners-v2.fp16.onnx', edges: 'edges-v1.fp16.onnx' },
  maxDim: MAX_DIM || 'native',
  note: 'raw per-slot model outputs; wear is a probability, deduction and angle are TAG points',
};
const todo = certs.filter((c) => !store.cards[c]);
console.log(`model-predict: ${todo.length} cards to run (${certs.length - todo.length} cached), out=${path.basename(OUT)}`);

// One shared Image: node-canvas 3.x leaks native memory per Image (see run.mjs).
const sharedImg = new Image();
let scaleCanvas = null;
function loadPhoto(file) {
  sharedImg.src = fs.readFileSync(file);
  if (!MAX_DIM || Math.max(sharedImg.width, sharedImg.height) <= MAX_DIM) return sharedImg;
  // Downscale once, the way a phone upload is capped (GRADE_UPLOAD_MAX_PX), then crop from that.
  const s = MAX_DIM / Math.max(sharedImg.width, sharedImg.height);
  const w = Math.round(sharedImg.width * s);
  const h = Math.round(sharedImg.height * s);
  if (!scaleCanvas || scaleCanvas.width !== w || scaleCanvas.height !== h) scaleCanvas = createCanvas(w, h);
  const ctx = scaleCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sharedImg, 0, 0, w, h);
  return scaleCanvas;
}

const runner = createCornerEdgeRunner({
  ort,
  createCanvas: (w, h) => createCanvas(w, h),
  baseUrl: ONNX + path.sep,
  executionProviders: ['wasm'],
});
await runner.preload();

const t0 = Date.now();
let done = 0;
for (const cert of todo) {
  const g = gt.certs[cert];
  const card = {};
  try {
    for (const side of ['front', 'back']) {
      const file = path.join(PHOTOS, side === 'front' ? 'Front' : 'Back', side === 'front' ? g.images.front : g.images.back);
      const photo = loadPhoto(file);
      const slots = await runner.analyzeSide(photo, null, side); // a TAG photo is the card, edge to edge
      card[side] = {
        size: [photo.width, photo.height],
        corners: slots.corners.map((s) => ({ key: s.key, wear: +s.wear.toFixed(4), deduction: +s.deduction.toFixed(1), angle: +s.angle.toFixed(1) })),
        edges: slots.edges.map((s) => ({ key: s.key, wear: +s.wear.toFixed(4), deduction: +s.deduction.toFixed(1) })),
      };
    }
    store.cards[cert] = card;
  } catch (e) {
    store.cards[cert] = { error: String((e && e.message) || e) };
  }
  sharedImg.src = '';
  if (typeof global.gc === 'function') global.gc();
  done++;
  if (done % 10 === 0 || done === todo.length) {
    fs.writeFileSync(OUT, JSON.stringify(store));
    const per = (Date.now() - t0) / done / 1000;
    process.stdout.write(`\r${done}/${todo.length}  ${per.toFixed(1)}s/card  eta ${Math.round((todo.length - done) * per / 60)} min   `);
  }
}
fs.writeFileSync(OUT, JSON.stringify(store));
console.log(`\nwrote ${OUT} (${Object.keys(store.cards).length} cards, ${Math.round((Date.now() - t0) / 60000)} min)`);
