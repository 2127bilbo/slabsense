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
 * AI Card Detection - Detect and crop card from image
 * Uses YOLO-World via Replicate (~$0.001/image, ~1-2 sec)
 *
 * @param {string} imageDataUrl - Base64 data URL of image
 * @returns {Promise<object>} Detection result with bbox and cropped card
 */
export async function detectCard(imageDataUrl) {
  try {
    const response = await fetch('/api/detect-card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: imageDataUrl,
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
 * Crop image to bounding box on client side
 * Uses the bbox from detectCard to crop the original image
 *
 * @param {string} imageDataUrl - Original image data URL
 * @param {object} bbox - Bounding box {x1, y1, x2, y2} (normalized 0-1 or pixels)
 * @param {number} targetWidth - Output width (default 500)
 * @param {number} targetHeight - Output height (default 700 for standard card ratio)
 * @returns {Promise<string>} Cropped image as data URL
 */
export async function cropCardFromBbox(imageDataUrl, bbox, targetWidth = 500, targetHeight = 700) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;

      // Convert bbox to pixels if normalized (0-1)
      let x1 = bbox.x1 <= 1 ? bbox.x1 * w : bbox.x1;
      let y1 = bbox.y1 <= 1 ? bbox.y1 * h : bbox.y1;
      let x2 = bbox.x2 <= 1 ? bbox.x2 * w : bbox.x2;
      let y2 = bbox.y2 <= 1 ? bbox.y2 * h : bbox.y2;

      // Add small padding
      const padding = Math.min(w, h) * 0.01;
      x1 = Math.max(0, x1 - padding);
      y1 = Math.max(0, y1 - padding);
      x2 = Math.min(w, x2 + padding);
      y2 = Math.min(h, y2 + padding);

      const cropW = x2 - x1;
      const cropH = y2 - y1;

      // Create canvas and crop
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      // Draw cropped and scaled image
      ctx.drawImage(img, x1, y1, cropW, cropH, 0, 0, targetWidth, targetHeight);

      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

/**
 * Full AI card detection and cropping pipeline
 * Detects card, crops to bbox, returns clean card image
 *
 * @param {string} imageDataUrl - Original photo with card
 * @returns {Promise<object>} Result with croppedCard data URL and metadata
 */
export async function detectAndCropCard(imageDataUrl) {
  // Step 1: Detect card
  const detection = await detectCard(imageDataUrl);

  if (!detection.success) {
    return {
      success: false,
      error: detection.error,
      suggestion: detection.suggestion,
    };
  }

  // Step 2: Crop to bbox
  const croppedCard = await cropCardFromBbox(imageDataUrl, detection.bbox);

  return {
    success: true,
    croppedCard,
    bbox: detection.bbox,
    confidence: detection.confidence,
    label: detection.label,
    cost: detection.cost_estimate,
  };
}
