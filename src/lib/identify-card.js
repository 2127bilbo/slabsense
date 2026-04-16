/**
 * Card Identification Pipeline
 *
 * Orchestrates the CLIP-based card identification flow:
 * 1. Detect and crop card from photo
 * 2. Compute CLIP embedding
 * 3. Search embedding database for matches
 * 4. Return results with confidence levels
 *
 * Uses Transformers.js CLIP model for visual matching.
 * Works well on holographic and textured cards where pHash fails.
 */

import { matchCard as clipMatchCard, loadModel, loadEmbeddings } from './clip-matcher.js';
import { getFullCardData } from '../services/tcgdex.js';

/**
 * Pre-load CLIP model and embeddings (call on app init for faster first search)
 */
export async function preloadHashDb() {
  try {
    console.log('[IdentifyCard] Preloading CLIP model and embeddings...');
    await Promise.all([
      loadModel(),
      loadEmbeddings(),
    ]);
    console.log('[IdentifyCard] CLIP model and embeddings preloaded');
    return true;
  } catch (e) {
    console.warn('[IdentifyCard] Failed to preload CLIP:', e);
    return false;
  }
}

/**
 * Main identification pipeline using CLIP visual matching
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
    console.log('[IdentifyCard] Starting CLIP-based identification...');

    // Use CLIP matcher which handles crop + embed + match
    const result = await clipMatchCard(imageSrc, {
      cropCard,
      topK: 20,
      onProgress: (progress) => {
        // Map CLIP progress steps to percentage
        const stepMap = {
          'model': 10,
          'embeddings': 30,
          'crop': 50,
          'embed': 70,
          'match': 85,
          'done': 100,
        };
        if (onProgress && progress.step) {
          onProgress(stepMap[progress.step] || 50);
        }
      },
    });

    const elapsed = performance.now() - startTime;
    console.log(`[IdentifyCard] Complete in ${elapsed.toFixed(0)}ms - Status: ${result.status}`);

    // Transform CLIP matches to CardIdentifier expected format
    const transformedMatches = (result.matches || []).map(match => ({
      id: match.id,
      name: match.name,
      number: match.number,
      set: match.set,
      similarity: match.similarity,
      confidence: match.confidence,
      // Add distance-like score for UI (lower = better, scale similarity to distance)
      distance: Math.round((1 - match.similarity) * 100),
    }));

    // Fetch full card data for high confidence match
    let cardData = null;
    if (result.status === 'matched' && result.topMatch) {
      try {
        console.log('[IdentifyCard] Fetching card details for:', result.topMatch.id);
        cardData = await getFullCardData(result.topMatch.id);
      } catch (e) {
        console.warn('[IdentifyCard] Failed to fetch card data:', e);
      }
    }

    if (onProgress) onProgress(100);

    return {
      status: result.status,
      confidence: result.confidence || 'low',
      topMatch: result.topMatch ? {
        ...result.topMatch,
        distance: Math.round((1 - result.topMatch.similarity) * 100),
      } : null,
      matches: transformedMatches,
      rawMatches: result.matches || [],
      cardData,
      elapsed,
      cropInfo: result.cropInfo,
      embeddingsMeta: result.embeddingsMeta,
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
