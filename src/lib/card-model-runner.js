/**
 * ============================================================================
 * CARD + CENTERING MODEL RUNNER — card-model-runner.js
 * ============================================================================
 * Runs the card model (photo -> card corners) and the centering model
 * (card crop -> four border distances) with an injected ONNX runtime and
 * canvas factory, so the same code serves the browser and scripts/harness.
 *
 * Card model contract: training/weights/onnx/card-v1.json — letterbox the
 * photo to 512 (long side scaled, short side padded with the photo's outer
 * ring mean), ImageNet-normalised NCHW, output logits > 0 = card. The mask is
 * turned into corners by src/lib/card-mask.js, then tightened at full
 * resolution against the photo itself.
 *
 * Centering model contract: training/weights/onnx/centering_rgb-v2b.json —
 * the card crop at 896x1248, side 0/1, output four distances in per-mille of
 * the card (left, right, top, bottom, from the card edge to the printed frame).
 * ============================================================================
 */
import { CARD_INPUT, letterbox, ringMean, cardFromMask, lumSampler, toNormalisedCorners } from './card-mask.js';
import { rgbaToTensor } from './tag-crops.js';

export const CENTERING_INPUT = { w: 896, h: 1248 };
export const DEFAULT_FILES = { card: 'card-v1.fp16.onnx', centering: 'centering_rgb-v2b.fp16.onnx' };

/**
 * @param {object} opts
 * @param {object} opts.ort
 * @param {(w:number,h:number)=>object} opts.createCanvas
 * @param {string} [opts.baseUrl]
 * @param {object} [opts.files]
 * @param {string[]} [opts.executionProviders]
 * @param {(name:string,file:string)=>Promise<ArrayBuffer|Uint8Array|string>} [opts.loadModel]
 */
