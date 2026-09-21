/**
 * ============================================================================
 * SURFACE DEDUCTION MODEL — surfaceDeduction.js
 * ============================================================================
 * TAG-calibrated points for a surface defect from its class, box and side.
 *
 * The model is the gradient-boosted regressor trained on 20,757 of TAG's own
 * surface markers (training/trainlib/deduction_model.py; val MAE 66 points
 * against 112 for the class median), dumped to JSON as plain decision trees
 * (api/_lib/models/surface-deduction-v1.json) and walked here — no runtime,
 * no native code, exact parity with sklearn (checked on 2,492 val boxes).
 *
 * On the paid paths Claude finds and classifies a surface defect and draws a
 * box; this replaces Claude's severity guess with TAG's statistics for a
 * defect of that class, size and place, mapped to the engine's severity
 * bands by calibrated cut lines (SURFACE_SEVERITY_CUTS). See
 * docs/GRADING_SYSTEM.md, "Surface severity from the deduction model".
 *
 * Pure. Types the model does not know (PLAY_WEAR) keep the AI's severity.
 * ============================================================================
 */
// A static import so the serverless bundler always ships the trees with the function.
import MODEL from './models/surface-deduction-v1.json' with { type: 'json' };

function model() { return MODEL; }

/** Feature vector in the model's order: one-hot class, geometry, side. Fractions of the card in. */
export function surfaceFeatures({ type, x, y, width, height, side }, classes = model().classes) {
  const k = classes.length;
  const f = new Array(k + 8).fill(0);
  const ci = classes.indexOf(type);
  if (ci < 0) return null;
  f[ci] = 1;
  const w = Math.max(width, 1e-6), h = Math.max(height, 1e-6);
  const cx = x + w / 2, cy = y + h / 2;
  f[k] = Math.log(w * h); f[k + 1] = Math.log(w); f[k + 2] = Math.log(h); f[k + 3] = Math.log(w / h);
  f[k + 4] = cx; f[k + 5] = cy;
  f[k + 6] = Math.min(cx, cy, 1 - cx, 1 - cy);
  f[k + 7] = side === 'BACK' ? 1 : 0;
  return f;
}

/** Walk every tree. Node layout: [value, feature, threshold, missing_left, left, right, is_leaf]. */
export function predictPoints(features, m = model()) {
  let s = m.baseline;
  for (const tree of m.trees) {
    let i = 0;
    for (;;) {
      const n = tree[i];
      if (n[6]) { s += n[0]; break; }
      const v = features[n[1]];
      i = Number.isNaN(v) ? (n[3] ? n[4] : n[5]) : (v <= n[2] ? n[4] : n[5]);
    }
  }
  return Math.min(m.clip[1], Math.max(m.clip[0], s));
}

/**
 * TAG points for one engine defect (AI-path shape: x/y/width/height in % of
 * the card). Null when the model has no class for it.
 */
export function surfaceDeductionPoints(defect) {
  const f = surfaceFeatures({
    type: defect.type,
    x: (defect.x ?? 50) / 100 - (defect.width ?? 0) / 200, // AI gives the centre; the model wants the top-left
    y: (defect.y ?? 50) / 100 - (defect.height ?? 0) / 200,
    width: (defect.width ?? 1) / 100,
    height: (defect.height ?? 1) / 100,
    side: defect.side,
  });
  return f ? predictPoints(f) : null;
}

/**
 * Points -> engine severity, per defect type. Calibrated 2026-09-21 on the DIG
 * harness with TAG's own boxes standing in for Claude's
 * (scripts/harness/surface-sweep.mjs, 203 cards with 436 markers): on those
 * cards the grade error is 2.23 with no surface defects, 1.45 with every
 * defect "moderate", 1.15 with TAG's actual points, 1.03 with these cuts on
 * the model's points, and the signed error is +0.02 (unbiased). Clean cards
 * are untouched (9-10 bucket 0.19 either way). See docs/GRADING_SYSTEM.md.
 */
export const SURFACE_SEVERITY_CUTS = {
  CREASE: { moderate: 300, severe: 550, extreme: 800 },
  DENT: { moderate: 125, severe: 225, extreme: 350 },
  PIT: { moderate: 105, severe: 210, extreme: 350 },
  PRINT_DEFECT: { moderate: 75, severe: 150, extreme: 250 },
  SCRATCH: { moderate: 105, severe: 210, extreme: 350 },
  STAIN: { moderate: 175, severe: 350, extreme: 560 },
  TEAR: { moderate: 0, severe: 0, extreme: 0 }, // every TAG tear in the dataset cost 900
};

export function severityFromPoints(type, points, cuts = SURFACE_SEVERITY_CUTS) {
  const c = cuts[type];
  if (!c || !(points >= 0)) return null;
  if (points >= c.extreme) return 'extreme';
  if (points >= c.severe) return 'severe';
  if (points >= c.moderate) return 'moderate';
  return 'minor';
}

/**
 * Re-severity the surface defects of an engine-shaped list with the model.
 * Corner/edge defects and unknown types pass through. Each re-scored defect
 * carries `aiSeverity` (what Claude said) and `deduction` (TAG points).
 */
export function applySurfaceDeduction(defects, { cuts = SURFACE_SEVERITY_CUTS } = {}) {
  let changed = 0;
  const out = (defects || []).map((d) => {
    const points = surfaceDeductionPoints(d);
    if (points === null) return d;
    const severity = severityFromPoints(d.type, points, cuts);
    if (!severity) return d;
    if (severity !== d.severity) changed++;
    return { ...d, aiSeverity: d.severity, severity, deduction: Math.round(points), severitySource: 'model' };
  });
  return { defects: out, changed };
}
