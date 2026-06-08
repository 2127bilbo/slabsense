/**
 * SlabSense - Backend API Service
 * Connects to the Python/OpenCV grading backend
 */

import { supabase, isSupabaseConfigured } from './supabase.js';

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

// ═══════════════════════════════════════════════════════════════════════════
// API PROVIDER CONFIG
// Toggle between Replicate (current) and Direct Anthropic API
// ═══════════════════════════════════════════════════════════════════════════
const USE_DIRECT_ANTHROPIC = true;  // true = Direct Anthropic, false = Replicate
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE COMPRESSION CONFIG
// This compression is required while using Replicate (Vercel 4.5MB payload limit)
// Not needed when USE_DIRECT_ANTHROPIC = true (images uploaded to Supabase)
// ═══════════════════════════════════════════════════════════════════════════
const ENABLE_COMPRESSION = !USE_DIRECT_ANTHROPIC; // Auto-disable when using direct API
const MAX_CLAUDE_DIMENSION = 1500;
const DEFAULT_JPEG_QUALITY = 0.85;

/**
 * Compress image for API calls to stay under Vercel's 4.5MB payload limit
 * Required for Replicate-based AI grade. Will be removed post-Replicate migration.
 *
 * @param {string} dataUrl - Original image data URL
 * @param {number} maxDimension - Max width/height (default 1500)
 * @param {number} quality - JPEG quality 0-1 (default 0.85)
 * @returns {Promise<string>} Compressed image data URL (or original if compression disabled)
 */
