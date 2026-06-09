/**
 * TAG Calibration Data
 *
 * Derived from analysis of 507 real TAG-graded reference cards.
 * Centering values are MAX DEVIATION from 50/50 (not ratios).
 *
 * Example: 2.0 means 48/52 or 52/48 is the max allowed.
 */

// Centering thresholds - P90 values (90% of cards at grade meet this)
// Values are MAX DEVIATION % from perfect 50/50 centering
// TAG grades: 10 (Pristine/Gem Mint), 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, etc.
// Note: Both Pristine and Gem Mint are grade 10, distinguished by score range
export const TAG_CENTERING_THRESHOLDS = {
  front: {
    // 10 Pristine: 990-1000 score, max 2% deviation (48/52)
    // 10 Gem Mint: 950-989 score, max 5% deviation (45/55) - per TAG guidelines
    10.0: 5.0,    // GRADE 10 (Gem Mint) - max 5% deviation (45/55)
    9.0: 10.0,    // MINT - max 10% deviation (40/60)
    8.5: 12.5,    // NM-MT+
    8.0: 15.0,    // NM-MT
    7.5: 17.5,    // NEAR MINT+
    7.0: 20.0,    // NEAR MINT
    6.5: 22.5,    // EX-MT+
    6.0: 25.0,    // EX-MT
    5.5: 27.5,    // EX+
    5.0: 30.0,    // EXCELLENT
    4.0: 35.0,    // VG-EX
    3.0: 40.0,    // VG
    2.0: 45.0,    // GOOD
    1.0: 50.0,    // POOR
  },
  back: {
    // Back centering is more lenient than front
    10.0: 15.0,   // GRADE 10 - max 15% deviation (35/65)
    9.0: 25.0,    // MINT
    8.5: 27.5,    // NM-MT+
    8.0: 30.0,    // NM-MT
    7.5: 32.5,    // NEAR MINT+
    7.0: 35.0,    // NEAR MINT
    6.5: 37.5,    // EX-MT+
    6.0: 40.0,    // EX-MT
    5.0: 45.0,    // EXCELLENT
    4.0: 50.0,    // VG-EX
    3.0: 50.0,    // VG
    2.0: 50.0,    // GOOD
    1.0: 50.0,    // POOR
  }
};

// Grade ceiling rules - cards CANNOT exceed these limits
// Based on MAX observed values in each grade category
// Note: TAG uses 10 for both Pristine and Gem Mint (no 9.9 grade)
export const GRADE_CEILINGS = {
  10.0: { // GRADE 10 (Pristine/Gem Mint)
    maxDefects: 3,
    maxCorner: 1,
    maxEdge: 1,
    maxSurface: 3,
    maxFrontDev: 5.0,
    maxBackDev: 15.0,
  },
  9.0: { // MINT
    maxDefects: 4,
    maxCorner: 3,
    maxEdge: 2,
    maxSurface: 3,
    maxFrontDev: 21.9,
    maxBackDev: 18.3,
  },
  8.5: { // NM-MT+
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 2,
    maxSurface: 2,
    maxFrontDev: 24.5,
    maxBackDev: 22.5,
  },
  8.0: { // NM-MT
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 3,
    maxSurface: 3,
    maxFrontDev: 30.3,
    maxBackDev: 20.6,
  },
  7.5: { // NEAR MINT+
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 3,
    maxSurface: 3,
    maxFrontDev: 32.9,
    maxBackDev: 33.3,
  },
  7.0: { // NEAR MINT
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 4,
    maxSurface: 3,
    maxFrontDev: 37.1,
    maxBackDev: 31.0,
  },
  6.5: { // EX-MT+
    maxDefects: 6,
    maxCorner: 5,
    maxEdge: 3,
    maxSurface: 4,
    maxFrontDev: 42.6,
    maxBackDev: 33.1,
  },
  6.0: { // EX-MT
    maxDefects: 6,
    maxCorner: 6,
    maxEdge: 3,
    maxSurface: 3,
    maxFrontDev: 30.0,
    maxBackDev: 21.5,
  },
  5.0: { // EXCELLENT
    maxDefects: 6,
    maxCorner: 5,
    maxEdge: 2,
    maxSurface: 5,
    maxFrontDev: 17.8,
    maxBackDev: 23.1,
  },
  4.0: { // VG-EX
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 3,
    maxSurface: 5,
    maxFrontDev: 70.4,
    maxBackDev: 23.6,
  },
  3.0: { // VG
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 4,
    maxSurface: 5,
    maxFrontDev: 34.1,
    maxBackDev: 21.8,
  },
  2.0: { // GOOD
    maxDefects: 6,
    maxCorner: 4,
    maxEdge: 5,
    maxSurface: 6,
    maxFrontDev: 28.4,
    maxBackDev: 19.9,
  },
  1.0: { // POOR
    maxDefects: 6,
    maxCorner: 5,
    maxEdge: 4,
    maxSurface: 6,
    maxFrontDev: 25.7,
    maxBackDev: 26.3,
  },
};

