/**
 * SlabSense - Backend API Service
 *
 * Unified API client for AI grading endpoints.
 * Uses Direct Anthropic API (Replicate path removed).
 *
 * Endpoints:
 * - /api/ai-analyze-unified → Standard AI Grade
 * - /api/card-info-unified?mode=claude → Card identification
 * - /api/deep-analyze-v2 → Deep AI Grade (multi-provider)
 *
 * Last updated: 2026-06-12
 */

import { supabase, isSupabaseConfigured } from './supabase.js';

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED ENDPOINT MAPPING
// ═══════════════════════════════════════════════════════════════════════════
const ENDPOINTS = {
  // AI grading analysis (Direct Anthropic)
  AI_ANALYZE_UNIFIED: '/api/ai-analyze-unified',
  // Card identification (Claude Vision)
  CARD_INFO_UNIFIED: '/api/card-info-unified',
  // Multi-provider deep analysis
  DEEP_ANALYZE_V2: '/api/deep-analyze-v2',
};
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze card using Claude Vision AI (UNIFIED ENDPOINT)
 * Extracts card identification info (name, set, rarity, etc.)
 *
 * NOTE: This endpoint is IDENTIFICATION-ONLY. For grading, use:
 * - claudeGradingAnalysis() for Standard AI Grade
 * - deepGradingAnalysisV2() for Deep AI Grade
 *
 * @param {string} imageDataUrl - Card image (cropped preferred)
 * @param {string} cardType - 'pokemon' | 'sports' | 'tcg'
 * @returns {Promise<object>} Card identification result
 */
export async function analyzeCardWithVision(imageDataUrl, cardType = 'pokemon') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for vision

  try {
    console.log(`[Claude Vision] Starting ${cardType} card identification...`);

    // Use unified endpoint with mode=claude (identification-only)
    const response = await fetch(`${ENDPOINTS.CARD_INFO_UNIFIED}?mode=claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: imageDataUrl,
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
    console.log('[Claude Vision] Identification complete:', result.analysis?.cardInfo?.name);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Card identification timed out - please try again');
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
  const result = await analyzeCardWithVision(imageDataUrl, cardType);
  // Transform to legacy format for backwards compatibility
  return {
    success: result.success,
    cardInfo: result.analysis?.cardInfo || null,
    rawResponse: result.rawResponse,
  };
}

/**
 * Upload image to Supabase for Standard AI analysis (Direct Anthropic path)
 * Returns public URL that Claude can fetch directly
 */
async function uploadImageForStandardAnalysis(dataUrl, side, userId) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured - required for Direct Anthropic API');
  }

  if (!userId) {
    throw new Error('User ID required for Direct Anthropic uploads');
  }

  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Generate unique filename under user's folder (required by RLS policy)
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const filename = `${userId}/standard-analysis/${timestamp}_${randomId}_${side}.jpg`;

    // Upload to storage bucket
    const { data, error } = await supabase.storage
      .from('card-images')
      .upload(filename, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[Standard AI] Upload error:', error);
      throw new Error(`Failed to upload ${side} image: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('card-images')
      .getPublicUrl(filename);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) {
      throw new Error(`Failed to get public URL for ${side} image`);
    }

    console.log(`[Standard AI] Uploaded ${side}:`, publicUrl.substring(0, 60) + '...');
    return publicUrl;
  } catch (err) {
    console.error(`[Standard AI] Upload ${side} error:`, err);
    throw err;
  }
}

/**
 * CLAUDE GRADING ANALYSIS - Returns grades immediately (UNIFIED ENDPOINT)
 *
 * Uses Direct Anthropic API with images uploaded to Supabase.
 *
 * Cost: ~$0.02-0.03 per analysis
 *
 * @param {string} frontImageDataUrl - Front card image
 * @param {string} backImageDataUrl - Back card image (optional)
 * @param {string} cardType - 'pokemon' | 'sports' | 'tcg'
 * @param {string} userId - User ID (required)
 * @param {object} frontCentering - Optional software centering { lrRatio, tbRatio }
 * @param {object} backCentering - Optional software centering { lrRatio, tbRatio }
 */
