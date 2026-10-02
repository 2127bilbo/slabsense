/**
 * SlabSense - Backend API Service
 *
 * Unified API client for AI grading endpoints.
 * Uses Direct Anthropic API (Replicate path removed).
 *
 * Endpoints:
 * - /api/ai-analyze-unified → Standard AI Grade
 * - /api/deep-analyze-v2 → Deep AI Grade (multi-provider)
 *
 * Last updated: 2026-06-12
 */

import { supabase, isSupabaseConfigured } from './supabase.js';
import { resizeImage } from '../lib/image-utils.js';

/** Long-edge cap for photos uploaded for AI grading (see uploadImageFor*Analysis). */
const GRADE_UPLOAD_MAX_PX = 2000;

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED ENDPOINT MAPPING
// ═══════════════════════════════════════════════════════════════════════════
const ENDPOINTS = {
  // AI grading analysis (Direct Anthropic)
  AI_ANALYZE_UNIFIED: '/api/ai-analyze-unified',
  // Card identification (Claude Vision)
  // Multi-provider deep analysis
  DEEP_ANALYZE_V2: '/api/deep-analyze-v2',
};
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shape a raw /api/ai-analyze-unified response into the client result (unified schema).
 * Also used to resume a stored ai_grade_jobs.result.
 */
export function shapeAiResult(claudeResult, { jobId = null } = {}) {
  const analysis = claudeResult?.analysis || {};
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
    jobId: claudeResult.jobId || jobId,
    creditsRemaining: claudeResult.creditsRemaining,
  };
}

/**
 * Shape a raw /api/deep-analyze-v2 response into the client result (unified schema).
 * Also used to resume a stored ai_grade_jobs.result.
 */
export function shapeDeepResult(result, { jobId = null } = {}) {
  const analysis = result?.analysis || {};
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
    jobId: result.jobId || jobId,
    creditsRemaining: result.creditsRemaining,
    // Multi-provider results (if parallel/sequential/synthesize mode)
    multiProviderResults: result.multiProviderResults || null,
  };
}

/**
 * POST to a grade endpoint with the user's Supabase JWT, a hard timeout, and typed errors.
 * Throws an Error with .status (HTTP) and .data (JSON body) so callers can react to
 * 401 (sign in), 402 (credits), 409 (already running: data.jobId), or a timeout (.timeout).
 */
async function postGrade(url, body, { timeoutMs }) {
  if (!supabase) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw Object.assign(new Error('The grade is taking longer than expected. It keeps running on the server; the result will appear when it finishes.'), { timeout: true });
    throw e;
  } finally { clearTimeout(timer); }
  const data = await response.json().catch(() => ({ error: 'Unknown error' }));
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || `API error: ${response.status}`), { status: response.status, data });
  if (!data.success) throw Object.assign(new Error(data.error || 'Analysis failed'), { status: 500, data });
  return data;
}

/**
 * Upload one grade image to the user's folder in the card-images bucket and return its public URL.
 * Claude downsizes anything past ~1,568 px on the long edge before it looks at it, so a 2,000 px
 * copy keeps every pixel it uses at roughly a fifth of the bytes (and of the bucket storage).
 * @param {string} folder - 'standard-analysis' | 'deep-analysis' (the storage cleanup job knows both)
 */
async function uploadGradeImage(dataUrl, side, userId, folder, label) {
  if (!isSupabaseConfigured()) throw new Error(`Supabase not configured - required for ${label}`);
  if (!userId) throw new Error(`User ID required for ${label} uploads`);
  try {
    const response = await fetch(await resizeImage(dataUrl, GRADE_UPLOAD_MAX_PX, GRADE_UPLOAD_MAX_PX, 0.9));
    const blob = await response.blob();
    const filename = `${userId}/${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${side}.jpg`;
    const { error } = await supabase.storage.from('card-images').upload(filename, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`Failed to upload ${side} image: ${error.message}`);
    const { data: urlData } = supabase.storage.from('card-images').getPublicUrl(filename);
    if (!urlData?.publicUrl) throw new Error(`Failed to get public URL for ${side} image`);
    return urlData.publicUrl;
  } catch (err) {
    console.error(`[${label}] Upload ${side} error:`, err);
    throw err;
  }
}
const uploadImageForStandardAnalysis = (dataUrl, side, userId) => uploadGradeImage(dataUrl, side, userId, 'standard-analysis', 'AI Grade (basic)');
const uploadImageForDeepAnalysis = (dataUrl, side, userId) => uploadGradeImage(dataUrl, side, userId, 'deep-analysis', 'AI Grade');

/**
 * Native-resolution tiles of a card crop for the tiled surface pass (api/_lib/surfacePass.js):
 * a 2 x 3 grid, each tile at most `maxPx` on its long side (Anthropic's cap), as JPEG data URLs.
 * Cut from the full-resolution crop, never from the 2,000 px upload copy.
 */
