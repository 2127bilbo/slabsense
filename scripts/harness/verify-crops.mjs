#!/usr/bin/env node
/**
 * Proves src/lib/tag-crops.js reproduces TAG's own framing.
 *
 * For every card that has BOTH a full-card harness photo and TAG's published
 * per-slot crops in the dataset cache, this cuts each slot with our geometry and
 * compares it to TAG's crop pixel for pixel (both resized to the model input),
 * then runs the model on each and compares the predictions.
 *
 *   node --expose-gc scripts/harness/verify-crops.mjs [--limit N] [--models]
 */
import { createCanvas, Image } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxesForTask, drawBox, rgbaToTensor, INPUT_SIZE } from '../../src/lib/tag-crops.js';
import { decodeLogits, OUTPUT_CHANNELS } from '../../src/lib/corner-edge-model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PHOTOS = path.join(ROOT, 'scripts', 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map');
const CACHE = path.join(ROOT, 'scripts', 'tag-dataset', 'data', 'cache', 'tag-dataset');
const ONNX = path.join(ROOT, 'training', 'weights', 'onnx');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(opt('--limit', 0)) || 0;
const WITH_MODELS = args.includes('--models');

// TAG's slot file names, in the order our boxes come out.
const TAG_FILE = {
  corners: { TL: 'TL', TR: 'TR', BL: 'BL', BR: 'BR' },
  edges: { T: 'T', B: 'B', L: 'L', R: 'R' },
};
const tagPath = (cert, task, side, key) =>
  path.join(CACHE, cert, `${task === 'corners' ? 'corner' : 'edge'}_${side === 'front' ? 'F' : 'B'}${TAG_FILE[task][key]}.png`);

const gt = JSON.parse(fs.readFileSync(path.join(here, 'ground-truth.json'), 'utf8'));
let certs = Object.keys(gt.certs).filter((c) => fs.existsSync(tagPath(c, 'corners', 'front', 'TL')));
if (LIMIT) certs = certs.slice(0, LIMIT);
if (!certs.length) { console.error('no cards have both a harness photo and cached TAG crops'); process.exit(1); }
console.log(`verify-crops: ${certs.length} cards with both sources${WITH_MODELS ? ' (running models)' : ''}`);

function loadImage(file) {
  const img = new Image();
  img.src = fs.readFileSync(file);
  return img;
}

/** Draw an image (or box of one) into a task-sized canvas and return its RGBA bytes. */
function slotPixels(ctx, task, source, box) {
  const { w, h } = INPUT_SIZE[task];
  drawBox(ctx, source, box, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function meanAbsDiff(a, b) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return sum / n;
}

let ort = null;
const sessions = {};
if (WITH_MODELS) {
  ort = await import('onnxruntime-web');
  for (const [task, file] of [['corners', 'corners-v2.fp16.onnx'], ['edges', 'edges-v1.fp16.onnx']]) {
    sessions[task] = await ort.InferenceSession.create(path.join(ONNX, file), { executionProviders: ['wasm'] });
  }
}

async function predict(task, rgba) {
  const { w, h } = INPUT_SIZE[task];
  const images = rgbaToTensor(rgba, w, h);
  const out = await sessions[task].run({
    images: new ort.Tensor('float32', images, [1, 3, h, w]),
    sides: new ort.Tensor('float32', new Float32Array([0]), [1, 1]),
  });
  return decodeLogits(task, Array.from(out.logits.data));
}

const ctxFor = {};
for (const task of ['corners', 'edges']) {
  const { w, h } = INPUT_SIZE[task];
  ctxFor[task] = createCanvas(w, h).getContext('2d', { willReadFrequently: true });
}

const rows = [];
for (const cert of certs) {
  const g = gt.certs[cert];
  for (const side of ['front', 'back']) {
    const file = path.join(PHOTOS, side === 'front' ? 'Front' : 'Back', side === 'front' ? g.images.front : g.images.back);
    if (!fs.existsSync(file)) continue;
    const photo = loadImage(file);
    for (const task of ['corners', 'edges']) {
      const boxes = boxesForTask(task, photo.width, photo.height); // a TAG photo is the card, edge to edge
      for (const box of boxes) {
        const tagFile = tagPath(cert, task, side, box.key);
        if (!fs.existsSync(tagFile)) continue;
        const ours = Uint8ClampedArray.from(slotPixels(ctxFor[task], task, photo, box));
        const tagImg = loadImage(tagFile);
        const theirs = slotPixels(ctxFor[task], task, tagImg, { x: 0, y: 0, w: tagImg.width, h: tagImg.height, rotate: box.rotate });
        const row = { cert, side, task, key: box.key, diff: meanAbsDiff(ours, theirs) };
        if (WITH_MODELS) {
          const a = await predict(task, ours);
          const b = await predict(task, theirs);
          row.wearOurs = a.wear; row.wearTag = b.wear;
          row.dedOurs = a.deduction; row.dedTag = b.deduction;
        }
        rows.push(row);
      }
    }
    if (typeof global.gc === 'function') global.gc();
  }
  process.stdout.write('.');
}
console.log('');

const by = (f) => rows.reduce((m, r) => { (m[f(r)] ||= []).push(r); return m; }, {});
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const r2 = (x) => Math.round(x * 100) / 100;

console.log('\npixel agreement with TAG crops (mean abs difference per channel, 0-255):');
for (const [k, list] of Object.entries(by((r) => `${r.task} ${r.key}`))) {
  const d = list.map((r) => r.diff).sort((a, b) => a - b);
  console.log(`  ${k.padEnd(12)} n=${String(list.length).padStart(3)}  mean ${r2(mean(d))}  median ${r2(d[Math.floor(d.length / 2)])}  worst ${r2(d[d.length - 1])}`);
}
if (WITH_MODELS) {
  console.log('\nmodel agreement (our crop vs TAG crop):');
  for (const [k, list] of Object.entries(by((r) => r.task))) {
    const dw = list.map((r) => Math.abs(r.wearOurs - r.wearTag));
    const dd = list.map((r) => Math.abs(r.dedOurs - r.dedTag));
    const flip = list.filter((r) => (r.wearOurs >= 0.5) !== (r.wearTag >= 0.5)).length;
    console.log(`  ${k.padEnd(8)} n=${list.length}  wear mean|diff| ${r2(mean(dw))}  max ${r2(Math.max(...dw))}  deduction mean|diff| ${r2(mean(dd))} pts  threshold flips ${flip}/${list.length}`);
  }
}
