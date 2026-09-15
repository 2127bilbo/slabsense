/**
 * CLIP Card Matcher - Browser-based visual card matching
 *
 * Uses Transformers.js to compute CLIP embeddings and match
 * against pre-computed card embeddings.
 *
 * Flow:
 * 1. Load pre-computed embeddings (on init)
 * 2. User captures card photo
 * 3. Crop card using card-detector
 * 4. Compute CLIP embedding with Transformers.js
 * 5. Find closest matches by cosine similarity
 */

import { detectAndCropCard } from './card-detector.js';
import { loadCardDb, topK as dbTopK } from './card-db-client.js';

// Transformers.js pipeline (lazy loaded)
let clipPipeline = null;
let isLoadingModel = false;
let modelLoadPromise = null;

// Embeddings database
let embeddingsMeta = null;

// Card info lookup (from card-hashes.json; only used on the bundled-JSON fallback path)
let cardInfoDb = null;

// Unified DB: { matrix: Float32Array(count×dim, unit rows), ids: string[], cards: {id:{name,set,number}}, meta }
let cardDb = null;
let cardDbPromise = null;

const CARD_DB_BASE = (() => {
  try {
    const u = import.meta.env?.VITE_SUPABASE_URL;
    return u ? `${u}/storage/v1/object/public/card-db` : null;
  } catch { return null; }
})();

/**
 * Re-ranking of the CLIP top-K (bake-off 2026-09-14, scripts/harness/results/*-identify*.md):
 *   'none'  → cosine order only
 *   'pixel' → + number-line template match against each candidate's TCGDex image
 *   'ocr'   → + set number read from the crop
 *   'both'  → both boosts
 * Set from the bake-off winner; override per call with matchCard(src, { rerank }).
 */
export const DEFAULT_RERANK = 'both';
/** Weight of the pixel number-line boost (× max(0, NCC)). 0.25 was harmful at production scale
 *  (bake-off 2026-09-14, normalized queries): use only what the harness validated. */
export const PIXEL_WEIGHT = 0.03;
/** Boost when the OCR'd set number equals the candidate's number. */
export const OCR_WEIGHT = 0.15;

