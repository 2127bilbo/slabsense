/**
 * TAG Coordinate System Utilities
 *
 * Converts TAG grading coordinates to image pixel/percentage coordinates
 * and determines which scoring zone a defect falls into.
 */

// TAG calibration values (from TAG_COORDINATE_MAPPING.md)
export const TAG_CALIBRATION = {
  front: {
    scaleX: 0.9808653546711816,
    offsetX: 35.73243034657268,
    scaleY: 0.985914375084105,
    offsetY: 32.327281025553326
  },
  back: {
    scaleX: 1.0094184051332116,
    offsetX: 9.52233267315872,
    scaleY: 1.00148208928669,
    offsetY: 50.37741061244348
  }
};

// Standard TAG image dimensions
export const TAG_IMAGE_WIDTH = 4500;
export const TAG_IMAGE_HEIGHT = 6300;

// Zone boundaries (percentage from center to edge)
export const TAG_ZONES = {
  front: [
    { left: 12.045, right: 14.994, top: 19.266, bottom: 21.416 }, // Zone 0 - Inner center
    { left: 19.478, right: 22.430, top: 25.451, bottom: 27.599 }, // Zone 1 - Center
    { left: 26.916, right: 29.865, top: 31.635, bottom: 33.783 }, // Zone 2 - Mid-field
    { left: 34.352, right: 37.303, top: 37.820, bottom: 39.967 }, // Zone 3 - Outer mid-field
    { left: 41.785, right: 44.738, top: 44.003, bottom: 46.152 }, // Zone 4 - Near edge
    { left: 50.000, right: 50.000, top: 50.000, bottom: 50.000 }  // Zone 5 - Edge/Corner
  ],
  back: [
    { left: 12.028, right: 15.003, top: 19.267, bottom: 21.416 },
    { left: 19.467, right: 22.436, top: 25.450, bottom: 27.602 },
    { left: 26.898, right: 29.871, top: 31.635, bottom: 33.788 },
    { left: 34.334, right: 37.306, top: 37.815, bottom: 39.971 },
    { left: 41.765, right: 44.738, top: 44.000, bottom: 46.152 },
    { left: 50.000, right: 50.000, top: 50.000, bottom: 50.000 }
  ]
};

// Zone descriptions
export const ZONE_LABELS = [
  'Inner Center',
  'Center',
  'Mid-field',
  'Outer Mid-field',
  'Near Edge',
  'Edge/Corner'
];

// Zone colors for visualization
export const ZONE_COLORS = [
  '#8B0000', // Zone 0 - Dark red (most protected)
  '#DC143C', // Zone 1 - Crimson
  '#FF8C00', // Zone 2 - Dark orange
  '#FFD700', // Zone 3 - Gold
  '#32CD32', // Zone 4 - Lime green
  '#00CED1'  // Zone 5 - Cyan (edge/corner)
];

/**
 * Convert TAG coordinates to image pixel coordinates
 * @param {number} tagX - TAG X coordinate
 * @param {number} tagY - TAG Y coordinate
 * @param {string} side - 'front' or 'back'
 * @returns {{ x: number, y: number }}
 */
export function tagToImage(tagX, tagY, side) {
  const cal = TAG_CALIBRATION[side.toLowerCase()];
  return {
    x: (tagX * cal.scaleX) + cal.offsetX,
    y: (tagY * cal.scaleY) + cal.offsetY
  };
}

/**
 * Convert image pixel coordinates to TAG coordinates
 * @param {number} imageX - Image X coordinate in pixels
 * @param {number} imageY - Image Y coordinate in pixels
 * @param {string} side - 'front' or 'back'
 * @returns {{ x: number, y: number }}
 */
export function imageToTag(imageX, imageY, side) {
  const cal = TAG_CALIBRATION[side.toLowerCase()];
  return {
    x: (imageX - cal.offsetX) / cal.scaleX,
    y: (imageY - cal.offsetY) / cal.scaleY
  };
}

