/**
 * Card Identification Pipeline
 *
 * Orchestrates CLIP-based card identification flow:
 * 1. Detect and crop card from photo
 * 2. Compute CLIP embedding
 * 3. Search embedding database for matches
 * 4. Return results with confidence levels
 *
 * Fallback chain:
 * - CLIP match (high confidence) → auto-select
 * - CLIP match (medium) → show candidates for user pick
 * - CLIP fail → fall back to manual search
 */

import { matchCard as clipMatchCard, preload as preloadClip, loadEmbeddings } from './clip-matcher.js';
import { getFullCardData } from '../services/tcgdex.js';

/**
 * Pre-load CLIP model and embeddings (call on app init for faster first search)
 */
export async function preloadHashDb() {
  try {
    console.log('[IdentifyCard] Preloading CLIP model and embeddings...');
    await preloadClip();
    console.log('[IdentifyCard] CLIP preloaded successfully');
    return true;
  } catch (e) {
    console.warn('[IdentifyCard] Failed to preload CLIP:', e);
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
 * @property {object[]} matches - All candidate matches
 * @property {object} cardData - Full card data (if high confidence match)
 */
export async function identifyCard(imageSrc, options = {}) {
  const { cropCard = true, onProgress = null } = options;

  const startTime = performance.now();

  try {
    // Use CLIP matcher (handles cropping, embedding, and matching)
    const matchResult = await clipMatchCard(imageSrc, {
      cropCard,
      topK: 20,
      onProgress: (p) => {
        // Map CLIP progress to 0-70%
        if (onProgress) {
          const progressMap = {
            'model': 10,
            'embeddings': 25,
            'crop': 40,
            'embed': 55,
            'match': 65,
            'done': 70,
          };
          onProgress(progressMap[p.step] || 50);
        }
      },
    });

    if (matchResult.status === 'error') {
      return {
        status: 'error',
        error: matchResult.error,
        matches: [],
      };
    }

    // Step 4: Process results
    const elapsed = performance.now() - startTime;
    console.log(`[IdentifyCard] Complete in ${elapsed.toFixed(0)}ms - Status: ${matchResult.status}`);

    // If high confidence, fetch full card data
    let cardData = null;
    if (matchResult.status === 'matched' && matchResult.topMatch) {
      if (onProgress) onProgress(85);
      console.log('[IdentifyCard] Fetching card details...');
      try {
        cardData = await getFullCardData(matchResult.topMatch.id);
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
      rawMatches: matchResult.matches || [],
      cardData,
      elapsed,
      dbMeta: matchResult.embeddingsMeta,
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
