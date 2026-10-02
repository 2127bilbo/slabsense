/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
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

let cardReady = false;
/** True once the card model session exists, so a live loop can use it without waiting. */
export function cardModelReady() { return cardReady; }

/** Warm the card model while the user is still in the viewfinder. */
export function preloadCardModel() {
  if (!modelGradingEnabled()) return;
  getCardRunner().then((r) => r.preload(['card'])).then(() => { cardReady = true; }).catch(() => {});
}

/**
 * The card model on any drawable source (image, canvas, video). Never throws.
 * @param {CanvasImageSource} source
 * @param {object} [o]
 * @param {'logits'|'gradient'|'none'} [o.refine='logits']
 * @param {boolean} [o.mark=true] bracket the run with the crash-loop guard (a live loop marks once itself)
 * @returns {Promise<{ok:true, corners:{tl,tr,br,bl}, fill:number, aspect:number, quad, stats, maskArea:number, ms:number, backend:string|null}
 *   | {ok:false, reason:'off'|'no-card'|'error', error?:Error}>}
 *   `fill` is the card's share of the frame in percent; `corners` are fractions of the source.
 */
export async function detectCardInSource(source, { refine = 'logits', mark = true } = {}) {
  if (!modelGradingEnabled()) return { ok: false, reason: 'off' };
  try {
    const r = await getCardRunner();
    if (mark) markModelPass(true);
    try {
      const det = await r.detectCard(source, { refine });
      if (!det || !det.stats.cardLike) return { ok: false, reason: 'no-card' };
      return {
        ok: true, corners: det.corners, fill: (100 * det.stats.area) / (det.width * det.height),
        aspect: det.stats.aspect, quad: det.quad, stats: det.stats, maskArea: det.maskArea, ms: det.ms, backend: r.backend('card'),
      };
    } finally { if (mark) markModelPass(false); }
  } catch (e) {
    console.warn('card model skipped:', e?.message || e);
    return { ok: false, reason: 'error', error: e };
  }
}

/**
 * One live-preview frame for the viewfinder. Does not wait for the model to load:
 * until it is ready the result is `{ok:false, reason:'loading'}` and the caller keeps
 * its fallback. The caller marks the crash guard once around its whole loop.
 */
export function liveCardQuad(video) {
  if (!cardReady) return Promise.resolve({ ok: false, reason: modelGradingEnabled() ? 'loading' : 'off' });
  return detectCardInSource(video, { mark: false });
}

/**
 * The card's corners in `photoDataUrl`, as fractions of the photo, or null
 * when the models are off, nothing card-shaped is found, or anything fails.
 * @returns {Promise<{corners:{tl,tr,br,bl}, aspect:number, ms:number}|null>}
 */
export async function suggestOuterCorners(photoDataUrl) {
  if (!modelGradingEnabled()) return null;
  let img = null;
  try {
    img = await loadImage(photoDataUrl);
    const res = await detectCardInSource(img);
    if (!res.ok) return null;
    return { corners: res.corners, aspect: res.aspect, maskArea: res.maskArea, ms: res.ms };
  } catch (e) {
    console.warn('card model suggestion skipped:', e?.message || e);
    return null;
  } finally { if (img) img.src = ''; }
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
