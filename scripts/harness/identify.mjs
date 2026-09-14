#!/usr/bin/env node
/**
 * Identification bake-off: scores four ranking strategies on the 507 TAG front photos.
 *
 *   node scripts/harness/identify.mjs [--label name] [--limit N] [--cert C] [--db local|bucket] [--skip-ocr] [--skip-pixel]
 *
 * Variants (spec §5.1): current | margin | ocr | pixel. Truth: scripts/harness/id-truth.json.
 * DB: scripts/card-db/out/ (default, after `cards:build-initial --dry-run`) or the bucket.
 * Reference images for `pixel`: public/card-images/{set}/{number}.png.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas, Image } from 'canvas';
import { createWorker, PSM } from 'tesseract.js';
import { decodeF16 } from '../../src/lib/f16.js';
import { loadCardDb, topK } from '../../src/lib/card-db-client.js';
import { getExtractor } from '../card-db/embed.mjs';
import { loadEnv } from '../card-db/env.mjs';

loadEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const CACHE = path.join(os.tmpdir(), 'slabsense-harness-cache');
const PHOTOS = path.join(ROOT, 'scripts', 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map', 'Front');
const REF_DIR = path.join(ROOT, 'public', 'card-images');
const OUT_DIR = path.join(ROOT, 'scripts', 'card-db', 'out');
const RESULTS = path.join(here, 'results');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LABEL = opt('--label', 'identify');
const LIMIT = Number(opt('--limit', 0)) || 0;
const ONLY = opt('--cert', null);
const DB_SRC = opt('--db', 'local');
const SKIP_OCR = args.includes('--skip-ocr');
const SKIP_PIXEL = args.includes('--skip-pixel');
const K = 20;

// ── DB ──────────────────────────────────────────────────────────────────────
async function loadLocalDb() {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8'));
  const dim = manifest.dim; const matrix = new Float32Array(manifest.count * dim); const ids = []; const cards = {}; let row = 0;
  for (const s of manifest.shards) {
    const f = decodeF16(fs.readFileSync(path.join(OUT_DIR, `${s.id}.f16`)));
    const meta = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${s.id}.meta.json`), 'utf8'));
    matrix.set(f, row * dim); row += meta.count; ids.push(...meta.ids); Object.assign(cards, meta.cards);
  }
  return { matrix, ids, cards, meta: { version: manifest.version, model: manifest.model, dim, count: manifest.count, source: 'local' } };
}
const db = DB_SRC === 'bucket'
  ? await loadCardDb({ baseUrl: `${process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL}/storage/v1/object/public/card-db` })
  : await loadLocalDb();
console.log(`db: ${db.meta.count} cards (${db.meta.source} v${db.meta.version})`);

// name/number index for "is this card in the DB at all"
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const numerator = (s) => String(s || '').split('/')[0].trim().replace(/^0+(?=\d)/, '').toUpperCase();
const byNameNum = new Set(db.ids.map((id) => `${norm(db.cards[id]?.name)}|${numerator(db.cards[id]?.number || id.split('-').slice(1).join('-'))}`));

// ── shared canvas / image (node-canvas leaks per instance; see scripts/harness/README.md) ──
const img = new Image();
const cv = createCanvas(500, 700);
const load = (src) => new Promise((res, rej) => { img.onload = res; img.onerror = (e) => rej(e || new Error('decode ' + src)); img.src = src; });
const LUM = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * TAG studio photos have a solid orange margin around the card. Find the card box by scanning
 * inward from each edge until most samples stop matching the border color. This stands in for
 * the user's manual crop (production feeds the crop, so no margin exists there). The app's
 * findBounds() is NOT used here: it miscuts ~13% of these photos (review F11).
 */
