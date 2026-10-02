/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/** Extracted from App.jsx on 2026-10-02 (App.jsx split, slice 1). */
import { loadImg, LUM, loadImageElement } from "./image-utils.js";
import { analyzePixels, PX } from "./detectors.js";
import { modelGradingEnabled, modelSlotsForSide, markModelPass } from "../services/cornerEdgeModels.js";
import { mergeModelDings } from "./corner-edge-model.js";
/* ═══════════════════════════════════════════
   PHOTO QUALITY DETECTION
   Checks for blur, lighting, and card fill
   ═══════════════════════════════════════════ */
export async function analyzePhotoQuality(imageSrc) {
  const { w, h, data } = await loadImg(imageSrc, 800); // Smaller for speed
  const d = data.data;
  const warnings = [];
  let score = 100;

  // 1. BLUR DETECTION using Laplacian variance
  // Higher variance = sharper image
  let laplacianSum = 0;
  let laplacianSq = 0;
  let laplacianN = 0;
  const step = 2; // Sample every 2nd pixel for speed

  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      // Laplacian kernel: center * 4 - neighbors
      const center = LUM(...PX(d, w, x, y));
      const top = LUM(...PX(d, w, x, y - 1));
      const bottom = LUM(...PX(d, w, x, y + 1));
      const left = LUM(...PX(d, w, x - 1, y));
      const right = LUM(...PX(d, w, x + 1, y));
      const laplacian = Math.abs(4 * center - top - bottom - left - right);
      laplacianSum += laplacian;
      laplacianSq += laplacian * laplacian;
      laplacianN++;
    }
  }

  const laplacianMean = laplacianSum / laplacianN;
  const laplacianVariance = (laplacianSq / laplacianN) - (laplacianMean * laplacianMean);

  // Thresholds determined empirically
  if (laplacianVariance < 100) {
    warnings.push({ type: 'blur', severity: 'high', message: 'Image is very blurry - retake recommended' });
    score -= 40;
  } else if (laplacianVariance < 300) {
    warnings.push({ type: 'blur', severity: 'medium', message: 'Image may be slightly blurry' });
    score -= 15;
  }

  // 2. LIGHTING CHECK - look for over/under exposure
  let darkPixels = 0, brightPixels = 0, totalPixels = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const lum = LUM(...PX(d, w, x, y));
      totalPixels++;
      if (lum < 30) darkPixels++;
      if (lum > 240) brightPixels++;
    }
  }

  const darkRatio = darkPixels / totalPixels;
  const brightRatio = brightPixels / totalPixels;

  if (darkRatio > 0.4) {
    warnings.push({ type: 'dark', severity: 'high', message: 'Image is too dark - add more light' });
    score -= 25;
  } else if (darkRatio > 0.25) {
    warnings.push({ type: 'dark', severity: 'medium', message: 'Image could use more light' });
    score -= 10;
  }

  if (brightRatio > 0.3) {
    warnings.push({ type: 'bright', severity: 'high', message: 'Image is overexposed - reduce light or glare' });
    score -= 25;
  } else if (brightRatio > 0.15) {
    warnings.push({ type: 'bright', severity: 'medium', message: 'Some areas may be overexposed' });
    score -= 10;
  }

  // 3. CONTRAST CHECK - low contrast makes edge detection harder
  let minLum = 255, maxLum = 0;
  for (let y = Math.floor(h * 0.2); y < h * 0.8; y += step * 2) {
    for (let x = Math.floor(w * 0.2); x < w * 0.8; x += step * 2) {
      const lum = LUM(...PX(d, w, x, y));
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }
  }

  const contrast = maxLum - minLum;
  if (contrast < 50) {
    warnings.push({ type: 'contrast', severity: 'medium', message: 'Low contrast - may affect detection accuracy' });
    score -= 10;
  }

  return {
    score: Math.max(0, score),
    warnings,
    metrics: {
      sharpness: Math.round(laplacianVariance),
      darkRatio: Math.round(darkRatio * 100),
      brightRatio: Math.round(brightRatio * 100),
      contrast: Math.round(contrast),
    },
    isAcceptable: score >= 60,
  };
}



/* ═══════════════════════════════════════════
   FULL ANALYSIS PIPELINE
   ═══════════════════════════════════════════ */
/** "CREASE_CAP_6" → "crease ≤ 6", for the Limited-by line under a grade. */
export function formatCaps(caps) {
  return (caps || []).map((c) => c
    .replace('MIN_SUBGRADE_CLAMP', 'min subgrade')
    .replace('PRISTINE_GATE', 'pristine gate')
    .replace('PRISTINE_BLOCK', 'pristine block')
    .replace(/_CAP_/, ' ≤ ')
    .replace(/_/g, ' ')
    .toLowerCase()).join(', ');
}

export async function analyzeCardFull(src, side, overrideBounds = null, overrideCentering = null, onProgress = null) {
  const { w, h, data, canvas } = await loadImg(src);
  const scaledImgUrl = canvas.toDataURL('image/jpeg', 0.92);
  const result = analyzePixels({ data: data.data, w, h }, side, overrideBounds, overrideCentering);
  return withModelDings(src, side, { ...result, scaledImgUrl }, onProgress);
}

/**
 * Replace the detector's corner and edge dings with the trained models' when model
 * grading is switched on. Every downstream computeGrade() reads `allDings`, so this
 * one hook covers the whole grade path. Fail-soft on purpose: a missing model, an
 * offline phone or an unsupported browser leaves the detector result exactly as it was.
 * Crops follow TAG's framing (src/lib/tag-crops.js); see docs/GRADING_SYSTEM.md.
 */
export async function withModelDings(src, side, result, onProgress = null) {
  if (!modelGradingEnabled()) return result;
  try {
    // On a phone without WebGPU this is seconds, not milliseconds, so say what is happening.
    if (onProgress) onProgress(`Checking corners and edges (${side})...`);
    const img = await loadImageElement(src); // natural resolution, not the 1400 px analysis copy
    if (!img) throw new Error('could not decode the card image');
    // The detectors ran on a 1400 px copy; scale their card bounds up to the full image so the
    // crops frame the card itself, whether or not the user cropped the photo.
    const scale = img.naturalWidth / (result.imgW || img.naturalWidth);
    const b = result.bounds;
    const rect = b ? { x: b.left * scale, y: b.top * scale, w: b.cardW * scale, h: b.cardH * scale } : null;
    markModelPass(true);
    let slots, dings;
    try {
      ({ slots, dings } = await modelSlotsForSide(img, rect, side));
    } finally {
      markModelPass(false);
      img.src = ''; // release the decoded full-resolution bitmap now, not whenever GC gets to it
    }
    // `modelSlots` (every slot, clean or not) rides along to the paid grades so Claude
    // judges corners and edges from the same numbers; see api/_lib/cornerEdgeInput.js.
    return { ...result, allDings: mergeModelDings(result.allDings, dings), modelDings: dings, modelSlots: slots, modelUsed: true };
  } catch (e) {
    console.warn(`corner/edge models skipped for ${side}:`, e?.message || e);
    return { ...result, modelUsed: false, modelError: String(e?.message || e) };
  }
}
