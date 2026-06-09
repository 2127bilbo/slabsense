/**
 * SlabSense - Master Grading Weights
 *
 * SINGLE SOURCE OF TRUTH for all grading company data.
 * Based on docs/Masterweights.md - update that document first, then sync here.
 *
 * TAG data is GOLD STANDARD (507-card calibration, April 2026)
 *
 * All centering values are expressed as MAX DEVIATION from 50/50.
 * Example: 5 = max 5% deviation = 45/55 or 55/45 acceptable
 */

// ============================================================================
// GRADE SCALES & LABELS
// ============================================================================

export const GRADE_SCALES = {
  tag: {
    id: 'tag',
    name: 'TAG',
    fullName: 'Technical Authentication & Grading',
    scaleType: '1000-point',
    hasSubgrades: true,
    subgradeCount: 8,
    hasHalfPoints: true,
    has9_5: false, // TAG has NO 9.5
    hasTwoTypes10: true, // Pristine (990+) vs Gem Mint (950-989)
    algorithm: 'compounding', // min × 0.75 + avg × 0.25
    subgradeCategories: [
      'Front Centering', 'Back Centering',
      'Front Corners', 'Back Corners',
      'Front Edges', 'Back Edges',
      'Front Surface', 'Back Surface'
    ],
  },
  psa: {
    id: 'psa',
    name: 'PSA',
    fullName: 'Professional Sports Authenticator',
    scaleType: '1-10',
    hasSubgrades: false,
    subgradeCount: 0,
    hasHalfPoints: true,
    has9_5: false, // PSA has NO 9.5
    hasTwoTypes10: false,
    algorithm: 'lowest_factor',
    subgradeCategories: [],
  },
  bgs: {
    id: 'bgs',
    name: 'BGS',
    fullName: 'Beckett Grading Services',
    scaleType: '1-10 with subgrades',
    hasSubgrades: true,
    subgradeCount: 4,
    hasHalfPoints: true,
    has9_5: true,
    hasTwoTypes10: true, // Black Label (quad 10) vs Gold (3×10 + 9.5)
    algorithm: '0.5_rule', // Final = lowest + 0.5 max
    subgradeCategories: ['Centering', 'Corners', 'Edges', 'Surface'],
  },
  cgc: {
    id: 'cgc',
    name: 'CGC',
    fullName: 'Certified Guaranty Company',
    scaleType: '1-10',
    hasSubgrades: false,
    subgradeCount: 0,
    hasHalfPoints: true,
    has9_5: true,
    hasTwoTypes10: true, // Pristine (Gold) vs Gem Mint
    algorithm: 'holistic', // Compensating allowed
    subgradeCategories: [],
  },
  sgc: {
    id: 'sgc',
    name: 'SGC',
    fullName: 'Sportscard Guaranty Corporation',
    scaleType: '1-10',
    hasSubgrades: false,
    subgradeCount: 0,
    hasHalfPoints: true,
    has9_5: true,
    hasTwoTypes10: true, // Pristine (Gold) vs Gem Mint
    algorithm: 'lowest_factor',
    subgradeCategories: [],
  },
};

// ============================================================================
// GRADE LABELS & SCORE THRESHOLDS
// ============================================================================

// TAG uses 1000-point scale internally
export const TAG_SCORE_THRESHOLDS = {
  10.0: { min: 950, label: 'Gem Mint', pristineMin: 990 },
  9.0:  { min: 900, label: 'Mint' },
  8.5:  { min: 850, label: 'NM-MT+' },
  8.0:  { min: 800, label: 'NM-MT' },
  7.5:  { min: 750, label: 'NM+' },
  7.0:  { min: 700, label: 'NM' },
  6.5:  { min: 650, label: 'EX-MT+' },
  6.0:  { min: 600, label: 'EX-MT' },
  5.5:  { min: 550, label: 'EX+' },
  5.0:  { min: 500, label: 'EX' },
  4.5:  { min: 450, label: 'VG-EX+' },
  4.0:  { min: 400, label: 'VG-EX' },
  3.5:  { min: 350, label: 'VG+' },
  3.0:  { min: 300, label: 'VG' },
  2.5:  { min: 250, label: 'Good+' },
  2.0:  { min: 200, label: 'Good' },
  1.5:  { min: 150, label: 'Fair' },
  1.0:  { min: 100, label: 'Poor' },
};

