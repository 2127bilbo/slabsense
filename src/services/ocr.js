/**
 * OCR Service for Pokemon Card Text Extraction
 *
 * Uses Tesseract.js to extract card name and set number from photos.
 * Targets specific regions of the card for accuracy.
 */

import Tesseract from 'tesseract.js';

// Card layout regions (percentages of card dimensions)
const REGIONS = {
  // Top region for card name (large text)
  name: { top: 0, left: 0, width: 0.75, height: 0.12 },
  // Bottom region for set number (e.g., "134/197")
  setNumber: { top: 0.92, left: 0.5, width: 0.45, height: 0.08 },
  // HP region (top right)
  hp: { top: 0.02, left: 0.7, width: 0.28, height: 0.08 },
};

/**
 * Pre-process image for better OCR accuracy
 * - Increases contrast
 * - Sharpens edges
 * - Converts to grayscale
 */
function preprocessImage(canvas, ctx, region) {
  const { width, height } = canvas;
  const imageData = ctx.getImageData(
    Math.floor(width * region.left),
    Math.floor(height * region.top),
    Math.floor(width * region.width),
    Math.floor(height * region.height)
  );

  const data = imageData.data;

  // Convert to grayscale and increase contrast
  for (let i = 0; i < data.length; i += 4) {
    // Grayscale
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Increase contrast (stretch histogram)
    const contrast = 1.5;
    const factor = (259 * (contrast * 100 + 255)) / (255 * (259 - contrast * 100));
    const newGray = Math.min(255, Math.max(0, factor * (gray - 128) + 128));

    data[i] = newGray;
    data[i + 1] = newGray;
    data[i + 2] = newGray;
  }

  // Create new canvas with processed region
  const regionCanvas = document.createElement('canvas');
  regionCanvas.width = imageData.width;
  regionCanvas.height = imageData.height;
  const regionCtx = regionCanvas.getContext('2d');
  regionCtx.putImageData(imageData, 0, 0);

  return regionCanvas;
}

/**
 * Extract a specific region from an image
 */
async function extractRegion(imageSrc, region) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const processed = preprocessImage(canvas, ctx, region);
      resolve(processed.toDataURL('image/png'));
    };
    img.src = imageSrc;
  });
}

/**
 * Clean up OCR result for card name
 * - Remove common OCR artifacts
 * - Normalize spacing
 * - Handle Pokemon-specific characters
 */
function cleanCardName(text) {
  if (!text) return '';

  return text
    .trim()
    .toUpperCase()
    // Remove common OCR noise
    .replace(/[^A-Z0-9\s\-'éÉ]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Common OCR corrections
    .replace(/\bEX\b/g, 'ex')
    .replace(/\bGX\b/g, 'GX')
    .replace(/\bVMAX\b/g, 'VMAX')
    .replace(/\bVSTAR\b/g, 'VSTAR')
    .trim();
}

/**
 * Clean up OCR result for set number
 * - Extract pattern like "134/197" or "134"
 */
function cleanSetNumber(text) {
  if (!text) return { localId: null, total: null };

  // Look for pattern: number/number (e.g., "134/197")
  const slashMatch = text.match(/(\d{1,3})\s*[\/\\]\s*(\d{1,3})/);
  if (slashMatch) {
    return {
      localId: slashMatch[1],
      total: slashMatch[2],
    };
  }

  // Look for just a number
  const numMatch = text.match(/\b(\d{1,3})\b/);
  if (numMatch) {
    return {
      localId: numMatch[1],
      total: null,
    };
  }

  return { localId: null, total: null };
}

/**
 * Clean up OCR result for HP
 */
function cleanHP(text) {
  if (!text) return null;

  const match = text.match(/(\d{2,3})/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Main OCR extraction function
 * Extracts card name, set number, and HP from a card image
 */
export async function extractCardInfo(imageSrc, onProgress = null) {
  const results = {
    name: null,
    localId: null,
    setTotal: null,
    hp: null,
    confidence: 0,
    rawText: {},
  };

  try {
    // Initialize Tesseract worker
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });

    // Set parameters for better accuracy
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -\'/éÉ',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    // Extract card name region
    if (onProgress) onProgress(0);
    const nameRegion = await extractRegion(imageSrc, REGIONS.name);
    const nameResult = await worker.recognize(nameRegion);
    results.rawText.name = nameResult.data.text;
    results.name = cleanCardName(nameResult.data.text);
    results.confidence += nameResult.data.confidence;

    // Extract set number region (use number-only whitelist)
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789/',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    if (onProgress) onProgress(50);
    const setRegion = await extractRegion(imageSrc, REGIONS.setNumber);
    const setResult = await worker.recognize(setRegion);
    results.rawText.setNumber = setResult.data.text;
    const setData = cleanSetNumber(setResult.data.text);
    results.localId = setData.localId;
    results.setTotal = setData.total;
    results.confidence += setResult.data.confidence;

    // Extract HP region
    if (onProgress) onProgress(75);
    const hpRegion = await extractRegion(imageSrc, REGIONS.hp);
    const hpResult = await worker.recognize(hpRegion);
    results.rawText.hp = hpResult.data.text;
    results.hp = cleanHP(hpResult.data.text);
    results.confidence += hpResult.data.confidence;

    // Average confidence
    results.confidence = Math.round(results.confidence / 3);

    await worker.terminate();

    if (onProgress) onProgress(100);

  } catch (error) {
    console.error('OCR extraction error:', error);
    results.error = error.message;
  }

  return results;
}

/**
 * Quick name-only extraction (faster)
 */
export async function extractCardName(imageSrc) {
  try {
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -\'/éÉ',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    const nameRegion = await extractRegion(imageSrc, REGIONS.name);
    const result = await worker.recognize(nameRegion);

    await worker.terminate();

    return cleanCardName(result.data.text);
  } catch (error) {
    console.error('Name extraction error:', error);
    return null;
  }
}

export default { extractCardInfo, extractCardName };
