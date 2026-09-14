#!/usr/bin/env node
/**
 * Software Grade harness.
 *
 * Runs the production detectors (src/lib/detectors.js) and adapter
 * (src/lib/softwareGrade.js) over the 507 local TAG reference photos and
 * scores them against scripts/harness/ground-truth.json.
 *
 * Usage:
 *   node scripts/harness/run.mjs [--label name] [--limit N] [--cert C1287305] [--cache dir] [--no-cache]
 *
 * Sign convention: every "error" is software − TAG. Positive = software too lenient.
 */
import { createCanvas, Image } from 'canvas';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzePixels } from '../../src/lib/detectors.js';
import { computeGrade, mapDingType } from '../../src/lib/softwareGrade.js';
import { ENGINE_VERSION, mergeSubgrades } from '../../src/lib/gradingEngine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PHOTOS = path.join(ROOT, 'scripts', 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map');
const GT_PATH = path.join(here, 'ground-truth.json');
const RESULTS_DIR = path.join(here, 'results');
const MAX_DIM = 1400; // must match src/lib/image-utils.js loadImg default

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const LABEL = opt('--label', 'run');
const LIMIT = Number(opt('--limit', 0)) || 0;
const ONLY = opt('--cert', null);
const USE_CACHE = !args.includes('--no-cache');
const CACHE_DIR = opt('--cache', path.join(os.tmpdir(), 'slabsense-harness-cache'));

// ── image loading (mirrors loadImg) ─────────────────────────────────────────
// node-canvas 3.x leaks native memory for every Image and every createCanvas()
// (measured 2026-09-14: ~9 MB per Image, ~6 MB per canvas, invisible to V8's GC).
// So the whole run shares ONE Image and ONE canvas; only the pixel buffer from
// getImageData is per-card, and that one V8 does free.
const sharedImg = new Image();
const sharedCanvas = createCanvas(MAX_DIM, MAX_DIM);
function loadShared(src) {
  return new Promise((resolve, reject) => {
    sharedImg.onload = () => resolve();
    sharedImg.onerror = (e) => reject(e || new Error(`decode failed: ${src}`));
    sharedImg.src = src;
  });
}
async function loadPixels(file) {
  const cachePath = path.join(CACHE_DIR, path.basename(file, '.jpg') + '.png');
  const cached = USE_CACHE && fs.existsSync(cachePath);
  await loadShared(cached ? cachePath : file);
  let w = sharedImg.width, h = sharedImg.height;
  if (Math.max(w, h) > MAX_DIM) { const s = MAX_DIM / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  sharedCanvas.width = w; sharedCanvas.height = h; // reassigning size resets the surface
  const ctx = sharedCanvas.getContext('2d');
  ctx.drawImage(sharedImg, 0, 0, w, h);
  if (!cached && USE_CACHE) { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cachePath, sharedCanvas.toBuffer('image/png')); }
  const { data } = ctx.getImageData(0, 0, w, h);
  sharedImg.src = ''; // release the decoded bitmap now, not at GC time
  return { data, w, h };
}

/** Force a GC when node was started with --expose-gc (npm run harness does). */
function releaseNative() { if (typeof global.gc === 'function') global.gc(); }

// ── helpers ─────────────────────────────────────────────────────────────────
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const bucketOf = (g) => (g >= 9 ? '9-10' : g >= 7 ? '7-8.5' : g >= 5 ? '5-6.5' : '1-4.5');
const GRADE_AXIS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10];
const DING_TYPES = ['CORNER', 'EDGE', 'PLAY_WEAR', 'CREASE', 'DENT', 'SCRATCH', 'PRINT_DEFECT', 'PIT', 'STAIN', 'TEAR'];

function softwareDingKey(d) { const t = mapDingType(d.type); return t ? `${d.side}|${t}` : null; }
function truthDingKey(d) { return `${d.side}|${d.engineType}`; }

/** multiset match on side|type: returns { matched, tpByKey } */
function matchDings(soft, truth) {
  const need = {};
  for (const d of truth) need[truthDingKey(d)] = (need[truthDingKey(d)] || 0) + 1;
  let matched = 0;
  const tpByKey = {};
  for (const d of soft) {
    const k = softwareDingKey(d);
    if (k && need[k] > 0) { need[k]--; matched++; tpByKey[k] = (tpByKey[k] || 0) + 1; }
  }
  return { matched, tpByKey };
}

// ── main ────────────────────────────────────────────────────────────────────
const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8'));
let certs = Object.keys(gt.certs);
if (ONLY) certs = certs.filter((c) => c === ONLY);
if (LIMIT) certs = certs.slice(0, LIMIT);
if (!certs.length) { console.error('no certs selected'); process.exit(1); }

let gitCommit = 'unknown';
try { gitCommit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}

