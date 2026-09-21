#!/usr/bin/env node
/**
 * Calibrates the surface deduction model's points -> severity cut lines on
 * the DIG harness, with TAG's own surface markers standing in for Claude's
 * boxes (perfect detection, so this isolates the severity mapping).
 *
 * For every harness card: corner/edge dings from the shipped models
 * (model-predictions-v3.json), TAG's centering, and its surface markers from
 * surface-boxes.json given a severity four ways —
 *   none      no surface defects at all (what the free path does today)
 *   ai-like   every surface defect "moderate" (a fixed guess)
 *   tag-pts   TAG's actual points through the cut lines (upper bound)
 *   model     the regressor's points through the cut lines (what ships)
 * — and graded. Then the cut lines are scaled up and down to pick the scale.
 *
 *   node scripts/harness/surface-sweep.mjs [--grid]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGrade } from '../../src/lib/softwareGrade.js';
import { slotsToDings, mergeModelDings } from '../../src/lib/corner-edge-model.js';
import { surfaceDeductionPoints, severityFromPoints, SURFACE_SEVERITY_CUTS } from '../../api/_lib/surfaceDeduction.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(here, 'results');
const args = process.argv.slice(2);
const GRID = args.includes('--grid');

const base = JSON.parse(fs.readFileSync(path.join(RESULTS, '2026-09-17-2026-09-17-baseline-engine11.json'), 'utf8'));
const preds = JSON.parse(fs.readFileSync(path.join(RESULTS, 'model-predictions-v3.json'), 'utf8'));
const splits = JSON.parse(fs.readFileSync(path.join(here, 'card-splits.json'), 'utf8'));
const boxes = JSON.parse(fs.readFileSync(path.join(here, 'surface-boxes.json'), 'utf8'));
const byCert = {};
for (const b of boxes) (byCert[b.cert] ||= []).push(b);

const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const bucketOf = (g) => (g >= 9 ? '9-10' : g >= 7 ? '7-8.5' : g >= 5 ? '5-6.5' : '1-4.5');

/** TAG marker -> engine defect in the AI-path shape (centre + size in % of the card). */
function toDefect(b) {
  return { side: b.side, type: b.cls, location: null, x: (b.x + b.w / 2) * 100, y: (b.y + b.h / 2) * 100, width: b.w * 100, height: b.h * 100, description: 'TAG marker', tagPoints: b.deduction };
}

const cards = base.cards.filter((c) => !c.error && preds.cards[c.cert] && !preds.cards[c.cert].error);
function score(mode, cuts = SURFACE_SEVERITY_CUTS, keep = false) {
  const rows = [];
  for (const card of cards) {
    const p = preds.cards[card.cert];
    const surface = (byCert[card.cert] || []).map(toDefect).map((d) => {
      if (mode === 'none') return null;
      if (mode === 'ai-like') return { ...d, severity: 'moderate' };
      const pts = mode === 'tag-pts' ? d.tagPoints : surfaceDeductionPoints(d);
      const sev = severityFromPoints(d.type, pts, cuts);
      return sev ? { ...d, severity: sev, deduction: pts } : null;
    }).filter(Boolean);
    const side = (s) => {
      const label = s === 'front' ? 'FRONT' : 'BACK';
      const detector = card.softDings.filter((d) => d.side === label);
      const model = [...slotsToDings('corners', s, p[s].corners), ...slotsToDings('edges', s, p[s].edges)];
      // detector surface dings are replaced by the marker-derived ones when we have markers
      const merged = mergeModelDings(detector, model).filter((d) => !/SURFACE|PLAY|CREASE|SCRATCH|DENT|STAIN|PIT|TEAR|PRINT/i.test(d.type || ''));
      return [...merged, ...surface.filter((d) => d.side === label)];
    };
    const g = computeGrade(side('front'), side('back'), card.centeringUsed.front, card.centeringUsed.back, 'tag');
    rows.push({ cert: card.cert, tagGrade: card.tagGrade, grade: g.overall.grade, err: g.overall.grade - card.tagGrade, held: splits[card.cert] !== 'train', hasSurface: !!byCert[card.cert] });
  }
  const sum = (list) => ({ n: list.length, mae: r2(mean(list.map((r) => Math.abs(r.err)))), signed: r2(mean(list.map((r) => r.err))), w05: r2((100 * list.filter((r) => Math.abs(r.err) <= 0.5).length) / list.length) });
  const out = { all: sum(rows), held: sum(rows.filter((r) => r.held)), surface: sum(rows.filter((r) => r.hasSurface)), clean: sum(rows.filter((r) => !r.hasSurface)) };
  out.byBucket = {};
  for (const b of ['9-10', '7-8.5', '5-6.5', '1-4.5']) out.byBucket[b] = sum(rows.filter((r) => bucketOf(r.tagGrade) === b));
  if (keep) out.rows = rows;
  return out;
}

