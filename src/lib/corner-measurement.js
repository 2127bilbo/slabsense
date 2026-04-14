/**
 * Corner-Anchored Multi-Sample Centering Measurement
 *
 * Measures border width at 5 points along each edge using median,
 * providing more accurate centering on tilted/warped cards.
 */

/**
 * Linear interpolation between two points
 * @param {Object} a - Start point {x, y}
 * @param {Object} b - End point {x, y}
 * @param {number} t - Interpolation factor (0-1)
 * @returns {Object} Interpolated point {x, y}
 */
export function lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

/**
 * Perpendicular distance from point P to line through lineStart-lineEnd
 * @param {Object} P - Point {x, y}
 * @param {Object} lineStart - Line start point {x, y}
 * @param {Object} lineEnd - Line end point {x, y}
 * @returns {number} Perpendicular distance in pixels
 */
export function perpendicularDistance(P, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return 0;
  // Standard perpendicular distance formula
  return Math.abs((P.x - lineStart.x) * dy - (P.y - lineStart.y) * dx) / len;
}

/**
 * Calculate median of an array
 * @param {number[]} arr - Array of numbers
 * @returns {number} Median value
 */
export function medianOf(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate standard deviation of an array
 * @param {number[]} arr - Array of numbers
 * @returns {number} Standard deviation
 */
export function stdevOf(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Sample positions along each edge (as fraction of edge length)
 */
export const SAMPLE_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

/**
 * Calculate border measurement for one edge using 5-sample median
 * @param {Object} outerStart - Outer edge start corner {x, y}
 * @param {Object} outerEnd - Outer edge end corner {x, y}
 * @param {Object} innerStart - Inner edge start corner {x, y}
 * @param {Object} innerEnd - Inner edge end corner {x, y}
 * @returns {Object} { median, samples, stdev, coefficientOfVariation, confidence }
 */
export function calculateBorderMeasurement(outerStart, outerEnd, innerStart, innerEnd) {
  const samples = [];

  for (const t of SAMPLE_POSITIONS) {
    const outerPt = lerp(outerStart, outerEnd, t);
    const innerPt = lerp(innerStart, innerEnd, t);
    // Perpendicular distance from inner point to outer edge line
    const width = perpendicularDistance(innerPt, outerStart, outerEnd);
    samples.push(width);
  }

  const median = medianOf(samples);
  const stdev = stdevOf(samples);
  const coefficientOfVariation = median > 0 ? stdev / median : 0;

  // Confidence classification based on CV
  let confidence;
  if (coefficientOfVariation < 0.05) {
    confidence = 'high';
  } else if (coefficientOfVariation < 0.15) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    median: Math.round(median * 10) / 10,
    samples: samples.map(s => Math.round(s * 10) / 10),
    stdev: Math.round(stdev * 10) / 10,
    coefficientOfVariation: Math.round(coefficientOfVariation * 1000) / 1000,
    confidence
  };
}

/**
 * Calculate centering ratios from 8 corner positions
 * @param {Object} outer - Outer corners { tl, tr, bl, br } each with {x, y}
 * @param {Object} inner - Inner corners { tl, tr, bl, br } each with {x, y}
 * @returns {Object} Full centering analysis with per-edge breakdown
 */
export function calculateCornerCentering(outer, inner) {
  // Top edge: TL->TR (outer), tl->tr (inner)
  const topMeasurement = calculateBorderMeasurement(
    outer.tl, outer.tr, inner.tl, inner.tr
  );

  // Bottom edge: BL->BR (outer), bl->br (inner)
  const bottomMeasurement = calculateBorderMeasurement(
    outer.bl, outer.br, inner.bl, inner.br
  );

  // Left edge: TL->BL (outer), tl->bl (inner)
  const leftMeasurement = calculateBorderMeasurement(
    outer.tl, outer.bl, inner.tl, inner.bl
  );

  // Right edge: TR->BR (outer), tr->br (inner)
  const rightMeasurement = calculateBorderMeasurement(
    outer.tr, outer.br, inner.tr, inner.br
  );

  // Calculate centering ratios
  const horizontalTotal = leftMeasurement.median + rightMeasurement.median;
  const verticalTotal = topMeasurement.median + bottomMeasurement.median;

  const lrRatio = horizontalTotal > 0
    ? Math.round((leftMeasurement.median / horizontalTotal) * 1000) / 10
    : 50;
  const tbRatio = verticalTotal > 0
    ? Math.round((topMeasurement.median / verticalTotal) * 1000) / 10
    : 50;

  // Count low-confidence edges
  const lowConfCount = [topMeasurement, bottomMeasurement, leftMeasurement, rightMeasurement]
    .filter(m => m.confidence === 'low').length;
  const medConfCount = [topMeasurement, bottomMeasurement, leftMeasurement, rightMeasurement]
    .filter(m => m.confidence === 'medium').length;

  // Overall confidence
  let overallConfidence;
  if (lowConfCount >= 2) {
    overallConfidence = 'low';
  } else if (lowConfCount >= 1 || medConfCount >= 2) {
    overallConfidence = 'medium';
  } else {
    overallConfidence = 'high';
  }

  return {
    edges: {
      top: topMeasurement,
      bottom: bottomMeasurement,
      left: leftMeasurement,
      right: rightMeasurement
    },
    centering: {
      horizontal: lrRatio,
      vertical: tbRatio,
      lrDisplay: `${lrRatio}/${Math.round((100 - lrRatio) * 10) / 10}`,
      tbDisplay: `${tbRatio}/${Math.round((100 - tbRatio) * 10) / 10}`
    },
    overallConfidence,
    lowConfidenceEdges: lowConfCount
  };
}

/**
 * Get sample point positions for visualization
 * @param {Object} outer - Outer corners { tl, tr, bl, br }
 * @param {Object} inner - Inner corners { tl, tr, bl, br }
 * @returns {Object} Arrays of sample points for each edge
 */
export function getSamplePoints(outer, inner) {
  const points = {
    top: [],
    bottom: [],
    left: [],
    right: []
  };

  for (const t of SAMPLE_POSITIONS) {
    // Top edge samples
    points.top.push({
      outer: lerp(outer.tl, outer.tr, t),
      inner: lerp(inner.tl, inner.tr, t)
    });
    // Bottom edge samples
    points.bottom.push({
      outer: lerp(outer.bl, outer.br, t),
      inner: lerp(inner.bl, inner.br, t)
    });
    // Left edge samples
    points.left.push({
      outer: lerp(outer.tl, outer.bl, t),
      inner: lerp(inner.tl, inner.bl, t)
    });
    // Right edge samples
    points.right.push({
      outer: lerp(outer.tr, outer.br, t),
      inner: lerp(inner.tr, inner.br, t)
    });
  }

  return points;
}

export default {
  lerp,
  perpendicularDistance,
  medianOf,
  stdevOf,
  calculateBorderMeasurement,
  calculateCornerCentering,
  getSamplePoints,
  SAMPLE_POSITIONS
};
