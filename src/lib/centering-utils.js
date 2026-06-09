/**
 * Centering Utilities
 *
 * Shared utilities for card centering and cropping operations.
 * Used by PostCaptureCentering and ManualBoundaryEditor.
 */

/**
 * Load an image from a data URL or URL
 * @param {string} src - Image source (data URL or URL)
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/**
 * Initialize corner positions with a margin from image edges
 * @param {number} imgWidth - Image width in pixels
 * @param {number} imgHeight - Image height in pixels
 * @param {number} margin - Margin as fraction (default 0.1 = 10%)
 * @returns {{ tl: {x,y}, tr: {x,y}, bl: {x,y}, br: {x,y} }}
 */
export function initializeCorners(imgWidth, imgHeight, margin = 0.1) {
  return {
    tl: { x: Math.round(imgWidth * margin), y: Math.round(imgHeight * margin) },
    tr: { x: Math.round(imgWidth * (1 - margin)), y: Math.round(imgHeight * margin) },
    bl: { x: Math.round(imgWidth * margin), y: Math.round(imgHeight * (1 - margin)) },
    br: { x: Math.round(imgWidth * (1 - margin)), y: Math.round(imgHeight * (1 - margin)) },
  };
}

/**
 * Initialize inner corners (artwork bounds) with offset from outer corners
 * @param {object} outerCorners - Outer corner positions
 * @param {number} offsetPct - Offset as percentage of card dimensions (default 0.08 = 8%)
 * @returns {{ tl: {x,y}, tr: {x,y}, bl: {x,y}, br: {x,y} }}
 */
export function initializeInnerCorners(outerCorners, offsetPct = 0.08) {
  const cardWidth = outerCorners.tr.x - outerCorners.tl.x;
  const cardHeight = outerCorners.bl.y - outerCorners.tl.y;
  const offsetX = Math.round(cardWidth * offsetPct);
  const offsetY = Math.round(cardHeight * offsetPct);

  return {
    tl: { x: outerCorners.tl.x + offsetX, y: outerCorners.tl.y + offsetY },
    tr: { x: outerCorners.tr.x - offsetX, y: outerCorners.tr.y + offsetY },
    bl: { x: outerCorners.bl.x + offsetX, y: outerCorners.bl.y - offsetY },
    br: { x: outerCorners.br.x - offsetX, y: outerCorners.br.y - offsetY },
  };
}

/**
 * Crop image to outer corner bounds with automatic rotation correction
 * Detects card rotation from corner positions and straightens the output
 * @param {string} imageDataUrl - Source image data URL
 * @param {object} corners - Corner positions { tl, tr, bl, br } in scaled coordinates
 * @param {number} rotation - Additional rotation in degrees (usually 0, auto-calculated)
 * @param {number} scaledWidth - Width of scaled coordinate space (default 1400 to match analysis)
 * @returns {Promise<string>} Cropped image as data URL
 */