export async function cutSurfaceTiles(cropDataUrl, { cols = 2, rows = 3, maxPx = 1568, quality = 0.9 } = {}) {
  const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('tile source failed to load')); i.src = cropDataUrl; });
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const tw = Math.ceil(W / cols), th = Math.ceil(H / rows);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const sx = c * tw, sy = r * th, sw = Math.min(tw, W - sx), sh = Math.min(th, H - sy);
    const sc = Math.min(1, maxPx / Math.max(sw, sh));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(sw * sc); canvas.height = Math.round(sh * sc);
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    out.push(canvas.toDataURL('image/jpeg', quality));
  }
  img.src = '';
  return out;
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
  backCentering = null,
  { jobId = null, cardKey = null, cornerEdge = null } = {}
) {
  // The endpoint needs front centering; back is optional (front-only grading when no back image)
  const hasSoftwareCentering = frontCentering?.lrRatio != null && (backImageDataUrl == null || backCentering?.lrRatio != null);
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

    // Build request body (jobId/cardKey tie the result to this card for the durable job row)
    const requestBody = { frontUrl, backUrl, cardType, jobId, cardKey };
    // Corner/edge model table (every slot, both sides): the server replaces Claude's
    // corner/edge findings with it so the paid grade agrees with the free grade.
    if (cornerEdge) requestBody.cornerEdge = cornerEdge;

    // Include software centering if available (more accurate than AI estimation)
    if (hasSoftwareCentering) {
      requestBody.frontCentering = frontCentering;
      if (backCentering?.lrRatio != null) requestBody.backCentering = backCentering;
      console.log('[Claude AI] Using software centering:', {
        front: `${frontCentering.lrRatio.toFixed(1)}/${frontCentering.tbRatio.toFixed(1)}`,
        back: backCentering?.lrRatio != null ? `${backCentering.lrRatio.toFixed(1)}/${backCentering.tbRatio.toFixed(1)}` : 'none'
      });
    }

    const claudeResult = await postGrade(ENDPOINTS.AI_ANALYZE_UNIFIED, requestBody, { timeoutMs: 150000 });

    const analysis = claudeResult.analysis;
    console.log('[Claude AI] Card identified:', analysis.cardInfo?.name);
    console.log('[Claude AI] subgrades:', analysis.subgrades);
    console.log('[Claude AI] overall:', analysis.overall);

    return shapeAiResult(claudeResult, { jobId });

  } catch (error) {
    console.error('[Claude AI] Error:', error);
    throw error;
  }
}

/**
 * Upload image to Supabase for Deep AI analysis
 * Returns public URL that Claude can fetch directly
 */
/**
 * Deep Grading Analysis V2 - Two-Pass with Reference Comparison (MULTI-PROVIDER)
 *
 * This version uses a two-pass system:
 * 1. Quick estimate to determine grade range
 * 2. Query similar reference cards from database
 * 3. Compare against real TAG-graded examples for final grade
 *
 * MULTI-PROVIDER SUPPORT:
 * - Provider selection is server-side (deep-analyze-v2.js DEFAULT_CONFIG)
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
  backCentering = null,   // { lrRatio, tbRatio }
  { jobId = null, cardKey = null, cornerEdge = null } = {}
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
    // Tiled surface pass: six native-resolution tiles per side from the crops (surfacePass.js).
    // The uncropped originals are no longer sent: the crop plus the tiles is everything the
    // inspection needs, and the background was the one thing the originals added (audit F-09).
    const [frontTiles, backTiles] = await Promise.all([cutSurfaceTiles(frontCropped), cutSurfaceTiles(backCropped)]);
    const uploadTiles = (list, side) => Promise.all(list.map((t, i) => uploadImageForDeepAnalysis(t, `${side}-tile${i + 1}`, userId)));
    const [frontCroppedUrl, backCroppedUrl, frontTileUrls, backTileUrls] = await Promise.all([
      uploadImageForDeepAnalysis(frontCropped, 'front-cropped', userId),
      uploadImageForDeepAnalysis(backCropped, 'back-cropped', userId),
      uploadTiles(frontTiles, 'front'),
      uploadTiles(backTiles, 'back'),
    ]);

    console.log('[Deep AI V2] Images uploaded, starting two-pass analysis...');

    // Step 2: Call our deep-analyze-v2 endpoint (multi-provider aware)
    const requestBody = {
      frontCroppedUrl,
      backCroppedUrl,
      frontUrl: frontCroppedUrl,
      backUrl: backCroppedUrl,
      frontTileUrls,
      backTileUrls,
      cardGame,
      cardType,
      jobId,
      cardKey,
      // Provider selection is server-side (deep-analyze-v2.js DEFAULT_CONFIG); the client never picks one
    };
    // Corner/edge model table (every slot, both sides): the server replaces Claude's
    // corner/edge findings with it so the paid grade agrees with the free grade.
    if (cornerEdge) requestBody.cornerEdge = cornerEdge;

    // Include software centering if available (more accurate than AI estimation)
    if (hasSoftwareCentering) {
      requestBody.frontCentering = frontCentering;
      requestBody.backCentering = backCentering;
      console.log('[Deep AI V2] Using software centering:', {
        front: `${frontCentering.lrRatio.toFixed(1)}/${frontCentering.tbRatio.toFixed(1)}`,
        back: `${backCentering.lrRatio.toFixed(1)}/${backCentering.tbRatio.toFixed(1)}`
      });
    }

    const result = await postGrade(ENDPOINTS.DEEP_ANALYZE_V2, requestBody, { timeoutMs: 320000 });

    // Extract from unified schema (result.analysis; see docs/GRADING_SYSTEM.md)
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

    return shapeDeepResult(result, { jobId });

  } catch (error) {
    console.error('[Deep AI V2] Error:', error);
    throw error;
  }
}
