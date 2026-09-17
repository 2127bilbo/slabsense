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
import { slotsToDings, mergeModelDings, MODEL_DEFAULTS, MODEL_TASKS } from '../lib/corner-edge-model.js';

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

/**
 * Whether the software grade uses the models. A per-device choice: the toggle in
 * Settings writes localStorage, VITE_MODEL_GRADING sets the build's default, and
 * with neither set the models are ON (owner's call, 2026-09-17). Turning it off
 * anywhere falls straight back to the pixel detectors.
 */
export function modelGradingEnabled() {
  try {
    const v = localStorage.getItem(FLAG_KEY);
    if (v !== null) return v === '1';
  } catch { /* private mode */ }
  try {
    const env = import.meta.env?.VITE_MODEL_GRADING;
    if (env !== undefined && env !== '') return env === '1';
  } catch { /* no import.meta */ }
  return true;
}

export function setModelGrading(on) {
  try { localStorage.setItem(FLAG_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

/** 'webgpu' when the device has it, otherwise 'wasm'. Used for the "this will be slow" hint. */
export function preferredBackend() {
  try { return navigator.gpu ? 'webgpu' : 'wasm'; } catch { return 'wasm'; }
}

/** Fetch with Cache API persistence, so a phone downloads each part once. */
async function cachedFetch(url) {
  let cache = null;
  try { cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null; } catch { /* no Cache API */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split('/').pop()}: HTTP ${res.status}`);
  if (cache) { try { await cache.put(url, res.clone()); } catch { /* quota */ } }
  return res;
}

let manifestPromise = null;
/** models.json lists each model's parts; see scripts/models/upload.mjs. */
async function getManifest() {
  if (!manifestPromise) {
    manifestPromise = cachedFetch(`${MODELS_BASE}/models.json`)
      .then((r) => r.json())
      .catch((e) => { manifestPromise = null; throw e; });
  }
  return manifestPromise;
}

async function sha256Hex(bytes) {
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; } // no WebCrypto (insecure context): skip verification
}

/**
 * The bytes of one model. Supabase caps an object at 50 MB and the models are
 * 53.6 MB, so they are stored in parts and joined here.
 */
async function cachedModelBytes(task, onProgress) {
  const manifest = await getManifest();
  const entry = manifest?.models?.[task];
  if (!entry) throw new Error(`models.json has no entry for ${task}`);
  const chunks = [];
  for (const part of entry.parts) {
    const res = await cachedFetch(`${MODELS_BASE}/${part.path}`);
    chunks.push(new Uint8Array(await res.arrayBuffer()));
    if (onProgress) onProgress({ task, part: part.path, loaded: chunks.reduce((s, c) => s + c.length, 0), total: entry.bytes });
  }
  const bytes = chunks.length === 1 ? chunks[0] : (() => {
    const out = new Uint8Array(entry.bytes);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  })();
  if (bytes.length !== entry.bytes) throw new Error(`${entry.file}: expected ${entry.bytes} bytes, got ${bytes.length}`);
  if (entry.sha256) {
    const sha = await sha256Hex(bytes);
    if (sha !== null && sha !== entry.sha256) throw new Error(`${entry.file}: checksum mismatch`);
  }
  return bytes;
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
        loadModel: (task) => cachedModelBytes(task, onProgress),
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
 * @param {CanvasImageSource & {width:number,height:number}} source the photo or crop
 * @param {object|null} rect where the card sits in `source` — the detector bounds when
 *   the photo still has background around the card, null once it is cropped to the card
 * @param {'front'|'back'} side
 * @returns {Promise<object[]>} legacy dings, ready for mergeModelDings
 */
export async function modelDingsForSide(source, rect, side, options = MODEL_DEFAULTS) {
  const r = await getRunner();
  return r.dingsForSide(source, rect, side, options);
}

/**
 * Both the raw per-slot predictions and the dings for one side. The slots are
 * what a paid grade sends to the server (`cornerEdge` in the request), so the AI
 * paths judge corners and edges from the same numbers as the free grade.
 * @returns {Promise<{slots: {corners: object[], edges: object[]}, dings: object[]}>}
 */
export async function modelSlotsForSide(source, rect, side, options = MODEL_DEFAULTS) {
  const r = await getRunner();
  const slots = await r.analyzeSide(source, rect, side);
  const dings = MODEL_TASKS.flatMap((task) => slotsToDings(task, side, slots[task], options));
  return { slots, dings };
}

/**
 * The request field for a paid grade: every slot of both sides, rounded. Null
 * when the models did not run on both sides, so the server falls back to
 * Claude's own corner/edge findings rather than judging from half a table.
 */
export function cornerEdgeRequest(frontSlots, backSlots) {
  const side = (s) => (s && s.corners && s.edges ? {
    corners: s.corners.map((x) => ({ key: x.key, wear: +x.wear.toFixed(4), deduction: +x.deduction.toFixed(1), ...(x.angle === undefined ? {} : { angle: +x.angle.toFixed(1) }) })),
    edges: s.edges.map((x) => ({ key: x.key, wear: +x.wear.toFixed(4), deduction: +x.deduction.toFixed(1) })),
  } : null);
  const front = side(frontSlots);
  if (!front) return null;
  const back = side(backSlots);
  return back ? { front, back } : { front };
}

/**
 * Replace the detector's corner/edge dings on both sides with the models'.
 * Returns the original dings untouched (and `used: false`) if anything fails,
 * so a model problem can never block a grade.
 */
export async function applyModelDings({ frontSource, backSource, frontRect = null, backRect = null, frontDings, backDings, options = MODEL_DEFAULTS }) {
  try {
    const [front, back] = await Promise.all([
      modelDingsForSide(frontSource, frontRect, 'front', options),
      modelDingsForSide(backSource, backRect, 'back', options),
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
