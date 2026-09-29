/**
 * ============================================================================
 * CARD + CENTERING MODELS IN THE BROWSER — cardModels.js
 * ============================================================================
 * Two suggestions for the centering tool, both fail-soft and both gated by the
 * same "trained models" switch as the corner/edge models:
 *
 *   suggestOuterCorners(photo)  -> the card's four corners in the photo, from
 *                                  the card model (6 MB, ~20 ms on WebGPU)
 *   suggestInnerCorners(crop)   -> the artwork frame inside the tight crop,
 *                                  from the centering model (54 MB)
 *
 * Both return normalised corners (fractions of the image) or null. The tool
 * places the lines from them and the user adjusts; nothing is final until the
 * user confirms, exactly as before. Models load lazily from the bucket and are
 * cached by the browser (see cornerEdgeModels.js for the loader).
 * ============================================================================
 */
import { createCardRunner, innerCornersFromDistances } from '../lib/card-model-runner.js';
import { getOrt, makeCanvas, cachedModelBytes, MODELS_BASE, modelGradingEnabled, preferredBackend, markModelPass } from './cornerEdgeModels.js';

let runner = null, runnerPromise = null;

export async function getCardRunner() {
  if (runner) return runner;
  if (!runnerPromise) {
    runnerPromise = (async () => {
      const ort = await getOrt();
      runner = createCardRunner({
        ort,
        createCanvas: makeCanvas,
        baseUrl: MODELS_BASE,
        executionProviders: [preferredBackend(), 'wasm'],
        loadModel: (name) => cachedModelBytes(name),
      });
      return runner;
    })().catch((e) => { runnerPromise = null; throw e; });
  }
  return runnerPromise;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

/** Warm the card model while the user is still in the viewfinder. */
export function preloadCardModel() {
  if (!modelGradingEnabled()) return;
  getCardRunner().then((r) => r.preload(['card'])).catch(() => {});
}

/**
 * The card's corners in `photoDataUrl`, as fractions of the photo, or null
 * when the models are off, nothing card-shaped is found, or anything fails.
 * @returns {Promise<{corners:{tl,tr,br,bl}, aspect:number, ms:number}|null>}
 */
export async function suggestOuterCorners(photoDataUrl) {
  if (!modelGradingEnabled()) return null;
  try {
    const [r, img] = await Promise.all([getCardRunner(), loadImage(photoDataUrl)]);
    markModelPass(true);
    try {
      const det = await r.detectCard(img);
      if (!det || !det.stats.cardLike) return null;
      return { corners: det.corners, aspect: det.stats.aspect, maskArea: det.maskArea, ms: det.ms };
    } finally { markModelPass(false); img.src = ''; }
  } catch (e) {
    console.warn('card model suggestion skipped:', e?.message || e);
    return null;
  }
}

/**
 * The artwork frame inside a tight card crop, as fractions of the crop, plus
 * the ratios the model implies. Null when off or on failure.
 * @returns {Promise<{corners:{tl,tr,br,bl}, lrRatio:number, tbRatio:number, distances:{l,r,t,b}, ms:number}|null>}
 */
export async function suggestInnerCorners(cropDataUrl, side) {
  if (!modelGradingEnabled()) return null;
  try {
    const [r, img] = await Promise.all([getCardRunner(), loadImage(cropDataUrl)]);
    markModelPass(true);
    try {
      const m = await r.measureCentering(img, side);
      return { corners: innerCornersFromDistances(m), lrRatio: m.lrRatio, tbRatio: m.tbRatio, distances: { l: m.l, r: m.r, t: m.t, b: m.b }, ms: m.ms };
    } finally { markModelPass(false); img.src = ''; }
  } catch (e) {
    console.warn('centering model suggestion skipped:', e?.message || e);
    return null;
  }
}
