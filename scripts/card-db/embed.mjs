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

/** @returns Float32Array(paths.length × 512), rows L2-normalized by the pipeline */
export async function embedImages(paths, onProgress = null) {
  const ex = await getExtractor();
  const out = new Float32Array(paths.length * DIM);
  for (let i = 0; i < paths.length; i++) {
    const r = await ex(paths[i], { pooling: 'mean', normalize: true });
    if (r.data.length !== DIM) throw new Error(`${paths[i]}: dim ${r.data.length}`);
    out.set(r.data, i * DIM);
    if (onProgress && (i % 50 === 49 || i === paths.length - 1)) onProgress(i + 1, paths.length);
  }
  return out;
}
