/**
 * Card DB client: loads manifest + float16 shards from the public `card-db` bucket.
 * Shards are immutable and addressed by id, so they are cached in the browser Cache API
 * and a manifest version bump only downloads shards not seen before.
 * Works in node too (no Cache API → plain fetch).
 */
import { decodeF16 } from './f16.js';

const CACHE_NAME = 'slabsense-card-db-v1';

async function openCache() {
  try { return typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null; } catch { return null; }
}

async function cachedFetch(url) {
  const cache = await openCache();
  if (cache) { const hit = await cache.match(url); if (hit) return hit; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  if (cache) { try { await cache.put(url, r.clone()); } catch { /* quota or opaque response */ } }
  return r;
}

/**
 * @param {object} o
 * @param {string} o.baseUrl   e.g. `${SUPABASE_URL}/storage/v1/object/public/card-db`
 * @param {function} [o.onProgress]  ({ step:'embeddings', done, total })
 * @returns {Promise<{ matrix: Float32Array, ids: string[], cards: object, meta: object }>}
 */
export async function loadCardDb({ baseUrl, onProgress = null }) {
  // Cache-bust the manifest (CDN may hold it briefly); shards are immutable and cached by id.
  const mr = await fetch(`${baseUrl}/manifest.json?v=${Date.now()}`, { cache: 'no-cache' });
  if (!mr.ok) throw new Error(`manifest: HTTP ${mr.status}`);
  const manifest = await mr.json();
  const dim = manifest.dim;
  const matrix = new Float32Array(manifest.count * dim);
  const ids = [];
  const cards = {};
  let row = 0, done = 0;
  for (const s of manifest.shards) {
    const [bin, meta] = await Promise.all([
      cachedFetch(`${baseUrl}/shards/${s.id}.f16`).then((r) => r.arrayBuffer()),
      cachedFetch(`${baseUrl}/shards/${s.id}.meta.json`).then((r) => r.json()),
    ]);
    const f = decodeF16(bin);
    if (f.length !== meta.count * dim) throw new Error(`shard ${s.id}: expected ${meta.count * dim} values, got ${f.length}`);
    if (row + meta.count > manifest.count) throw new Error(`shard ${s.id}: exceeds manifest count`);
    // Defensive: rows must be unit length for dot-product search. Normalize any that are not
    // (a shard published without normalization would otherwise win every query).
    for (let r = 0; r < meta.count; r++) {
      let n = 0; for (let i = 0; i < dim; i++) n += f[r * dim + i] * f[r * dim + i];
      n = Math.sqrt(n);
      if (n > 0 && Math.abs(n - 1) > 0.02) for (let i = 0; i < dim; i++) f[r * dim + i] /= n;
    }
    matrix.set(f, row * dim);
    row += meta.count;
    for (const id of meta.ids) ids.push(id);
    Object.assign(cards, meta.cards);
    if (onProgress) onProgress({ step: 'embeddings', done: ++done, total: manifest.shards.length });
  }
  if (row !== manifest.count) throw new Error(`manifest count ${manifest.count} but shards hold ${row}`);
  return { matrix, ids, cards, meta: { version: manifest.version, model: manifest.model, dim, count: manifest.count, source: 'bucket' } };
}

/** Top-K by dot product over unit rows. `query` must be a unit vector of length dim. */
export function topK(db, query, k = 20) {
  const { matrix, ids, meta } = db;
  const dim = meta.dim;
  const best = []; // ascending by score, length ≤ k
  for (let r = 0, off = 0; r < ids.length; r++, off += dim) {
    let d = 0;
    for (let i = 0; i < dim; i++) d += query[i] * matrix[off + i];
    if (best.length < k || d > best[0].s) {
      let pos = best.length;
      while (pos > 0 && best[pos - 1].s > d) pos--;
      best.splice(pos, 0, { id: ids[r], s: d });
      if (best.length > k) best.shift();
    }
  }
  return best.reverse();
}
