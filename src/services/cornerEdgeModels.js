/**
 * ============================================================================
 * CORNER / EDGE MODELS IN THE BROWSER — cornerEdgeModels.js
 * ============================================================================
 * Lazily loads the exported corner and edge models and runs them over a card
 * crop, returning engine dings. Everything here is opt-in and fail-soft: if the
 * flag is off, the models are not hosted, the device cannot run them, or any
 * step throws, the caller keeps the legacy detector result.
 *
 * The two fp16 models are ~54 MB each, so they are NEVER bundled: they are
 * fetched from the public `models` bucket and kept in the Cache API, the same
 * way the card database shards are (src/lib/card-db-client.js). A phone
 * downloads them once.
 *
 * Timings measured on the dev PC (training/README.md): ~10 ms per crop on
 * WebGPU, ~300 ms on WASM. A card is 16 crops, so WASM-only devices take
 * several seconds — which is why `preferredBackend` reports what a device has.
 * ============================================================================
 */
import { createCornerEdgeRunner, DEFAULT_MODEL_FILES } from '../lib/corner-edge-runner.js';
import { slotsToDings, mergeModelDings, MODEL_DEFAULTS } from '../lib/corner-edge-model.js';

const CACHE_NAME = 'slabsense-models-v1';
const FLAG_KEY = 'slabsense_modelGrading';

export const MODELS_BASE = (() => {
  try {
    const explicit = import.meta.env?.VITE_MODELS_URL;
    if (explicit) return String(explicit).replace(/\/+$/, '');
    const u = import.meta.env?.VITE_SUPABASE_URL;
    return u ? `${u}/storage/v1/object/public/models` : null;
  } catch { return null; }
})();

/** True when this build could run the models at all (hosted + a runtime exists). */
export function modelsAvailable() {
  return Boolean(MODELS_BASE) && typeof fetch === 'function';
}

/** Opt-in flag. Off until the owner turns it on, so grading behaviour never changes silently. */
export function modelGradingEnabled() {
  try {
    const v = localStorage.getItem(FLAG_KEY);
    if (v !== null) return v === '1';
  } catch { /* private mode */ }
  try { return import.meta.env?.VITE_MODEL_GRADING === '1'; } catch { return false; }
}

export function setModelGrading(on) {
  try { localStorage.setItem(FLAG_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

/** 'webgpu' when the device has it, otherwise 'wasm'. Used for the "this will be slow" hint. */
export function preferredBackend() {
  try { return navigator.gpu ? 'webgpu' : 'wasm'; } catch { return 'wasm'; }
}

async function cachedModelBytes(file, onProgress) {
  const url = `${MODELS_BASE}/${file}`;
  let cache = null;
  try { cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null; } catch { /* no Cache API */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  if (cache) { try { await cache.put(url, res.clone()); } catch { /* quota */ } }
  if (onProgress) onProgress(file);
  return res.arrayBuffer();
}

let runner = null;
let runnerPromise = null;

/** Build (once) the runner bound to this browser's canvas and ONNX runtime. */
export async function getRunner({ onProgress = null } = {}) {
  if (runner) return runner;
  if (!runnerPromise) {
    runnerPromise = (async () => {
      if (!modelsAvailable()) throw new Error('corner/edge models are not hosted for this build');
      // The runtime is imported from the bucket at runtime, never bundled: letting Vite bundle
      // onnxruntime-web also emits its 27 MB .wasm into the deploy. Everything heavy lives in
      // the bucket and is cached by the browser after the first grade.
      const ort = await import(/* @vite-ignore */ `${MODELS_BASE}/ort/ort.min.mjs`);
      ort.env.wasm.wasmPaths = `${MODELS_BASE}/ort/`;
      // Multiple wasm threads need cross-origin isolation (COOP/COEP), which this app does not
      // set; asking for them without it makes the runtime fail rather than fall back.
      try {
        const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
        ort.env.wasm.numThreads = isolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      } catch { /* default */ }
      const created = createCornerEdgeRunner({
        ort,
        createCanvas: (w, h) => (typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), { width: w, height: h })),
        baseUrl: MODELS_BASE,
        executionProviders: [preferredBackend(), 'wasm'],
        loadModel: (task, file) => cachedModelBytes(file, onProgress),
      });
      runner = created;
      return created;
    })().catch((e) => { runnerPromise = null; throw e; });
  }
  return runnerPromise;
}

/** Download and compile both models ahead of the first grade. */
export async function preloadModels(onProgress = null) {
  const r = await getRunner({ onProgress });
  await r.preload();
  return r;
}

/**
 * Model dings for one side of a card.
 * @param {CanvasImageSource & {width:number,height:number}} source the card crop
 * @param {'front'|'back'} side
 * @returns {Promise<object[]>} legacy dings, ready for mergeModelDings
 */
export async function modelDingsForSide(source, side, options = MODEL_DEFAULTS) {
  const r = await getRunner();
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  return r.dingsForSide(source, w, h, side, options);
}

/**
 * Replace the detector's corner/edge dings on both sides with the models'.
 * Returns the original dings untouched (and `used: false`) if anything fails,
 * so a model problem can never block a grade.
 */
export async function applyModelDings({ frontSource, backSource, frontDings, backDings, options = MODEL_DEFAULTS }) {
  try {
    const [front, back] = await Promise.all([
      modelDingsForSide(frontSource, 'front', options),
      modelDingsForSide(backSource, 'back', options),
    ]);
    return {
      used: true,
      backend: preferredBackend(),
      frontDings: mergeModelDings(frontDings, front),
      backDings: mergeModelDings(backDings, back),
    };
  } catch (e) {
    console.warn('corner/edge models unavailable, keeping detector dings:', e?.message || e);
    return { used: false, error: String(e?.message || e), frontDings, backDings };
  }
}

export { DEFAULT_MODEL_FILES, slotsToDings, MODEL_DEFAULTS };
