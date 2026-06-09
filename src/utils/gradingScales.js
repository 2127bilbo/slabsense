/**
 * SlabSense - Grading Company Scales Configuration
 *
 * DEPRECATED: This file now re-exports from masterweights.js
 * All grading data is consolidated in src/lib/masterweights.js
 *
 * Kept for backward compatibility - update imports to use masterweights.js directly.
 */

import {
  GRADING_COMPANIES,
  DEFAULT_GRADING_COMPANY,
  COMPANY_IDS,
  getCompanyOptions,
  GRADE_SCALES,
  CENTERING_THRESHOLDS,
  getCenteringGrade,
  getGradeColor,
  getGradeLabel,
  TAGScoreToGrade,
  applyGradingAlgorithm,
  TAG_SCORE_THRESHOLDS,
  GRADE_COLORS,
} from '../lib/masterweights.js';

// Re-export everything
export {
  GRADING_COMPANIES,
  DEFAULT_GRADING_COMPANY,
  COMPANY_IDS,
  getCompanyOptions,
  GRADE_SCALES,
  CENTERING_THRESHOLDS,
  getCenteringGrade,
  getGradeColor,
  getGradeLabel,
  TAGScoreToGrade,
  applyGradingAlgorithm,
};

// Legacy function - get grade from score (for backward compatibility)
export function getGradeFromScore(score, companyId = 'tag') {
  // Find the grade for this score
  const grades = Object.entries(TAG_SCORE_THRESHOLDS)
    .sort(([a], [b]) => parseFloat(b) - parseFloat(a));

  for (const [gradeStr, data] of grades) {
    if (score >= data.min) {
      const grade = parseFloat(gradeStr);
      const colors = GRADE_COLORS[grade] || { color: '#888', bg: 'rgba(0,0,0,0.1)' };
      return {
        grade,
        label: data.label,
        min: data.min,
        max: data.min + 49,
        ...colors,
      };
    }
  }

  // Return lowest grade
  return {
    grade: 1,
    label: 'Poor',
    min: 100,
    max: 149,
    color: '#441111',
    bg: 'rgba(68,17,17,0.08)',
  };
}

// Legacy function - convert grade between companies
export function convertGrade(grade, fromCompany, toCompany) {
  const conversionMap = {
    10: 10,
    9.5: 10,
    9: 9,
    8.5: 9,
    8: 8,
    7.5: 8,
    7: 7,
    6.5: 7,
    6: 6,
    5.5: 6,
    5: 5,
    4.5: 5,
    4: 4,
    3.5: 4,
    3: 3,
    2.5: 3,
    2: 2,
    1.5: 2,
    1: 1,
  };

  const toScale = GRADE_SCALES[toCompany];
  if (toScale && !toScale.hasHalfPoints) {
    return conversionMap[grade] || grade;
  }

  return grade;
}