console.log(`harness: ${certs.length} cards, label=${LABEL}, cache=${USE_CACHE ? CACHE_DIR : 'off'}`);
const t0 = Date.now();
const cards = [];
let i = 0;
for (const cert of certs) {
  const g = gt.certs[cert];
  const c = g.centering;
  const frontC = c.front.lrRatio == null ? { lrRatio: 50, tbRatio: 50 } : c.front;
  const backC = c.back.lrRatio == null ? { lrRatio: 50, tbRatio: 50 } : c.back;
  try {
    const fp = await loadPixels(path.join(PHOTOS, 'Front', g.images.front));
    const bp = await loadPixels(path.join(PHOTOS, 'Back', g.images.back));
    const fr = analyzePixels(fp, 'front', null, frontC);
    const br = analyzePixels(bp, 'back', null, backC);
    const grade = computeGrade(fr.allDings, br.allDings, frontC, backC, 'tag', null);
    const softDings = [...fr.allDings, ...br.allDings].filter((d) => d.type !== 'CENTERING');
    const m = matchDings(softDings, g.dings);
    const boundsOk = (b, p) => b.cardW >= p.w * 0.85 && b.cardH >= p.h * 0.85;
    cards.push({
      cert,
      tagGrade: g.grade,
      tagLabel: g.label,
      softGrade: grade.overall.grade,
      softScore: grade.rawScore,
      gradeError: r2(grade.overall.grade - g.grade),
      subgrades: grade.subgrades,
      tag: g.tag,
      capsApplied: grade.overall.capsApplied,
      softDings: softDings.map((d) => ({ side: d.side, type: d.type, engineType: mapDingType(d.type), severity: d.severity, location: d.location })),
      truthDings: g.dings.map((d) => ({ side: d.side, engineType: d.engineType, type: d.type, location: d.location })),
      dingMatched: m.matched,
      bounds: { front: fr.bounds, back: br.bounds, frontOk: boundsOk(fr.bounds, fp), backOk: boundsOk(br.bounds, bp) },
      centeringUsed: { front: frontC, back: backC, frontMissing: c.front.lrRatio == null, backMissing: c.back.lrRatio == null },
    });
  } catch (e) {
    cards.push({ cert, tagGrade: g.grade, error: String((e && e.message) || e) });
  }
  releaseNative();
  if (++i % 25 === 0 || i === certs.length) process.stdout.write(`  ${i}/${certs.length} (${Math.round((Date.now() - t0) / 1000)}s, rss ${Math.round(process.memoryUsage().rss / 1048576)} MB)\n`);
}

// ── summary ─────────────────────────────────────────────────────────────────
const ok = cards.filter((c) => !c.error);
const errs = ok.map((c) => c.gradeError);
const within = (t) => r2(100 * errs.filter((e) => Math.abs(e) <= t + 1e-9).length / errs.length);

const byBucket = {};
for (const c of ok) {
  const b = bucketOf(c.tagGrade);
  (byBucket[b] ||= []).push(c.gradeError);
}
const bucketSummary = Object.fromEntries(Object.entries(byBucket).map(([b, es]) => [b, {
  cards: es.length, mae: r2(mean(es.map(Math.abs))), signed: r2(mean(es)),
  within05: r2(100 * es.filter((e) => Math.abs(e) <= 0.5 + 1e-9).length / es.length),
}]));

const confusion = {};
for (const c of ok) { (confusion[c.tagGrade] ||= {}); confusion[c.tagGrade][c.softGrade] = (confusion[c.tagGrade][c.softGrade] || 0) + 1; }

// subgrades: software 0-100 ×10 vs TAG 1000-pt rollups
const subErr = { corners: [], edges: [], surface: [], centering: [], surfaceFront: [], surfaceBack: [] };
for (const c of ok) {
  const m = mergeSubgrades(c.subgrades);
  const cent = c.subgrades.backCentering == null ? c.subgrades.frontCentering : c.subgrades.frontCentering * 0.65 + c.subgrades.backCentering * 0.35;
  const push = (k, soft100, tag1000) => { if (tag1000 != null && soft100 != null) subErr[k].push(soft100 * 10 - tag1000); };
  push('corners', m.corners, c.tag.corners); push('edges', m.edges, c.tag.edges); push('surface', m.surface, c.tag.surface);
  push('centering', cent, c.tag.centering);
  push('surfaceFront', c.subgrades.frontSurface, c.tag.surfaceFront); push('surfaceBack', c.subgrades.backSurface, c.tag.surfaceBack);
}
const subSummary = Object.fromEntries(Object.entries(subErr).map(([k, es]) => [k, { n: es.length, mae: r2(mean(es.map(Math.abs))), signed: r2(mean(es)) }]));