function l2normalize(v) {
  let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Load CLIP model (lazy, cached)
 * First call downloads ~90MB model, subsequent calls use cache
 */
export async function loadModel(onProgress = null) {
  if (clipPipeline) return clipPipeline;

  if (isLoadingModel && modelLoadPromise) {
    return modelLoadPromise;
  }

  isLoadingModel = true;

  modelLoadPromise = (async () => {
    try {
      if (onProgress) onProgress({ status: 'loading', message: 'Loading AI model...' });

      // Dynamic import to enable code splitting
      const { pipeline, env } = await import('@xenova/transformers');

      // Configure for browser
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      if (onProgress) onProgress({ status: 'downloading', message: 'Downloading model (first time only)...' });

      clipPipeline = await pipeline(
        'image-feature-extraction',
        'Xenova/clip-vit-base-patch32',
        {
          progress_callback: (progress) => {
            if (onProgress && progress.status === 'progress') {
              const pct = Math.round((progress.loaded / progress.total) * 100);
              onProgress({
                status: 'downloading',
                message: `Downloading model: ${pct}%`,
                progress: pct,
              });
            }
          },
        }
      );

      if (onProgress) onProgress({ status: 'ready', message: 'Model ready!' });

      return clipPipeline;

    } catch (error) {
      console.error('[CLIPMatcher] Failed to load model:', error);
      throw error;
    } finally {
      isLoadingModel = false;
    }
  })();

  return modelLoadPromise;
}

/**
 * Load card info from card-hashes.json (for name lookups)
 */
async function loadCardInfo() {
  if (cardDb?.cards) return cardDb.cards;
  if (cardInfoDb) return cardInfoDb;

  try {
    const response = await fetch('/card-hashes.json');
    if (!response.ok) {
      console.warn('[CLIPMatcher] Could not load card-hashes.json for name lookups');
      return {};
    }
    const data = await response.json();

    // Convert array to lookup object by ID
    cardInfoDb = {};
    for (const card of data.cards) {
      cardInfoDb[card.id] = {
        name: card.name,
        set: card.set,
        number: card.number,
      };
    }
    console.log(`[CLIPMatcher] Loaded card info for ${Object.keys(cardInfoDb).length} cards`);
    return cardInfoDb;
  } catch (e) {
    console.warn('[CLIPMatcher] Failed to load card info:', e);
    return {};
  }
}

/**
 * Load pre-computed embeddings database
 * Supports chunked loading for large databases
 */
export async function loadEmbeddings(forceRefresh = false) {
  if (cardDb && !forceRefresh) return { embeddings: cardDb, meta: cardDb.meta };
  if (cardDbPromise && !forceRefresh) return cardDbPromise;

  cardDbPromise = (async () => {
    const startTime = performance.now();
    // 1) Sharded DB from the public bucket (versioned, cached per shard in the browser)
    if (CARD_DB_BASE) {
      try {
        const db = await loadCardDb({ baseUrl: CARD_DB_BASE });
        cardDb = db;
        embeddingsMeta = db.meta;
        console.log(`[CLIPMatcher] Loaded ${db.meta.count} embeddings (bucket v${db.meta.version}) in ${(performance.now() - startTime).toFixed(0)}ms`);
        return { embeddings: cardDb, meta: embeddingsMeta };
      } catch (e) {
        console.error('[CLIPMatcher] card DB unavailable:', e?.message || e);
        throw new Error(`Card database unavailable: ${e?.message || e}`);
      }
    }
    throw new Error('Card database not configured (VITE_SUPABASE_URL missing)');
  })();
  try { return await cardDbPromise; } finally { cardDbPromise = null; }
}

/**
 * Compute CLIP embedding for an image
 */
export async function computeEmbedding(imageSource) {
  const model = await loadModel();

  // If it's a canvas, convert to data URL
  let input = imageSource;
  if (imageSource instanceof HTMLCanvasElement) {
    input = imageSource.toDataURL('image/jpeg', 0.9);
  }

  const output = await model(input, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Derive TCGDex series from set ID
 */
function getSeriesFromSetId(setId) {
  if (!setId) return 'unknown';
  const s = setId.toLowerCase();

  // Scarlet & Violet era
  if (s.startsWith('sv')) return 'sv';

  // Sword & Shield era
  if (s.startsWith('swsh')) return 'swsh';

  // Sun & Moon era
  if (s.startsWith('sm')) return 'sm';

  // XY era
  if (s.startsWith('xy')) return 'xy';

  // Black & White era
  if (s.startsWith('bw')) return 'bw';

  // HeartGold SoulSilver era
  if (s.startsWith('hgss')) return 'hgss';

  // Platinum era
  if (s.startsWith('pl')) return 'pl';

  // Diamond & Pearl era
  if (s.startsWith('dp') || s.startsWith('dv') || s.startsWith('dpp')) return 'dp';

  // EX era
  if (s.startsWith('ex')) return 'ex';

  // e-Card era
  if (s.startsWith('ecard')) return 'ecard';

  // Neo era
  if (s.startsWith('neo')) return 'neo';

  // Gym era
  if (s.startsWith('gym')) return 'gym';

  // Base era
  if (s.startsWith('base') || s === 'lc') return 'base';

  // Promos and special sets
  if (s.startsWith('pop')) return 'pop';
  if (s.startsWith('cel')) return 'cel';
  if (s.startsWith('col')) return 'col';
  if (s.startsWith('det')) return 'det';
  if (s.startsWith('dc')) return 'dc';
  if (s.startsWith('fut')) return 'fut';
  if (s.startsWith('si')) return 'si';
  if (s.startsWith('ru')) return 'ru';
  if (s.startsWith('np')) return 'np';
  if (s.startsWith('mcd')) return 'mcd';
  if (s.startsWith('me')) return 'me';
  if (s === 'g1') return 'g';
  if (s === 'p') return 'p';

  // Pokemon TCG Pocket
  if (s.match(/^[ab]\d/)) return 'tcgp';

  return 'unknown';
}

/**
 * Find best matching cards for an embedding
 */
export function findMatches(queryEmbedding, cardInfo, topK = 10) {
  if (!cardDb) {
    throw new Error('Embeddings not loaded. Call loadEmbeddings() first.');
  }
  const q = l2normalize(queryEmbedding);
  const hits = dbTopK(cardDb, q, topK);
  return hits.map(({ id, s }) => {
    const card = cardDb.cards[id] || cardInfo?.[id] || {};
    const setId = card.set || id.split('-')[0] || '';
    const number = card.number || id.split('-')[1] || '';
    const series = getSeriesFromSetId(setId);
    return {
      id,
      name: card.name || id.split('-').slice(1).join('-') || 'Unknown',
      number,
      set: setId,
      // TCGDex image URL: /en/{series}/{setId}/{localId}
      image: `https://assets.tcgdex.net/en/${series}/${setId}/${number}`,
      similarity: s,
      confidence: getConfidence(s),
    };
  });
}

/**
 * Get confidence level from similarity score
 */
/** Margin rule: 'matched' | 'ambiguous' | 'unknown' from the top two scores. */
export function statusFromScores(top, second) {
  if (top >= 0.80 && top - second >= 0.03) return 'matched';
  if (top >= 0.75) return 'ambiguous';
  return 'unknown';
}

function getConfidence(similarity) {
  if (similarity >= 0.85) return 'high';
  if (similarity >= 0.75) return 'medium';
  if (similarity >= 0.65) return 'low';
  return 'none';
}

/**
 * Full matching pipeline: crop → embed → match
 */
export async function matchCard(imageSource, options = {}) {
  const {
    cropCard = true,
    topK = 10,
    cardInfo = null,
    onProgress = null,
  } = options;

  const startTime = performance.now();

  try {
    // Step 1: Ensure model is loaded
    if (onProgress) onProgress({ step: 'model', message: 'Loading AI model...' });
    await loadModel();

    // Step 2: Ensure embeddings and card info are loaded
    if (onProgress) onProgress({ step: 'embeddings', message: 'Loading card database...' });
    await loadEmbeddings();          // names ship inside the shards; loadCardInfo() is then a no-op
    await loadCardInfo();

    // Step 3: Crop card if requested
    let processedImage = imageSource;
    let cropInfo = null;

    if (cropCard) {
      if (onProgress) onProgress({ step: 'crop', message: 'Detecting card...' });
      const cropResult = await detectAndCropCard(imageSource);
      processedImage = cropResult.canvas;
      cropInfo = {
        method: cropResult.method,
        bounds: cropResult.bounds,
      };
    }

    // Step 4: Compute embedding
    if (onProgress) onProgress({ step: 'embed', message: 'Analyzing image...' });
    const embedding = await computeEmbedding(processedImage);

    // Step 5: Find matches (use loaded cardInfoDb for names)
    if (onProgress) onProgress({ step: 'match', message: 'Finding matches...' });
    const matches = findMatches(embedding, cardInfoDb, topK);

    // Step 5b: optional re-ranking on the number line (see DEFAULT_RERANK)
    const rerank = options.rerank ?? DEFAULT_RERANK;
    let ocrRead = null;
    if (rerank !== 'none' && matches.length > 1) {
      if (onProgress) onProgress({ step: 'rerank', message: 'Checking card number...' });
      try {
        const { pixelBoosts, ocrNumber, numerator } = await import('./id-rerank.js');
        const cropSrc = processedImage instanceof HTMLCanvasElement ? processedImage.toDataURL('image/jpeg', 0.92) : processedImage;
        const boosts = rerank === 'pixel' || rerank === 'both' ? await pixelBoosts(cropSrc, matches, { weight: PIXEL_WEIGHT }) : {};
        if (rerank === 'ocr' || rerank === 'both') ocrRead = await ocrNumber(cropSrc);
        for (const m of matches) {
          m.baseSimilarity = m.similarity;
          m.similarity = m.similarity + (boosts[m.id] || 0) + (ocrRead && numerator(m.number) === ocrRead ? OCR_WEIGHT : 0);
        }
        matches.sort((a, b) => b.similarity - a.similarity);
        for (const m of matches) m.confidence = getConfidence(m.similarity);
      } catch (e) {
        console.warn('[CLIPMatcher] re-rank skipped:', e?.message || e);
      }
    }

    const elapsed = performance.now() - startTime;

    // Determine overall status (margin rule, bake-off 2026-09-14): a confident match needs
    // both a high top score AND a clear gap to the runner-up. Absolute similarity alone
    // labeled 243/506 wrong answers "high" because reprints score within 0.02 of each other.
    const topMatch = matches[0];
    const second = matches[1];
    const status = statusFromScores(topMatch?.similarity ?? 0, second?.similarity ?? 0);
    if (topMatch) topMatch.confidence = status === 'matched' ? 'high' : status === 'ambiguous' ? 'medium' : getConfidence(topMatch.similarity);

    if (onProgress) onProgress({ step: 'done', message: 'Complete!' });

    return {
      status,
      confidence: topMatch?.confidence ?? 'none',
      topMatch,
      matches,
      cropInfo,
      elapsed,
      embeddingsMeta,
      variant: rerank === 'none' ? 'margin' : rerank,
      ocrRead,
    };

  } catch (error) {
    console.error('[CLIPMatcher] Match failed:', error);
    return {
      status: 'error',
      error: error.message,
      matches: [],
    };
  }
}

/**
 * Check if model is loaded
 */
export function isModelLoaded() {
  return clipPipeline !== null;
}

/**
 * Check if embeddings are loaded
 */
export function areEmbeddingsLoaded() {
  return cardDb !== null;
}

/**
 * Get embeddings metadata
 */
export function getEmbeddingsMeta() {
  return cardDb?.meta || embeddingsMeta;
}

/**
 * Preload model, embeddings, and card info (call on app init)
 */
export async function preload(onProgress = null) {
  await Promise.all([loadModel(onProgress), loadEmbeddings()]);
  await loadCardInfo();
}

export default {
  loadModel,
  loadEmbeddings,
  computeEmbedding,
  findMatches,
  matchCard,
  isModelLoaded,
  areEmbeddingsLoaded,
  getEmbeddingsMeta,
  preload,
};
