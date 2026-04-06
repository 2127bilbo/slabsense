/**
 * SlabSense - Grading Company Scales Configuration
 *
 * This file contains the grading scales, thresholds, and configurations
 * for all supported grading companies.
 */

export const GRADING_COMPANIES = {
  tag: {
    id: 'tag',
    name: 'TAG',
    fullName: 'True Authentic Grading',
    scaleType: '1000-point to 1-10',
    hasSubgrades: true,
    hasHalfPoints: true,
    subgradeCategories: ['Front Centering', 'Back Centering', 'Front Corners', 'Back Corners', 'Front Edges', 'Back Edges', 'Front Surface', 'Back Surface'],
    grades: [
      { grade: 10, label: 'Pristine', min: 990, max: 1000, color: '#00ff88', bg: 'rgba(0,255,136,0.10)' },
      { grade: 10, label: 'Gem Mint', min: 950, max: 989, color: '#00dd77', bg: 'rgba(0,221,119,0.08)' },
      { grade: 9, label: 'Mint', min: 900, max: 949, color: '#66dd44', bg: 'rgba(102,221,68,0.08)' },
      { grade: 8.5, label: 'NM-MT+', min: 850, max: 899, color: '#ccbb00', bg: 'rgba(204,187,0,0.08)' },
      { grade: 8, label: 'NM-MT', min: 800, max: 849, color: '#ff9900', bg: 'rgba(255,153,0,0.08)' },
      { grade: 7.5, label: 'NM+', min: 750, max: 799, color: '#ff7722', bg: 'rgba(255,119,34,0.08)' },
      { grade: 7, label: 'NM', min: 700, max: 749, color: '#ff6633', bg: 'rgba(255,102,51,0.08)' },
      { grade: 6.5, label: 'EX-MT+', min: 650, max: 699, color: '#ff5544', bg: 'rgba(255,85,68,0.08)' },
      { grade: 6, label: 'EX-MT', min: 600, max: 649, color: '#ff4444', bg: 'rgba(255,68,68,0.08)' },
      { grade: 5.5, label: 'EX+', min: 550, max: 599, color: '#dd3333', bg: 'rgba(221,51,51,0.08)' },
      { grade: 5, label: 'EX', min: 500, max: 549, color: '#cc2222', bg: 'rgba(204,34,34,0.08)' },
      { grade: 4.5, label: 'VG-EX+', min: 450, max: 499, color: '#bb1111', bg: 'rgba(187,17,17,0.08)' },
      { grade: 4, label: 'VG-EX', min: 400, max: 449, color: '#aa1111', bg: 'rgba(170,17,17,0.08)' },
      { grade: 3.5, label: 'VG+', min: 350, max: 399, color: '#991111', bg: 'rgba(153,17,17,0.08)' },
      { grade: 3, label: 'VG', min: 300, max: 349, color: '#881111', bg: 'rgba(136,17,17,0.08)' },
      { grade: 2.5, label: 'Good+', min: 250, max: 299, color: '#771111', bg: 'rgba(119,17,17,0.08)' },
      { grade: 2, label: 'Good', min: 200, max: 249, color: '#661111', bg: 'rgba(102,17,17,0.08)' },
      { grade: 1.5, label: 'Fair', min: 150, max: 199, color: '#551111', bg: 'rgba(85,17,17,0.08)' },
      { grade: 1, label: 'Poor', min: 100, max: 149, color: '#441111', bg: 'rgba(68,17,17,0.08)' },
    ],
    centeringThresholds: {
      front: {
        10: { pristine: 51, gem: 55 },
        9: 60,
        8.5: 62.5,
        8: 65,
        7.5: 67.5,
        7: 70,
        6.5: 72.5,
        6: 75,
        5.5: 77.5,
        5: 80,
        4.5: 82.5,
        4: 85,
        3.5: 87.5,
        3: 90,
        2.5: 92.5,
        2: 95,
        1.5: 98.33,
      },
      back: {
        10: { pristine: 52, gem: 65 },
        9: 75,
        8: 85,
      }
    }
  },

  psa: {
    id: 'psa',
    name: 'PSA',
    fullName: 'Professional Sports Authenticator',
    scaleType: '1-10',
    hasSubgrades: false,
    hasHalfPoints: false,
    subgradeCategories: [],
    grades: [
      { grade: 10, label: 'Gem Mint', min: 950, max: 1000, color: '#00ff88', bg: 'rgba(0,255,136,0.10)' },
      { grade: 9, label: 'Mint', min: 850, max: 949, color: '#66dd44', bg: 'rgba(102,221,68,0.08)' },
      { grade: 8, label: 'NM-MT', min: 750, max: 849, color: '#ff9900', bg: 'rgba(255,153,0,0.08)' },
      { grade: 7, label: 'NM', min: 650, max: 749, color: '#ff6633', bg: 'rgba(255,102,51,0.08)' },
      { grade: 6, label: 'EX-MT', min: 550, max: 649, color: '#ff4444', bg: 'rgba(255,68,68,0.08)' },
      { grade: 5, label: 'EX', min: 450, max: 549, color: '#cc2222', bg: 'rgba(204,34,34,0.08)' },
      { grade: 4, label: 'VG-EX', min: 350, max: 449, color: '#aa1111', bg: 'rgba(170,17,17,0.08)' },
      { grade: 3, label: 'VG', min: 250, max: 349, color: '#881111', bg: 'rgba(136,17,17,0.08)' },
      { grade: 2, label: 'Good', min: 150, max: 249, color: '#661111', bg: 'rgba(102,17,17,0.08)' },
      { grade: 1, label: 'Poor', min: 100, max: 149, color: '#441111', bg: 'rgba(68,17,17,0.08)' },
    ],
    centeringThresholds: {
      front: {
        10: 60,
        9: 65,
        8: 70,
        7: 75,
        6: 80,
        5: 85,
        4: 90,
      },
      back: {
        10: 75,
        9: 80,
        8: 90,
      }
    }
  },

  bgs: {
    id: 'bgs',
    name: 'BGS',
    fullName: 'Beckett Grading Services',
    scaleType: '1-10 with subgrades',
    hasSubgrades: true,
    hasHalfPoints: true,
    subgradeCategories: ['Centering', 'Corners', 'Edges', 'Surface'],
    grades: [
      { grade: 10, label: 'Pristine', min: 990, max: 1000, color: '#ffd700', bg: 'rgba(255,215,0,0.10)', special: 'black_label_eligible' },
      { grade: 10, label: 'Perfect', min: 975, max: 989, color: '#00ff88', bg: 'rgba(0,255,136,0.10)' },
      { grade: 9.5, label: 'Gem Mint', min: 925, max: 974, color: '#00dd77', bg: 'rgba(0,221,119,0.08)' },
      { grade: 9, label: 'Mint', min: 875, max: 924, color: '#66dd44', bg: 'rgba(102,221,68,0.08)' },
      { grade: 8.5, label: 'NM-MT+', min: 825, max: 874, color: '#ccbb00', bg: 'rgba(204,187,0,0.08)' },
      { grade: 8, label: 'NM-MT', min: 775, max: 824, color: '#ff9900', bg: 'rgba(255,153,0,0.08)' },
      { grade: 7.5, label: 'NM+', min: 725, max: 774, color: '#ff7722', bg: 'rgba(255,119,34,0.08)' },
      { grade: 7, label: 'NM', min: 675, max: 724, color: '#ff6633', bg: 'rgba(255,102,51,0.08)' },
      { grade: 6.5, label: 'EX-MT+', min: 625, max: 674, color: '#ff5544', bg: 'rgba(255,85,68,0.08)' },
      { grade: 6, label: 'EX-MT', min: 575, max: 624, color: '#ff4444', bg: 'rgba(255,68,68,0.08)' },
      { grade: 5.5, label: 'EX+', min: 525, max: 574, color: '#dd3333', bg: 'rgba(221,51,51,0.08)' },
      { grade: 5, label: 'EX', min: 475, max: 524, color: '#cc2222', bg: 'rgba(204,34,34,0.08)' },
      { grade: 4, label: 'VG-EX', min: 375, max: 474, color: '#aa1111', bg: 'rgba(170,17,17,0.08)' },
      { grade: 3, label: 'VG', min: 275, max: 374, color: '#881111', bg: 'rgba(136,17,17,0.08)' },
      { grade: 2, label: 'Good', min: 175, max: 274, color: '#661111', bg: 'rgba(102,17,17,0.08)' },
      { grade: 1, label: 'Poor', min: 100, max: 174, color: '#441111', bg: 'rgba(68,17,17,0.08)' },
    ],
    centeringThresholds: {
      front: {
        10: 50,
        9.5: 55,
        9: 60,
        8.5: 65,
        8: 70,
        7.5: 75,
        7: 80,
        6: 85,
        5: 90,
      },
      back: {
        10: 55,
        9.5: 60,
        9: 70,
        8: 80,
      }
    }
  },

  cgc: {
    id: 'cgc',
    name: 'CGC',
    fullName: 'Certified Guaranty Company',
    scaleType: '1-10 with subgrades',
    hasSubgrades: true,
    hasHalfPoints: true,
    subgradeCategories: ['Centering', 'Corners', 'Edges', 'Surface'],
    grades: [
      { grade: 10, label: 'Pristine', min: 985, max: 1000, color: '#00ff88', bg: 'rgba(0,255,136,0.10)' },
      { grade: 9.5, label: 'Gem Mint', min: 940, max: 984, color: '#00dd77', bg: 'rgba(0,221,119,0.08)' },
      { grade: 9, label: 'Mint', min: 890, max: 939, color: '#66dd44', bg: 'rgba(102,221,68,0.08)' },
      { grade: 8.5, label: 'NM-MT+', min: 840, max: 889, color: '#ccbb00', bg: 'rgba(204,187,0,0.08)' },
      { grade: 8, label: 'NM-MT', min: 790, max: 839, color: '#ff9900', bg: 'rgba(255,153,0,0.08)' },
      { grade: 7.5, label: 'NM+', min: 740, max: 789, color: '#ff7722', bg: 'rgba(255,119,34,0.08)' },
      { grade: 7, label: 'NM', min: 690, max: 739, color: '#ff6633', bg: 'rgba(255,102,51,0.08)' },
      { grade: 6.5, label: 'EX-MT+', min: 640, max: 689, color: '#ff5544', bg: 'rgba(255,85,68,0.08)' },
      { grade: 6, label: 'EX-MT', min: 590, max: 639, color: '#ff4444', bg: 'rgba(255,68,68,0.08)' },
      { grade: 5.5, label: 'EX+', min: 540, max: 589, color: '#dd3333', bg: 'rgba(221,51,51,0.08)' },
      { grade: 5, label: 'EX', min: 490, max: 539, color: '#cc2222', bg: 'rgba(204,34,34,0.08)' },
      { grade: 4, label: 'VG-EX', min: 390, max: 489, color: '#aa1111', bg: 'rgba(170,17,17,0.08)' },
      { grade: 3, label: 'VG', min: 290, max: 389, color: '#881111', bg: 'rgba(136,17,17,0.08)' },
      { grade: 2, label: 'Good', min: 190, max: 289, color: '#661111', bg: 'rgba(102,17,17,0.08)' },
      { grade: 1, label: 'Poor', min: 100, max: 189, color: '#441111', bg: 'rgba(68,17,17,0.08)' },
    ],
    centeringThresholds: {
      front: {
        10: 55,
        9.5: 60,
        9: 65,
        8.5: 70,
        8: 75,
        7: 80,
        6: 85,
        5: 90,
      },
      back: {
        10: 60,
        9.5: 65,
        9: 75,
        8: 85,
      }
    }
  },

  sgc: {
    id: 'sgc',
    name: 'SGC',
    fullName: 'Sportscard Guaranty Corporation',
    scaleType: '1-10',
    hasSubgrades: false,
    hasHalfPoints: false,
    subgradeCategories: [],
    grades: [
      { grade: 10, label: 'Pristine', min: 960, max: 1000, color: '#00ff88', bg: 'rgba(0,255,136,0.10)', special: 'gold_label' },
      { grade: 10, label: 'Gem Mint', min: 920, max: 959, color: '#00dd77', bg: 'rgba(0,221,119,0.08)' },
      { grade: 9.5, label: 'Mint+', min: 880, max: 919, color: '#44ee55', bg: 'rgba(68,238,85,0.08)' },
      { grade: 9, label: 'Mint', min: 840, max: 879, color: '#66dd44', bg: 'rgba(102,221,68,0.08)' },
      { grade: 8.5, label: 'NM-MT+', min: 800, max: 839, color: '#ccbb00', bg: 'rgba(204,187,0,0.08)' },
      { grade: 8, label: 'NM-MT', min: 760, max: 799, color: '#ff9900', bg: 'rgba(255,153,0,0.08)' },
      { grade: 7.5, label: 'NM+', min: 720, max: 759, color: '#ff7722', bg: 'rgba(255,119,34,0.08)' },
      { grade: 7, label: 'NM', min: 680, max: 719, color: '#ff6633', bg: 'rgba(255,102,51,0.08)' },
      { grade: 6, label: 'EX-MT', min: 600, max: 679, color: '#ff4444', bg: 'rgba(255,68,68,0.08)' },
      { grade: 5, label: 'EX', min: 500, max: 599, color: '#cc2222', bg: 'rgba(204,34,34,0.08)' },
      { grade: 4, label: 'VG-EX', min: 400, max: 499, color: '#aa1111', bg: 'rgba(170,17,17,0.08)' },
      { grade: 3, label: 'VG', min: 300, max: 399, color: '#881111', bg: 'rgba(136,17,17,0.08)' },
      { grade: 2, label: 'Good', min: 200, max: 299, color: '#661111', bg: 'rgba(102,17,17,0.08)' },
      { grade: 1, label: 'Poor', min: 100, max: 199, color: '#441111', bg: 'rgba(68,17,17,0.08)' },
    ],
    centeringThresholds: {
      front: {
        10: 60,
        9: 65,
        8: 70,
        7: 75,
        6: 80,
        5: 90,
      },
      back: {
        10: 75,
        9: 80,
        8: 90,
      }
    }
  }
};

