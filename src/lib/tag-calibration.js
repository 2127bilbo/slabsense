/**
 * TAG Calibration Data
 *
 * DEPRECATED: This file now re-exports from masterweights.js
 * All grading data is consolidated in src/lib/masterweights.js
 *
 * Kept for backward compatibility - update imports to use masterweights.js directly.
 */

import {
  CENTERING_THRESHOLDS,
  GRADE_CEILINGS,
  DEFECT_GRADE_CAPS,
  getCenteringGrade as _getCenteringGrade,
  getMaxGradeByDefects,
  ratioToDeviation,
  calculateSoftwareConfidence,
} from './masterweights.js';

// Re-export TAG centering in the old format for compatibility
export const TAG_CENTERING_THRESHOLDS = CENTERING_THRESHOLDS.tag;

// Re-export everything else
export { GRADE_CEILINGS, DEFECT_GRADE_CAPS, getMaxGradeByDefects, ratioToDeviation, calculateSoftwareConfidence };

// Wrap getCenteringGrade to default to TAG
export function getCenteringGrade(frontDeviation, backDeviation) {
  return _getCenteringGrade(frontDeviation, backDeviation, 'tag');
}

// Legacy: AVG_DEFECTS_BY_GRADE was unused, removed in consolidation

// Default export for backward compatibility
export default {
  TAG_CENTERING_THRESHOLDS,
  GRADE_CEILINGS,
  DEFECT_GRADE_CAPS,
  getMaxGradeByDefects,
  getCenteringGrade,
  ratioToDeviation,
  calculateSoftwareConfidence,
};