// Standard grade labels (used by all companies)
export const GRADE_LABELS = {
  10.0: 'Gem Mint',
  9.5: 'Gem Mint',
  9.0: 'Mint',
  8.5: 'NM-MT+',
  8.0: 'NM-MT',
  7.5: 'NM+',
  7.0: 'NM',
  6.5: 'EX-MT+',
  6.0: 'EX-MT',
  5.5: 'EX+',
  5.0: 'EX',
  4.5: 'VG-EX+',
  4.0: 'VG-EX',
  3.5: 'VG+',
  3.0: 'VG',
  2.5: 'Good+',
  2.0: 'Good',
  1.5: 'Fair',
  1.0: 'Poor',
};

// ============================================================================
// CENTERING THRESHOLDS (All values are MAX DEVIATION from 50)
// ============================================================================

export const CENTERING_THRESHOLDS = {
  // TAG - Gold Standard (507-card calibration)
  tag: {
    front: {
      10.0: 5.0,    // 45/55 max (Gem Mint)
      9.0: 10.0,    // 40/60 max
      8.5: 12.5,
      8.0: 15.0,
      7.5: 17.5,
      7.0: 20.0,
      6.5: 22.5,
      6.0: 25.0,
      5.5: 27.5,
      5.0: 30.0,
      4.0: 35.0,
      3.0: 40.0,
      2.0: 45.0,
      1.0: 50.0,
    },
    back: {
      10.0: 15.0,   // 35/65 max
      9.0: 25.0,
      8.5: 27.5,
      8.0: 30.0,
      7.5: 32.5,
      7.0: 35.0,
      6.5: 37.5,
      6.0: 40.0,
      5.0: 45.0,
      4.0: 50.0,
      3.0: 50.0,
      2.0: 50.0,
      1.0: 50.0,
    },
    // Pristine requires tighter centering
    pristine: {
      front: 2.0,   // 48/52 max
      back: 2.0,    // 48/52 max
    },
  },

  // PSA - Updated Q1 2025
  psa: {
    front: {
      10.0: 5.0,    // 55/45 (was 60/40 before Q1 2025)
      9.0: 10.0,    // 60/40
      8.0: 15.0,    // 65/35
      7.0: 20.0,    // 70/30
      6.0: 30.0,    // 80/20
      5.0: 35.0,    // 85/15
      4.0: 35.0,    // 85/15
      3.0: 40.0,    // 90/10
      2.0: 40.0,
      1.0: 40.0,
    },
    back: {
      10.0: 25.0,   // 75/25
      9.0: 40.0,    // 90/10
      8.0: 40.0,
      7.0: 40.0,
      6.0: 40.0,
      5.0: 40.0,
      4.0: 40.0,
      3.0: 40.0,
      2.0: 40.0,
      1.0: 40.0,
    },
  },

  // BGS - Strictest on centering
  bgs: {
    front: {
      10.0: 0.0,    // 50/50 perfect required
      9.5: 5.0,     // 55/45
      9.0: 10.0,    // 60/40
      8.5: 12.0,    // 62/38
      8.0: 15.0,    // 65/35
      7.0: 20.0,    // 70/30
      6.0: 25.0,    // 75/25
      5.0: 40.0,
      4.0: 40.0,
      3.0: 40.0,
    },
    back: {
      10.0: 0.0,    // 50/50 perfect required
      9.5: 10.0,    // 60/40
      9.0: 15.0,    // 65/35
      8.5: 20.0,    // 70/30
      8.0: 25.0,    // 75/25
      7.0: 30.0,    // 80/20
      6.0: 35.0,    // 85/15
      5.0: 40.0,
      4.0: 40.0,
      3.0: 40.0,
    },
  },

  // CGC - Holistic (centering can be compensated)
  cgc: {
    front: {
      '10P': 0.0,   // Pristine: 50/50
      10.0: 5.0,    // Gem Mint: 55/45
      9.5: 10.0,    // 60/40
      9.0: 10.0,    // 60/40
      8.5: 15.0,    // 65/35
      8.0: 15.0,    // 65/35
      7.0: 20.0,    // 70/30
      6.0: 25.0,    // 75/25
      5.0: 40.0,
      4.0: 40.0,
      3.0: 40.0,
    },
    back: {
      '10P': 0.0,   // Pristine: 50/50
      10.0: 25.0,   // Gem Mint: 75/25
      9.5: 40.0,    // 90/10
      9.0: 40.0,    // 90/10
      8.5: 35.0,    // 65/35
      8.0: 35.0,
      7.0: 30.0,
      6.0: 35.0,
      5.0: 40.0,
      4.0: 40.0,
      3.0: 40.0,
    },
  },

  // SGC - Strictest on back centering
  sgc: {
    front: {
      '10P': 0.0,   // Pristine: 50/50
      10.0: 5.0,    // Gem Mint: 55/45
      9.5: 5.0,     // 55/45
      9.0: 10.0,    // 60/40
      8.5: 15.0,    // 65/35
      8.0: 15.0,    // 65/35
      7.5: 20.0,    // 70/30
      7.0: 20.0,    // 70/30
      6.5: 25.0,    // 75/25
      6.0: 25.0,    // 75/25
      5.5: 30.0,    // 80/20
      5.0: 30.0,    // 80/20
      4.0: 35.0,    // 85/15
      3.0: 40.0,    // 90/10
    },
    back: {
      '10P': 0.0,   // Pristine: 50/50 (strictest!)
      10.0: 20.0,   // Gem Mint: 70/30 (stricter than PSA's 90/10)
      9.5: 5.0,     // 55/45
      9.0: 10.0,    // 60/40
      8.5: 15.0,    // 65/35
      8.0: 15.0,    // 65/35
      7.5: 20.0,    // 70/30
      7.0: 20.0,    // 70/30
      6.5: 25.0,    // 75/25
      6.0: 25.0,    // 75/25
      5.5: 30.0,
      5.0: 30.0,
      4.0: 35.0,
      3.0: 40.0,
    },
  },
};

