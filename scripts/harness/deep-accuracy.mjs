#!/usr/bin/env node
/**
 * Paid-path accuracy: the Deep AI grade against TAG on the harness cards, with the exact
 * production flow (two Claude passes, references, structural floor, four images, the model
 * corner/edge slot table) run directly against the provider — no credits, no Vercel.
 *
 * Arms:
 *   base  — exactly what api/deep-analyze-v2.js sends (front full, back full, front crop, back crop)
 *   maps  — base plus the app's emboss and high-pass maps of each side (owner's idea, 2026-10-02)
 *
 *   node scripts/harness/deep-accuracy.mjs --arm base --limit 40 [--held-out] [--offset N] [--dry]
 *   node scripts/harness/deep-accuracy.mjs --score            # re-score cached responses only
 *
 * Every provider response is cached under results/deep-accuracy/<arm>/<cert>.json, so a rerun
 * never pays twice and `--score` is free. Needs ANTHROPIC_API_KEY (and the Supabase service
 * key for references) in .env.local. Cost is computed from the usage the API returns.
 */
import { createCanvas, Image } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
// .env.local, never printed
for (const line of fs.existsSync(path.join(ROOT, '.env.local')) ? fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const { callClaude } = await import('../../api/_providers/anthropic.js');
const { DETECTION_SYSTEM, buildDetectionPrompt, parseDetection, sanitizeDefects, mergeStructural, assembleUnifiedOutput } = await import('../../api/_lib/detectionPrompt.js');
const { gradeCard } = await import('../../src/lib/gradingEngine.js');
const { createClient } = await import('@supabase/supabase-js');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ARM = opt('--arm', 'base');
const LIMIT = Number(opt('--limit', 40)) || 40;
const OFFSET = Number(opt('--offset', 0)) || 0;
const HELD_OUT = args.includes('--held-out') || !args.includes('--all-splits');
const DRY = args.includes('--dry');
const SCORE_ONLY = args.includes('--score');
const MODEL = opt('--model', null);
const MAX_PX = 2000; // GRADE_UPLOAD_MAX_PX in src/services/api.js
// list prices per million tokens; override with --in-price/--out-price if the model differs
const IN_PRICE = Number(opt('--in-price', 5)), OUT_PRICE = Number(opt('--out-price', 25));

const DATA_DIR = process.env.SLABSENSE_DATA_DIR || path.join(ROOT, '..', 'SlabSense-data');
const PHOTOS = path.join(DATA_DIR, 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map');
const gt = JSON.parse(fs.readFileSync(path.join(here, 'ground-truth.json'), 'utf8'));
const splits = JSON.parse(fs.readFileSync(path.join(here, 'card-splits.json'), 'utf8'));
const preds = JSON.parse(fs.readFileSync(path.join(here, 'results', 'model-predictions-v3.json'), 'utf8'));
const OUT_DIR = path.join(here, 'results', 'deep-accuracy', ARM);
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── card selection: held-out only by default, stratified across the TAG grade buckets ────────
const bucketOf = (g) => (g >= 9 ? '9-10' : g >= 7 ? '7-8.5' : g >= 5 ? '5-6.5' : '1-4.5');
let certs = Object.keys(gt.certs).filter((c) => preds.cards[c] && gt.certs[c].centering.front.lrRatio != null && gt.certs[c].centering.back.lrRatio != null);
if (HELD_OUT) certs = certs.filter((c) => splits[c] && splits[c] !== 'train');
certs.sort();
const byBucket = {}; for (const c of certs) (byBucket[bucketOf(gt.certs[c].grade)] ||= []).push(c);
const picked = [];
for (let i = 0; picked.length < OFFSET + LIMIT; i++) { let any = false; for (const b of ['9-10', '7-8.5', '5-6.5', '1-4.5']) { if (byBucket[b]?.[i]) { picked.push(byBucket[b][i]); any = true; } } if (!any) break; }
const selected = picked.slice(OFFSET, OFFSET + LIMIT);

// ── images: the TAG photo resized like the app's upload (2000 px, JPEG 0.9), plus the maps ────
const LUM = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
function loadResized(file, maxPx) {
  const img = new Image(); img.src = fs.readFileSync(file);
  let w = img.width, h = img.height;
  if (Math.max(w, h) > maxPx) { const s = maxPx / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  const c = createCanvas(w, h); const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  return c;
}
const b64 = (canvas) => canvas.toBuffer('image/jpeg', { quality: 0.9 }).toString('base64');
/** The app's emboss and high-pass views (src/lib/image-utils.js genMaps), at 1400 px like the app. */
function maps(canvas) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const L = (Y, X) => LUM(src[(Y * w + X) * 4], src[(Y * w + X) * 4 + 1], src[(Y * w + X) * 4 + 2]);
  const eC = createCanvas(w, h), eX = eC.getContext('2d'), eD = eX.createImageData(w, h), e = eD.data;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = (y * w + x) * 4; const v = Math.min(255, Math.max(0, 128 + (L(y + 1, x + 1) - L(y - 1, x - 1)) * 2)); e[i] = e[i + 1] = e[i + 2] = v; e[i + 3] = 255; }
  eX.putImageData(eD, 0, 0);
  const hC = createCanvas(w, h), hX = hC.getContext('2d'), hD = hX.createImageData(w, h), hp = hD.data;
  for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) { const i = (y * w + x) * 4; let ls = 0, ln = 0; for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) { ls += L(y + dy, x + dx); ln++; } const v = Math.min(255, Math.max(0, 128 + (L(y, x) - ls / ln) * 3)); hp[i] = hp[i + 1] = hp[i + 2] = v; hp[i + 3] = 255; }
  hX.putImageData(hD, 0, 0);
  return { emboss: eC, highpass: hC };
}

