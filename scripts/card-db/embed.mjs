/** CLIP embeddings in node, same model and options as the app (`clip-matcher.js computeEmbedding`). */
import path from 'node:path';
import { pipeline, env } from '@xenova/transformers';

env.cacheDir = path.join(process.cwd(), 'models', 'transformers-cache');
env.allowLocalModels = true;

export const MODEL = 'Xenova/clip-vit-base-patch32';
export const DIM = 512;
let extractor = null;

export async function getExtractor() {
  extractor ||= await pipeline('image-feature-extraction', MODEL);
  return extractor;
}

/** L2-normalize in place. The pipeline's `normalize: true` does NOT yield unit vectors for this
 *  model (norms ≈ 9, measured 2026-09-14), so every consumer normalizes explicitly. */
export function l2normalize(v) {
  let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Embed one image → unit-length Float32Array(512). */
export async function embedOne(src) {
  const ex = await getExtractor();
  const r = await ex(src, { pooling: 'mean', normalize: true });
  if (r.data.length !== DIM) throw new Error(`embedding dim ${r.data.length}`);
  return l2normalize(Float32Array.from(r.data));
}

/** @returns Float32Array(paths.length × 512), rows L2-normalized (explicitly; see l2normalize) */
export async function embedImages(paths, onProgress = null) {
  const ex = await getExtractor();
  const out = new Float32Array(paths.length * DIM);
  for (let i = 0; i < paths.length; i++) {
    const r = await ex(paths[i], { pooling: 'mean', normalize: true });
    if (r.data.length !== DIM) throw new Error(`${paths[i]}: dim ${r.data.length}`);
    out.set(l2normalize(Float32Array.from(r.data)), i * DIM);
    if (onProgress && (i % 50 === 49 || i === paths.length - 1)) onProgress(i + 1, paths.length);
  }
  return out;
}
