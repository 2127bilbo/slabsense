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
 * Load pre-computed embeddings database
 */
export async function loadEmbeddings(forceRefresh = false) {
  if (embeddingsDb && !forceRefresh) {
    return { embeddings: embeddingsDb, meta: embeddingsMeta };
  }

  console.log('[CLIPMatcher] Loading embeddings database...');
  const startTime = performance.now();

  try {
    // Try Transformers.js embeddings first, fall back to Python CLIP
    let response = await fetch('/models/clip_embeddings_tfjs.json');
    if (!response.ok) {
      console.log('[CLIPMatcher] TFJS embeddings not found, trying Python CLIP embeddings...');
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

    const elapsed = performance.now() - startTime;
    console.log(`[CLIPMatcher] Loaded ${data.count} embeddings in ${elapsed.toFixed(0)}ms`);

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

    similarities.push({
      id: cardId,
      name: card.name || cardId.split('-').slice(1).join('-') || 'Unknown',
      number: card.number || cardId.split('-')[1] || '?',
      set: card.set || cardId.split('-')[0] || '?',
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

    // Step 2: Ensure embeddings are loaded
    if (onProgress) onProgress({ step: 'embeddings', message: 'Loading card database...' });
    await loadEmbeddings();

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

    // Step 5: Find matches
    if (onProgress) onProgress({ step: 'match', message: 'Finding matches...' });
    const matches = findMatches(embedding, cardInfo, topK);

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
 * Preload model and embeddings (call on app init)
 */
export async function preload(onProgress = null) {
  await Promise.all([
    loadModel(onProgress),
    loadEmbeddings(),
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