function slotTable(cert) {
  const p = preds.cards[cert];
  const side = (s) => ({ corners: s.corners.map((x) => ({ key: x.key, wear: x.wear, deduction: x.deduction, angle: x.angle })), edges: s.edges.map((x) => ({ key: x.key, wear: x.wear, deduction: x.deduction })) });
  return { front: side(p.front), back: side(p.back) };
}

// ── references, as the handler does it (not exported from api/deep-analyze-v2.js) ───────────
const supabase = (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
function formatReferences(references) {
  if (!references.length) return null;
  return references.map((ref, i) => {
    const defectList = ref.defect_details?.map((d) => `${d.type} (${d.location})`).join(', ') || 'None noted';
    const adjustedNote = ref.is_adjusted ? '\n⚠ HUMAN-ADJUSTED GRADE: a TAG grader manually set this grade because the automated defect list UNDERSTATES the true damage (usually catastrophic damage like paper loss or creasing). Do NOT calibrate severity from this card\'s defect count.' : '';
    return `\nREFERENCE ${i + 1}: ${ref.grade} (Score: ${ref.score || 'N/A'})\nCard: ${ref.card_name} | Type: ${ref.card_type}\nCentering: Front ${ref.centering_front_lr?.toFixed(1) || '?'}% LR / ${ref.centering_front_tb?.toFixed(1) || '?'}% TB, Back ${ref.centering_back_lr?.toFixed(1) || '?'}% LR / ${ref.centering_back_tb?.toFixed(1) || '?'}% TB\nDefects: ${ref.defect_count} total (${ref.corner_defects} corner, ${ref.edge_defects} edge, ${ref.surface_defects} surface)\nDetails: ${defectList}${adjustedNote}`;
  }).join('\n');
}
async function getReferences(estimatedGrade, cardType = 'modern_holo') {
  if (!supabase) return [];
  const gradeBands = { 10: [10], 9.5: [10, 9], 9: [10, 9, 8.5], 8.5: [9, 8.5, 8], 8: [9, 8.5, 8, 7.5], 7.5: [8.5, 8, 7.5, 7], 7: [8, 7.5, 7, 6.5], 6.5: [7.5, 7, 6.5, 6], 6: [7, 6.5, 6, 5], 5: [6, 5, 4], 4: [5, 4, 3], 3: [4, 3, 2], 2: [3, 2, 1], 1: [2, 1] };
  const targetGrades = [...(gradeBands[Math.round(estimatedGrade * 2) / 2] || gradeBands[Math.round(estimatedGrade)] || gradeBands[8])];
  if (!targetGrades.includes(10)) targetGrades.unshift(10);
  const references = [];
  const { data: rows, error } = await supabase.from('graded_references').select('*').in('grade_numeric', targetGrades).order('defect_count', { ascending: true });
  if (error) { console.error('reference query error:', error.message); return []; }
  for (const grade of targetGrades) {
    const data = (rows || []).filter((r) => Number(r.grade_numeric) === grade).slice(0, 3);
    if (data.length > 0) { const sameType = data.filter((d) => d.card_type === cardType); references.push(...(sameType.length > 0 ? sameType.slice(0, 2) : data.slice(0, 2))); }
    if (references.length >= 7) break;
  }
  return references.slice(0, 7);
}

// ── one card through the Deep flow ───────────────────────────────────────────────────────────
async function runCard(cert) {
  const g = gt.certs[cert];
  const cacheFile = path.join(OUT_DIR, `${cert}.json`);
  if (fs.existsSync(cacheFile) && !DRY) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const front = loadResized(path.join(PHOTOS, 'Front', g.images.front), MAX_PX);
  const back = loadResized(path.join(PHOTOS, 'Back', g.images.back), MAX_PX);
  // a TAG scan is already the card: the "full" photo and the crop are the same picture, as in the app when the user does not crop
  const images = [b64(front), b64(back), b64(front), b64(back)];
  let imageLayout = '- IMAGE 1: FRONT (full) · IMAGE 2: BACK (full) · IMAGE 3: FRONT (cropped to card) · IMAGE 4: BACK (cropped to card)';
  if (ARM === 'maps') {
    const fm = maps(loadResized(path.join(PHOTOS, 'Front', g.images.front), 1400)), bm = maps(loadResized(path.join(PHOTOS, 'Back', g.images.back), 1400));
    images.push(b64(fm.emboss), b64(bm.emboss), b64(fm.highpass), b64(bm.highpass));
    imageLayout += '\n- IMAGE 5: FRONT relief (emboss filter of image 3) · IMAGE 6: BACK relief (emboss of image 4) · IMAGE 7: FRONT high-pass (local contrast of image 3) · IMAGE 8: BACK high-pass (of image 4). Images 5–8 are processed views of the SAME two sides, not other cards: use them to confirm or rule out surface texture (pits, print lines, scratches, dents, edge fray) seen in images 1–4. Do not report a defect that appears only in a processed view unless image 3 or 4 shows it too.';
  }
  const centering = { front: g.centering.front, back: g.centering.back };
  const cornerEdge = slotTable(cert);
  const cardType = 'modern_holo';
  if (DRY) {
    const p1 = buildDetectionPrompt({ cardType, centering, imageLayout, cornerEdge });
    return { cert, dry: true, images: images.length, imageBytes: images.reduce((s, i) => s + i.length * 0.75, 0), promptChars: p1.length + DETECTION_SYSTEM.length };
  }
  const t0 = Date.now();
  const pass1 = await callClaude({ systemPrompt: DETECTION_SYSTEM, userPrompt: buildDetectionPrompt({ cardType, centering, imageLayout, cornerEdge }), images, maxTokens: 3000, temperature: 0.1, ...(MODEL ? { model: MODEL } : {}) });
  if (!pass1.success) throw new Error('pass 1: ' + pass1.error);
  const det1 = parseDetection(pass1.text); if (!det1) throw new Error('pass 1 parse failed');
  const pass1Defects = sanitizeDefects(det1.defects);
  const est = gradeCard({ defects: pass1Defects, centering }).overall.grade;
  const references = await getReferences(est, cardType);
  const t1 = Date.now();
  const pass2 = await callClaude({ systemPrompt: DETECTION_SYSTEM, userPrompt: buildDetectionPrompt({ cardType, centering, imageLayout, referencesText: formatReferences(references), priorFindings: { imageQuality: det1.imageQuality, defects: pass1Defects }, cornerEdge }), images, maxTokens: 3000, temperature: 0.1, ...(MODEL ? { model: MODEL } : {}) });
  if (!pass2.success) throw new Error('pass 2: ' + pass2.error);
  const det2 = parseDetection(pass2.text); if (!det2) throw new Error('pass 2 parse failed');
  const finalDetection = { ...det2, defects: mergeStructural(pass1Defects, sanitizeDefects(det2.defects)) };
  const analysis = assembleUnifiedOutput({ detection: finalDetection, centering, gradePath: 'deep', cornerEdge, meta: { referencesUsed: references.length } });
  const rec = {
    cert, arm: ARM, model: pass1.model || MODEL || 'default', tagGrade: g.grade, tagLabel: g.label, tag: g.tag,
    estimateAfterPass1: est, grade: analysis.overall.grade, displayGrade: analysis.overall.displayGrade, subgrades: analysis.subgrades,
    defects: analysis.defects.items.map((d) => ({ side: d.side, type: d.type, severity: d.severity, location: d.location })),
    referencesUsed: references.length, usage: { pass1: pass1.usage || null, pass2: pass2.usage || null },
    ms: { pass1: t1 - t0, pass2: Date.now() - t1 }, raw: { pass1: pass1.text, pass2: pass2.text },
  };
  fs.writeFileSync(cacheFile, JSON.stringify(rec, null, 1));
  return rec;
}

// ── scoring against TAG ──────────────────────────────────────────────────────────────────────
const SURFACE = new Set(['CREASE', 'DENT', 'SCRATCH', 'PIT', 'STAIN', 'PRINT_DEFECT', 'TEAR', 'PLAY_WEAR']);
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
function score(recs) {
  const errs = recs.map((r) => r.grade - r.tagGrade);
  let tp = 0, fp = 0, fn = 0; const perType = {};
  for (const r of recs) {
    const truth = gt.certs[r.cert].dings.filter((d) => SURFACE.has(d.engineType));
    const need = {}; for (const d of truth) need[`${d.side}|${d.engineType}`] = (need[`${d.side}|${d.engineType}`] || 0) + 1;
    for (const d of r.defects.filter((d) => SURFACE.has(d.type))) {
      const k = `${d.side}|${d.type}`; const t = (perType[d.type] ||= { tp: 0, fp: 0, fn: 0 });
      if (need[k] > 0) { need[k]--; tp++; t.tp++; } else { fp++; t.fp++; }
    }
    for (const [k, n] of Object.entries(need)) { fn += n; (perType[k.split('|')[1]] ||= { tp: 0, fp: 0, fn: 0 }).fn += n; }
  }
  const surfErr = recs.flatMap((r) => [10 * r.subgrades.frontSurface - r.tag.surfaceFront, 10 * r.subgrades.backSurface - r.tag.surfaceBack]).filter(Number.isFinite);
  const usage = recs.map((r) => ({ in: (r.usage.pass1?.input_tokens || 0) + (r.usage.pass2?.input_tokens || 0), out: (r.usage.pass1?.output_tokens || 0) + (r.usage.pass2?.output_tokens || 0) }));
  const cost = usage.map((u) => (u.in * IN_PRICE + u.out * OUT_PRICE) / 1e6);
  const byBucket = {};
  for (const r of recs) { const b = bucketOf(r.tagGrade); (byBucket[b] ||= []).push(r.grade - r.tagGrade); }
  return {
    cards: recs.length, mae: r2(mean(errs.map(Math.abs))), signed: r2(mean(errs)), exact: r2((100 * errs.filter((e) => e === 0).length) / errs.length), within05: r2((100 * errs.filter((e) => Math.abs(e) <= 0.5).length) / errs.length), within10: r2((100 * errs.filter((e) => Math.abs(e) <= 1).length) / errs.length),
    byBucket: Object.fromEntries(Object.entries(byBucket).map(([b, es]) => [b, { n: es.length, mae: r2(mean(es.map(Math.abs))), signed: r2(mean(es)) }])),
    surface: { precision: r2(tp / Math.max(1, tp + fp)), recall: r2(tp / Math.max(1, tp + fn)), tp, fp, fn, perType, subgradeMae: r2(mean(surfErr.map(Math.abs))), subgradeSigned: r2(mean(surfErr)) },
    tokens: { inPerCard: Math.round(mean(usage.map((u) => u.in))), outPerCard: Math.round(mean(usage.map((u) => u.out))) },
    costPerCard: r2(mean(cost)), costTotal: r2(cost.reduce((s, v) => s + v, 0)), msPerCard: Math.round(mean(recs.map((r) => r.ms.pass1 + r.ms.pass2))),
    referencesUsedMean: r2(mean(recs.map((r) => r.referencesUsed))),
  };
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
if (SCORE_ONLY) {
  const recs = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && f !== 'summary.json').map((f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')));
  const s = score(recs); console.log(JSON.stringify(s, null, 1)); fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(s, null, 1));
} else {
  console.log(`arm ${ARM}: ${selected.length} cards (${HELD_OUT ? 'held-out' : 'all'} splits, offset ${OFFSET})${DRY ? ' DRY RUN' : ''}; cache ${path.relative(ROOT, OUT_DIR)}`);
  if (!DRY && !process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set (.env.local). Nothing was sent.'); process.exit(2); }
  const recs = []; let spent = 0;
  for (const [i, cert] of selected.entries()) {
    try {
      const r = await runCard(cert);
      recs.push(r);
      if (DRY) { console.log(`${cert}: ${r.images} images, ${Math.round(r.imageBytes / 1024)} KB, prompt ${r.promptChars} chars`); continue; }
      const u = r.usage; const c = (((u.pass1?.input_tokens || 0) + (u.pass2?.input_tokens || 0)) * IN_PRICE + ((u.pass1?.output_tokens || 0) + (u.pass2?.output_tokens || 0)) * OUT_PRICE) / 1e6; spent += c;
      console.log(`${i + 1}/${selected.length} ${cert} TAG ${r.tagLabel} → ${r.displayGrade} (pass1 est ${r.estimateAfterPass1}, refs ${r.referencesUsed}, ${r.defects.length} defects, $${c.toFixed(3)}, ${Math.round((r.ms.pass1 + r.ms.pass2) / 1000)} s)  spent $${spent.toFixed(2)}`);
    } catch (e) { console.error(`${cert}: ${e.message}`); }
  }
  if (!DRY && recs.length) { const s = score(recs); console.log(JSON.stringify(s, null, 1)); fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(s, null, 1)); }
}