function marginCrop(d, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  for (let x = 0; x < w; x += 4) for (const y of [1, 2, h - 3, h - 2]) { const p = px(x, y); r += p[0]; g += p[1]; b += p[2]; n++; }
  for (let y = 0; y < h; y += 4) for (const x of [1, 2, w - 3, w - 2]) { const p = px(x, y); r += p[0]; g += p[1]; b += p[2]; n++; }
  r /= n; g /= n; b /= n;
  const isBorder = (x, y) => { const p = px(x, y); return Math.abs(p[0] - r) + Math.abs(p[1] - g) + Math.abs(p[2] - b) < 60; };
  const rowIsBorder = (y) => { let m = 0, t = 0; for (let x = Math.round(w * 0.1); x < w * 0.9; x += 4) { t++; if (isBorder(x, y)) m++; } return m / t > 0.6; };
  const colIsBorder = (x) => { let m = 0, t = 0; for (let y = Math.round(h * 0.1); y < h * 0.9; y += 4) { t++; if (isBorder(x, y)) m++; } return m / t > 0.6; };
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < h * 0.2 && rowIsBorder(top)) top++;
  while (bottom > h * 0.8 && rowIsBorder(bottom)) bottom--;
  while (left < w * 0.2 && colIsBorder(left)) left++;
  while (right > w * 0.8 && colIsBorder(right)) right--;
  return { left, top, right: right + 1, bottom: bottom + 1, cardW: right + 1 - left, cardH: bottom + 1 - top };
}

/** Load `src`, crop the card (margin-based for TAG photos, none for reference images), draw to 500×700.
 *  Returns the 500×700 RGBA data; when `keepFull` is set, also leaves the native-resolution crop in `cvFull`. */
const cvFull = createCanvas(16, 16);
async function draw500x700(src, cropMargin, keepFull = false) {
  await load(src);
  const w = img.width, h = img.height;
  let box = { left: 0, top: 0, cardW: w, cardH: h };
  if (cropMargin) {
    cv.width = w; cv.height = h; const fx = cv.getContext('2d'); fx.drawImage(img, 0, 0);
    box = marginCrop(fx.getImageData(0, 0, w, h).data, w, h);
  }
  if (keepFull) { cvFull.width = box.cardW; cvFull.height = box.cardH; cvFull.getContext('2d').drawImage(img, box.left, box.top, box.cardW, box.cardH, 0, 0, box.cardW, box.cardH); }
  cv.width = CW; cv.height = CH; const ctx = cv.getContext('2d');
  ctx.drawImage(img, box.left, box.top, box.cardW, box.cardH, 0, 0, CW, CH);
  const d = ctx.getImageData(0, 0, CW, CH).data; img.src = '';
  return d;
}

// Working card size for pixel comparison and the bottom strip (number line) within it.
const CW = 1000, CH = 1400;
const SW = CW, SY0 = Math.round(CH * 0.91), SH = CH - SY0; // bottom 9% → 1000×126
function stripFeature(d) {
  const W = SW, Y0 = SY0, H = SH; const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = LUM(d, ((Y0 + y) * W + x) * 4);
  const I = new Float64Array((W + 1) * (H + 1)), I2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) { let s = 0, s2 = 0; for (let x = 1; x <= W; x++) { const v = g[(y - 1) * W + x - 1]; s += v; s2 += v * v; I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x] + s; I2[y * (W + 1) + x] = I2[(y - 1) * (W + 1) + x] + s2; } }
  const R = 12; const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1); const n = (x1 - x0) * (y1 - y0);
    const S = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    const S2 = I2[y1 * (W + 1) + x1] - I2[y0 * (W + 1) + x1] - I2[y1 * (W + 1) + x0] + I2[y0 * (W + 1) + x0];
    const m = S / n, sd = Math.sqrt(Math.max(0, S2 / n - m * m));
    out[y * W + x] = (g[y * W + x] - m) / (sd + 5);
  }
  return out;
}
/**
 * Ink boxes: inside the left 30% and right 30% of the reference strip (where numbers sit),
 * find the bounding box of dark pixels. That box (number + set symbol) is the template.
 * Falls back to the whole window when no plausible ink box is found.
 */
