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

// Transformers.js pipeline (lazy loaded)
let clipPipeline = null;
let isLoadingModel = false;
let modelLoadPromise = null;

// Embeddings database
let embeddingsDb = null;
let embeddingsMeta = null;

// Card info lookup (from card-hashes.json)
let cardInfoDb = null;

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
  if (embeddingsDb && !forceRefresh) {
    return { embeddings: embeddingsDb, meta: embeddingsMeta };
  }

  console.log('[CLIPMatcher] Loading embeddings database...');
  const startTime = performance.now();

  try {
    // Try loading chunked embeddings first (for Vercel deployment)
    let response = await fetch('/models/clip_embeddings_0.json');

    if (response.ok) {
      // Chunked format - load all chunks
      const firstChunk = await response.json();
      const totalChunks = firstChunk.totalChunks || 1;

      console.log(`[CLIPMatcher] Loading ${totalChunks} embedding chunks...`);
      embeddingsDb = { ...firstChunk.embeddings };

      // Load remaining chunks in parallel
      if (totalChunks > 1) {
        const chunkPromises = [];
        for (let i = 1; i < totalChunks; i++) {
          chunkPromises.push(
            fetch(`/models/clip_embeddings_${i}.json`).then(r => r.json())
          );
        }
        const chunks = await Promise.all(chunkPromises);
        for (const chunk of chunks) {
          Object.assign(embeddingsDb, chunk.embeddings);
        }
      }

      embeddingsMeta = {
        version: firstChunk.version,
        model: firstChunk.model,
        count: Object.keys(embeddingsDb).length,
        chunked: true,
      };
    } else {
      // Try single file format (local development)
      console.log('[CLIPMatcher] Trying single-file embeddings...');
      response = await fetch('/models/clip_embeddings_tfjs.json');
      if (!response.ok) {
        response = await fetch('/models/clip_embeddings.json');
      }

      if (!response.ok) {
        throw new Error(`Failed to load embeddings: ${response.status}`);
      }

      const data = await response.json();
      embeddingsDb = data.embeddings;
      embeddingsMeta = {
        version: data.version,
        model: data.model,
        count: data.count,
        generated: data.generated,
      };
    }

    const elapsed = performance.now() - startTime;
    console.log(`[CLIPMatcher] Loaded ${embeddingsMeta.count} embeddings in ${elapsed.toFixed(0)}ms`);

    return { embeddings: embeddingsDb, meta: embeddingsMeta };

  } catch (error) {
    console.error('[CLIPMatcher] Failed to load embeddings:', error);
    throw error;
  }
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
  if (!embeddingsDb) {
    throw new Error('Embeddings not loaded. Call loadEmbeddings() first.');
  }

  const similarities = [];

  for (const [cardId, embedding] of Object.entries(embeddingsDb)) {
    const sim = cosineSimilarity(queryEmbedding, embedding);
    const card = cardInfo?.[cardId] || {};
    const setId = card.set || cardId.split('-')[0] || '';
    const number = card.number || cardId.split('-')[1] || '';
    const series = getSeriesFromSetId(setId);

    similarities.push({
      id: cardId,
      name: card.name || cardId.split('-').slice(1).join('-') || 'Unknown',
      number,
      set: setId,
      // TCGDex image URL: /en/{series}/{setId}/{localId}
      image: `https://assets.tcgdex.net/en/${series}/${setId}/${number}`,
      similarity: sim,
    });
  }

  // Sort by similarity descending
  similarities.sort((a, b) => b.similarity - a.similarity);

  // Add confidence levels
  return similarities.slice(0, topK).map(match => ({
    ...match,
    confidence: getConfidence(match.similarity),
  }));
}

/**
 * Get confidence level from similarity score
 */
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
    await Promise.all([loadEmbeddings(), loadCardInfo()]);

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

    const elapsed = performance.now() - startTime;

    // Determine overall status
    const topMatch = matches[0];
    let status;
    if (topMatch.confidence === 'high') {
      status = 'matched';
    } else if (topMatch.confidence === 'medium') {
      status = 'ambiguous';
    } else {
      status = 'unknown';
    }

    if (onProgress) onProgress({ step: 'done', message: 'Complete!' });

    return {
      status,
      confidence: topMatch.confidence,
      topMatch,
      matches,
      cropInfo,
      elapsed,
      embeddingsMeta,
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
  return embeddingsDb !== null;
}

/**
 * Get embeddings metadata
 */
export function getEmbeddingsMeta() {
  return embeddingsMeta;
}

/**
 * Preload model, embeddings, and card info (call on app init)
 */
export async function preload(onProgress = null) {
  await Promise.all([
    loadModel(onProgress),
    loadEmbeddings(),
    loadCardInfo(),
  ]);
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