console.log(`${cards.length} cards; ${Object.keys(byCert).length} have TAG surface markers (${boxes.length} boxes)\n`);
console.log('| surface severity from | all MAE | signed | held MAE | cards with markers MAE | signed | 9-10 | 7-8.5 | 5-6.5 | 1-4.5 |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const mode of ['none', 'ai-like', 'tag-pts', 'model']) {
  const s = score(mode);
  console.log(`| ${mode} | ${s.all.mae} | ${s.all.signed} | ${s.held.mae} | ${s.surface.mae} | ${s.surface.signed} | ${s.byBucket['9-10'].mae} | ${s.byBucket['7-8.5'].mae} | ${s.byBucket['5-6.5'].mae} | ${s.byBucket['1-4.5'].mae} |`);
}

if (GRID) {
  console.log('\ncut-line scale (all types together), model points:');
  console.log('| scale | all MAE | signed | cards with markers MAE | signed | 9-10 | 1-4.5 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const k of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0]) {
    const cuts = Object.fromEntries(Object.entries(SURFACE_SEVERITY_CUTS).map(([t, c]) => [t, { moderate: c.moderate * k, severe: c.severe * k, extreme: c.extreme * k }]));
    const s = score('model', cuts);
    console.log(`| ${k} | ${s.all.mae} | ${s.all.signed} | ${s.surface.mae} | ${s.surface.signed} | ${s.byBucket['9-10'].mae} | ${s.byBucket['1-4.5'].mae} |`);
  }
  const mk = (per) => Object.fromEntries(Object.entries(SURFACE_SEVERITY_CUTS).map(([t, c]) => { const k = per[t] ?? per.default ?? 1; return [t, { moderate: c.moderate * k, severe: c.severe * k, extreme: c.extreme * k }]; }));
  console.log('\ncombinations (scale per type):');
  console.log('| cuts | all MAE | signed | held MAE | held signed | marker cards MAE | signed | 9-10 | 1-4.5 |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [name, per] of Object.entries({ 'all 1.0': {}, 'all 0.7': { default: 0.7 }, 'all 0.7, CREASE 1.0': { default: 0.7, CREASE: 1 }, 'all 0.7, CREASE 1.0, DENT 0.5': { default: 0.7, CREASE: 1, DENT: 0.5 }, 'all 0.7, CREASE 1.0, DENT 0.5, PRINT 0.5': { default: 0.7, CREASE: 1, DENT: 0.5, PRINT_DEFECT: 0.5 }, 'all 0.6, CREASE 1.0, DENT 0.5, PRINT 0.5': { default: 0.6, CREASE: 1, DENT: 0.5, PRINT_DEFECT: 0.5 } })) {
    const s = score('model', mk(per));
    console.log(`| ${name} | ${s.all.mae} | ${s.all.signed} | ${s.held.mae} | ${s.held.signed} | ${s.surface.mae} | ${s.surface.signed} | ${s.byBucket['9-10'].mae} | ${s.byBucket['1-4.5'].mae} |`);
  }
  console.log('\nper-type scale, others at 1.0 (cards with markers MAE):');
  for (const type of Object.keys(SURFACE_SEVERITY_CUTS)) {
    const line = [];
    for (const k of [0.5, 0.75, 1.0, 1.5, 2.0]) {
      const cuts = { ...SURFACE_SEVERITY_CUTS, [type]: { moderate: SURFACE_SEVERITY_CUTS[type].moderate * k, severe: SURFACE_SEVERITY_CUTS[type].severe * k, extreme: SURFACE_SEVERITY_CUTS[type].extreme * k } };
      line.push(`${k}: ${score('model', cuts).surface.mae}`);
    }
    console.log(`  ${type.padEnd(13)} ${line.join('   ')}`);
  }
}
