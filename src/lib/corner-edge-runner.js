/**
 * ============================================================================
 * CORNER / EDGE MODEL RUNNER — corner-edge-runner.js
 * ============================================================================
 * Loads the exported ONNX models and runs them over the 8 corner and 8 edge
 * crops of a card. Environment-agnostic: the ONNX runtime, the canvas factory
 * and the model URLs are all injected, so the same code serves the browser app
 * and scripts/harness under Node (onnxruntime-web runs in both).
 *
 * Models are fetched lazily on first use and cached for the session; they are
 * 54 MB each (fp16), so they must never be bundled — host them and pass the
 * base URL. See training/README.md ("ONNX export") for sizes and timings.
 * ============================================================================
 */
import { cropBatch, cardRect, INPUT_SIZE } from './tag-crops.js';
import { decodeSide, slotsToDings, MODEL_TASKS, OUTPUT_CHANNELS } from './corner-edge-model.js';

/** The shipped pair. v3-phone / v2-phone (2026-09-18) were trained with backdrop, blur and
 *  resolution augmentation and no longer need the tile repaint; see training/README.md. */
export const DEFAULT_MODEL_FILES = { corners: 'corners-v3-phone-safe.fp16.onnx', edges: 'edges-v2-phone-safe.fp16.onnx' };

/**
 * @param {object} opts
 * @param {object} opts.ort          the onnxruntime module (web or node)
 * @param {(w:number,h:number)=>object} opts.createCanvas returns a canvas with getContext('2d')
 * @param {string} opts.baseUrl      where the .onnx files live (trailing slash optional)
 * @param {object} [opts.files]      overrides DEFAULT_MODEL_FILES
 * @param {string[]} [opts.executionProviders] defaults to WebGPU then WASM
 * @param {boolean} [opts.backdrop=false] repaint the table beyond the card TAG orange before
 *        inference (tag-crops.js repaintBackdrop). A bridge for the scan-only v2/v1 models;
 *        with the phone-augmented models it costs accuracy (17 vs 5 false edge dings on a
 *        black table), so it is off by default.
 * @param {(task:string,file:string)=>Promise<ArrayBuffer|string>} [opts.loadModel]
 *        supplies the model bytes instead of letting the runtime fetch the URL —
 *        the browser uses it to persist the download in the Cache API.
 */
export function createCornerEdgeRunner({ ort, createCanvas, baseUrl, files, executionProviders, loadModel, backdrop = false }) {
  if (!ort) throw new Error('corner-edge-runner: ort is required');
  if (!createCanvas) throw new Error('corner-edge-runner: createCanvas is required');
  const modelFiles = { ...DEFAULT_MODEL_FILES, ...(files || {}) };
  const providers = executionProviders || ['webgpu', 'wasm'];
  const base = baseUrl ? String(baseUrl).replace(/\/+$/, '') + '/' : '';
  const sessions = {};
  const canvases = {};

  function ctxFor(task) {
    if (!canvases[task]) {
      const { w, h } = INPUT_SIZE[task];
      const canvas = createCanvas(w, h);
      canvases[task] = canvas.getContext('2d', { willReadFrequently: true });
    }
    return canvases[task];
  }

  const modelBytes = {};
  async function bytesFor(task) {
    if (!modelBytes[task]) modelBytes[task] = loadModel ? loadModel(task, modelFiles[task]) : Promise.resolve(base + modelFiles[task]);
    return modelBytes[task];
  }

  async function sessionFor(task) {
    if (!sessions[task]) {
      sessions[task] = (async () => {
        const src = await bytesFor(task);
        for (const ep of providers) {
          try {
            const session = await ort.InferenceSession.create(src, { executionProviders: [ep] });
            session.__ep = ep;
            return session;
          } catch (e) {
            if (ep === providers[providers.length - 1]) throw e;
          }
        }
        throw new Error(`corner-edge-runner: no execution provider worked for ${task}`);
      })();
    }
    return sessions[task];
  }

  // WASM fallback for a batch whose GPU result is not finite. An fp16 kernel on WebGPU
  // overflowed on one real tile (2026-09-20) and returned NaN, which would read as "clean";
  // WASM upcasts and never did. The export now keeps the risky ops in fp32, this is the belt.
  const fallbacks = {};
  async function fallbackFor(task) {
    if (!fallbacks[task]) fallbacks[task] = bytesFor(task).then((src) => ort.InferenceSession.create(src, { executionProviders: ['wasm'] }));
    return fallbacks[task];
  }

  /** Run one task over one side. Returns the decoded slots. */
  async function runTask(task, source, rect, side) {
    const { images, boxes, w, h } = cropBatch(ctxFor(task), source, task, rect, undefined, { backdrop });
    const n = boxes.length;
    const session = await sessionFor(task);
    const feeds = () => ({
      images: new ort.Tensor('float32', images, [n, 3, h, w]),
      sides: new ort.Tensor('float32', new Float32Array(n).fill(side === 'back' || side === 'BACK' ? 1 : 0), [n, 1]),
    });
    let logits = (await session.run(feeds())).logits.data;
    if (!Array.from(logits).every(Number.isFinite) && session.__ep !== 'wasm') {
      console.warn(`corner-edge-runner: non-finite ${task} output on ${session.__ep}, rerunning on wasm`);
      logits = (await (await fallbackFor(task)).run(feeds())).logits.data;
    }
    return decodeSide(task, logits, boxes, OUTPUT_CHANNELS[task].length);
  }

  return {
    /**
     * Decoded corner and edge slots for one side of a card.
     * @param rect where the card sits in `source` — the detector bounds on an
     *   uncropped photo, or the image size once the user has cropped to the card.
     */
    async analyzeSide(source, rect, side) {
      const r = cardRect(rect, source.naturalWidth || source.width, source.naturalHeight || source.height);
      const slots = {};
      for (const task of MODEL_TASKS) slots[task] = await runTask(task, source, r, side);
      return slots;
    },
    /** Legacy dings for one side, ready to merge with the detector output. */
    async dingsForSide(source, rect, side, options = {}) {
      const slots = await this.analyzeSide(source, rect, side);
      return MODEL_TASKS.flatMap((task) => slotsToDings(task, side, slots[task], options));
    },
    /** Warm both sessions (and, on WebGPU, their shader compile) before first use. */
    async preload() {
      await Promise.all(MODEL_TASKS.map((t) => sessionFor(t)));
    },
    get sessions() { return sessions; },
  };
}