// Default grading company
export const DEFAULT_GRADING_COMPANY = 'tag';

// Get grade from score for a specific company
export function getGradeFromScore(score, companyId = DEFAULT_GRADING_COMPANY) {
  const company = GRADING_COMPANIES[companyId];
  if (!company) return null;

  for (const grade of company.grades) {
    if (score >= grade.min && score <= grade.max) {
      return grade;
    }
  }
  return company.grades[company.grades.length - 1]; // Return lowest grade
}

// Get centering grade for a specific company
export function getCenteringGrade(maxOffset, side, companyId = DEFAULT_GRADING_COMPANY) {
  const company = GRADING_COMPANIES[companyId];
  if (!company) return null;

  const thresholds = company.centeringThresholds[side];
  if (!thresholds) return null;

  const sortedGrades = Object.keys(thresholds)
    .filter(k => typeof thresholds[k] === 'number')
    .map(Number)
    .sort((a, b) => b - a);

  for (const grade of sortedGrades) {
    if (maxOffset <= thresholds[grade]) {
      return grade;
    }
  }

  return 1; // Below all thresholds
}

// Convert between grading systems (approximate)
export function convertGrade(grade, fromCompany, toCompany) {
  // This is a rough conversion - grades don't map 1:1 between companies
  const conversionMap = {
    // From TAG/BGS/CGC (with half points) to PSA (no half points)
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

  if (!GRADING_COMPANIES[toCompany].hasHalfPoints) {
    return conversionMap[grade] || grade;
  }

  return grade;
}

// List of all company IDs
export const COMPANY_IDS = Object.keys(GRADING_COMPANIES);

// Get company display info for dropdown
export function getCompanyOptions() {
  return COMPANY_IDS.map(id => ({
    id,
    name: GRADING_COMPANIES[id].name,
    fullName: GRADING_COMPANIES[id].fullName,
  }));
}
