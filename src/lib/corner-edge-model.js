/**
 * ============================================================================
 * CORNER / EDGE MODEL ADAPTER — corner-edge-model.js
 * ============================================================================
 * Turns the trained corner and edge model outputs into the legacy ding objects
 * that softwareGrade.computeGrade() already understands, so the models feed the
 * grading engine through the existing defect vocabulary and nothing downstream
 * changes. See docs/GRADING_SYSTEM.md and training/README.md ("ONNX export").
 *
 * Each model sees one crop and returns per-slot logits:
 *   corners -> wear (binary), deduction (TAG points), angle (TAG points)
 *   edges   -> wear (binary), deduction (TAG points)
 * Apply sigmoid, then multiply the regression channels by 1000 to read them as
 * TAG points, exactly as the exported contract sidecars describe.
 *
 * A slot becomes a ding when its wear probability clears `wearThreshold`. Its
 * engine severity comes from the predicted deduction, whose cut lines are
 * calibrated against the DIG harness (scripts/harness/model-run.mjs), NOT
 * guessed: the engine's own arithmetic (BASE x SEVERITY) is on a 0-100 subgrade
 * scale while TAG deducts on a 1000-point scale, so the two only line up by
 * measurement.
 *
 * Pure: no canvas, no ONNX, no DOM. The runtime lives in corner-edge-runner.js.
 * ============================================================================
 */

export const MODEL_TASKS = ['corners', 'edges'];

/** Channel order per task, from the exported contract sidecars. */
export const OUTPUT_CHANNELS = {
  corners: ['wear', 'deduction', 'angle'],
  edges: ['wear', 'deduction'],
};

/** Regression channels are read as TAG points (sigmoid x 1000). */
export const POINT_SCALE = 1000;

/**
 * Calibrated on the 507-card DIG harness (scripts/harness/results/), see
 * training/README.md. `wearThreshold` is the probability a slot must clear to
 * become a ding; `severityCuts` are predicted-deduction points, ascending.
 */
export const MODEL_DEFAULTS = {
  corners: { wearThreshold: 0.5, severityCuts: { moderate: 250, severe: 450, extreme: 700 } },
  edges: { wearThreshold: 0.5, severityCuts: { moderate: 350, severe: 650, extreme: 950 } },
};

const DING_TYPE = { corners: 'CORNER WEAR', edges: 'EDGE WEAR' };

/** Predicted TAG points -> engine severity key. */
export function severityFromDeduction(points, cuts) {
  if (!(points >= 0)) return 'minor';
  if (points >= cuts.extreme) return 'extreme';
  if (points >= cuts.severe) return 'severe';
  if (points >= cuts.moderate) return 'moderate';
  return 'minor';
}

export function sigmoid(x) {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

/**
 * One row of raw logits -> named, scaled predictions.
 * @param {ArrayLike<number>} logits one slot's logits, in channel order
 */
export function decodeLogits(task, logits) {
  const names = OUTPUT_CHANNELS[task];
  const out = {};
  names.forEach((name, i) => {
    const p = sigmoid(logits[i]);
    out[name] = name === 'wear' ? p : p * POINT_SCALE;
  });
  return out;
}

/** Every slot of one side, decoded and paired with its box. */
export function decodeSide(task, logits, boxes, nOut = OUTPUT_CHANNELS[task].length) {
  return boxes.map((box, n) => ({
    key: box.key,
    location: box.location,
    ...decodeLogits(task, Array.from(logits.slice(n * nOut, (n + 1) * nOut))),
  }));
}

/**
 * Decoded slots -> legacy dings for one side.
 * Shape matches src/lib/detectors.js so computeGrade() needs no changes; the
 * extra `source`/`wear`/`deduction` fields are carried for the damage report
 * and for the harness, and ignored by the engine.
 */
export function slotsToDings(task, side, slots, options = {}) {
  // Accepts either a per-task map ({ corners: {...}, edges: {...} }) or one config
  // object meant for this task; anything absent falls back to the calibrated defaults.
  const own = options[task] || (options.wearThreshold !== undefined || options.severityCuts ? options : null);
  const cfg = { ...MODEL_DEFAULTS[task], ...(own || {}) };
  const sideLabel = side === 'back' || side === 'BACK' ? 'BACK' : 'FRONT';
  const dings = [];
  for (const slot of slots) {
    if (!(slot.wear >= cfg.wearThreshold)) continue;
    const severity = severityFromDeduction(slot.deduction, cfg.severityCuts);
    dings.push({
      side: sideLabel,
      type: DING_TYPE[task],
      location: slot.location,
      severity,
      desc: `${severity === 'minor' ? 'Light' : severity === 'moderate' ? 'Visible' : severity === 'severe' ? 'Significant' : 'Heavy'} ${task === 'corners' ? 'corner' : 'edge'} wear`,
      source: 'model',
      wear: Math.round(slot.wear * 1000) / 1000,
      deduction: Math.round(slot.deduction),
      ...(slot.angle === undefined ? {} : { angle: Math.round(slot.angle) }),
    });
  }
  return dings;
}

/**
 * Drop the legacy detector's corner/edge dings once the models supply them, so
 * a slot is never counted twice. Surface dings (creases, scratches, stains) are
 * untouched — no model covers them yet.
 */
export function withoutDetectorCornerEdge(dings) {
  return dings.filter((d) => {
    const t = (d.type || '').toUpperCase();
    return !(t.includes('CORNER') || t.includes('EDGE'));
  });
}

/**
 * Merge model dings into a side's detector dings.
 * @param {object[]} detectorDings dings from src/lib/detectors.js for that side
 * @param {object[]} modelDings dings from slotsToDings (both tasks)
 */
export function mergeModelDings(detectorDings, modelDings) {
  return [...withoutDetectorCornerEdge(detectorDings || []), ...(modelDings || [])];
}