// dings: per side|type precision / recall
const dingStats = {};
for (const side of ['FRONT', 'BACK']) for (const t of DING_TYPES) dingStats[`${side}|${t}`] = { truth: 0, soft: 0, tp: 0 };
for (const c of ok) {
  for (const d of c.truthDings) { const k = `${d.side}|${d.engineType}`; if (dingStats[k]) dingStats[k].truth++; }
  for (const d of c.softDings) { const k = `${d.side}|${d.engineType}`; if (dingStats[k]) dingStats[k].soft++; }
  const m = matchDings(c.softDings.map((d) => ({ side: d.side, type: d.type })), c.truthDings);
  for (const [k, n] of Object.entries(m.tpByKey)) if (dingStats[k]) dingStats[k].tp += n;
}
for (const s of Object.values(dingStats)) { s.precision = s.soft ? r2(s.tp / s.soft) : null; s.recall = s.truth ? r2(s.tp / s.truth) : null; }
const cardsWithSoftDings = ok.filter((c) => c.softDings.length).length;
const cardsWithTruthDings = ok.filter((c) => c.truthDings.length).length;

const summary = {
  cards: ok.length, errors: cards.length - ok.length,
  grade: { mae: r2(mean(errs.map(Math.abs))), signed: r2(mean(errs)), exact: within(0), within05: within(0.5), within10: within(1.0) },
  byBucket: bucketSummary,
  confusion,
  subgrades: subSummary,
  dings: dingStats,
  dingCards: { softwareAny: cardsWithSoftDings, truthAny: cardsWithTruthDings },
  boundsFlagged: ok.filter((c) => !c.bounds.frontOk || !c.bounds.backOk).map((c) => c.cert),
  centeringMissing: ok.filter((c) => c.centeringUsed.frontMissing || c.centeringUsed.backMissing).length,
  seconds: Math.round((Date.now() - t0) / 1000),
};

const meta = { date: new Date().toISOString(), label: LABEL, gitCommit, engineVersion: ENGINE_VERSION, cards: ok.length, sign: 'software - TAG (positive = software too lenient)' };
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const stem = `${new Date().toISOString().slice(0, 10)}-${LABEL}`;
fs.writeFileSync(path.join(RESULTS_DIR, `${stem}.json`), JSON.stringify({ meta, summary, cards }, null, 1));
fs.writeFileSync(path.join(RESULTS_DIR, `${stem}.md`), renderMd(meta, summary));
console.log(renderMd(meta, summary));
console.log(`wrote results/${stem}.json and .md`);

function renderMd(meta, s) {
  const L = [];
  L.push(`# Harness run: ${meta.label} (${meta.date.slice(0, 10)})`, '');
  L.push(`commit ${meta.gitCommit} · engine ${meta.engineVersion} · ${s.cards} cards · ${s.errors} errors · ${s.seconds}s`, '');
  L.push(`Sign: ${meta.sign}`, '');
  L.push('## Grade', '', '| MAE | signed | exact % | ≤0.5 % | ≤1.0 % |', '|---|---|---|---|---|');
  L.push(`| ${s.grade.mae} | ${s.grade.signed} | ${s.grade.exact} | ${s.grade.within05} | ${s.grade.within10} |`, '');
  L.push('| TAG bucket | cards | MAE | signed | ≤0.5 % |', '|---|---|---|---|---|');
  for (const b of ['9-10', '7-8.5', '5-6.5', '1-4.5']) { const v = s.byBucket[b]; if (v) L.push(`| ${b} | ${v.cards} | ${v.mae} | ${v.signed} | ${v.within05} |`); }
  L.push('', '## Confusion (rows TAG, cols software)', '', `| TAG \\ SW | ${GRADE_AXIS.join(' | ')} |`, `|---|${GRADE_AXIS.map(() => '---').join('|')}|`);
  for (const g of GRADE_AXIS) { const row = s.confusion[g]; if (!row) continue; L.push(`| **${g}** | ${GRADE_AXIS.map((x) => row[x] || '').join(' | ')} |`); }
  L.push('', '## Subgrades (software×10 − TAG rollup, 1000-pt)', '', '| category | n | MAE | signed |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(s.subgrades)) L.push(`| ${k} | ${v.n} | ${v.mae} | ${v.signed} |`);
  L.push('', '## Dings by side|type', '', '| key | TAG | software | matched | precision | recall |', '|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(s.dings)) if (v.truth || v.soft) L.push(`| ${k} | ${v.truth} | ${v.soft} | ${v.tp} | ${v.precision ?? '-'} | ${v.recall ?? '-'} |`);
  L.push('', `Cards with ≥1 software ding: ${s.dingCards.softwareAny} · with ≥1 TAG ding: ${s.dingCards.truthAny}`);
  L.push(`Bounds flagged (<85% of frame): ${s.boundsFlagged.length}${s.boundsFlagged.length ? ' — ' + s.boundsFlagged.slice(0, 20).join(', ') : ''}`);
  L.push(`Cards with missing TAG centering (50/50 assumed): ${s.centeringMissing}`, '');
  return L.join('\n');
}