async function compressImageForAPI(dataUrl, maxDimension = MAX_CLAUDE_DIMENSION, quality = DEFAULT_JPEG_QUALITY) {
  // Easy toggle to disable compression when Replicate is removed
  if (!ENABLE_COMPRESSION) {
    console.log('[Compress] Compression disabled, using original image');
    return dataUrl;
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Scale down if larger than max dimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height / width) * maxDimension);
          width = maxDimension;
        } else {
          width = Math.round((width / height) * maxDimension);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressed = canvas.toDataURL('image/jpeg', quality);
      const originalSize = Math.round(dataUrl.length / 1024);
      const newSize = Math.round(compressed.length / 1024);
      console.log(`[Compress] ${img.width}x${img.height} -> ${width}x${height} (${originalSize}KB -> ${newSize}KB)`);

      resolve(compressed);
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
 * Stitch two cropped card images side-by-side for Claude analysis
 * Both images should be the same height (standard card dimensions)
 */
async function stitchCroppedCards(frontDataUrl, backDataUrl) {
  const [frontImg, backImg] = await Promise.all([
    loadImageFromUrl(frontDataUrl),
    loadImageFromUrl(backDataUrl),
  ]);

  // Use consistent height, scale if needed
  const targetHeight = Math.max(frontImg.height, backImg.height);
  const frontScale = targetHeight / frontImg.height;
  const backScale = targetHeight / backImg.height;

  const frontW = Math.round(frontImg.width * frontScale);
  const backW = Math.round(backImg.width * backScale);

  const canvas = document.createElement('canvas');
  canvas.width = frontW + backW;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  // Draw front on left, back on right
  ctx.drawImage(frontImg.img, 0, 0, frontW, targetHeight);
  ctx.drawImage(backImg.img, frontW, 0, backW, targetHeight);

  const stitched = canvas.toDataURL('image/jpeg', 0.90);
  console.log(`[Stitch Cropped] ${frontW}+${backW} x ${targetHeight} = ${canvas.width}x${canvas.height} (${Math.round(stitched.length/1024)}KB)`);

  return {
    dataUrl: stitched,
    width: canvas.width,
    height: canvas.height,
    frontWidth: frontW,
    backWidth: backW,
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
 * CLAUDE GRADING ANALYSIS - Returns grades immediately
 *
 * Supports two modes based on USE_DIRECT_ANTHROPIC config:
 * - Direct Anthropic: Uploads images to Supabase, calls /api/ai-analyze-direct
 * - Replicate: Stitches images, calls /api/ai-analyze (legacy)
 *
 * Cost: ~$0.02-0.03 per analysis
 *
 * @param {string} frontImageDataUrl - Front card image
 * @param {string} backImageDataUrl - Back card image (optional for Replicate, recommended for Direct)
 * @param {string} cardType - 'pokemon' | 'sports' | 'tcg'
 * @param {string} userId - User ID (required when USE_DIRECT_ANTHROPIC = true)
 */
export async function claudeGradingAnalysis(frontImageDataUrl, backImageDataUrl = null, cardType = 'pokemon', userId = null) {
  console.log('[Claude AI] Starting grading analysis...');
  console.log('[Claude AI] Provider:', USE_DIRECT_ANTHROPIC ? 'Direct Anthropic' : 'Replicate');
  console.log('[Claude AI] Has back image:', !!backImageDataUrl);

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // DIRECT ANTHROPIC PATH - Upload images, call direct endpoint
    // ═══════════════════════════════════════════════════════════════════════
    if (USE_DIRECT_ANTHROPIC) {
      if (!userId) {
        throw new Error('User ID required for Direct Anthropic API. Please sign in.');
      }

      // Upload images to Supabase to get public URLs
      console.log('[Claude AI] Uploading images to Supabase...');
      const uploadPromises = [uploadImageForStandardAnalysis(frontImageDataUrl, 'front', userId)];
      if (backImageDataUrl) {
        uploadPromises.push(uploadImageForStandardAnalysis(backImageDataUrl, 'back', userId));
      }

      const urls = await Promise.all(uploadPromises);
      const frontUrl = urls[0];
      const backUrl = urls[1] || null;

      console.log('[Claude AI] Images uploaded, calling Direct Anthropic API...');

      // Call direct Anthropic endpoint
      const response = await fetch('/api/ai-analyze-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontUrl,
          backUrl,
          cardType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[Claude AI] Direct API error:', errorData);
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const claudeResult = await response.json();

      if (!claudeResult.success) {
        throw new Error(claudeResult.error || 'Direct analysis failed');
      }

      const analysis = claudeResult.analysis;
      console.log('[Claude AI] Card identified:', analysis.cardInfo?.name);

      return {
        success: true,
        cardInfo: analysis.cardInfo || null,
        centering: analysis.centering || {
          front: { leftRight: '50/50', topBottom: '50/50' },
          back: null,
        },
        condition: analysis.condition || null,
        grades: analysis.grades || null,
        summary: analysis.summary || null,
        rawAnalysis: analysis,
        model: claudeResult.model,
        cost: 0.02, // Direct API is cheaper
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // REPLICATE PATH - Stitch images, call Replicate endpoint (legacy)
    // ═══════════════════════════════════════════════════════════════════════
    let imageForClaude;
    let isStitched = false;

    if (backImageDataUrl) {
      const stitched = await stitchCroppedCards(frontImageDataUrl, backImageDataUrl);
      imageForClaude = stitched.dataUrl;
      isStitched = true;
      console.log(`[Claude AI] Stitched originals: ${stitched.width}x${stitched.height} (${Math.round(stitched.dataUrl.length/1024)}KB)`);
    } else {
      imageForClaude = frontImageDataUrl;
    }

    // Call Claude API with retry logic for rate limits
    let claudeResult = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[Claude AI] API attempt ${attempt}/3...`);

      const response = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageForClaude,
          isStitched,
          cardType,
        }),
      });

      if (response.ok) {
        claudeResult = await response.json();
        if (claudeResult.success) {
          console.log('[Claude AI] Grading complete!');
          break;
        }
      }

      // Handle errors
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      lastError = errorData;
      console.error(`[Claude AI] Attempt ${attempt} failed:`, errorData);

      // If rate limited (429), wait and retry
      if (response.status === 429 || errorData.status === 429) {
        const waitTime = (errorData.retry_after || 2) * 1000 + 500;
        console.log(`[Claude AI] Rate limited, waiting ${waitTime}ms before retry...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      break;
    }

    if (!claudeResult?.success) {
      console.error('[Claude AI] Failed:', lastError);
      throw new Error(lastError?.error || lastError?.message || 'Claude grading failed');
    }

    const analysis = claudeResult.analysis;
    console.log('[Claude AI] Card identified:', analysis.cardInfo?.name);

    // Return Claude results immediately (SAM will be called separately)
    return {
      success: true,
      // Card info from Claude
      cardInfo: analysis.cardInfo || null,
      // Centering measurements (shown on all tabs)
      centering: analysis.centering || {
        front: { leftRight: '50/50', topBottom: '50/50' },
        back: null,
      },
      // Raw condition scores
      condition: analysis.condition || null,
      // Multi-company grades (PSA, BGS, SGC, CGC, TAG)
      grades: analysis.grades || null,
      // Summary with positives/concerns
      summary: analysis.summary || null,
      // Full raw analysis for debugging
      rawAnalysis: analysis,
      // Metadata
      model: claudeResult.model,
      cost: 0.03,
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
 * Returns detailed grades for ALL companies, defect list, precise centering.
 *
 * Cost: ~$0.03-0.05 per analysis (higher due to full-res images)
 *
 * @param {string} frontImageDataUrl - Full resolution front image
 * @param {string} backImageDataUrl - Full resolution back image
 * @param {string} cardGame - 'pokemon' | 'sports' | 'tcg'
 * @param {string} userId - User ID for storage path (required for RLS)
 * @returns {Promise<object>} Detailed analysis result
 */
export async function deepGradingAnalysis(frontImageDataUrl, backImageDataUrl, cardGame = 'pokemon', userId = null) {
  console.log('[Deep AI] Starting full-resolution analysis...');

  if (!frontImageDataUrl || !backImageDataUrl) {
    throw new Error('Both front and back images required for Deep AI Grade');
  }

  if (!userId) {
    throw new Error('User ID required for Deep AI Grade');
  }

  try {
    // Step 1: Upload full-res images to Supabase to get public URLs
    console.log('[Deep AI] Uploading images to storage...');
    const [frontUrl, backUrl] = await Promise.all([
      uploadImageForDeepAnalysis(frontImageDataUrl, 'front', userId),
      uploadImageForDeepAnalysis(backImageDataUrl, 'back', userId),
    ]);

    console.log('[Deep AI] Images uploaded, calling Anthropic API...');

    // Step 2: Call our deep-analyze endpoint with just the URLs
    const response = await fetch('/api/deep-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frontUrl,
        backUrl,
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
