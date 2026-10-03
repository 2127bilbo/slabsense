/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * What the camera's review screen recommends after a photo: use it, or retake it.
 * Combines the card detector's check (validateCap in CameraViewfinder.jsx) with the photo-confidence
 * score (src/lib/photo-confidence.js, phone-capped). Catching a bad photo here costs nothing: a free
 * grade is only spent when the user asks for the grade.
 * Copy rule (owner, 2026-10-03): never quote a margin or promise a better grade from a better photo.
 */

/** Scores below this (the Hazy and Cloudy bands) recommend a retake. */
export const RETAKE_BELOW = 5.0;
/** Scores below this (the Clear band) are usable but could be better. */
export const FAIR_BELOW = 7.0;

const FREE = 'Retaking is free; a grade is only used when you ask for one.';

/**
 * @param {{valid:boolean, issues:string[], corners:object|null}|null} validation
 * @param {{score:number, issues:object, cutoff:boolean}|null} conf photo confidence, or null when not scored
 * @returns {null | {verdict:'good'|'fair'|'retake', primary:'use'|'retake', useLabel:string, headline:string, message:string}}
 */
export function captureAdvice(validation, conf) {
  if (!validation) return null;
  const retake = (headline, message) => ({ verdict: 'retake', primary: 'retake', useLabel: 'Use Anyway', headline, message: `${message} ${FREE}` });
  const fair = (headline, message) => ({ verdict: 'fair', primary: 'use', useLabel: 'Use Photo', headline, message });
  const good = { verdict: 'good', primary: 'use', useLabel: 'Use Photo', headline: 'Good photo', message: 'The card is clear and fully in the photo.' };

  if (!validation.corners && !validation.valid) {
    return retake(validation.issues?.[0]?.startsWith('Card not') ? 'Card not found' : 'Check the photo', 'SlabSense could not find the card edges in this photo.');
  }
  if (conf?.cutoff) return retake('Part of the card is outside the photo', 'All four corners need to be in the photo to grade them.');
  if (conf && conf.score < RETAKE_BELOW) return retake('Retake recommended', 'Photo issues may affect the estimate.');
  if (conf && conf.score < FAIR_BELOW) return fair('Usable photo', 'A retake that fixes the points below makes the estimate more reliable.');
  if (!validation.valid) return fair('Usable photo', validation.issues?.[0] || 'The photo could be better.');
  return good;
}
