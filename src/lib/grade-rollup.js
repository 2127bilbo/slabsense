/**
 * ============================================================================
 * GRADE ROLLUP MODEL — grade-rollup.js
 * ============================================================================
 * TAG's rollup, learned: the final grade from the subgrades and defect counts,
 * as boosted trees (training/trainlib/rollup_model.py, exported to
 * api/_lib/models/grade-rollup-v1.json in the same tree format
 * api/_lib/surfaceDeduction.js walks). Val + foil2026-val 95.1 % exact /
 * 99.6 % within a half grade; test (read once) 89.9 % / 99.0 %.
 *
 * This module is pure and takes the model as an argument so the same code
 * serves the API (static import) and the browser (fetched from the models
 * bucket). It never replaces the engine's score: it proposes a grade label
 * from the engine's own subgrades, and the caller decides (behind a flag)
 * whether the label shown is the engine's fixed rule or the model's.
 *
 * Feature mapping from the engine (documented assumption, validated on the
 * harness — see docs/GRADING_SYSTEM.md "Grade rollup model"):
 *   rollup_<attr>   = 10 × (0.6 × front + 0.4 × back) of the engine's 0–100
 *                     subgrades (back missing → front). TAG's published
 *                     attribute rollups are not a simple function of its
 *                     per-side scores; 0.58/0.41 is the least-squares fit of
 *                     rollup_surface on surface_front/back over 6,803 certs.
 *   surface_front/back = 10 × the engine's per-side surface subgrade
 *   n_markers_front/back = surface-type defects the engine scored on that side
 *   n_dings         = corner + edge defects on both sides
 * ============================================================================
 */

export const ROLLUP_SIDE_WEIGHTS = { front: 0.6, back: 0.4 };
const SURFACE_TYPES = new Set(['SCRATCH', 'DENT', 'PRINT_DEFECT', 'CREASE', 'PLAY_WEAR', 'PIT', 'STAIN', 'TEAR']);
const DING_TYPES = new Set(['CORNER', 'EDGE']);

/** Engine label (GRADE_TABLE displayGrade) for each model grade string. */
export const MODEL_GRADE_TO_DISPLAY = {
  '1 POOR': '1', '1.5 FAIR': '1.5', '2 GOOD': '2', '2.5 GOOD+': '2.5', '3 VG': '3', '3.5 VG+': '3.5',
  '4 VG EX': '4', '4.5 VG EX+': '4.5', '5 EXCELLENT': '5', '5.5 EXCELLENT+': '5.5', '6 EX MT': '6', '6.5 EX MT+': '6.5',
  '7 NEAR MINT': '7', '7.5 NEAR MINT+': '7.5', '8 NM MT': '8', '8.5 NM MT+': '8.5', '9 MINT': '9', '10 GEM MINT': '10', '10 PRISTINE': '10P',
};

const combine = (front, back) => (back == null ? front : ROLLUP_SIDE_WEIGHTS.front * front + ROLLUP_SIDE_WEIGHTS.back * back);
const sideOf = (d) => String(d.side || '').toUpperCase();

/**
 * The model's nine inputs from an engine result.
 * @param {object} subgrades the engine's eight 0–100 subgrades (back keys may be null)
 * @param {object[]|{items:object[]}} defects the engine's defects block ({items:[{side,type}]}) or a plain array
 * @returns {number[]} in model feature order
 */
export function rollupFeatures(subgrades, defects = []) {
  const s = subgrades;
  // the engine's output block is { counts, items }; a plain array is accepted too
  if (defects && !Array.isArray(defects)) defects = Array.isArray(defects.items) ? defects.items : [];
  const front = (t) => defects.filter((d) => t.has(d.type) && sideOf(d) === 'FRONT').length;
  const back = (t) => defects.filter((d) => t.has(d.type) && sideOf(d) === 'BACK').length;
  return [
    10 * combine(s.frontCentering, s.backCentering),
    10 * combine(s.frontCorners, s.backCorners),
    10 * combine(s.frontEdges, s.backEdges),
    10 * combine(s.frontSurface, s.backSurface),
    10 * s.frontSurface,
    10 * (s.backSurface == null ? s.frontSurface : s.backSurface),
    front(SURFACE_TYPES),
    back(SURFACE_TYPES),
    front(DING_TYPES) + back(DING_TYPES),
  ];
}

/** Walk every tree. Node layout: [value, feature, threshold, missing_left, left, right, is_leaf]. */
export function predictGradeIndex(features, model) {
  let s = model.baseline;
  for (const tree of model.trees) {
    let i = 0;
    for (;;) {
      const n = tree[i];
      if (n[6]) { s += n[0]; break; }
      const v = features[n[1]];
      i = Number.isNaN(v) ? (n[3] ? n[4] : n[5]) : (v <= n[2] ? n[4] : n[5]);
    }
  }
  return Math.min(model.clip[1], Math.max(model.clip[0], s));
}

/**
 * The model's grade for an engine result.
 * @returns {{index:number, raw:number, label:string, displayGrade:string, grade:number}}
 *   `grade` is the numeric grade the app uses (10 for both Gem Mint and Pristine).
 */
export function rollupGrade(subgrades, defects, model) {
  const raw = predictGradeIndex(rollupFeatures(subgrades, defects), model);
  const index = Math.round(raw);
  const label = model.grades[index];
  const displayGrade = MODEL_GRADE_TO_DISPLAY[label] ?? label;
  return { index, raw, label, displayGrade, grade: Number.parseFloat(displayGrade) };
}

/** Self-check against the vectors shipped inside the model file. Returns the failures. */
export function checkTestVectors(model) {
  const bad = [];
  for (const tv of model.test_vectors || []) {
    const f = model.features.map((k) => tv[k]);
    const raw = predictGradeIndex(f, model);
    if (Math.abs(raw - tv.expected_index) > 1e-6 || model.grades[Math.round(raw)] !== tv.expected_grade) bad.push({ tv, raw });
  }
  return bad;
}