/**
 * Convert image coordinates to percentage of image dimensions
 * @param {number} imageX - Image X coordinate in pixels
 * @param {number} imageY - Image Y coordinate in pixels
 * @param {number} width - Image width (default TAG_IMAGE_WIDTH)
 * @param {number} height - Image height (default TAG_IMAGE_HEIGHT)
 * @returns {{ x: number, y: number }} Percentages (0-100)
 */
export function imageToPercent(imageX, imageY, width = TAG_IMAGE_WIDTH, height = TAG_IMAGE_HEIGHT) {
  return {
    x: (imageX / width) * 100,
    y: (imageY / height) * 100
  };
}

/**
 * Convert TAG coordinates directly to percentage
 * @param {number} tagX - TAG X coordinate
 * @param {number} tagY - TAG Y coordinate
 * @param {string} side - 'front' or 'back'
 * @returns {{ x: number, y: number }} Percentages (0-100)
 */
export function tagToPercent(tagX, tagY, side) {
  const imageCoords = tagToImage(tagX, tagY, side);
  return imageToPercent(imageCoords.x, imageCoords.y);
}

/**
 * Determine which zone a defect falls into
 * @param {number} imageX - X coordinate in image pixels
 * @param {number} imageY - Y coordinate in image pixels
 * @param {number} imageWidth - Total image width
 * @param {number} imageHeight - Total image height
 * @param {string} side - 'front' or 'back'
 * @returns {number} Zone index (0-5), where 0 is center and 5 is edge
 */
export function getZone(imageX, imageY, imageWidth, imageHeight, side) {
  const centerX = imageWidth / 2;
  const centerY = imageHeight / 2;

  // Calculate distance from center as percentage
  const distLeftPct = ((centerX - imageX) / imageWidth) * 100;
  const distRightPct = ((imageX - centerX) / imageWidth) * 100;
  const distTopPct = ((centerY - imageY) / imageHeight) * 100;
  const distBottomPct = ((imageY - centerY) / imageHeight) * 100;

  const zones = TAG_ZONES[side.toLowerCase()];

  // Check zones from innermost (0) to outermost (5)
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const insideLeft = distLeftPct <= zone.left;
    const insideRight = distRightPct <= zone.right;
    const insideTop = distTopPct <= zone.top;
    const insideBottom = distBottomPct <= zone.bottom;

    if (insideLeft && insideRight && insideTop && insideBottom) {
      return i;
    }
  }

  return 5; // Default to outermost zone
}

/**
 * Get defect category from TAG type string
 * @param {string} tagType - TAG defect type (e.g., "SURFACE / SCRATCH")
 * @returns {'corner' | 'edge' | 'surface'}
 */
export function getDefectCategory(tagType) {
  const type = (tagType || '').toUpperCase();
  if (type.includes('CORNER')) return 'corner';
  if (type.includes('EDGE')) return 'edge';
  return 'surface';
}

/**
 * Check if coordinates are in percentage format (0-100) vs TAG format (0-4500/6300)
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {boolean}
 */
function isPercentageCoords(x, y) {
  // If both values are <= 100, assume percentage format
  // TAG coords would typically be > 100 for any visible defect on the card
  return x <= 100 && y <= 100;
}

/**
 * Process raw TAG defects into display format
 * Supports both TAG coordinates (0-4500 x 0-6300) and percentage coordinates (0-100)
 * @param {Array} tagDefects - Raw defects from TAG API/analysis or AI output
 * @param {number} defaultBoxSize - Default box size as percentage (default 5%)
 * @returns {{ front: Array, back: Array }}
 */