export async function cropToOuterBounds(imageDataUrl, corners, rotation = 0, scaledWidth = null) {
  const img = await loadImage(imageDataUrl);

  // Calculate scale factor if corners are in scaled space
  // Coordinates from PostCaptureCentering are in 1400px-max space, but image is at natural resolution
  let scale = 1;
  if (scaledWidth && img.width !== scaledWidth) {
    scale = img.width / scaledWidth;
  }

  // Scale corners to natural image coordinates
  const tl = { x: corners.tl.x * scale, y: corners.tl.y * scale };
  const tr = { x: corners.tr.x * scale, y: corners.tr.y * scale };
  const bl = { x: corners.bl.x * scale, y: corners.bl.y * scale };
  const br = { x: corners.br.x * scale, y: corners.br.y * scale };

  // Calculate rotation angle from the top edge (tl to tr)
  // atan2 returns angle of the top edge relative to horizontal
  // If card tilts clockwise (tr.y > tl.y), angle is positive
  const topEdgeAngle = Math.atan2(tr.y - tl.y, tr.x - tl.x);

  // Calculate the card dimensions (using average of top/bottom and left/right edges)
  const topWidth = Math.sqrt((tr.x - tl.x) ** 2 + (tr.y - tl.y) ** 2);
  const bottomWidth = Math.sqrt((br.x - bl.x) ** 2 + (br.y - bl.y) ** 2);
  const leftHeight = Math.sqrt((bl.x - tl.x) ** 2 + (bl.y - tl.y) ** 2);
  const rightHeight = Math.sqrt((br.x - tr.x) ** 2 + (br.y - tr.y) ** 2);

  const cropW = (topWidth + bottomWidth) / 2;
  const cropH = (leftHeight + rightHeight) / 2;

  // Calculate center of the card
  const centerX = (tl.x + tr.x + bl.x + br.x) / 4;
  const centerY = (tl.y + tr.y + bl.y + br.y) / 4;

  // Create canvas for cropped output at proper card dimensions
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cropW);
  canvas.height = Math.round(cropH);
  const ctx = canvas.getContext('2d');

  // Apply rounded corners - real cards have ~3mm radius on 63mm width (~4.8%)
  const cornerRadius = Math.round(cropW * 0.048);
  ctx.beginPath();
  ctx.roundRect(0, 0, Math.round(cropW), Math.round(cropH), cornerRadius);
  ctx.clip();

  // Transform: position the rotated card in the output
  // The card's top edge is at angle topEdgeAngle relative to horizontal
  // To straighten, we counter-rotate by that angle
  // ctx.rotate() with negative angle = clockwise rotation of coordinate system
  // = counter-clockwise apparent rotation of content
  // If card tilts clockwise (topEdgeAngle > 0), we want counter-clockwise apparent rotation
  // So we use ctx.rotate(-topEdgeAngle) which gives counter-clockwise appearance

  ctx.translate(cropW / 2, cropH / 2);           // Move origin to output center
  ctx.rotate(-topEdgeAngle + (rotation * Math.PI / 180));  // Counter-rotate to straighten
  ctx.translate(-centerX, -centerY);              // Shift so card center is at origin

  // Draw the full source image - transforms handle the crop and rotation
  ctx.drawImage(img, 0, 0);

  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Calculate centering ratios from outer and inner corner bounds
 * @param {object} outer - Outer corners (card edge)
 * @param {object} inner - Inner corners (artwork bounds)
 * @returns {{ lrRatio, tbRatio, borderL, borderR, borderT, borderB, lrDisplay, tbDisplay }}
 */
export function calculateCenteringFromBounds(outer, inner) {
  // Calculate border widths
  const borderL = inner.tl.x - outer.tl.x;
  const borderR = outer.tr.x - inner.tr.x;
  const borderT = inner.tl.y - outer.tl.y;
  const borderB = outer.bl.y - inner.bl.y;

  // Calculate ratios
  const horizontalTotal = borderL + borderR;
  const verticalTotal = borderT + borderB;

  const lrRatio = horizontalTotal > 0 ? (borderL / horizontalTotal) * 100 : 50;
  const tbRatio = verticalTotal > 0 ? (borderT / verticalTotal) * 100 : 50;

  // Format display strings
  const lrDisplay = `${lrRatio.toFixed(1)}/${(100 - lrRatio).toFixed(1)}`;
  const tbDisplay = `${tbRatio.toFixed(1)}/${(100 - tbRatio).toFixed(1)}`;

  return {
    lrRatio,
    tbRatio,
    borderL,
    borderR,
    borderT,
    borderB,
    lrDisplay,
    tbDisplay,
  };
}

/**
 * Get cropped bounds rectangle from corners
 * @param {object} corners - Corner positions { tl, tr, bl, br }
 * @returns {{ x, y, width, height }}
 */
export function getBoundsFromCorners(corners) {
  const x = Math.min(corners.tl.x, corners.bl.x);
  const y = Math.min(corners.tl.y, corners.tr.y);
  const width = Math.max(corners.tr.x, corners.br.x) - x;
  const height = Math.max(corners.bl.y, corners.br.y) - y;

  return { x, y, width, height };
}

/**
 * Validate corners are within image bounds and maintain minimum size
 * @param {object} corners - Corner positions
 * @param {number} imgWidth - Image width
 * @param {number} imgHeight - Image height
 * @param {number} minSize - Minimum crop dimension (default 100px)
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateCorners(corners, imgWidth, imgHeight, minSize = 100) {
  const issues = [];

  // Check bounds
  const allCorners = [corners.tl, corners.tr, corners.bl, corners.br];
  for (const c of allCorners) {
    if (c.x < 0 || c.x > imgWidth || c.y < 0 || c.y > imgHeight) {
      issues.push('Corners must be within image bounds');
      break;
    }
  }

  // Check minimum size
  const bounds = getBoundsFromCorners(corners);
  if (bounds.width < minSize) {
    issues.push(`Crop width too small (min ${minSize}px)`);
  }
  if (bounds.height < minSize) {
    issues.push(`Crop height too small (min ${minSize}px)`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export default {
  loadImage,
  initializeCorners,
  initializeInnerCorners,
  cropToOuterBounds,
  calculateCenteringFromBounds,
  getBoundsFromCorners,
  validateCorners,
};
