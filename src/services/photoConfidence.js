/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * Photo confidence for a captured card, in the browser: finds the card's corners (card model,
 * else the outline the user placed in the centering tool), reads the photo's pixels and scores it
 * with src/lib/photo-confidence.js. Both sides are combined: the score is the weaker side and each
 * problem is as bad as its worse side. Returns null when the card cannot be located; the grade
 * screen then shows nothing rather than a guess.
 */
import { photoConfidence, capForSource } from '../lib/photo-confidence.js';
import { detectCardInSource } from './cardModels.js';
import { loadImageElement } from '../lib/image-utils.js';

const MAX_SIDE = 2000;   // same scale the calibration run used

/** Corners from the centering tool's saved outline (editor pixels -> fractions), when it is usable. */
export function cornersFromCentering(centeringData) {
  const src = centeringData?.source;
  if (!src?.imgW || !src?.imgH) return null;
  if (Math.abs(src.rotation || 0) > 0.01 || Math.abs(src.tiltX || 0) > 0.01 || Math.abs(src.tiltY || 0) > 0.01) return null;   // outline is in a transformed frame
  const n = (p) => ({ x: p.x / src.imgW, y: p.y / src.imgH });
  if (src.outerCorners) return { tl: n(src.outerCorners.tl), tr: n(src.outerCorners.tr), br: n(src.outerCorners.br), bl: n(src.outerCorners.bl) };
  const o = src.outer; if (!o) return null;
  return { tl: n({ x: o.left, y: o.top }), tr: n({ x: o.right, y: o.top }), br: n({ x: o.right, y: o.bottom }), bl: n({ x: o.left, y: o.bottom }) };
}

async function measureSide(src, centeringData) {
  if (!src) return null;
  const img = await loadImageElement(src);
  if (!img) return null;
  let corners = null;
  const det = await detectCardInSource(img, { refine: 'logits' }).catch(() => null);
  if (det?.ok) corners = det.corners;
  if (!corners) corners = cornersFromCentering(centeringData);
  if (!corners) return null;
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return photoConfidence(ctx.getImageData(0, 0, c.width, c.height), corners);
}

/** @returns {Promise<null | {score:number, issues:Record<string,number>, cutoff:boolean, sides:{front:object|null, back:object|null}}>} */
export async function measurePhotoConfidence({ front, back, frontCentering, backCentering, source = 'phone' }) {
  const [f, b] = [await measureSide(front, frontCentering), await measureSide(back, backCentering)];
  const sides = [f, b].filter((x) => x && x.score != null);   // not card-shaped (a slab) or not found: no score
  if (!sides.length) return null;
  const issues = {};
  for (const s of sides) for (const [k, v] of Object.entries(s.issues)) issues[k] = Math.max(issues[k] || 0, v);
  const raw = Math.min(...sides.map((s) => s.score));
  return { score: capForSource(raw, source), issues, cutoff: sides.some((s) => s.cutoff), sides: { front: f, back: b } };
}
