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
import { cropBatch, INPUT_SIZE } from './tag-crops.js';
import { decodeSide, slotsToDings, MODEL_TASKS, OUTPUT_CHANNELS } from './corner-edge-model.js';

export const DEFAULT_MODEL_FILES = { corners: 'corners-v2.fp16.onnx', edges: 'edges-v1.fp16.onnx' };

/**
 * @param {object} opts
 * @param {object} opts.ort          the onnxruntime module (web or node)
 * @param {(w:number,h:number)=>object} opts.createCanvas returns a canvas with getContext('2d')
 * @param {string} opts.baseUrl      where the .onnx files live (trailing slash optional)
 * @param {object} [opts.files]      overrides DEFAULT_MODEL_FILES
 * @param {string[]} [opts.executionProviders] defaults to WebGPU then WASM
 * @param {(task:string,file:string)=>Promise<ArrayBuffer|string>} [opts.loadModel]
 *        supplies the model bytes instead of letting the runtime fetch the URL —
 *        the browser uses it to persist the download in the Cache API.
 */
export function createCornerEdgeRunner({ ort, createCanvas, baseUrl, files, executionProviders, loadModel }) {
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

  async function sessionFor(task) {
    if (!sessions[task]) {
      sessions[task] = (async () => {
        const src = loadModel ? await loadModel(task, modelFiles[task]) : base + modelFiles[task];
        for (const ep of providers) {
          try {
            return await ort.InferenceSession.create(src, { executionProviders: [ep] });
          } catch (e) {
            if (ep === providers[providers.length - 1]) throw e;
          }
        }
        throw new Error(`corner-edge-runner: no execution provider worked for ${task}`);
      })();
    }
    return sessions[task];
  }

  /** Run one task over one side. Returns the decoded slots. */
  async function runTask(task, source, cardW, cardH, side) {
    const { images, boxes, w, h } = cropBatch(ctxFor(task), source, task, cardW, cardH);
    const n = boxes.length;
    const session = await sessionFor(task);
    const sides = new Float32Array(n).fill(side === 'back' || side === 'BACK' ? 1 : 0);
    const out = await session.run({
      images: new ort.Tensor('float32', images, [n, 3, h, w]),
      sides: new ort.Tensor('float32', sides, [n, 1]),
    });
    return decodeSide(task, out.logits.data, boxes, OUTPUT_CHANNELS[task].length);
  }

  return {
    /** Decoded corner and edge slots for one side of a card. */
    async analyzeSide(source, cardW, cardH, side) {
      const slots = {};
      for (const task of MODEL_TASKS) slots[task] = await runTask(task, source, cardW, cardH, side);
      return slots;
    },
    /** Legacy dings for one side, ready to merge with the detector output. */
    async dingsForSide(source, cardW, cardH, side, options = {}) {
      const slots = await this.analyzeSide(source, cardW, cardH, side);
      return MODEL_TASKS.flatMap((task) => slotsToDings(task, side, slots[task], options));
    },
    /** Warm both sessions (and, on WebGPU, their shader compile) before first use. */
    async preload() {
      await Promise.all(MODEL_TASKS.map((t) => sessionFor(t)));
    },
    get sessions() { return sessions; },
  };
}