function inkBoxes(feat) {
  // "ink" = strong local contrast in the normalized strip, so dark-on-light (vintage) and
  // light-on-dark (modern full-art) text both count.
  const W = SW, H = SH; const win = Math.round(W * 0.3); const boxes = []; const T = 1.4;
  for (const x0 of [0, W - win]) {
    // per-row ink count inside the window (ignore the outer 12 px: card edge / rounded corner)
    const rows = new Int32Array(H);
    for (let y = 0; y < H; y++) for (let x = x0 + 12; x < x0 + win - 12; x++) if (Math.abs(feat[y * W + x]) > T) rows[y]++;
    // lowest band of ink rows: skip near-empty rows from the bottom, then take rows until a ≥3-row gap
    let y2 = H - 4; while (y2 > 0 && rows[y2] < 4) y2--;
    let y1 = y2, gap = 0; while (y1 > 0) { if (rows[y1 - 1] < 4) { if (++gap >= 3) break; } else gap = 0; y1--; }
    let minX = 1e9, maxX = -1;
    for (let y = y1; y <= y2; y++) for (let x = x0 + 12; x < x0 + win - 12; x++) if (Math.abs(feat[y * W + x]) > T) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    const bw = maxX - minX + 1, bh = y2 - y1 + 1;
    if (maxX >= 0 && bw >= 24 && bh >= 8 && bh <= 45) boxes.push({ x0: Math.max(0, minX - 6), y0: Math.max(0, y1 - 4), w: Math.min(W, maxX + 7) - Math.max(0, minX - 6), h: Math.min(H, y2 + 5) - Math.max(0, y1 - 4) });
    else boxes.push({ x0, y0: 0, w: win, h: H });
  }
  return boxes;
}
/** NCC of the photo strip `a` against each template box of the reference strip `b`; ±12 px x, ±6 px y. Best box wins. */
function ncc(a, ref) {
  const W = SW, H = SH; let best = -1;
  for (const bx of ref.boxes) {
    for (let dy = -12; dy <= 12; dy += 2) for (let dx = -24; dx <= 24; dx += 4) {
      let dot = 0, na = 0, nb = 0;
      for (let y = bx.y0; y < bx.y0 + bx.h; y++) {
        const ya = y + dy; if (ya < 0 || ya >= H) continue;
        for (let x = bx.x0; x < bx.x0 + bx.w; x++) { const xa = x + dx; if (xa < 0 || xa >= W) continue; const va = a[ya * W + xa], vb = ref.feat[y * W + x]; dot += va * vb; na += va * va; nb += vb * vb; }
      }
      const v = dot / (Math.sqrt(na * nb) || 1); if (v > best) best = v;
    }
  }
  return best;
}
const refCache = new Map();
async function refFeature(id) {
  if (refCache.has(id)) return refCache.get(id);
  const c = db.cards[id] || {}; const p = path.join(REF_DIR, c.set || id.split('-')[0], `${c.number || id.split('-').slice(1).join('-')}.png`);
  let f = null;
  if (fs.existsSync(p)) { try { const feat = stripFeature(await draw500x700(p, false)); f = { feat, boxes: inkBoxes(feat) }; } catch { f = null; } }
  refCache.set(id, f); return f;
}

// ── OCR ─────────────────────────────────────────────────────────────────────
let worker = null;
/** OCR the set number from the native-resolution crop in `cvFull` (bottom 8% of the card). */
async function ocrNumerator() {
  // Note: tesseract's LSTM engine ignores character whitelists, so none is set; the regex does the filtering.
  if (!worker) worker = await createWorker('eng', 1, { cachePath: path.join(ROOT, 'models', 'tesseract-cache') });
  const W = cvFull.width, H = cvFull.height;
  const sy = Math.round(H * 0.92), sh = H - sy;           // number line lives in the bottom 8%
  const S = Math.max(1, Math.min(3, 130 / sh));           // scale the strip to ~130 px tall
  const strip = createCanvas(Math.round(W * S), Math.round(sh * S));
  const sctx = strip.getContext('2d'); sctx.imageSmoothingEnabled = true; sctx.drawImage(cvFull, 0, sy, W, sh, 0, 0, strip.width, strip.height);
  // thresholded copy (ink → black, rest → white) reads printed numbers better than color
  const bw = createCanvas(strip.width, strip.height); const bx = bw.getContext('2d'); bx.drawImage(strip, 0, 0);
  const id = bx.getImageData(0, 0, bw.width, bw.height); const p = id.data;
  for (let i = 0; i < p.length; i += 4) { const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; const o = v < 110 ? 0 : 255; p[i] = p[i + 1] = p[i + 2] = o; }
  bx.putImageData(id, 0, 0);
  const attempts = [[bw, PSM.SINGLE_BLOCK], [strip, PSM.SINGLE_LINE], [strip, PSM.SPARSE_TEXT]];
  for (const [canvas, psm] of attempts) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas.toBuffer('image/png'));
    const m = (data.text || '').match(/(\d{1,3})\s*\/\s*(\d{1,3})/); if (m) return numerator(m[1]);
  }
  return null;
}

