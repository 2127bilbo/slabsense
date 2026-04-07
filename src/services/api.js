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