// Defect count to grade ceiling mapping
// Cards with this many total defects CANNOT exceed this grade
// Note: TAG uses 10 for both Pristine (990+) and Gem Mint (950-989)
export const DEFECT_GRADE_CAPS = {
  0: 10.0,  // Perfect - can be PRISTINE
  1: 10.0,  // GEM MINT (still grade 10)
  2: 10.0,  // GEM MINT (still grade 10)
  3: 10.0,  // Can still be grade 10 (surface defects allowed)
  4: 9.0,   // MINT max
  5: 8.5,   // NM-MT+ max - THE 5-DEFECT CLIFF
  6: 8.5,   // NM-MT+ max
};

// Average defect counts by grade (for reference/validation)
export const AVG_DEFECTS_BY_GRADE = {
  10.0: 0.4,  // GRADE 10 (Pristine/Gem Mint combined)
  9.0: 1.9,   // MINT
  8.5: 2.8,   // NM-MT+
  8.0: 2.7,   // NM-MT
  7.5: 3.3,   // NEAR MINT+
  7.0: 3.1,   // NEAR MINT
  6.5: 4.0,   // EX-MT+
  6.0: 4.1,   // EX-MT
  5.0: 4.2,   // EXCELLENT
  4.0: 4.8,   // VG-EX
  3.0: 5.2,   // VG
  2.0: 5.1,   // GOOD
  1.0: 5.4,   // POOR
};

/**
 * Get the maximum grade allowed based on defect counts
 * @param {number} totalDefects - Total defect count
 * @param {number} cornerDefects - Corner defect count
 * @param {number} edgeDefects - Edge defect count
 * @param {number} surfaceDefects - Surface defect count
 * @returns {number} Maximum allowed grade (e.g., 10.0, 9.9, 9.0, etc.)
 */
export function getMaxGradeByDefects(totalDefects, cornerDefects = 0, edgeDefects = 0, surfaceDefects = 0) {
  // Check each grade level from highest to lowest
  // TAG actual grades (no 9.9 - both Pristine and Gem Mint are grade 10)
  const grades = [10.0, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0];

  for (const grade of grades) {
    const ceiling = GRADE_CEILINGS[grade];
    if (!ceiling) continue;

    // Check if card meets all requirements for this grade
    if (totalDefects <= ceiling.maxDefects &&
        cornerDefects <= ceiling.maxCorner &&
        edgeDefects <= ceiling.maxEdge &&
        surfaceDefects <= ceiling.maxSurface) {
      return grade;
    }
  }

  return 1.0; // Minimum grade
}

/**
 * Get centering grade based on deviation from 50/50
 * @param {number} frontDeviation - Front max deviation % (e.g., 5 = 45/55 or 55/45)
 * @param {number} backDeviation - Back max deviation %
 * @returns {number} Maximum grade allowed by centering
 */
export function getCenteringGrade(frontDeviation, backDeviation) {
  // TAG actual grades (no 9.9 - both Pristine and Gem Mint are grade 10)
  const grades = [10.0, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5, 6.0, 5.5, 5.0, 4.0, 3.0, 2.0, 1.0];

  for (const grade of grades) {
    const frontMax = TAG_CENTERING_THRESHOLDS.front[grade];
    const backMax = TAG_CENTERING_THRESHOLDS.back[grade];

    if (frontMax !== undefined && backMax !== undefined) {
      if (frontDeviation <= frontMax && backDeviation <= backMax) {
        return grade;
      }
    }
  }

  return 1.0;
}

/**
 * Convert centering ratio (e.g., 45) to deviation (e.g., 5)
 * @param {number} ratio - The smaller side of the ratio (e.g., 45 from 45/55)
 * @returns {number} Deviation from 50 (e.g., 5)
 */
export function ratioToDeviation(ratio) {
  return Math.abs(50 - ratio);
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
      // High sharpness = higher confidence
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

  // Manual centering used (higher confidence than auto-detected)
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

export default {
  TAG_CENTERING_THRESHOLDS,
  GRADE_CEILINGS,
  DEFECT_GRADE_CAPS,
  AVG_DEFECTS_BY_GRADE,
  getMaxGradeByDefects,
  getCenteringGrade,
  ratioToDeviation,
  calculateSoftwareConfidence,
};
