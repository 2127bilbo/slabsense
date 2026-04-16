/**
 * Card Detection - Browser-compatible card cropping
 *
 * Detects and crops trading cards from photos using:
 * 1. Variance-based grid detection (finds high-detail regions)
 * 2. Edge detection for fine-tuning bounds
 * 3. Aspect ratio validation (cards are ~2.5:3.5)
 *
 * Works with canvas - no external dependencies.
 */

/**
 * Detect and crop card from an image
 *
 * @param {string|HTMLImageElement|HTMLCanvasElement} source - Image source
 * @param {object} options - Detection options
 * @returns {Promise<{canvas: HTMLCanvasElement, bounds: object, method: string}>}
 */
export async function detectAndCropCard(source, options = {}) {
  const {
    maxSize = 1000,       // Max dimension for processing
    gridSize = 16,        // Grid cells for variance detection
    varianceThreshold = 0.12, // Variance threshold (fraction of max)
    minVariance = 30,     // Minimum absolute variance
    padding = 5,          // Padding around detected bounds
    validateAspect = true, // Validate card aspect ratio
    targetAspect = 0.714, // Card aspect ratio (2.5/3.5)
    aspectTolerance = 0.15, // Aspect ratio tolerance
  } = options;

  // Load image to canvas
  const img = await loadImage(source);
  const { canvas, ctx, scale } = createScaledCanvas(img, maxSize);

  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);

  // Method 1: Variance-based grid detection
  let bounds = detectByVariance(imageData, w, h, {
    gridSize,
    varianceThreshold,
    minVariance,
    padding,
  });

  let method = 'variance';

  // Validate bounds
  if (!bounds || bounds.width < 50 || bounds.height < 50) {
    // Fallback: center 80%
    bounds = {
      x: Math.floor(w * 0.1),
      y: Math.floor(h * 0.1),
      width: Math.floor(w * 0.8),
      height: Math.floor(h * 0.8),
    };
    method = 'fallback';
  }

  // Validate aspect ratio if enabled
  if (validateAspect) {
    const aspect = Math.min(bounds.width, bounds.height) / Math.max(bounds.width, bounds.height);
    if (Math.abs(aspect - targetAspect) > aspectTolerance) {
      // Aspect ratio doesn't match card - try to adjust
      bounds = adjustToCardAspect(bounds, w, h, targetAspect);
      method += '+aspect';
    }
  }

  // Create cropped canvas
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = bounds.width;
  cropCanvas.height = bounds.height;
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(
    canvas,
    bounds.x, bounds.y, bounds.width, bounds.height,
    0, 0, bounds.width, bounds.height
  );

  return {
    canvas: cropCanvas,
    bounds: {
      ...bounds,
      originalWidth: img.width,
      originalHeight: img.height,
      scale,
    },
    method,
  };
}

/**
 * Load image from various sources
 */
async function loadImage(source) {
  if (source instanceof HTMLImageElement) {
    if (source.complete) return source;
    return new Promise((resolve, reject) => {
      source.onload = () => resolve(source);
      source.onerror = reject;
    });
  }

  if (source instanceof HTMLCanvasElement) {
    const img = new Image();
    img.src = source.toDataURL();
    return new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
    });
  }

  // String (URL or data URL)
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = source;
  });
}

/**
 * Create scaled canvas for processing
 */