// ── variants ────────────────────────────────────────────────────────────────
const statusCurrent = (top) => (top >= 0.85 ? 'high' : top >= 0.75 ? 'medium' : 'unknown');
const statusMargin = (top, second) => (top >= 0.80 && top - second >= 0.03 ? 'high' : top >= 0.75 ? 'medium' : 'unknown');
const rerank = (hits, bonus) => hits.map((h) => ({ ...h, s2: h.s + (bonus(h) || 0) })).sort((a, b) => b.s2 - a.s2);

// ── run ─────────────────────────────────────────────────────────────────────
const truth = JSON.parse(fs.readFileSync(path.join(here, 'id-truth.json'), 'utf8')).certs;
let certs = Object.keys(truth).sort(); if (ONLY) certs = certs.filter((c) => c === ONLY); if (LIMIT) certs = certs.slice(0, LIMIT);
const extractor = await getExtractor();
let gitCommit = 'unknown'; try { gitCommit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}
const VARIANTS = ['current', 'margin', ...(SKIP_OCR ? [] : ['ocr']), ...(SKIP_PIXEL ? [] : ['pixel'])];
const stats = Object.fromEntries(VARIANTS.map((v) => [v, { top1Exact: 0, top1ExactInDb: 0, inTop5InDb: 0, wrongHigh: 0, unknownButInDb: 0, ms: 0 }]));
const cards = []; const notInDb = []; let n = 0; const t0 = Date.now();

