#!/usr/bin/env node
/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Audit of the legacy pixel surface check (detectSurfaceDings in src/lib/detectors.js) that still feeds
 * the free grade's surface subgrades. For each of the 507 harness cards and each side it records the
 * check's verdict (none / minor / moderate / severe) and its raw anomaly and scratch rates, against
 * TAG's own per-side surface score and the surface defects TAG marked on that side.
 * Then every card is graded twice by the shipped adapter + engine: with the check's surface dings and
 * without them, so the effect on the grade is measured, per company.
 *
 *   node --expose-gc scripts/harness/surface-detector-audit.mjs [--limit N]
 *
 * Writes results/<date>-surface-detector-audit.json. Studio scans, not phone photos: phone noise and
 * glare can only add false flags, so this is the check's best case.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Image } from 'canvas';
import { analyzePixels } from '../../src/lib/detectors.js';
import { computeGrade, mapDingType } from '../../src/lib/softwareGrade.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const DATA_DIR = process.env.SLABSENSE_DATA_DIR || path.join(ROOT, '..', 'SlabSense-data');
const PHOTOS = path.join(DATA_DIR, 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map');
const CACHE_DIR = path.join(os.tmpdir(), 'slabsense-harness-cache');
const MAX_DIM = 1400;
const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 0;

// One Image and one canvas for the whole run (node-canvas leaks per instance; see README).
const img = new Image();
const canvas = createCanvas(MAX_DIM, MAX_DIM);
async function loadPixels(file) {
  const cachePath = path.join(CACHE_DIR, path.basename(file, '.jpg') + '.png');
  const src = fs.existsSync(cachePath) ? cachePath : file;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  let w = img.width, h = img.height;
  if (Math.max(w, h) > MAX_DIM) { const s = MAX_DIM / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  img.src = '';
  return { data, w, h };
}

const gt = JSON.parse(fs.readFileSync(path.join(here, 'ground-truth.json'), 'utf8'));
let certs = Object.keys(gt.certs);
if (LIMIT) certs = certs.slice(0, LIMIT);
const isSurface = (d) => { const t = mapDingType(d.type); return t && !['CORNER', 'EDGE'].includes(t); };
const COMPANIES = ['tag', 'psa', 'bgs', 'cgc', 'sgc'];

const sides = [], cards = [];
let n = 0;
for (const cert of certs) {
  const g = gt.certs[cert];
  const c = g.centering;
  const fc = c.front.lrRatio == null ? { lrRatio: 50, tbRatio: 50 } : c.front;
  const bc = c.back.lrRatio == null ? { lrRatio: 50, tbRatio: 50 } : c.back;
  try {
    const fr = analyzePixels(await loadPixels(path.join(PHOTOS, 'Front', g.images.front)), 'front', null, fc);
    const br = analyzePixels(await loadPixels(path.join(PHOTOS, 'Back', g.images.back)), 'back', null, bc);
    for (const [side, r, tagScore] of [['FRONT', fr, g.tag.surfaceFront], ['BACK', br, g.tag.surfaceBack]]) {
      const sev = r.surface.dings[0]?.severity || 0;
      const tagMarks = g.dings.filter((d) => d.side === side && !['CORNER', 'EDGE'].includes(d.engineType)).length;
      sides.push({ cert, side, sev, anom: r.surface.anomalyRate, scratch: r.surface.scratchRate, holo: r.surface.isHolo, tagScore, tagMarks });
    }
    const all = [...fr.allDings, ...br.allDings];
    const withS = {}, without = {};
    for (const co of COMPANIES) {
      withS[co] = computeGrade(fr.allDings, br.allDings, fc, bc, co, null).grade.grade;
      without[co] = computeGrade(fr.allDings.filter((d) => !isSurface(d)), br.allDings.filter((d) => !isSurface(d)), fc, bc, co, null).grade.grade;
    }
    cards.push({ cert, tagGrade: g.grade, surfaceDings: all.filter(isSurface).length, withS, without });
  } catch (e) { console.warn(cert, e.message); }
  if (++n % 50 === 0) { if (global.gc) global.gc(); process.stdout.write(`${n} `); }
}
console.log();

// ── summaries ──
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
function auc(pos, neg) { // probability a random positive outranks a random negative (ties half)
  let w = 0; for (const p of pos) for (const q of neg) w += p > q ? 1 : p === q ? 0.5 : 0;
  return pos.length && neg.length ? r2(w / (pos.length * neg.length)) : null;
}
function spearman(a, b) {
  const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = []; idx.forEach(([, i], k) => { r[i] = k; }); return r; };
  const ra = rank(a), rb = rank(b), ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return r2(num / Math.sqrt(da * db));
}
const bySide = {};
for (const S of ['FRONT', 'BACK']) {
  const rows = sides.filter((s) => s.side === S);
  const marked = rows.filter((s) => s.tagMarks > 0), clean = rows.filter((s) => s.tagMarks === 0);
  const flagged = rows.filter((s) => s.sev > 0);
  bySide[S] = {
    n: rows.length,
    tagMarkedSides: marked.length,
    flagged: flagged.length,
    flaggedBySeverity: [1, 2, 3].map((v) => rows.filter((s) => s.sev === v).length),
    precision: flagged.length ? r2(flagged.filter((s) => s.tagMarks > 0).length / flagged.length) : null,
    recall: marked.length ? r2(marked.filter((s) => s.sev > 0).length / marked.length) : null,
    falseFlagRateOnCleanSides: clean.length ? r2(clean.filter((s) => s.sev > 0).length / clean.length) : null,
    aucAnomaly: auc(marked.map((s) => s.anom), clean.map((s) => s.anom)),
    aucScratch: auc(marked.map((s) => s.scratch), clean.map((s) => s.scratch)),
    spearmanAnomVsTagScore: spearman(rows.map((s) => -s.anom), rows.map((s) => s.tagScore)),
    meanTagScoreFlagged: r2(mean(flagged.map((s) => s.tagScore))),
    meanTagScoreUnflagged: r2(mean(rows.filter((s) => s.sev === 0).map((s) => s.tagScore))),
  };
}
const effect = {};
for (const co of ['tag']) {
  const err = (k) => cards.map((c) => c[k][co] - c.tagGrade);
  effect[co] = { maeWith: r2(mean(err('withS').map(Math.abs))), biasWith: r2(mean(err('withS'))), maeWithout: r2(mean(err('without').map(Math.abs))), biasWithout: r2(mean(err('without'))) };
}
for (const co of COMPANIES) {
  const changed = cards.filter((c) => c.withS[co] !== c.without[co]);
  effect[co] = { ...(effect[co] || {}), cardsChanged: changed.length, meanDropWhenChanged: r2(mean(changed.map((c) => c.without[co] - c.withS[co]))), maxDrop: Math.max(0, ...changed.map((c) => c.without[co] - c.withS[co])) };
}
const summary = { cards: cards.length, bySide, effect, note: 'TAG-marked = TAG lists at least one surface defect on that side. Studio scans.' };
const date = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(here, 'results', `${date}-surface-detector-audit.json`), JSON.stringify({ summary, sides, cards }, null, 1));
console.log(JSON.stringify(summary, null, 2));