function createScaledCanvas(img, maxSize) {
  let w = img.width;
  let h = img.height;
  let scale = 1;

  if (Math.max(w, h) > maxSize) {
    scale = maxSize / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  return { canvas, ctx, scale };
}

/**
 * Detect card bounds using variance-based grid detection
 */
function detectByVariance(imageData, w, h, options) {
  const { gridSize, varianceThreshold, minVariance, padding } = options;
  const data = imageData.data;

  const cellW = Math.floor(w / gridSize);
  const cellH = Math.floor(h / gridSize);

  // Calculate variance for each grid cell
  const variances = [];
  let maxVariance = 0;

  for (let gy = 0; gy < gridSize; gy++) {
    variances[gy] = [];
    for (let gx = 0; gx < gridSize; gx++) {
      const x0 = gx * cellW;
      const y0 = gy * cellH;

      let sum = 0;
      let sumSq = 0;
      let count = 0;

      // Sample every 2nd pixel for speed
      for (let y = y0; y < y0 + cellH && y < h; y += 2) {
        for (let x = x0; x < x0 + cellW && x < w; x += 2) {
          const idx = (y * w + x) * 4;
          // Grayscale value
          const v = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          sum += v;
          sumSq += v * v;
          count++;
        }
      }

      const variance = count > 0 ? (sumSq / count) - Math.pow(sum / count, 2) : 0;
      variances[gy][gx] = variance;
      if (variance > maxVariance) maxVariance = variance;
    }
  }

  // Find bounding box of high-variance cells
  const threshold = Math.max(minVariance, maxVariance * varianceThreshold);
  let minGX = gridSize, maxGX = -1, minGY = gridSize, maxGY = -1;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      if (variances[gy][gx] > threshold) {
        if (gx < minGX) minGX = gx;
        if (gx > maxGX) maxGX = gx;
        if (gy < minGY) minGY = gy;
        if (gy > maxGY) maxGY = gy;
      }
    }
  }

  // No high-variance region found
  if (maxGX < minGX || maxGY < minGY) {
    return null;
  }

  // Convert to pixel coordinates
  const x = Math.max(0, minGX * cellW - padding);
  const y = Math.max(0, minGY * cellH - padding);
  const right = Math.min(w, (maxGX + 1) * cellW + padding);
  const bottom = Math.min(h, (maxGY + 1) * cellH + padding);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

/**
 * Adjust bounds to match card aspect ratio
 */
function adjustToCardAspect(bounds, imgW, imgH, targetAspect) {
  const { x, y, width, height } = bounds;
  const currentAspect = Math.min(width, height) / Math.max(width, height);

  // If already close enough, return as is
  if (Math.abs(currentAspect - targetAspect) < 0.05) {
    return bounds;
  }

  // Determine if card is portrait or landscape
  const isPortrait = height > width;

  let newWidth, newHeight;
  if (isPortrait) {
    // Height is larger, adjust width
    newWidth = Math.round(height * targetAspect);
    newHeight = height;
  } else {
    // Width is larger, adjust height
    newWidth = width;
    newHeight = Math.round(width * targetAspect);
  }

  // Center the adjusted bounds
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  let newX = Math.round(centerX - newWidth / 2);
  let newY = Math.round(centerY - newHeight / 2);

  // Clamp to image bounds
  newX = Math.max(0, Math.min(newX, imgW - newWidth));
  newY = Math.max(0, Math.min(newY, imgH - newHeight));
  newWidth = Math.min(newWidth, imgW - newX);
  newHeight = Math.min(newHeight, imgH - newY);

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * Get cropped image as data URL
 */
export async function getCroppedDataUrl(source, options = {}) {
  const { format = 'image/jpeg', quality = 0.9 } = options;
  const result = await detectAndCropCard(source, options);
  return {
    dataUrl: result.canvas.toDataURL(format, quality),
    bounds: result.bounds,
    method: result.method,
  };
}

/**
 * Debug: visualize detection bounds on original image
 */
export async function visualizeDetection(source, options = {}) {
  const img = await loadImage(source);
  const { canvas, ctx, scale } = createScaledCanvas(img, options.maxSize || 800);

  const result = await detectAndCropCard(source, options);
  const bounds = result.bounds;

  // Draw bounding box
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 3;
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Draw label
  ctx.fillStyle = '#00ff00';
  ctx.font = '14px monospace';
  ctx.fillText(`${result.method} (${bounds.width}x${bounds.height})`, bounds.x + 5, bounds.y - 5);

  return {
    canvas,
    croppedCanvas: result.canvas,
    bounds,
    method: result.method,
  };
}

export default {
  detectAndCropCard,
  getCroppedDataUrl,
  visualizeDetection,
};
