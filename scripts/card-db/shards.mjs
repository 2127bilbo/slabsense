/** Shard writer shared by build-initial.mjs and update.mjs. Shards are append-only. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodeF16 } from '../../src/lib/f16.js';

export const DIM = 512;

/**
 * @param outDir   local directory for the files
 * @param shardId  zero-padded id, e.g. '0006'
 * @param ids      card ids in row order
 * @param cards    { id: { name, set, number } }
 * @param matrix   Float32Array(ids.length × DIM), rows L2-normalized
 */
export function writeShard(outDir, shardId, ids, cards, matrix) {
  if (matrix.length !== ids.length * DIM) throw new Error(`matrix/ids length mismatch: ${matrix.length} vs ${ids.length}×${DIM}`);
  // Guard: rows must be unit length or they dominate every dot-product search (bug of 2026-09-14).
  for (let r = 0; r < ids.length; r++) {
    let n = 0; for (let i = 0; i < DIM; i++) n += matrix[r * DIM + i] ** 2;
    if (Math.abs(Math.sqrt(n) - 1) > 0.02) throw new Error(`row ${r} (${ids[r]}) is not unit length (norm ${Math.sqrt(n).toFixed(3)}); normalize before writeShard`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const bytes = encodeF16(matrix);
  const f16Path = path.join(outDir, `${shardId}.f16`);
  const metaPath = path.join(outDir, `${shardId}.meta.json`);
  fs.writeFileSync(f16Path, bytes);
  const meta = { shard: shardId, dim: DIM, count: ids.length, ids, cards: Object.fromEntries(ids.map((id) => [id, cards[id]])) };
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  return { f16Path, metaPath, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), count: ids.length };
}

export const nextShardId = (manifest) => String((manifest?.shards?.length || 0) + 1).padStart(4, '0');