// ============================================================================
// GRADE CEILINGS (From TAG 507-card calibration)
// ============================================================================

export const GRADE_CEILINGS = {
  10.0: {
    maxDefects: 3,
    maxCorner: 1,
    maxEdge: 1,
    maxSurface: 3,
    maxFrontDev: 5.0,
    maxBackDev: 15.0,
  },
  9.0: {
    maxDefects: 4,
    maxCorner: 3,
    maxEdge: 2,
    maxSurface: 3,
    maxFrontDev: 21.9,
    maxBackDev: 18.3,
  },
  8.5: {
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 2,
    maxSurface: 2,
    maxFrontDev: 24.5,
    maxBackDev: 22.5,
  },
  8.0: {
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 3,
    maxSurface: 3,
    maxFrontDev: 30.3,
    maxBackDev: 20.6,
  },
  7.5: {
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 3,
    maxSurface: 3,
    maxFrontDev: 32.9,
    maxBackDev: 33.3,
  },
  7.0: {
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 4,
    maxSurface: 3,
    maxFrontDev: 37.1,
    maxBackDev: 31.0,
  },
  6.5: {
    maxDefects: 6,
    maxCorner: 5,
    maxEdge: 3,
    maxSurface: 4,
    maxFrontDev: 42.6,
    maxBackDev: 33.1,
  },
  6.0: {
    maxDefects: 6,
    maxCorner: 6,
    maxEdge: 3,
    maxSurface: 3,
    maxFrontDev: 30.0,
    maxBackDev: 21.5,
  },
  5.0: {
    maxDefects: 6,
    maxCorner: 5,
    maxEdge: 2,
    maxSurface: 5,
    maxFrontDev: 17.8,
    maxBackDev: 23.1,
  },
  4.0: {
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 3,
    maxSurface: 5,
    maxFrontDev: 70.4,
    maxBackDev: 23.6,
  },
  3.0: {
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 4,
    maxSurface: 5,
    maxFrontDev: 34.1,
    maxBackDev: 21.8,
  },
  2.0: {
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 5,
    maxSurface: 6,
    maxFrontDev: 28.4,
    maxBackDev: 19.9,
  },
  1.0: {
    maxDefects: 6,
    maxCorner: 5,
    maxEdge: 4,
    maxSurface: 6,
    maxFrontDev: 25.7,
    maxBackDev: 26.3,
  },
};

// ============================================================================
// DEFECT GRADE CAPS (The 5-defect cliff)
// ============================================================================

