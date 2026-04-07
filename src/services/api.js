/**
 * SlabSense - Backend API Service
 * Connects to the Python/OpenCV grading backend
 */

// Backend URL - defaults to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Check if backend is available
 */
export async function checkBackendHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return { available: false, error: 'Backend not responding' };
    const data = await response.json();
    return { available: data.status === 'healthy', version: data.version };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

/**
 * Convert data URL to Blob for file upload
 */
function dataURLtoBlob(dataURL) {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Analyze card images using the backend
 * @param {string} frontImageDataUrl - Base64 data URL of front image
 * @param {string} backImageDataUrl - Base64 data URL of back image (optional)
 * @param {string} cardType - "tcg" or "sports"
 * @returns {Promise<object>} Analysis result
 */
export async function analyzeCard(frontImageDataUrl, backImageDataUrl = null, cardType = 'tcg') {
  const formData = new FormData();

  // Convert data URLs to blobs and append to form
  if (frontImageDataUrl) {
    const frontBlob = dataURLtoBlob(frontImageDataUrl);
    formData.append('front_image', frontBlob, 'front.png');
  }

  if (backImageDataUrl) {
    const backBlob = dataURLtoBlob(backImageDataUrl);
    formData.append('back_image', backBlob, 'back.png');
  }

  formData.append('card_type', cardType);
  formData.append('apply_perspective', 'true');

  const response = await fetch(`${API_BASE_URL}/api/v1/analyze`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Backend error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Get centering analysis only (lighter weight)
 * @param {string} imageDataUrl - Base64 data URL of image
 * @param {string} side - "front" or "back"
 * @param {string} cardType - "tcg" or "sports"
 * @returns {Promise<object>} Centering result
 */
export async function analyzeCentering(imageDataUrl, side = 'front', cardType = 'tcg') {
  const formData = new FormData();

  const blob = dataURLtoBlob(imageDataUrl);
  formData.append('image', blob, 'card.png');
  formData.append('side', side);
  formData.append('card_type', cardType);

  const response = await fetch(`${API_BASE_URL}/api/v1/centering`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Apply perspective correction to image
 * @param {string} imageDataUrl - Base64 data URL of image
 * @returns {Promise<object>} Corrected image result
 */
export async function correctPerspective(imageDataUrl) {
  const formData = new FormData();

  const blob = dataURLtoBlob(imageDataUrl);
  formData.append('image', blob, 'card.png');
  formData.append('return_image', 'true');

  const response = await fetch(`${API_BASE_URL}/api/v1/perspective`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Convert backend result to frontend format
 * Maps the backend API response to the format expected by the frontend UI
 */
export function convertBackendResult(backendResult, side = 'front') {
  const result = backendResult.combined_result;
  if (!result) return null;

  const centering = result.centering || {};
  const isBack = side === 'back';

  // Extract centering for the requested side
  const lr = isBack ? centering.back_lr : centering.front_lr;
  const tb = isBack ? centering.back_tb : centering.front_tb;
  const maxOffset = isBack ? centering.back_max_offset : centering.front_max_offset;

  // Get border pixel data for overlay
  const boundsData = isBack ? result.back_bounds : result.front_bounds;
  const bordersPx = boundsData?.borders_px || {};
  const imageSize = boundsData?.image_size || { width: 750, height: 1050 };

  // Calculate border widths for centering display
  const borderL = bordersPx.left || 0;
  const borderR = imageSize.width - (bordersPx.right || imageSize.width);
  const borderT = bordersPx.top || 0;
  const borderB = imageSize.height - (bordersPx.bottom || imageSize.height);

  // Convert to frontend centering format
  const frontendCentering = {
    lrRatio: lr ? lr[0] : 50,
    tbRatio: tb ? tb[0] : 50,
    borderL: borderL,
    borderR: borderR,
    borderT: borderT,
    borderB: borderB,
    maxOffset: maxOffset || 50,
  };

  // Build bounds object for frontend overlay
  const bounds = {
    left: bordersPx.left || 0,
    right: bordersPx.right || imageSize.width,
    top: bordersPx.top || 0,
    bottom: bordersPx.bottom || imageSize.height,
    cardW: (bordersPx.right || imageSize.width) - (bordersPx.left || 0),
    cardH: (bordersPx.bottom || imageSize.height) - (bordersPx.top || 0),
  };

  // Convert defects to dings format
  const dings = (result.defects || []).map(d => ({
    type: d.type,
    severity: d.severity,
    desc: d.description,
    side: d.side || side,
    location: d.location,
    deduction: d.severity * 20, // Approximate deduction
  }));

  // Add centering ding if it's the limiting factor
  const centerScore = isBack ? result.subgrades?.backCenter : result.subgrades?.frontCenter;
  if (centerScore && centerScore < 970) {
    dings.push({
      type: 'centering',
      severity: centerScore < 900 ? 3 : (centerScore < 950 ? 2 : 1),
      desc: `${side.charAt(0).toUpperCase() + side.slice(1)} centering ${Math.round(maxOffset)}/${Math.round(100-maxOffset)}`,
      side: side,
      location: 'CENTER',
      deduction: 990 - centerScore,
    });
  }

  // Create placeholder corner details for UI compatibility
  const cornerSize = Math.min(bounds.cardW, bounds.cardH) * 0.12;
  const cornerDetails = [
    { name: 'TL', cropX: bounds.left, cropY: bounds.top, cropSize: cornerSize, hasDing: false },
    { name: 'TR', cropX: bounds.right - cornerSize, cropY: bounds.top, cropSize: cornerSize, hasDing: false },
    { name: 'BL', cropX: bounds.left, cropY: bounds.bottom - cornerSize, cropSize: cornerSize, hasDing: false },
    { name: 'BR', cropX: bounds.right - cornerSize, cropY: bounds.bottom - cornerSize, cropSize: cornerSize, hasDing: false },
  ];

  return {
    centering: frontendCentering,
    centerDings: dings.filter(d => d.type === 'centering'),
    allDings: dings,
    corners: { dings: dings.filter(d => d.type?.includes('CORNER')), details: cornerDetails },
    edges: { dings: dings.filter(d => d.type?.includes('EDGE')), maps: null },
    surface: { dings: dings.filter(d => d.type?.includes('SURFACE')), maps: null },
    bounds: bounds,
    imgW: imageSize.width,
    imgH: imageSize.height,
    scaledImgUrl: null,
    // Backend-specific data
    backendScore: result.tag_score,
    backendGrade: result.grade,
    backendGradeLabel: result.grade_label,
    backendSubgrades: result.subgrades,
    processingTimeMs: result.processing_time_ms,
  };
}

/**
 * Full backend analysis with format conversion
 */
export async function analyzeCardWithBackend(frontImageDataUrl, backImageDataUrl, cardType = 'tcg') {
  const result = await analyzeCard(frontImageDataUrl, backImageDataUrl, cardType);

  if (!result.success) {
    throw new Error(result.error || 'Analysis failed');
  }

  return {
    raw: result,
    front: convertBackendResult(result, 'front'),
    back: backImageDataUrl ? convertBackendResult(result, 'back') : null,
    combined: result.combined_result,
  };
}

/**
 * AI Card Detection - Detect card(s) using SAM 2
 * Uses Segment Anything Model 2 via Replicate
 *
 * Single mode: ~$0.02 for one card
 * Dual mode: ~$0.02 for BOTH front and back (stitched)
 *
 * @param {string} imageDataUrl - Base64 data URL of image
 * @param {object} options - { mode: 'single'|'dual', points: {...} }
 * @returns {Promise<object>} Detection result with mask URL(s)
 */
export async function detectCard(imageDataUrl, options = {}) {
  const { mode = 'single', points = null } = options;

  try {
    const response = await fetch('/api/detect-card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: imageDataUrl,
        mode,
        points: points || (mode === 'single' ? { x: 0.5, y: 0.5 } : null),
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Card detection error:', error);
    throw error;
  }
}

/**
 * Stitch two images side by side for dual-card detection
 * @param {string} frontDataUrl - Front card image
 * @param {string} backDataUrl - Back card image
 * @returns {Promise<string>} Stitched image data URL
 */
export async function stitchImages(frontDataUrl, backDataUrl) {
  const [frontImg, backImg] = await Promise.all([
    loadImageFromUrl(frontDataUrl),
    loadImageFromUrl(backDataUrl),
  ]);

  // Use the larger height, scale both to same height
  const targetHeight = Math.max(frontImg.height, backImg.height);
  const frontScale = targetHeight / frontImg.height;
  const backScale = targetHeight / backImg.height;

  const frontW = Math.round(frontImg.width * frontScale);
  const backW = Math.round(backImg.width * backScale);

  // Create stitched canvas
  const canvas = document.createElement('canvas');
  canvas.width = frontW + backW;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  // Draw front on left
  ctx.drawImage(frontImg.img, 0, 0, frontW, targetHeight);
  // Draw back on right
  ctx.drawImage(backImg.img, frontW, 0, backW, targetHeight);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    frontWidth: frontW,
    backWidth: backW,
    height: targetHeight,
    splitPoint: frontW, // X coordinate where front ends and back begins
  };
}

/**
 * Split a stitched mask into front and back portions
 * @param {ImageData} maskData - Full mask image data
 * @param {number} splitPoint - X coordinate to split at
 * @returns {object} { frontMask, backMask }
 */
function splitMask(maskData, width, height, splitPoint) {
  const frontWidth = splitPoint;
  const backWidth = width - splitPoint;

  // Create front mask
  const frontCanvas = document.createElement('canvas');
  frontCanvas.width = frontWidth;
  frontCanvas.height = height;
  const frontCtx = frontCanvas.getContext('2d');

  // Create back mask
  const backCanvas = document.createElement('canvas');
  backCanvas.width = backWidth;
  backCanvas.height = height;
  const backCtx = backCanvas.getContext('2d');

  // Copy pixel data
  const frontData = frontCtx.createImageData(frontWidth, height);
  const backData = backCtx.createImageData(backWidth, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;

      if (x < splitPoint) {
        // Front portion
        const dstIdx = (y * frontWidth + x) * 4;
        frontData.data[dstIdx] = maskData.data[srcIdx];
        frontData.data[dstIdx + 1] = maskData.data[srcIdx + 1];
        frontData.data[dstIdx + 2] = maskData.data[srcIdx + 2];
        frontData.data[dstIdx + 3] = maskData.data[srcIdx + 3];
      } else {
        // Back portion
        const dstX = x - splitPoint;
        const dstIdx = (y * backWidth + dstX) * 4;
        backData.data[dstIdx] = maskData.data[srcIdx];
        backData.data[dstIdx + 1] = maskData.data[srcIdx + 1];
        backData.data[dstIdx + 2] = maskData.data[srcIdx + 2];
        backData.data[dstIdx + 3] = maskData.data[srcIdx + 3];
      }
    }
  }

  frontCtx.putImageData(frontData, 0, 0);
  backCtx.putImageData(backData, 0, 0);

  return {
    front: { canvas: frontCanvas, data: frontData, width: frontWidth, height },
    back: { canvas: backCanvas, data: backData, width: backWidth, height },
  };
}

/**
 * Load an image from URL and return as ImageData
 */
async function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve({
        img,
        canvas,
        ctx,
        data: ctx.getImageData(0, 0, img.width, img.height),
        width: img.width,
        height: img.height,
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

/**
 * Find the 4 corners of a card from a binary mask
 * Uses contour detection to find the quadrilateral
 */
function findCardCornersFromMask(maskData, width, height) {
  const data = maskData.data;

  // Find all white/non-black pixels (the mask)
  const points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Check if pixel is part of mask (non-black)
      if (data[i] > 128 || data[i + 1] > 128 || data[i + 2] > 128) {
        points.push({ x, y });
      }
    }
  }

  if (points.length < 100) {
    return null; // Not enough mask pixels
  }

  // Find bounding box first
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  // Find corners by looking for extreme points in each quadrant
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Top-left: minimize x+y
  // Top-right: maximize x-y
  // Bottom-left: minimize x-y (maximize y-x)
  // Bottom-right: maximize x+y
  let tl = null, tr = null, bl = null, br = null;
  let tlScore = Infinity, trScore = -Infinity, blScore = Infinity, brScore = -Infinity;

  for (const p of points) {
    const sumScore = p.x + p.y;
    const diffScore = p.x - p.y;

    if (sumScore < tlScore) { tlScore = sumScore; tl = p; }
    if (sumScore > brScore) { brScore = sumScore; br = p; }
    if (diffScore > trScore) { trScore = diffScore; tr = p; }
    if (diffScore < blScore) { blScore = diffScore; bl = p; }
  }

  if (!tl || !tr || !bl || !br) {
    return null;
  }

  return { tl, tr, bl, br, bounds: { minX, maxX, minY, maxY } };
}

/**
 * Apply perspective transform to flatten a card
 * Takes 4 corner points and transforms to a rectangle
 */
function perspectiveTransform(sourceImg, corners, targetWidth = 500, targetHeight = 700) {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  // Source corners (from mask detection)
  const { tl, tr, bl, br } = corners;

  // For a proper perspective transform, we need to use canvas transforms
  // This is a simplified version using quadrilateral mapping

  // Calculate the transformation matrix coefficients
  // Using a simple approach: divide into triangles

  // Draw upper triangle (tl, tr, br)
  // Draw lower triangle (tl, bl, br)

  // Actually, for simplicity let's use a grid-based approach
  const srcW = sourceImg.width;
  const srcH = sourceImg.height;

  // Create temporary canvas for source
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(sourceImg, 0, 0);

  // Sample grid points and map them
  const gridSize = 20; // 20x20 grid for smooth transform

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      // Target position (normalized)
      const tx = gx / gridSize;
      const ty = gy / gridSize;
      const tx2 = (gx + 1) / gridSize;
      const ty2 = (gy + 1) / gridSize;

      // Bilinear interpolation for source positions
      const srcX1 = bilinearInterp(tl.x, tr.x, bl.x, br.x, tx, ty);
      const srcY1 = bilinearInterp(tl.y, tr.y, bl.y, br.y, tx, ty);
      const srcX2 = bilinearInterp(tl.x, tr.x, bl.x, br.x, tx2, ty);
      const srcY2 = bilinearInterp(tl.y, tr.y, bl.y, br.y, tx2, ty);
      const srcX3 = bilinearInterp(tl.x, tr.x, bl.x, br.x, tx, ty2);
      const srcY3 = bilinearInterp(tl.y, tr.y, bl.y, br.y, tx, ty2);
      const srcX4 = bilinearInterp(tl.x, tr.x, bl.x, br.x, tx2, ty2);
      const srcY4 = bilinearInterp(tl.y, tr.y, bl.y, br.y, tx2, ty2);

      // Source rectangle (approximate)
      const srcLeft = Math.min(srcX1, srcX3);
      const srcTop = Math.min(srcY1, srcY2);
      const srcRight = Math.max(srcX2, srcX4);
      const srcBottom = Math.max(srcY3, srcY4);

      // Target rectangle
      const dstLeft = tx * targetWidth;
      const dstTop = ty * targetHeight;
      const dstWidth = targetWidth / gridSize;
      const dstHeight = targetHeight / gridSize;

      // Draw this grid cell
      ctx.drawImage(
        srcCanvas,
        srcLeft, srcTop, srcRight - srcLeft, srcBottom - srcTop,
        dstLeft, dstTop, dstWidth, dstHeight
      );
    }
  }

  return canvas.toDataURL('image/jpeg', 0.95);
}

function bilinearInterp(tl, tr, bl, br, u, v) {
  const top = tl + (tr - tl) * u;
  const bottom = bl + (br - bl) * u;
  return top + (bottom - top) * v;
}

/**
 * Simple crop from bounding box (fallback if corners fail)
 */
export async function cropCardFromBbox(imageDataUrl, bbox, targetWidth = 500, targetHeight = 700) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;

      const x1 = bbox.minX || bbox.x1 || 0;
      const y1 = bbox.minY || bbox.y1 || 0;
      const x2 = bbox.maxX || bbox.x2 || w;
      const y2 = bbox.maxY || bbox.y2 || h;

      const cropW = x2 - x1;
      const cropH = y2 - y1;

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      ctx.drawImage(img, x1, y1, cropW, cropH, 0, 0, targetWidth, targetHeight);

      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

/**
 * Process a single card from mask data
 */
async function processCardFromMask(originalImg, maskData, targetWidth, targetHeight) {
  const corners = findCardCornersFromMask(maskData.data, maskData.width, maskData.height);

  if (!corners) {
    // Fallback to bounding box crop
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(originalImg.img, 0, 0, originalImg.width, originalImg.height, 0, 0, targetWidth, targetHeight);
    return {
      croppedCard: canvas.toDataURL('image/jpeg', 0.95),
      method: 'bbox-fallback',
      corners: null,
    };
  }

  // Scale corners to original image size
  const scaleX = originalImg.width / maskData.width;
  const scaleY = originalImg.height / maskData.height;

  const scaledCorners = {
    tl: { x: corners.tl.x * scaleX, y: corners.tl.y * scaleY },
    tr: { x: corners.tr.x * scaleX, y: corners.tr.y * scaleY },
    bl: { x: corners.bl.x * scaleX, y: corners.bl.y * scaleY },
    br: { x: corners.br.x * scaleX, y: corners.br.y * scaleY },
  };

  const croppedCard = perspectiveTransform(originalImg.img, scaledCorners, targetWidth, targetHeight);

  return {
    croppedCard,
    method: 'perspective-transform',
    corners: scaledCorners,
  };
}

/**
 * Full AI card detection and cropping pipeline with SAM 2
 * Single card mode - processes one image
 *
 * @param {string} imageDataUrl - Original photo with card
 * @param {object} options - { point: {x, y}, targetWidth, targetHeight }
 * @returns {Promise<object>} Result with croppedCard data URL and metadata
 */
export async function detectAndCropCard(imageDataUrl, options = {}) {
  const { point, targetWidth = 500, targetHeight = 700 } = options;

  console.log('Calling SAM for single card detection...');
  const detection = await detectCard(imageDataUrl, { mode: 'single', points: point });

  if (!detection.success) {
    return {
      success: false,
      error: detection.error,
      suggestion: detection.suggestion,
    };
  }

  let maskData;
  try {
    maskData = await loadImageFromUrl(detection.maskUrl);
  } catch (err) {
    return {
      success: false,
      error: 'Failed to load mask image',
      maskUrl: detection.maskUrl,
    };
  }

  const originalImg = await loadImageFromUrl(imageDataUrl);
  const result = await processCardFromMask(originalImg, maskData, targetWidth, targetHeight);

  return {
    success: true,
    ...result,
    cost: detection.cost_estimate,
    maskUrl: detection.maskUrl,
  };
}

/**
 * DUAL CARD DETECTION - Process front AND back in ONE API call
 * Cost: $0.02 for BOTH cards (same as single!)
 *
 * @param {string} frontDataUrl - Front of card image
 * @param {string} backDataUrl - Back of card image
 * @param {object} options - { targetWidth, targetHeight }
 * @returns {Promise<object>} Result with both croppedFront and croppedBack
 */
export async function detectAndCropBothCards(frontDataUrl, backDataUrl, options = {}) {
  const { targetWidth = 500, targetHeight = 700 } = options;

  console.log('Stitching front and back images...');

  // Step 1: Stitch images side by side
  const stitched = await stitchImages(frontDataUrl, backDataUrl);

  console.log(`Stitched image: ${stitched.frontWidth}+${stitched.backWidth} x ${stitched.height}`);
  console.log('Calling SAM for dual card detection...');

  // Step 2: Call SAM with dual mode (two point prompts)
  const detection = await detectCard(stitched.dataUrl, {
    mode: 'dual',
    points: {
      // Points at center of each card (25% and 75% horizontally)
      coords: '0.25,0.5,0.75,0.5',
      labels: '1,1',
    },
  });

  if (!detection.success) {
    return {
      success: false,
      error: detection.error,
      suggestion: detection.suggestion,
    };
  }

  console.log('SAM returned masks:', detection.masks?.length || 1);

  // Step 3: Load the mask
  let maskData;
  try {
    maskData = await loadImageFromUrl(detection.maskUrl);
  } catch (err) {
    return {
      success: false,
      error: 'Failed to load mask image',
    };
  }

  // Step 4: Split mask into front and back portions
  // Calculate split point proportionally
  const maskSplitPoint = Math.round(maskData.width * (stitched.frontWidth / (stitched.frontWidth + stitched.backWidth)));

  const splitMasks = splitMask(maskData.data, maskData.width, maskData.height, maskSplitPoint);

  // Step 5: Load original images
  const [frontImg, backImg] = await Promise.all([
    loadImageFromUrl(frontDataUrl),
    loadImageFromUrl(backDataUrl),
  ]);

  // Step 6: Process each card
  const frontResult = await processCardFromMask(frontImg, splitMasks.front, targetWidth, targetHeight);
  const backResult = await processCardFromMask(backImg, splitMasks.back, targetWidth, targetHeight);

  return {
    success: true,
    front: {
      croppedCard: frontResult.croppedCard,
      corners: frontResult.corners,
      method: frontResult.method,
    },
    back: {
      croppedCard: backResult.croppedCard,
      corners: backResult.corners,
      method: backResult.method,
    },
    cost: detection.cost_estimate, // $0.02 for BOTH!
    model: 'sam-2-dual',
  };
}