export function createCardRunner({ ort, createCanvas, baseUrl, files, executionProviders, loadModel }) {
  const modelFiles = { ...DEFAULT_FILES, ...(files || {}) };
  const providers = executionProviders || ['webgpu', 'wasm'];
  const base = baseUrl ? String(baseUrl).replace(/\/+$/, '') + '/' : '';
  const sessions = {};
  const backends = {}; // execution provider each session ended up on, once created

  async function sessionFor(name) {
    if (!sessions[name]) {
      sessions[name] = (async () => {
        const src = loadModel ? await loadModel(name, modelFiles[name]) : base + modelFiles[name];
        for (const ep of providers) {
          try { const s = await ort.InferenceSession.create(src, { executionProviders: [ep] }); s.__ep = ep; backends[name] = ep; return s; } catch (e) { if (ep === providers[providers.length - 1]) throw e; }
        }
        throw new Error(`card-model-runner: no execution provider worked for ${name}`);
      })().catch((e) => { delete sessions[name]; throw e; });
    }
    return sessions[name];
  }
  const fallbacks = {};
  async function wasmFallback(name) {
    if (!fallbacks[name]) fallbacks[name] = (async () => { const src = loadModel ? await loadModel(name, modelFiles[name]) : base + modelFiles[name]; return ort.InferenceSession.create(src, { executionProviders: ['wasm'] }); })();
    return fallbacks[name];
  }
  const finite = (arr) => { for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false; return true; };
  // One inference at a time per runner: an ONNX session throws "Session already started"
  // when two runs overlap (React effects can fire twice), so calls queue up instead.
  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  let cardCanvas = null, cropCanvas = null;
  const canvasFor = (which, w, h) => {
    if (which === 'card') { if (!cardCanvas) cardCanvas = createCanvas(w, h); return cardCanvas; }
    if (!cropCanvas) cropCanvas = createCanvas(w, h); return cropCanvas;
  };

  /**
   * Where the card is in `source`. Returns null when no card-shaped region is found.
   * @param {CanvasImageSource & {width?:number,height?:number,naturalWidth?:number}} source the photo
   * @param {object} [o]
   * @param {'logits'|'gradient'|'none'} [o.refine='logits'] see card-mask.cardFromMask
   * @param {{data:Uint8ClampedArray,w:number,h:number}} [o.pixels] the photo's RGBA if the caller already has it
   * @returns {Promise<{corners:{tl,tr,br,bl}, quad, quadRaw, stats, maskArea, components, ms:number}|null>}
   */
  function detectCard(source, opts = {}) { return serial(() => detectCardNow(source, opts)); }
  async function detectCardNow(source, { refine = 'logits', pixels = null } = {}) {
    const t0 = Date.now();
    const W = source.videoWidth || source.naturalWidth || source.width, H = source.videoHeight || source.naturalHeight || source.height;
    const S = CARD_INPUT;
    const lb = letterbox(W, H, S);
    const canvas = canvasFor('card', S, S);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // resized photo first, to take the ring colour from it, then pad
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(source, 0, 0, W, H, lb.padX, lb.padY, lb.newW, lb.newH);
    const inner = ctx.getImageData(lb.padX, lb.padY, lb.newW, lb.newH);
    const [r, g, b] = ringMean(inner.data, lb.newW, lb.newH, Math.max(1, Math.round(8 * lb.scale)));
    ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(source, 0, 0, W, H, lb.padX, lb.padY, lb.newW, lb.newH);
    const image = rgbaToTensor(ctx.getImageData(0, 0, S, S).data, S, S);
    const session = await sessionFor('card');
    const run = (s) => s.run({ image: new ort.Tensor('float32', image, [1, 3, S, S]) }).then((o) => o.mask.data);
    let logits = await run(session);
    if (!finite(logits) && session.__ep !== 'wasm') { console.warn('card model: non-finite output on', session.__ep, '— rerunning on wasm'); logits = await run(await wasmFallback('card')); }
    let lum = null;
    if (refine === 'gradient') {
      let px = pixels;
      if (!px) {
        const full = createCanvas(W, H); const fctx = full.getContext('2d', { willReadFrequently: true });
        fctx.drawImage(source, 0, 0, W, H); px = { data: fctx.getImageData(0, 0, W, H).data, w: W, h: H };
      }
      lum = lumSampler(px.data, px.w, px.h);
    }
    const out = cardFromMask(logits, W, H, { lum, S, refine });
    if (!out) return null;
    return { ...out, corners: toNormalisedCorners(out.quad, W, H), width: W, height: H, ms: Date.now() - t0 };
  }

  /**
   * Border distances for a card crop (the tight crop, card edge at the border).
   * @returns {Promise<{l,r,t,b, lrRatio, tbRatio, ms}>} distances in per-mille of the card
   */
  function measureCentering(crop, side) { return serial(() => measureCenteringNow(crop, side)); }
  async function measureCenteringNow(crop, side) {
    const t0 = Date.now();
    const { w, h } = CENTERING_INPUT;
    const W = crop.naturalWidth || crop.width, H = crop.naturalHeight || crop.height;
    const canvas = canvasFor('crop', w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop, 0, 0, W, H, 0, 0, w, h);
    const images = rgbaToTensor(ctx.getImageData(0, 0, w, h).data, w, h);
    const session = await sessionFor('centering');
    const feeds = () => ({ images: new ort.Tensor('float32', images, [1, 3, h, w]), sides: new ort.Tensor('float32', new Float32Array([side === 'back' || side === 'BACK' ? 1 : 0]), [1, 1]) });
    let logits = (await session.run(feeds())).logits.data;
    if (!finite(logits) && session.__ep !== 'wasm') { console.warn('centering model: non-finite output on', session.__ep, '— rerunning on wasm'); logits = (await (await wasmFallback('centering')).run(feeds())).logits.data; }
    const [l, r, t, b] = Array.from(logits).map((v) => 1000 / (1 + Math.exp(-v)));
    return { l, r, t, b, lrRatio: (100 * l) / (l + r), tbRatio: (100 * t) / (t + b), ms: Date.now() - t0 };
  }

  return {
    detectCard,
    measureCentering,
    async preload(names = ['card', 'centering']) { await Promise.all(names.map(sessionFor)); },
    /** 'webgpu' | 'wasm' once the session exists, else null. */
    backend(name) { return backends[name] || null; },
    get sessions() { return sessions; },
  };
}

/**
 * Artwork-frame corners inside a crop, from the four border distances.
 * Distances are per-mille of the card; the crop is the card, so l/r scale by
 * the crop width and t/b by its height. Returns fractions of the crop.
 */
export function innerCornersFromDistances({ l, r, t, b }) {
  const L = l / 1000, R = 1 - r / 1000, T = t / 1000, B = 1 - b / 1000;
  return { tl: { x: L, y: T }, tr: { x: R, y: T }, br: { x: R, y: B }, bl: { x: L, y: B } };
}
