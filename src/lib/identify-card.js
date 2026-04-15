/**
 * Card Identification Pipeline
 *
 * Orchestrates the pHash-based card identification flow:
 * 1. Detect and crop card from photo
 * 2. Compute perceptual hash
 * 3. Search hash database for matches
 * 4. Return results with confidence levels
 *
 * Fallback chain:
 * - pHash match (high confidence) → auto-select
 * - pHash match (medium) → show candidates for user pick
 * - pHash fail → fall back to manual search
 */

import { computePHash } from './phash.js';
import { matchCard, loadHashDb } from './card-matcher.js';
import { getFullCardData } from '../services/tcgdex.js';

/**
 * Detect and crop card from image using variance-based detection
 * Reuses logic from ocr.js
 */
async function detectAndCropCard(imageSrc) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSize = 800;
      let w = img.width, h = img.height;

      if (Math.max(w, h) > maxSize) {
        const scale = maxSize / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;

      // Grid-based variance detection
      const GX = 16, GY = 16;
      const cellW = Math.floor(w / GX), cellH = Math.floor(h / GY);
      const vg = [];
      let maxV = 0;

      for (let gy = 0; gy < GY; gy++) {
        vg[gy] = [];
        for (let gx = 0; gx < GX; gx++) {
          let s = 0, sq = 0, n = 0;
          const x0 = gx * cellW, y0 = gy * cellH;
          for (let y = y0; y < y0 + cellH && y < h; y += 2) {
            for (let x = x0; x < x0 + cellW && x < w; x += 2) {
              const idx = (y * w + x) * 4;
              const v = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
              s += v; sq += v * v; n++;
            }
          }
          const variance = n > 0 ? sq / n - (s / n) ** 2 : 0;
          vg[gy][gx] = variance;
          if (variance > maxV) maxV = variance;
        }
      }

      // Find bounding box of high-variance cells
      const floor = Math.max(30, maxV * 0.12);
      let minGX = GX, maxGX = -1, minGY = GY, maxGY = -1;

      for (let gy = 0; gy < GY; gy++) {
        for (let gx = 0; gx < GX; gx++) {
          if (vg[gy][gx] > floor) {
            if (gx < minGX) minGX = gx;
            if (gx > maxGX) maxGX = gx;
            if (gy < minGY) minGY = gy;
            if (gy > maxGY) maxGY = gy;
          }
        }
      }

      // Convert grid coords to pixels
      const pad = 5;
      const left = Math.max(0, minGX * cellW - pad);
      const top = Math.max(0, minGY * cellH - pad);
      const right = Math.min(w, (maxGX + 1) * cellW + pad);
      const bottom = Math.min(h, (maxGY + 1) * cellH + pad);
      const cropW = right - left;
      const cropH = bottom - top;

      // If detection failed, use center 80%
      if (cropW < 50 || cropH < 50 || maxGX < minGX) {
        const cx = w * 0.1, cy = h * 0.1;
        const cw = w * 0.8, ch = h * 0.8;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cw;
        cropCanvas.height = ch;
        cropCanvas.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
        resolve(cropCanvas.toDataURL('image/png'));
        return;
      }

      // Crop to detected card bounds
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      cropCanvas.getContext('2d').drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);
      resolve(cropCanvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      console.error('[IdentifyCard] Failed to load image');
      resolve(null);
    };

    img.src = imageSrc;
  });
}

/**
 * Pre-load hash database (call on app init for faster first search)
 */
export async function preloadHashDb() {
  try {
    await loadHashDb();
    console.log('[IdentifyCard] Hash database preloaded');
    return true;
  } catch (e) {
    console.warn('[IdentifyCard] Failed to preload hash DB:', e);
    return false;
  }
}

/**
 * Main identification pipeline
 *
 * @param {string} imageSrc - Card image (data URL or URL)
 * @param {object} options - Configuration options
 * @param {boolean} options.cropCard - Whether to auto-crop card (default: true)
 * @param {function} options.onProgress - Progress callback (0-100)
 * @returns {Promise<IdentificationResult>}
 *
 * @typedef {object} IdentificationResult
 * @property {'matched'|'ambiguous'|'unknown'|'error'} status
 * @property {string} confidence - 'high', 'medium', 'low'
 * @property {object} topMatch - Best match details
 * @property {object[]} matches - All candidate matches (grouped by artwork)
 * @property {string} hash - Computed pHash of the card
 * @property {object} cardData - Full card data (if high confidence match)
 */
export async function identifyCard(imageSrc, options = {}) {
  const { cropCard = true, onProgress = null } = options;

  const startTime = performance.now();

  try {
    // Step 1: Crop card from photo (if needed)
    if (onProgress) onProgress(10);
    let cardImage = imageSrc;

    if (cropCard) {
      console.log('[IdentifyCard] Detecting card bounds...');
      cardImage = await detectAndCropCard(imageSrc);
      if (!cardImage) {
        return {
          status: 'error',
          error: 'Failed to detect card in image',
          matches: [],
        };
      }
    }

    // Step 2: Compute pHash
    if (onProgress) onProgress(30);
    console.log('[IdentifyCard] Computing pHash...');
    const hash = await computePHash(cardImage);

    // Step 3: Search hash database
    if (onProgress) onProgress(50);
    console.log('[IdentifyCard] Searching database...');
    const matchResult = await matchCard(hash, { topN: 20, groupResults: true });

    if (onProgress) onProgress(70);

    // Step 4: Process results
    const elapsed = performance.now() - startTime;
    console.log(`[IdentifyCard] Complete in ${elapsed.toFixed(0)}ms - Status: ${matchResult.status}`);

    // If high confidence, fetch full card data
    let cardData = null;
    if (matchResult.status === 'matched' && matchResult.topMatch) {
      if (onProgress) onProgress(85);
      console.log('[IdentifyCard] Fetching card details...');
      try {
        cardData = await getFullCardData(matchResult.topMatch.primaryCard?.id || matchResult.topMatch.id);
      } catch (e) {
        console.warn('[IdentifyCard] Failed to fetch card data:', e);
      }
    }

    if (onProgress) onProgress(100);

    return {
      status: matchResult.status,
      confidence: matchResult.confidence || 'low',
      topMatch: matchResult.topMatch || null,
      matches: matchResult.matches || [],
      rawMatches: matchResult.rawMatches || [],
      hash,
      cardData,
      elapsed,
      dbMeta: matchResult.dbMeta,
    };

  } catch (error) {
    console.error('[IdentifyCard] Error:', error);
    return {
      status: 'error',
      error: error.message,
      matches: [],
    };
  }
}

/**
 * Get full card data for a specific match
 * Used when user selects from ambiguous results
 *
 * @param {string} cardId - TCGDex card ID
 * @returns {Promise<object>} Full card data
 */
export async function selectCard(cardId) {
  console.log('[IdentifyCard] User selected:', cardId);
  return await getFullCardData(cardId);
}

/**
 * Identification status descriptions for UI
 */
export const STATUS_MESSAGES = {
  matched: 'Card identified!',
  ambiguous: 'Multiple matches found - please select',
  unknown: 'Card not recognized - try manual search',
  error: 'Identification failed',
};

export default {
  identifyCard,
  selectCard,
  preloadHashDb,
  STATUS_MESSAGES,
};
