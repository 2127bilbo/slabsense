/**
 * ============================================================================
 * TRAINING CAPTURE — trainingCapture.js
 * ============================================================================
 * Keeps the ORIGINAL photos (not just the card crop) and the card corners the
 * user confirmed in the centering tool, so real phone photos with real labels
 * accumulate for the card model's validation set
 * (training/HANDOFF-card-and-centering.md, Step 10.3).
 *
 * Off by default; a per-device toggle in Settings turns it on. Files go next
 * to the saved card in the `card-images` bucket under
 * `<user>/<scan>/training/{front.jpg, back.jpg, labels.json}`, a folder the
 * weekly cleanup never touches. Corners are stored normalised to the photo
 * (0-1 of width and height), so they are valid at any resolution.
 * ============================================================================
 */
import { supabase, isSupabaseConfigured } from './supabase.js';
import { normalisedCorners } from '../lib/training-labels.js';

export { normalisedCorners };

const FLAG_KEY = 'slabsense_keepOriginals';
export const TRAINING_FOLDER = 'training';

export function trainingCaptureEnabled() {
  try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; }
}
export function setTrainingCapture(on) {
  try { localStorage.setItem(FLAG_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

async function upload(path, body, contentType) {
  const { error } = await supabase.storage.from('card-images').upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`${path}: ${error.message}`);
}

/**
 * Store both originals and their labels for one saved scan. Fail-soft: a
 * failure here must never affect the save itself, so it only logs.
 * @returns {Promise<{stored: string[]}|null>}
 */
export async function captureForTraining({ userId, scanId, front, back }) {
  if (!isSupabaseConfigured() || !userId || !scanId) return null;
  const sides = { front, back };
  const labels = { version: 1, capturedAt: new Date().toISOString(), sides: {} };
  const stored = [];
  try {
    for (const [side, s] of Object.entries(sides)) {
      if (!s?.dataUrl) continue;
      const corners = normalisedCorners(s.centeringData);
      if (!corners) continue; // no confirmed outline: no label, so no photo either
      const blob = await (await fetch(s.dataUrl)).blob();
      const path = `${userId}/${scanId}/${TRAINING_FOLDER}/${side}.jpg`;
      await upload(path, blob, blob.type || 'image/jpeg');
      stored.push(path);
      labels.sides[side] = {
        corners,
        imageWidth: s.centeringData.source.imgW,
        imageHeight: s.centeringData.source.imgH,
        rotation: s.centeringData.rotation ?? 0,
        measureMode: s.centeringData.measureMode ?? null,
        lrRatio: s.centeringData.lrRatio ?? null,
        tbRatio: s.centeringData.tbRatio ?? null,
      };
    }
    if (!stored.length) return null;
    await upload(`${userId}/${scanId}/${TRAINING_FOLDER}/labels.json`, new Blob([JSON.stringify(labels, null, 2)], { type: 'application/json' }), 'application/json');
    return { stored };
  } catch (e) {
    console.warn('training capture skipped:', e?.message || e);
    return null;
  }
}