export async function claudeGradingAnalysis(
  frontImageDataUrl,
  backImageDataUrl = null,
  cardType = 'pokemon',
  userId = null,
  frontCentering = null,
  backCentering = null
) {
  const hasSoftwareCentering = frontCentering?.lrRatio != null && backCentering?.lrRatio != null;
  console.log('[Claude AI] Starting grading analysis...');
  console.log('[Claude AI] Has back image:', !!backImageDataUrl);
  console.log('[Claude AI] Has software centering:', hasSoftwareCentering);

  if (!userId) {
    throw new Error('User ID required for AI Grade. Please sign in.');
  }

  try {
    // Upload images to Supabase to get public URLs
    console.log('[Claude AI] Uploading images to Supabase...');
    const uploadPromises = [uploadImageForStandardAnalysis(frontImageDataUrl, 'front', userId)];
    if (backImageDataUrl) {
      uploadPromises.push(uploadImageForStandardAnalysis(backImageDataUrl, 'back', userId));
    }

    const urls = await Promise.all(uploadPromises);
    const frontUrl = urls[0];
    const backUrl = urls[1] || null;

    console.log('[Claude AI] Images uploaded, calling unified AI endpoint...');

    // Build request body
    const requestBody = {
      frontUrl,
      backUrl,
      cardType,
    };

    // Include software centering if available (more accurate than AI estimation)
    if (hasSoftwareCentering) {
      requestBody.frontCentering = frontCentering;
      requestBody.backCentering = backCentering;
      console.log('[Claude AI] Using software centering:', {
        front: `${frontCentering.lrRatio.toFixed(1)}/${frontCentering.tbRatio.toFixed(1)}`,
        back: `${backCentering.lrRatio.toFixed(1)}/${backCentering.tbRatio.toFixed(1)}`
      });
    }

    const response = await fetch(ENDPOINTS.AI_ANALYZE_UNIFIED, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[Claude AI] API error:', errorData);
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const claudeResult = await response.json();

    if (!claudeResult.success) {
      throw new Error(claudeResult.error || 'Analysis failed');
    }

    const analysis = claudeResult.analysis;
    console.log('[Claude AI] Card identified:', analysis.cardInfo?.name);
    console.log('[Claude AI] subgrades:', analysis.subgrades);
    console.log('[Claude AI] overall:', analysis.overall);

    // Return unified schema shape (GRADING_OUTPUT_SCHEMA.md)
    return {
      success: true,
      // Card identification
      cardInfo: analysis.cardInfo || null,
      // Centering: numeric shape (lrRatio/tbRatio/devLR/devTB/maxDev)
      centering: analysis.centering || null,
      // 8 subgrades (0-100 scale) - UI subgrade panel reads this
      subgrades: analysis.subgrades || null,
      // Overall grade info (score, grade, label, displayGrade, capsApplied, minSubgrade)
      overall: analysis.overall || null,
      // Company-specific grades (tag, psa, bgs, cgc, sgc)
      grades: analysis.companyGrades || null,
      // Defects list with counts and items
      defects: analysis.defects || null,
      // Summary (positives, concerns, recommendation)
      summary: analysis.summary || null,
      // Confidence (value 0-1, factors array)
      confidence: analysis.confidence || null,
      // Full analysis for debugging
      rawAnalysis: analysis,
      // Metadata
      model: claudeResult.model,
      cost: 0.02,
    };

  } catch (error) {
    console.error('[Claude AI] Error:', error);
    throw error;
  }
}

/**
 * Upload image to Supabase for Deep AI analysis
 * Returns public URL that Claude can fetch directly
 */
async function uploadImageForDeepAnalysis(dataUrl, side, userId) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured - required for Deep AI Grade');
  }

  if (!userId) {
    throw new Error('User ID required for Deep AI Grade uploads');
  }

  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Generate unique filename under user's folder (required by RLS policy)
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const filename = `${userId}/deep-analysis/${timestamp}_${randomId}_${side}.jpg`;

    // Upload to storage bucket
    const { data, error } = await supabase.storage
      .from('card-images')
      .upload(filename, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[Deep AI] Upload error:', error);
      throw new Error(`Failed to upload ${side} image: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('card-images')
      .getPublicUrl(filename);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) {
      throw new Error(`Failed to get public URL for ${side} image`);
    }

    console.log(`[Deep AI] Uploaded ${side}:`, publicUrl.substring(0, 60) + '...');
    return publicUrl;
  } catch (err) {
    console.error(`[Deep AI] Upload ${side} error:`, err);
    throw err;
  }
}

/**
 * DEEP AI GRADING ANALYSIS - Full resolution via Anthropic API
 *
 * Uses direct Anthropic Claude API with image URLs for maximum quality analysis.
 * Bypasses Vercel's 4.5MB payload limit by uploading images to Supabase
 * and passing URLs to Claude instead of base64 data.
 *
 * 4-IMAGE APPROACH:
 * - Original front/back: Used for CENTERING measurement (shows card edge vs background)
 * - Cropped front/back: Used for DEFECT detection (high detail on card surface)
 *
 * Returns detailed grades for ALL companies, defect list, precise centering.
 *
 * Cost: ~$0.08-0.10 per analysis (4 images for maximum accuracy)
 *
 * @param {string} originalFrontImage - Original photo with background (for centering)
 * @param {string} originalBackImage - Original photo with background (for centering)
 * @param {string} croppedFrontImage - Cropped card image (for defect detection)
 * @param {string} croppedBackImage - Cropped card image (for defect detection)
 * @param {string} cardGame - 'pokemon' | 'sports' | 'tcg'
 * @param {string} userId - User ID for storage path (required for RLS)
 * @returns {Promise<object>} Detailed analysis result
 */
export async function deepGradingAnalysis(originalFrontImage, originalBackImage, croppedFrontImage = null, croppedBackImage = null, cardGame = 'pokemon', userId = null) {
  console.log('[Deep AI] Starting 4-image full-resolution analysis...');

  // Support legacy 2-image calls: if cropped images not provided, use originals for both
  const frontOriginal = originalFrontImage;
  const backOriginal = originalBackImage;
  const frontCropped = croppedFrontImage || originalFrontImage;
  const backCropped = croppedBackImage || originalBackImage;

  if (!frontOriginal || !backOriginal) {
    throw new Error('Both front and back images required for Deep AI Grade');
  }

  if (!userId) {
    throw new Error('User ID required for Deep AI Grade');
  }

  try {
    // Step 1: Upload all images to Supabase to get public URLs
    console.log('[Deep AI] Uploading 4 images to storage...');
    const [frontOriginalUrl, backOriginalUrl, frontCroppedUrl, backCroppedUrl] = await Promise.all([
      uploadImageForDeepAnalysis(frontOriginal, 'front-original', userId),
      uploadImageForDeepAnalysis(backOriginal, 'back-original', userId),
      uploadImageForDeepAnalysis(frontCropped, 'front-cropped', userId),
      uploadImageForDeepAnalysis(backCropped, 'back-cropped', userId),
    ]);

    console.log('[Deep AI] Images uploaded, calling Anthropic API with 4 images...');

    // Step 2: Call our deep-analyze endpoint with all 4 URLs
    const response = await fetch('/api/deep-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frontOriginalUrl,
        backOriginalUrl,
        frontCroppedUrl,
        backCroppedUrl,
        // Legacy support
        frontUrl: frontCroppedUrl,
        backUrl: backCroppedUrl,
        cardGame,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[Deep AI] API error:', errorData);
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Deep analysis failed');
    }

    console.log('[Deep AI] Analysis complete:', {
      card: result.cardInfo?.name,
      psa: result.grades?.psa?.grade,
      defects: result.defects?.length || 0,
    });

    return {
      success: true,
      // Card identification
      cardInfo: result.cardInfo,
      // Precise centering measurements
      centering: result.centering,
      // Condition scores (1-10)
      condition: result.condition,
      // Detailed defect list
      defects: result.defects,
      // Grades for all companies (PSA, BGS, CGC, SGC, TAG)
      grades: result.grades,
      // Summary with recommendations
      summary: result.summary,
      // Analysis metadata
      analysisType: 'deep',
      cost: 0.05,
    };

  } catch (error) {
    console.error('[Deep AI] Error:', error);
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
 * Deep Grading Analysis V2 - Two-Pass with Reference Comparison (MULTI-PROVIDER)
 *
 * This version uses a two-pass system:
 * 1. Quick estimate to determine grade range
 * 2. Query similar reference cards from database
 * 3. Compare against real TAG-graded examples for final grade
 *
 * MULTI-PROVIDER SUPPORT:
 * - Provider selection is controlled by ai-config.json (admin only)
 * - Supports modes: single, parallel, sequential, synthesize
 * - Fallback to Claude if other providers fail
 *
 * More accurate than V1, similar cost (~$0.04-0.05 per grade)
 *
 * @param {string} originalFrontImage - Full card image with background (for centering)
 * @param {string} originalBackImage - Full card image with background (for centering)
 * @param {string} croppedFrontImage - Cropped card image (for defect detection)
 * @param {string} croppedBackImage - Cropped card image (for defect detection)
 * @param {string} cardGame - 'pokemon' | 'sports' | 'tcg'
 * @param {string} cardType - 'modern_holo' | 'vintage_holo' | 'non_holo'
 * @param {string} userId - User ID for storage path (required for RLS)
 * @returns {Promise<object>} Detailed analysis result with reference comparison
 */
export async function deepGradingAnalysisV2(
  originalFrontImage,
  originalBackImage,
  croppedFrontImage = null,
  croppedBackImage = null,
  cardGame = 'pokemon',
  cardType = 'modern_holo',
  userId = null,
  // Optional software-calculated centering (from calculateCenteringFromBounds)
  frontCentering = null,  // { lrRatio, tbRatio }
  backCentering = null    // { lrRatio, tbRatio }
) {
  const hasSoftwareCentering = frontCentering?.lrRatio != null && backCentering?.lrRatio != null;
  console.log('[Deep AI V2] Starting two-pass reference comparison analysis...', hasSoftwareCentering ? '(with software centering)' : '');
  console.log('[Deep AI V2] Received params:', {
    hasOriginalFront: !!originalFrontImage,
    hasOriginalBack: !!originalBackImage,
    hasCroppedFront: !!croppedFrontImage,
    hasCroppedBack: !!croppedBackImage,
    cardGame,
    cardType,
    userId: userId,
    hasFrontCentering: !!frontCentering,
    hasBackCentering: !!backCentering,
  });

  // Support legacy 2-image calls
  const frontOriginal = originalFrontImage;
  const backOriginal = originalBackImage;
  const frontCropped = croppedFrontImage || originalFrontImage;
  const backCropped = croppedBackImage || originalBackImage;

  if (!frontOriginal || !backOriginal) {
    throw new Error('Both front and back images required for Deep AI Grade V2');
  }

  if (!userId) {
    console.error('[Deep AI V2] userId is falsy:', userId, typeof userId);
    throw new Error('User ID required for Deep AI Grade V2');
  }

  try {
    // Step 1: Upload all images to Supabase to get public URLs
    console.log('[Deep AI V2] Uploading images to storage...');
    const [frontOriginalUrl, backOriginalUrl, frontCroppedUrl, backCroppedUrl] = await Promise.all([
      uploadImageForDeepAnalysis(frontOriginal, 'front-original', userId),
      uploadImageForDeepAnalysis(backOriginal, 'back-original', userId),
      uploadImageForDeepAnalysis(frontCropped, 'front-cropped', userId),
      uploadImageForDeepAnalysis(backCropped, 'back-cropped', userId),
    ]);

    console.log('[Deep AI V2] Images uploaded, starting two-pass analysis...');

    // Step 2: Call our deep-analyze-v2 endpoint (multi-provider aware)
    const requestBody = {
      frontOriginalUrl,
      backOriginalUrl,
      frontCroppedUrl,
      backCroppedUrl,
      frontUrl: frontCroppedUrl,
      backUrl: backCroppedUrl,
      cardGame,
      cardType,
      // Provider selection is handled server-side via ai-config.json
      // Frontend does NOT specify providers
    };

    // Include software centering if available (more accurate than AI estimation)
    if (hasSoftwareCentering) {
      requestBody.frontCentering = frontCentering;
      requestBody.backCentering = backCentering;
      console.log('[Deep AI V2] Using software centering:', {
        front: `${frontCentering.lrRatio.toFixed(1)}/${frontCentering.tbRatio.toFixed(1)}`,
        back: `${backCentering.lrRatio.toFixed(1)}/${backCentering.tbRatio.toFixed(1)}`
      });
    }

    const response = await fetch(ENDPOINTS.DEEP_ANALYZE_V2, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[Deep AI V2] API error:', errorData);
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Deep analysis V2 failed');
    }

    // Extract from unified schema (result.analysis contains full GRADING_OUTPUT_SCHEMA)
    const analysis = result.analysis || {};

    console.log('[Deep AI V2] Analysis complete:', {
      card: result.cardInfo?.name,
      tag: result.grades?.tag?.grade,
      confidence: analysis.confidence?.value,
      referencesUsed: result.passes?.referencesUsed,
      elapsedMs: result.meta?.elapsedMs,
      providers: result.multiProviderResults ? Object.keys(result.multiProviderResults) : ['primary'],
      mode: result.meta?.gradeMode || 'single',
    });
    console.log('[Deep AI V2] subgrades:', analysis.subgrades);
    console.log('[Deep AI V2] overall:', analysis.overall);

    // Return unified schema shape (GRADING_OUTPUT_SCHEMA.md)
    return {
      success: true,
      version: 'v2',
      // Two-pass metadata
      passes: result.passes,
      // Card identification
      cardInfo: result.cardInfo || analysis.cardInfo || null,
      // Centering: numeric shape (lrRatio/tbRatio/devLR/devTB/maxDev)
      centering: result.centering || analysis.centering || null,
      // 8 subgrades (0-100 scale) - UI subgrade panel reads this
      subgrades: analysis.subgrades || null,
      // Overall grade info (score, grade, label, displayGrade, capsApplied, minSubgrade)
      overall: analysis.overall || null,
      // Company-specific grades (tag, psa, bgs, cgc, sgc)
      grades: result.grades || analysis.companyGrades || null,
      // Defects list with counts and items
      defects: result.defects || analysis.defects || null,
      // Summary (positives, concerns, recommendation)
      summary: result.summary || analysis.summary || null,
      // Confidence (value 0-1, factors array)
      confidence: analysis.confidence || null,
      // Full analysis for debugging
      rawAnalysis: analysis,
      // Analysis metadata
      analysisType: 'deep-v2',
      meta: result.meta || analysis.meta || null,
      cost: 0.05,
      // Multi-provider results (if parallel/sequential/synthesize mode)
      multiProviderResults: result.multiProviderResults || null,
    };

  } catch (error) {
    console.error('[Deep AI V2] Error:', error);
    throw error;
  }
}