export const DEFECT_GRADE_CAPS = {
  0: 10.0,  // Perfect - can be PRISTINE
  1: 10.0,  // GEM MINT
  2: 10.0,  // GEM MINT
  3: 10.0,  // Can still be grade 10
  4: 9.0,   // MINT max
  5: 8.5,   // NM-MT+ max - THE 5-DEFECT CLIFF
  6: 8.5,   // NM-MT+ max
};

// ============================================================================
// FRONT/BACK WEIGHTING
// ============================================================================

export const DEFECT_WEIGHTS = {
  front: 1.5,  // Front defects weighted 1.5x
  back: 1.0,   // Back defects weighted 1.0x
};

// ============================================================================
// GRADE COLORS (UI display)
// ============================================================================

export const GRADE_COLORS = {
  10.0: { color: '#00ff88', bg: 'rgba(0,255,136,0.10)' },
  9.5:  { color: '#00dd77', bg: 'rgba(0,221,119,0.08)' },
  9.0:  { color: '#66dd44', bg: 'rgba(102,221,68,0.08)' },
  8.5:  { color: '#ccbb00', bg: 'rgba(204,187,0,0.08)' },
  8.0:  { color: '#ff9900', bg: 'rgba(255,153,0,0.08)' },
  7.5:  { color: '#ff7722', bg: 'rgba(255,119,34,0.08)' },
  7.0:  { color: '#ff6633', bg: 'rgba(255,102,51,0.08)' },
  6.5:  { color: '#ff5544', bg: 'rgba(255,85,68,0.08)' },
  6.0:  { color: '#ff4444', bg: 'rgba(255,68,68,0.08)' },
  5.5:  { color: '#dd3333', bg: 'rgba(221,51,51,0.08)' },
  5.0:  { color: '#cc2222', bg: 'rgba(204,34,34,0.08)' },
  4.5:  { color: '#bb1111', bg: 'rgba(187,17,17,0.08)' },
  4.0:  { color: '#aa1111', bg: 'rgba(170,17,17,0.08)' },
  3.5:  { color: '#991111', bg: 'rgba(153,17,17,0.08)' },
  3.0:  { color: '#881111', bg: 'rgba(136,17,17,0.08)' },
  2.5:  { color: '#771111', bg: 'rgba(119,17,17,0.08)' },
  2.0:  { color: '#661111', bg: 'rgba(102,17,17,0.08)' },
  1.5:  { color: '#551111', bg: 'rgba(85,17,17,0.08)' },
  1.0:  { color: '#441111', bg: 'rgba(68,17,17,0.08)' },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get centering grade based on deviation from 50/50
 * @param {number} frontDeviation - Front max deviation % (e.g., 5 = 45/55)
 * @param {number} backDeviation - Back max deviation %
 * @param {string} company - Company ID (tag, psa, bgs, cgc, sgc)
 * @returns {number} Maximum grade allowed by centering
 */
export function getCenteringGrade(frontDeviation, backDeviation, company = 'tag') {
  const thresholds = CENTERING_THRESHOLDS[company];
  if (!thresholds) return 1.0;

  const frontThresholds = thresholds.front;
  const backThresholds = thresholds.back;

  // Get available grades for this company (descending order)
  const grades = Object.keys(frontThresholds)
    .filter(k => !isNaN(parseFloat(k)))
    .map(k => parseFloat(k))
    .sort((a, b) => b - a);

  for (const grade of grades) {
    const frontMax = frontThresholds[grade];
    const backMax = backThresholds[grade];

    if (frontMax !== undefined && backMax !== undefined) {
      if (frontDeviation <= frontMax && backDeviation <= backMax) {
        return grade;
      }
    }
  }

  return 1.0;
}

/**
 * Get the maximum grade allowed based on defect counts
 * @param {number} totalDefects - Total defect count
 * @param {number} cornerDefects - Corner defect count
 * @param {number} edgeDefects - Edge defect count
 * @param {number} surfaceDefects - Surface defect count
 * @returns {number} Maximum allowed grade
 */
export function getMaxGradeByDefects(totalDefects, cornerDefects = 0, edgeDefects = 0, surfaceDefects = 0) {
  const grades = [10.0, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0];

  for (const grade of grades) {
    const ceiling = GRADE_CEILINGS[grade];
    if (!ceiling) continue;

    if (totalDefects <= ceiling.maxDefects &&
        cornerDefects <= ceiling.maxCorner &&
        edgeDefects <= ceiling.maxEdge &&
        surfaceDefects <= ceiling.maxSurface) {
      return grade;
    }
  }

  return 1.0;
}

/**
 * Convert centering ratio to deviation from 50
 * @param {number} ratio - The smaller side (e.g., 45 from 45/55)
 * @returns {number} Deviation from 50 (e.g., 5)
 */
export function ratioToDeviation(ratio) {
  return Math.abs(50 - ratio);
}

/**
 * Convert deviation to centering ratio string
 * @param {number} deviation - Deviation from 50 (e.g., 5)
 * @returns {string} Ratio string (e.g., "45/55")
 */
export function deviationToRatio(deviation) {
  const smaller = 50 - deviation;
  const larger = 50 + deviation;
  return `${smaller}/${larger}`;
}

/**
 * Get TAG score from grade
 * @param {number} grade - Grade value (e.g., 9.0)
 * @returns {number} Minimum score for that grade
 */
export function gradeToTAGScore(grade) {
  const threshold = TAG_SCORE_THRESHOLDS[grade];
  return threshold ? threshold.min : 100;
}

/**
 * Get grade from TAG score
 * @param {number} score - TAG score (100-1000)
 * @returns {{ grade: number, label: string, isPristine: boolean }}
 */
export function TAGScoreToGrade(score) {
  // Check Pristine first
  if (score >= 990) {
    return { grade: 10.0, label: 'Pristine', isPristine: true };
  }

  const grades = Object.keys(TAG_SCORE_THRESHOLDS)
    .map(k => parseFloat(k))
    .sort((a, b) => b - a);

  for (const grade of grades) {
    const threshold = TAG_SCORE_THRESHOLDS[grade];
    if (score >= threshold.min) {
      return { grade, label: threshold.label, isPristine: false };
    }
  }

  return { grade: 1.0, label: 'Poor', isPristine: false };
}

/**
 * Get grade color for UI
 * @param {number} grade - Grade value
 * @returns {{ color: string, bg: string }}
 */
export function getGradeColor(grade) {
  // Round to nearest half grade
  const roundedGrade = Math.round(grade * 2) / 2;
  return GRADE_COLORS[roundedGrade] || GRADE_COLORS[1.0];
}

/**
 * Get grade label
 * @param {number} grade - Grade value
 * @param {boolean} isPristine - Whether this is a Pristine 10
 * @returns {string}
 */
export function getGradeLabel(grade, isPristine = false) {
  if (grade === 10 && isPristine) return 'Pristine';
  return GRADE_LABELS[grade] || 'Unknown';
}

/**
 * Calculate software grading confidence based on image quality
 * @param {object} imageQuality - Quality metrics from checkImageQuality
 * @param {object} options - Additional factors
 * @returns {{ confidence: number, factors: string[] }}
 */
export function calculateSoftwareConfidence(imageQuality, options = {}) {
  let confidence = 1.0;
  const factors = [];

  // Image sharpness (blur detection)
  if (imageQuality?.metrics?.sharpness !== undefined) {
    const sharpness = imageQuality.metrics.sharpness;
    if (sharpness < 100) {
      confidence -= 0.30;
      factors.push('Very blurry image');
    } else if (sharpness < 300) {
      confidence -= 0.15;
      factors.push('Slightly blurry');
    } else if (sharpness > 800) {
      confidence += 0.05;
    }
  }

  // Overexposure / glare
  if (imageQuality?.metrics?.brightRatio !== undefined) {
    const bright = imageQuality.metrics.brightRatio;
    if (bright > 30) {
      confidence -= 0.25;
      factors.push('Significant glare/overexposure');
    } else if (bright > 15) {
      confidence -= 0.10;
      factors.push('Some glare detected');
    }
  }

  // Underexposure
  if (imageQuality?.metrics?.darkRatio !== undefined) {
    const dark = imageQuality.metrics.darkRatio;
    if (dark > 40) {
      confidence -= 0.20;
      factors.push('Image too dark');
    } else if (dark > 25) {
      confidence -= 0.10;
      factors.push('Low lighting');
    }
  }

  // Low contrast
  if (imageQuality?.metrics?.contrast !== undefined) {
    const contrast = imageQuality.metrics.contrast;
    if (contrast < 50) {
      confidence -= 0.15;
      factors.push('Low contrast');
    }
  }

  // Manual centering used (higher confidence)
  if (options.manualCentering) {
    confidence += 0.10;
    factors.push('Manual centering (higher accuracy)');
  }

  // High-res images
  if (options.imageWidth && options.imageWidth > 2000) {
    confidence += 0.05;
    factors.push('High resolution image');
  }

  // Clamp to 0.1 - 1.0 range
  confidence = Math.max(0.1, Math.min(1.0, confidence));

  return {
    confidence: Math.round(confidence * 100) / 100,
    factors,
  };
}

/**
 * Apply company-specific grading algorithm
 * @param {string} company - Company ID
 * @param {object} scores - { centering, corners, edges, surface }
 * @returns {number} Final grade
 */
export function applyGradingAlgorithm(company, scores) {
  const { centering, corners, edges, surface } = scores;
  const allScores = [centering, corners, edges, surface].filter(s => s != null);

  if (allScores.length === 0) return 1.0;

  const minScore = Math.min(...allScores);
  const avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;

  const scale = GRADE_SCALES[company];
  if (!scale) return minScore;

  switch (scale.algorithm) {
    case 'compounding':
      // TAG: min × 0.75 + avg × 0.25
      return minScore * 0.75 + avgScore * 0.25;

    case '0.5_rule':
      // BGS: Final = lowest + 0.5 max (unless 2+ share lowest)
      const countAtMin = allScores.filter(s => s === minScore).length;
      if (countAtMin >= 2) return minScore;
      return Math.min(minScore + 0.5, 10);

    case 'holistic':
      // CGC: Can compensate for centering if others are strong
      const conditionScores = [corners, edges, surface].filter(s => s != null);
      const conditionAvg = conditionScores.length > 0
        ? conditionScores.reduce((a, b) => a + b, 0) / conditionScores.length
        : 0;

      if (conditionAvg >= 9.5 && centering >= 8) {
        return Math.min(conditionAvg, centering + 0.5);
      }
      return minScore;

    case 'lowest_factor':
    default:
      // PSA, SGC: Weakest area = final grade
      return minScore;
  }
}

// ============================================================================
// LEGACY COMPATIBILITY (for gradingScales.js consumers)
// ============================================================================

export const GRADING_COMPANIES = Object.fromEntries(
  Object.entries(GRADE_SCALES).map(([id, scale]) => [
    id,
    {
      ...scale,
      grades: Object.entries(TAG_SCORE_THRESHOLDS).map(([grade, data]) => ({
        grade: parseFloat(grade),
        label: data.label,
        min: data.min,
        max: data.min + 49,
        ...GRADE_COLORS[parseFloat(grade)],
      })),
      centeringThresholds: {
        front: Object.fromEntries(
          Object.entries(CENTERING_THRESHOLDS[id]?.front || {})
            .filter(([k]) => !isNaN(parseFloat(k)))
            .map(([k, v]) => [parseFloat(k), 50 + v]) // Convert deviation to max side
        ),
        back: Object.fromEntries(
          Object.entries(CENTERING_THRESHOLDS[id]?.back || {})
            .filter(([k]) => !isNaN(parseFloat(k)))
            .map(([k, v]) => [parseFloat(k), 50 + v])
        ),
      },
    },
  ])
);

export const DEFAULT_GRADING_COMPANY = 'tag';
export const COMPANY_IDS = Object.keys(GRADE_SCALES);

export function getCompanyOptions() {
  return COMPANY_IDS.map(id => ({
    id,
    name: GRADE_SCALES[id].name,
    fullName: GRADE_SCALES[id].fullName,
  }));
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  // Scales and data
  GRADE_SCALES,
  TAG_SCORE_THRESHOLDS,
  GRADE_LABELS,
  CENTERING_THRESHOLDS,
  GRADE_CEILINGS,
  DEFECT_GRADE_CAPS,
  DEFECT_WEIGHTS,
  GRADE_COLORS,

  // Functions
  getCenteringGrade,
  getMaxGradeByDefects,
  ratioToDeviation,
  deviationToRatio,
  gradeToTAGScore,
  TAGScoreToGrade,
  getGradeColor,
  getGradeLabel,
  calculateSoftwareConfidence,
  applyGradingAlgorithm,

  // Legacy compatibility
  GRADING_COMPANIES,
  DEFAULT_GRADING_COMPANY,
  COMPANY_IDS,
  getCompanyOptions,
};