export function processTagDefects(tagDefects, defaultBoxSize = 5) {
  const result = { front: [], back: [] };

  if (!tagDefects || !Array.isArray(tagDefects)) {
    return result;
  }

  tagDefects.forEach((defect, index) => {
    const side = (defect.side || 'front').toLowerCase();
    const hasCoords = defect.x !== undefined && defect.y !== undefined;

    let center, zone;

    if (hasCoords) {
      // Check if AI provided percentage coords (0-100) or TAG coords (0-4500/6300)
      if (isPercentageCoords(defect.x, defect.y)) {
        // Percentage format from AI - use directly
        center = { x: defect.x, y: defect.y };
        // Estimate zone from percentage position
        const distFromCenterX = Math.abs(50 - defect.x);
        const distFromCenterY = Math.abs(50 - defect.y);
        const maxDist = Math.max(distFromCenterX, distFromCenterY);
        // Map distance to zone (0-5)
        zone = maxDist < 10 ? 0 : maxDist < 15 ? 1 : maxDist < 25 ? 2 : maxDist < 35 ? 3 : maxDist < 42 ? 4 : 5;
      } else {
        // TAG coordinate format - convert to image pixels then percentage
        const imageCoords = tagToImage(defect.x, defect.y, side);
        center = imageToPercent(imageCoords.x, imageCoords.y);
        zone = getZone(imageCoords.x, imageCoords.y, TAG_IMAGE_WIDTH, TAG_IMAGE_HEIGHT, side);
      }
    } else {
      // Fallback: estimate position from location string
      center = estimatePositionFromLocation(defect.location);
      zone = 5; // Assume edge/corner if no coords
    }

    const category = getDefectCategory(defect.type);

    // Use AI-provided width/height if available, otherwise default
    const boxWidth = defect.width || defaultBoxSize;
    const boxHeight = defect.height || defaultBoxSize;

    result[side].push({
      id: defect.ordering || defect.id || index + 1,
      type: category,
      label: defect.type || 'Unknown Defect',
      location: defect.location || 'Unknown',
      tagCoords: hasCoords && !isPercentageCoords(defect.x, defect.y) ? { x: defect.x, y: defect.y } : null,
      percentCoords: hasCoords && isPercentageCoords(defect.x, defect.y) ? { x: defect.x, y: defect.y } : null,
      center,
      bounds: {
        x1: Math.max(0, center.x - boxWidth / 2),
        y1: Math.max(0, center.y - boxHeight / 2),
        x2: Math.min(100, center.x + boxWidth / 2),
        y2: Math.min(100, center.y + boxHeight / 2)
      },
      zone,
      zoneLabel: ZONE_LABELS[zone],
      severity: defect.severity || 'moderate',
      imageUrl: defect.image_url || null
    });
  });

  return result;
}

/**
 * Estimate position from location string (fallback when no coords)
 * @param {string} location - e.g., "TOP LEFT", "BOTTOM CENTER"
 * @returns {{ x: number, y: number }}
 */
function estimatePositionFromLocation(location) {
  const loc = (location || '').toUpperCase();

  let x = 50, y = 50; // Default center

  // Horizontal
  if (loc.includes('LEFT')) x = 10;
  else if (loc.includes('RIGHT')) x = 90;
  else if (loc.includes('CENTER')) x = 50;

  // Vertical
  if (loc.includes('TOP')) y = 10;
  else if (loc.includes('BOTTOM')) y = 90;
  else if (loc.includes('MIDDLE') || loc.includes('CENTER')) y = 50;

  return { x, y };
}

/**
 * Convert our internal defect format to SlabSense dings format
 * @param {Object} processedDefects - Output from processTagDefects
 * @returns {Array} Array compatible with gradeResult.allDings
 */
export function toSlabSenseDings(processedDefects) {
  const allDings = [];

  ['front', 'back'].forEach(side => {
    (processedDefects[side] || []).forEach(defect => {
      allDings.push({
        type: defect.label,
        location: `${side.toUpperCase()} / ${defect.location}`,
        side: side.toUpperCase(),
        desc: `${defect.label} detected in ${defect.zoneLabel} (Zone ${defect.zone})`,
        zone: defect.zone,
        coords: defect.tagCoords,
        bounds: defect.bounds
      });
    });
  });

  return allDings;
}

export default {
  TAG_CALIBRATION,
  TAG_IMAGE_WIDTH,
  TAG_IMAGE_HEIGHT,
  TAG_ZONES,
  ZONE_LABELS,
  ZONE_COLORS,
  tagToImage,
  imageToTag,
  imageToPercent,
  tagToPercent,
  getZone,
  getDefectCategory,
  processTagDefects,
  toSlabSenseDings
};