for (const cert of certs) {
  const t = truth[cert];
  const pngCache = path.join(CACHE, path.basename(t.image, '.jpg') + '.png');
  const src = fs.existsSync(pngCache) ? pngCache : path.join(PHOTOS, t.image);
  const tName = norm(t.name), tNum = numerator(t.number);
  const inDb = byNameNum.has(`${tName}|${tNum}`);
  if (!inDb) notInDb.push({ cert, name: t.name, number: t.number, set: t.set });
  const isMatch = (id) => norm(db.cards[id]?.name) === tName && numerator(db.cards[id]?.number || id.split('-').slice(1).join('-')) === tNum;

  const q = Array.from((await extractor(src, { pooling: 'mean', normalize: true })).data);
  const hits = topK(db, q, K);
  const d = (VARIANTS.includes('ocr') || VARIANTS.includes('pixel')) ? await draw500x700(src, true, true) : null;
  const rec = { cert, truth: { name: t.name, number: t.number, set: t.set }, inDb, top: hits.slice(0, 5).map((h) => ({ id: h.id, s: +h.s.toFixed(4) })), variants: {} };

  for (const v of VARIANTS) {
    const tv = Date.now();
    let ranked, status;
    if (v === 'current') { ranked = hits.map((h) => ({ ...h, s2: h.s })); status = statusCurrent(ranked[0].s2); }
    else if (v === 'margin') { ranked = hits.map((h) => ({ ...h, s2: h.s })); status = statusMargin(ranked[0].s2, ranked[1]?.s2 ?? 0); }
    else if (v === 'ocr') { const read = await ocrNumerator(); ranked = rerank(hits, (h) => (read && numerator(db.cards[h.id]?.number || h.id.split('-').slice(1).join('-')) === read ? 0.15 : 0)); status = statusMargin(ranked[0].s2, ranked[1]?.s2 ?? 0); rec.ocrRead = read; }
    else if (v === 'pixel') { const qf = stripFeature(d); const boosts = {}; let found = 0; for (const h of hits) { const rf = await refFeature(h.id); if (rf) found++; boosts[h.id] = rf ? 0.25 * Math.max(0, ncc(qf, rf)) : 0; } ranked = rerank(hits, (h) => boosts[h.id]); status = statusMargin(ranked[0].s2, ranked[1]?.s2 ?? 0); rec.pixel = { refFound: found, boosts: hits.slice(0, 5).map((h) => ({ id: h.id, boost: +boosts[h.id].toFixed(3), match: isMatch(h.id) })) }; }
    const top1 = ranked[0].id; const ok = isMatch(top1); const top5 = ranked.slice(0, 5).some((h) => isMatch(h.id));
    const s = stats[v]; s.ms += Date.now() - tv;
    if (ok) s.top1Exact++; if (ok && inDb) s.top1ExactInDb++; if (top5 && inDb) s.inTop5InDb++;
    if (status === 'high' && !ok) s.wrongHigh++; if (status === 'unknown' && inDb) s.unknownButInDb++;
    rec.variants[v] = { top1, status, ok, top5 };
  }
  cards.push(rec);
  if (++n % 25 === 0 || n === certs.length) console.log(`  ${n}/${certs.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
}
if (worker) await worker.terminate();

const N = cards.length, inDbN = cards.filter((c) => c.inDb).length;
const summary = { cards: N, inDb: inDbN, notInDb: N - inDbN, variants: {} };
for (const v of VARIANTS) { const s = stats[v]; summary.variants[v] = { top1Exact: s.top1Exact, top1ExactPct: +(100 * s.top1Exact / N).toFixed(1), top1ExactInDb: s.top1ExactInDb, top1ExactInDbPct: +(100 * s.top1ExactInDb / (inDbN || 1)).toFixed(1), inTop5InDb: s.inTop5InDb, inTop5InDbPct: +(100 * s.inTop5InDb / (inDbN || 1)).toFixed(1), wrongHigh: s.wrongHigh, unknownButInDb: s.unknownButInDb, msPerCard: +(s.ms / N).toFixed(0) }; }
const bySet = {}; for (const c of notInDb) (bySet[c.set] ||= []).push(`${c.name} ${c.number}`);

const meta = { date: new Date().toISOString(), label: LABEL, gitCommit, db: db.meta, cards: N };
fs.mkdirSync(RESULTS, { recursive: true });
const stem = `${meta.date.slice(0, 10)}-${LABEL}`;
fs.writeFileSync(path.join(RESULTS, `${stem}.json`), JSON.stringify({ meta, summary, cards }, null, 1));
const L = [`# Identification bake-off: ${LABEL} (${meta.date.slice(0, 10)})`, '', `commit ${gitCommit} · DB ${db.meta.source} v${db.meta.version} (${db.meta.count} cards) · ${N} photos · ${inDbN} in DB, ${N - inDbN} not in DB`, '',
  '| variant | top-1 exact (all) | top-1 exact (in DB) | in top-5 (in DB) | high but wrong | unknown but in DB | ms/card |', '|---|---|---|---|---|---|---|'];
for (const [v, s] of Object.entries(summary.variants)) L.push(`| ${v} | ${s.top1Exact} (${s.top1ExactPct}%) | ${s.top1ExactInDb} (${s.top1ExactInDbPct}%) | ${s.inTop5InDb} (${s.inTop5InDbPct}%) | ${s.wrongHigh} | ${s.unknownButInDb} | ${s.msPerCard} |`);
L.push('', `## Not in DB (${N - inDbN}) by TAG set`, ''); for (const [set, list] of Object.entries(bySet).sort((a, b) => b[1].length - a[1].length)) L.push(`- **${set}** (${list.length}): ${list.slice(0, 6).join('; ')}${list.length > 6 ? '; …' : ''}`);
L.push('', 'Rules: exact = name and set number match TAG. "in DB" = a card with that name and number exists in the DB. Status rules per spec §5.1. Studio photos only.', '');
fs.writeFileSync(path.join(RESULTS, `${stem}.md`), L.join('\n'));
console.log(L.slice(0, 10).join('\n')); console.log(`wrote results/${stem}.json and .md`);
