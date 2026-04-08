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
 * Compress an image to reduce payload size for API calls
 * Prevents Vercel's 4.5MB payload limit errors (FUNCTION_PAYLOAD_TOO_LARGE)
 * Returns both the compressed image AND scale info for coordinate conversion
 * @param {string} dataUrl - Original image data URL
 * @param {number} maxDimension - Max width or height (default 1500px)
 * @param {number} quality - JPEG quality 0-1 (default 0.85)
 * @returns {Promise<object>} { dataUrl, originalWidth, originalHeight, scale, scaleBack }
 */
async function compressImageForAPI(dataUrl, maxDimension = 1500, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const originalWidth = img.width;
      const originalHeight = img.height;
      let newWidth = originalWidth;
      let newHeight = originalHeight;
      let scale = 1.0;

      // Calculate new dimensions maintaining aspect ratio
      if (originalWidth > maxDimension || originalHeight > maxDimension) {
        if (originalWidth > originalHeight) {
          scale = maxDimension / originalWidth;
        } else {
          scale = maxDimension / originalHeight;
        }
        newWidth = Math.round(originalWidth * scale);
        newHeight = Math.round(originalHeight * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      // Return as JPEG with compression
      const compressed = canvas.toDataURL('image/jpeg', quality);

      // Log compression results
      const originalSize = Math.round(dataUrl.length / 1024);
      const compressedSize = Math.round(compressed.length / 1024);
      console.log(`[Compress] ${originalWidth}x${originalHeight} -> ${newWidth}x${newHeight} (scale: ${scale.toFixed(3)})`);
      console.log(`[Compress] ${originalSize}KB -> ${compressedSize}KB`);

      resolve({
        dataUrl: compressed,
        originalWidth,
        originalHeight,
        compressedWidth: newWidth,
        compressedHeight: newHeight,
        scale,
        scaleBack: 1 / scale, // Multiply compressed coords by this to get original coords
      });
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = dataUrl;
  });
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
  const { mode = 'single', points = null, timeout = 55000 } = options;

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    console.log(`[detectCard] Starting ${mode} mode detection...`);

    // Compress image to avoid Vercel's 4.5MB payload limit
    // Use 2000px max for SAM detection (needs more detail for accurate masks)
    const compressedImage = await compressImageForAPI(imageDataUrl, 2000, 0.9);

    const response = await fetch('/api/detect-card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: compressedImage,
        mode,
        points: points || (mode === 'single' ? { x: 0.5, y: 0.5 } : null),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[detectCard] API error:', error);
      throw new Error(error.error || `API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('[detectCard] Success:', result.success, 'masks:', result.masks?.length);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error('[detectCard] Request timed out after', timeout, 'ms');
      throw new Error('Detection timed out - Replicate may be slow. Try again.');
    }
    console.error('[detectCard] Error:', error);
    throw error;
  }
}

/**
 * Analyze card using Claude Vision AI
 * Extracts card info, condition assessment, and grading notes
 * @param {string} imageDataUrl - Card image (cropped preferred)
 * @param {string} cardType - 'pokemon' | 'sports' | 'tcg'
 * @param {boolean} includeGrading - Include condition/grading analysis
 * @returns {Promise<object>} Full analysis result
 */
export async function analyzeCardWithVision(imageDataUrl, cardType = 'pokemon', includeGrading = true) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for vision

  try {
    console.log(`[Claude Vision] Starting ${cardType} card analysis...`);

    // Compress image to avoid Vercel's 4.5MB payload limit
    const compressedImage = await compressImageForAPI(imageDataUrl);

    const response = await fetch('/api/analyze-card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: compressedImage,
        cardType,
        includeGrading,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('[Claude Vision] Analysis complete:', result.analysis?.cardInfo?.name);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Card analysis timed out - please try again');
    }
    console.error('[Claude Vision] Error:', error);
    throw error;
  }
}

/**
 * Legacy function - redirects to new Claude Vision API
 * @deprecated Use analyzeCardWithVision instead
 */
export async function extractCardInfo(imageDataUrl, cardType = 'pokemon') {
  const result = await analyzeCardWithVision(imageDataUrl, cardType, false);
  // Transform to legacy format for backwards compatibility
  return {
    success: result.success,
    cardInfo: result.analysis?.cardInfo || null,
    rawResponse: result.rawResponse,
  };
}

/**
 * UNIFIED AI CARD ANALYSIS - Single Claude call does EVERYTHING
 * - Card boundary detection with precise coordinates
 * - Rotation/deskew angle detection
 * - Border measurements for centering (front & back)
 * - Card info extraction (OCR)
 * - Condition assessment with numeric scores
 * - Grading notes
 *
 * Uses Claude Sonnet 4 via Replicate (your prepaid balance)
 * Cost: ~$0.02-0.05 per card
 *
 * @param {string} frontImageDataUrl - Front card image
 * @param {string} backImageDataUrl - Back card image (optional)
 * @param {string} cardType - 'pokemon' | 'sports'
 * @returns {Promise<object>} Complete analysis with cropped images
 */
export async function unifiedCardAnalysis(frontImageDataUrl, backImageDataUrl = null, cardType = 'pokemon') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

  try {
    console.log('[Unified AI] Starting analysis via Claude (separate calls for front/back)...');

    // Compress images for API - also get scale info for coordinate conversion
    console.log('[Unified AI] Compressing images for API...');
    const frontCompressed = await compressImageForAPI(frontImageDataUrl);
    const backCompressed = backImageDataUrl
      ? await compressImageForAPI(backImageDataUrl)
      : null;

    console.log(`[Unified AI] Front scale: ${frontCompressed.scale.toFixed(3)} (scaleBack: ${frontCompressed.scaleBack.toFixed(3)})`);
    if (backCompressed) {
      console.log(`[Unified AI] Back scale: ${backCompressed.scale.toFixed(3)} (scaleBack: ${backCompressed.scaleBack.toFixed(3)})`);
    }

    // Send compressed images to Claude (coordinates will be for compressed size)
    const response = await fetch('/api/ai-analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        frontImage: frontCompressed.dataUrl,
        backImage: backCompressed?.dataUrl || null,
        cardType,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success || !result.analysis) {
      throw new Error('AI analysis returned no data');
    }

    console.log('[Unified AI] Claude analysis complete, processing images...');

    const analysis = result.analysis;

    // Handle parse errors gracefully
    if (analysis.parseError) {
      console.warn('[Unified AI] Claude response parsing issue:', analysis.parseError);
    }

    // Log what Claude returned for debugging
    console.log('[Unified AI] Raw analysis structure:', {
      hasFront: !!analysis.front,
      hasBack: !!analysis.back,
      frontBoundingBox: analysis.front?.boundingBox,
      backBoundingBox: analysis.back?.boundingBox,
      hasCardInfo: !!analysis.cardInfo,
    });

    // Helper to scale bounding box coordinates from compressed to original
    const scaleBoundingBox = (bb, scaleBack) => ({
      topLeft: { x: Math.round(bb.topLeft.x * scaleBack), y: Math.round(bb.topLeft.y * scaleBack) },
      topRight: { x: Math.round(bb.topRight.x * scaleBack), y: Math.round(bb.topRight.y * scaleBack) },
      bottomLeft: { x: Math.round(bb.bottomLeft.x * scaleBack), y: Math.round(bb.bottomLeft.y * scaleBack) },
      bottomRight: { x: Math.round(bb.bottomRight.x * scaleBack), y: Math.round(bb.bottomRight.y * scaleBack) },
    });

    // Apply cropping - scale coordinates to original size and crop from ORIGINAL images
    let croppedFront = frontImageDataUrl; // Default to original
    let croppedBack = backImageDataUrl;

    // Crop FRONT image
    if (analysis.front?.boundingBox) {
      try {
        const bbCompressed = analysis.front.boundingBox;
        console.log('[Unified AI] Front bbox (compressed):', JSON.stringify(bbCompressed));

        if (bbCompressed.topLeft?.x != null && bbCompressed.topRight?.x != null &&
            bbCompressed.bottomLeft?.x != null && bbCompressed.bottomRight?.x != null) {

          // Scale coordinates back to original image dimensions
          const bbOriginal = scaleBoundingBox(bbCompressed, frontCompressed.scaleBack);
          console.log('[Unified AI] Front bbox (original):  ', JSON.stringify(bbOriginal));

          // Crop from ORIGINAL image using scaled coordinates
          croppedFront = await cropAndRotateCard(
            frontImageDataUrl, // Original, not compressed!
            bbOriginal,
            analysis.front.rotationAngle || 0
          );
          console.log('[Unified AI] Front cropped from original image');
        }
      } catch (cropError) {
        console.error('[Unified AI] Failed to crop front:', cropError.message);
      }
    }

    // Crop BACK image
    if (backImageDataUrl && backCompressed && analysis.back?.boundingBox) {
      try {
        const bbCompressed = analysis.back.boundingBox;
        console.log('[Unified AI] Back bbox (compressed):', JSON.stringify(bbCompressed));

        if (bbCompressed.topLeft?.x != null && bbCompressed.topRight?.x != null &&
            bbCompressed.bottomLeft?.x != null && bbCompressed.bottomRight?.x != null) {

          // Scale coordinates back to original image dimensions
          const bbOriginal = scaleBoundingBox(bbCompressed, backCompressed.scaleBack);
          console.log('[Unified AI] Back bbox (original):  ', JSON.stringify(bbOriginal));

          // Crop from ORIGINAL image using scaled coordinates
          croppedBack = await cropAndRotateCard(
            backImageDataUrl, // Original, not compressed!
            bbOriginal,
            analysis.back.rotationAngle || 0
          );
          console.log('[Unified AI] Back cropped from original image');
        }
      } catch (cropError) {
        console.error('[Unified AI] Failed to crop back:', cropError.message);
      }
    }

    return {
      success: true,
      // Cropped/rotated images ready for display
      croppedFront: croppedFront || frontImageDataUrl,
      croppedBack: croppedBack || backImageDataUrl,
      // Card info from OCR
      cardInfo: analysis.cardInfo || null,
      // Centering data
      centering: {
        front: {
          lr: analysis.front?.centeringLR || '50/50',
          tb: analysis.front?.centeringTB || '50/50',
          borders: analysis.front?.borders || null,
        },
        back: analysis.back ? {
          lr: analysis.back?.centeringLR || '50/50',
          tb: analysis.back?.centeringTB || '50/50',
          borders: analysis.back?.borders || null,
        } : null,
      },
      // Condition assessment
      condition: analysis.condition || null,
      // Grading notes
      gradingNotes: analysis.gradingNotes || null,
      // Raw analysis for debugging
      rawAnalysis: analysis,
      model: result.model,
    };

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('AI analysis timed out - please try again');
    }
    console.error('[Unified AI] Error:', error);
    throw error;
  }
}

/**
 * Crop and rotate card image based on Claude's detected coordinates
 * Uses perspective transform for accurate corner-to-corner mapping
 * @param {string} imageDataUrl - Original image
 * @param {object} boundingBox - {topLeft, topRight, bottomLeft, bottomRight} with {x, y}
 * @param {number} rotationAngle - Degrees to rotate (unused - perspective handles this)
 * @returns {Promise<string>} Cropped and perspective-corrected image data URL
 */
async function cropAndRotateCard(imageDataUrl, boundingBox, rotationAngle = 0) {
  const imgData = await loadImageFromUrl(imageDataUrl);
  const img = imgData.img; // Get the actual Image element

  // Calculate card dimensions from bounding box
  const { topLeft, topRight, bottomLeft, bottomRight } = boundingBox;

  // Validate all corners exist and have valid coordinates
  if (!topLeft || !topRight || !bottomLeft || !bottomRight) {
    throw new Error('Invalid bounding box: missing corners');
  }

  // Ensure coordinates are within image bounds
  const clamp = (val, max) => Math.max(0, Math.min(val, max));
  const corners = {
    tl: { x: clamp(topLeft.x, imgData.width), y: clamp(topLeft.y, imgData.height) },
    tr: { x: clamp(topRight.x, imgData.width), y: clamp(topRight.y, imgData.height) },
    bl: { x: clamp(bottomLeft.x, imgData.width), y: clamp(bottomLeft.y, imgData.height) },
    br: { x: clamp(bottomRight.x, imgData.width), y: clamp(bottomRight.y, imgData.height) },
  };

  // Calculate width and height from corners
  const topWidth = Math.sqrt(
    Math.pow(corners.tr.x - corners.tl.x, 2) + Math.pow(corners.tr.y - corners.tl.y, 2)
  );
  const bottomWidth = Math.sqrt(
    Math.pow(corners.br.x - corners.bl.x, 2) + Math.pow(corners.br.y - corners.bl.y, 2)
  );
  const leftHeight = Math.sqrt(
    Math.pow(corners.bl.x - corners.tl.x, 2) + Math.pow(corners.bl.y - corners.tl.y, 2)
  );
  const rightHeight = Math.sqrt(
    Math.pow(corners.br.x - corners.tr.x, 2) + Math.pow(corners.br.y - corners.tr.y, 2)
  );

  const avgWidth = (topWidth + bottomWidth) / 2;
  const avgHeight = (leftHeight + rightHeight) / 2;

  // Sanity check dimensions
  if (avgWidth < 50 || avgHeight < 50) {
    throw new Error(`Invalid crop dimensions: ${avgWidth}x${avgHeight}`);
  }

  // Standard card aspect ratio is 2.5:3.5 = 0.714
  const standardRatio = 2.5 / 3.5;
  let finalWidth = Math.round(avgWidth);
  let finalHeight = Math.round(avgHeight);

  // Enforce standard card ratio
  const currentRatio = finalWidth / finalHeight;
  if (currentRatio > standardRatio) {
    // Too wide, adjust width
    finalWidth = Math.round(finalHeight * standardRatio);
  } else {
    // Too tall, adjust height
    finalHeight = Math.round(finalWidth / standardRatio);
  }

  // Ensure minimum output size for quality
  if (finalWidth < 400) {
    finalWidth = 400;
    finalHeight = Math.round(400 / standardRatio);
  }

  console.log(`[Crop] Corners: TL(${Math.round(corners.tl.x)},${Math.round(corners.tl.y)}) TR(${Math.round(corners.tr.x)},${Math.round(corners.tr.y)}) BL(${Math.round(corners.bl.x)},${Math.round(corners.bl.y)}) BR(${Math.round(corners.br.x)},${Math.round(corners.br.y)})`);
  console.log(`[Crop] Output: ${finalWidth}x${finalHeight}`);

  // Use perspective transform for accurate mapping
  return perspectiveTransformFromCorners(img, corners, finalWidth, finalHeight);
}

/**
 * Perspective transform using grid-based sampling
 * Maps a quadrilateral (4 corners) to a rectangle
 */
function perspectiveTransformFromCorners(sourceImg, corners, targetWidth, targetHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  // Clear with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  const { tl, tr, bl, br } = corners;

  // Grid-based sampling for smooth perspective transform
  const gridSize = 25; // Higher = smoother but slower

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      // Normalized target positions (0-1)
      const u1 = gx / gridSize;
      const v1 = gy / gridSize;
      const u2 = (gx + 1) / gridSize;
      const v2 = (gy + 1) / gridSize;

      // Bilinear interpolation to find source positions
      const srcX1 = bilinearInterp(tl.x, tr.x, bl.x, br.x, u1, v1);
      const srcY1 = bilinearInterp(tl.y, tr.y, bl.y, br.y, u1, v1);
      const srcX2 = bilinearInterp(tl.x, tr.x, bl.x, br.x, u2, v1);
      const srcY2 = bilinearInterp(tl.y, tr.y, bl.y, br.y, u2, v1);
      const srcX3 = bilinearInterp(tl.x, tr.x, bl.x, br.x, u1, v2);
      const srcY3 = bilinearInterp(tl.y, tr.y, bl.y, br.y, u1, v2);
      const srcX4 = bilinearInterp(tl.x, tr.x, bl.x, br.x, u2, v2);
      const srcY4 = bilinearInterp(tl.y, tr.y, bl.y, br.y, u2, v2);

      // Source rectangle bounds
      const srcLeft = Math.min(srcX1, srcX3);
      const srcTop = Math.min(srcY1, srcY2);
      const srcRight = Math.max(srcX2, srcX4);
      const srcBottom = Math.max(srcY3, srcY4);
      const srcWidth = srcRight - srcLeft;
      const srcHeight = srcBottom - srcTop;

      // Target rectangle
      const dstX = u1 * targetWidth;
      const dstY = v1 * targetHeight;
      const dstW = targetWidth / gridSize;
      const dstH = targetHeight / gridSize;

      // Draw grid cell
      if (srcWidth > 0 && srcHeight > 0) {
        ctx.drawImage(
          sourceImg,
          srcLeft, srcTop, srcWidth, srcHeight,
          dstX, dstY, dstW, dstH
        );
      }
    }
  }

  return canvas.toDataURL('image/jpeg', 0.95);
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
 * Uses edge detection to find the card boundary, then finds corners
 */
function findCardCornersFromMask(maskData, width, height) {
  const data = maskData.data;

  // Create a 2D binary array for easier processing
  const mask = [];
  for (let y = 0; y < height; y++) {
    mask[y] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Check if pixel is part of mask (non-black)
      mask[y][x] = (data[i] > 128 || data[i + 1] > 128 || data[i + 2] > 128) ? 1 : 0;
    }
  }

  // Find EDGE pixels only (mask pixels that border non-mask pixels)
  // This gives us the contour of the card, not the whole filled area
  const edgePoints = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (mask[y][x] === 1) {
        // Check if this is an edge pixel (has at least one non-mask neighbor)
        if (mask[y-1][x] === 0 || mask[y+1][x] === 0 ||
            mask[y][x-1] === 0 || mask[y][x+1] === 0) {
          edgePoints.push({ x, y });
        }
      }
    }
  }

  if (edgePoints.length < 50) {
    // Fallback to all mask points if edge detection fails
    const points = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y][x] === 1) points.push({ x, y });
      }
    }
    if (points.length < 100) return null;
    return findCornersFromPoints(points, width, height);
  }

  return findCornersFromPoints(edgePoints, width, height);
}

/**
 * Find corners from a set of points using convex hull approach
 */
function findCornersFromPoints(points, width, height) {
  // Find bounding box
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  // Card should be at least 20% of the image in each dimension
  const cardW = maxX - minX;
  const cardH = maxY - minY;
  if (cardW < width * 0.2 || cardH < height * 0.2) {
    return null;
  }

  // Find corners by looking for extreme points
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

  // Sanity check: corners should form a roughly rectangular shape
  // The card aspect ratio should be close to 5:7 (standard trading card)
  const topWidth = Math.sqrt(Math.pow(tr.x - tl.x, 2) + Math.pow(tr.y - tl.y, 2));
  const bottomWidth = Math.sqrt(Math.pow(br.x - bl.x, 2) + Math.pow(br.y - bl.y, 2));
  const leftHeight = Math.sqrt(Math.pow(bl.x - tl.x, 2) + Math.pow(bl.y - tl.y, 2));
  const rightHeight = Math.sqrt(Math.pow(br.x - tr.x, 2) + Math.pow(br.y - tr.y, 2));

  const avgWidth = (topWidth + bottomWidth) / 2;
  const avgHeight = (leftHeight + rightHeight) / 2;
  const aspectRatio = avgWidth / avgHeight;

  // Standard card is ~2.5x3.5 inches = 0.714 aspect ratio
  // Allow some tolerance (0.5 to 0.9)
  if (aspectRatio < 0.4 || aspectRatio > 1.0) {
    console.log('Card aspect ratio out of range:', aspectRatio);
    // Still return corners, but log warning
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

  // Add small outward padding to corners to avoid cutting card edges
  // SAM masks can be slightly inside the actual card boundary
  // Padding moves corners ~1.5% outward from card center
  const centerX = (scaledCorners.tl.x + scaledCorners.tr.x + scaledCorners.bl.x + scaledCorners.br.x) / 4;
  const centerY = (scaledCorners.tl.y + scaledCorners.tr.y + scaledCorners.bl.y + scaledCorners.br.y) / 4;
  const paddingFactor = 1.04; // 4% outward expansion to ensure full card edges captured

  const paddedCorners = {
    tl: {
      x: centerX + (scaledCorners.tl.x - centerX) * paddingFactor,
      y: centerY + (scaledCorners.tl.y - centerY) * paddingFactor,
    },
    tr: {
      x: centerX + (scaledCorners.tr.x - centerX) * paddingFactor,
      y: centerY + (scaledCorners.tr.y - centerY) * paddingFactor,
    },
    bl: {
      x: centerX + (scaledCorners.bl.x - centerX) * paddingFactor,
      y: centerY + (scaledCorners.bl.y - centerY) * paddingFactor,
    },
    br: {
      x: centerX + (scaledCorners.br.x - centerX) * paddingFactor,
      y: centerY + (scaledCorners.br.y - centerY) * paddingFactor,
    },
  };

  // Clamp corners to image bounds
  const clamp = (val, max) => Math.max(0, Math.min(val, max));
  paddedCorners.tl.x = clamp(paddedCorners.tl.x, originalImg.width);
  paddedCorners.tl.y = clamp(paddedCorners.tl.y, originalImg.height);
  paddedCorners.tr.x = clamp(paddedCorners.tr.x, originalImg.width);
  paddedCorners.tr.y = clamp(paddedCorners.tr.y, originalImg.height);
  paddedCorners.bl.x = clamp(paddedCorners.bl.x, originalImg.width);
  paddedCorners.bl.y = clamp(paddedCorners.bl.y, originalImg.height);
  paddedCorners.br.x = clamp(paddedCorners.br.x, originalImg.width);
  paddedCorners.br.y = clamp(paddedCorners.br.y, originalImg.height);

  const croppedCard = perspectiveTransform(originalImg.img, paddedCorners, targetWidth, targetHeight);

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

