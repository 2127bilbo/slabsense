/**
 * OCR Service for Pokemon Card Text Extraction
 *
 * Uses Tesseract.js to extract card name and set number from photos.
 * First detects/crops the card, then reads from specific regions.
 */

import Tesseract from 'tesseract.js';

// Card layout regions (percentages of CROPPED card dimensions)
const REGIONS = {
  // Top region for card name (large text) - wider region for reliability
  name: { top: 0.02, left: 0.05, width: 0.65, height: 0.10 },
  // Bottom region for set number (e.g., "134/197" or "gg44/gg70")
  setNumber: { top: 0.93, left: 0.45, width: 0.50, height: 0.06 },
};

/**
 * Simple luminance calculation
 */
const LUM = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Detect card bounds in image using variance-based detection
 * Returns cropped card image as data URL
 */
async function detectAndCropCard(imageSrc) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSize = 800;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxSize) {
        const scale = maxSize / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;

      // Grid-based variance detection (find card area)
      const GX = 16, GY = 16;
      const cellW = Math.floor(w / GX), cellH = Math.floor(h / GY);
      const vg = [];
      let maxV = 0;

      for (let gy = 0; gy < GY; gy++) {
        vg[gy] = [];
        for (let gx = 0; gx < GX; gx++) {
          let s = 0, sq = 0, n = 0;
          const x0 = gx * cellW, y0 = gy * cellH;
          for (let y = y0; y < y0 + cellH && y < h; y += 2) {
            for (let x = x0; x < x0 + cellW && x < w; x += 2) {
              const idx = (y * w + x) * 4;
              const v = LUM(d[idx], d[idx + 1], d[idx + 2]);
              s += v; sq += v * v; n++;
            }
          }
          const variance = n > 0 ? sq / n - (s / n) ** 2 : 0;
          vg[gy][gx] = variance;
          if (variance > maxV) maxV = variance;
        }
      }

      // Find bounding box of high-variance cells
      const floor = Math.max(30, maxV * 0.12);
      let minGX = GX, maxGX = -1, minGY = GY, maxGY = -1;
      for (let gy = 0; gy < GY; gy++) {
        for (let gx = 0; gx < GX; gx++) {
          if (vg[gy][gx] > floor) {
            if (gx < minGX) minGX = gx;
            if (gx > maxGX) maxGX = gx;
            if (gy < minGY) minGY = gy;
            if (gy > maxGY) maxGY = gy;
          }
        }
      }

      // Convert grid coords to pixels with small padding
      const pad = 5;
      const left = Math.max(0, minGX * cellW - pad);
      const top = Math.max(0, minGY * cellH - pad);
      const right = Math.min(w, (maxGX + 1) * cellW + pad);
      const bottom = Math.min(h, (maxGY + 1) * cellH + pad);
      const cropW = right - left;
      const cropH = bottom - top;

      // If no card detected or too small, use center 80%
      if (cropW < 50 || cropH < 50 || maxGX < minGX) {
        console.log('Card detection failed, using center crop');
        const cx = w * 0.1, cy = h * 0.1;
        const cw = w * 0.8, ch = h * 0.8;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cw;
        cropCanvas.height = ch;
        cropCanvas.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
        resolve(cropCanvas.toDataURL('image/png'));
        return;
      }

      console.log(`Card detected: ${left},${top} ${cropW}x${cropH}`);
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      cropCanvas.getContext('2d').drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);
      resolve(cropCanvas.toDataURL('image/png'));
    };
    img.src = imageSrc;
  });
}

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
 * - Extract pattern like "134/197", "gg44/gg70", or just "134"
 */
function cleanSetNumber(text) {
  if (!text) return { localId: null, total: null };

  // Clean the text first
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, '');

  // Look for pattern: alphanumeric/alphanumeric (e.g., "gg44/gg70" or "134/197")
  const slashMatch = cleaned.match(/([a-z]*\d+)\s*[\/\\]\s*([a-z]*\d+)/i);
  if (slashMatch) {
    return {
      localId: slashMatch[1],
      total: slashMatch[2],
    };
  }

  // Look for alphanumeric pattern (e.g., "gg44" or "134")
  const alphaNumMatch = cleaned.match(/([a-z]*\d+)/i);
  if (alphaNumMatch) {
    return {
      localId: alphaNumMatch[1],
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
 * First detects/crops the card, then extracts name and set number
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
    console.log('🔍 Step 1: Detecting and cropping card...');
    if (onProgress) onProgress(5);

    // Step 1: Crop to just the card (removes background)
    const croppedCard = await detectAndCropCard(imageSrc);
    console.log('✓ Card cropped');
    if (onProgress) onProgress(15);

    // Initialize Tesseract worker
    console.log('🔍 Step 2: Initializing OCR...');
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          // Scale progress: 15-80 for OCR
          onProgress(15 + Math.round(m.progress * 65));
        }
      },
    });

    // Set parameters for card name (allow letters, numbers, spaces, hyphens)
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -\'',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    // Extract card name from CROPPED card
    console.log('🔍 Step 3: Reading card name...');
    const nameRegion = await extractRegion(croppedCard, REGIONS.name);
    const nameResult = await worker.recognize(nameRegion);
    results.rawText.name = nameResult.data.text;
    results.name = cleanCardName(nameResult.data.text);
    results.confidence = nameResult.data.confidence;
    console.log('📝 Name raw:', nameResult.data.text, '→ cleaned:', results.name);

    // Extract set number (allow letters too for sets like "gg44")
    console.log('🔍 Step 4: Reading set number...');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    const setRegion = await extractRegion(croppedCard, REGIONS.setNumber);
    const setResult = await worker.recognize(setRegion);
    results.rawText.setNumber = setResult.data.text;
    const setData = cleanSetNumber(setResult.data.text);
    results.localId = setData.localId;
    results.setTotal = setData.total;
    console.log('📝 Set raw:', setResult.data.text, '→ localId:', results.localId);

    // Done - terminate worker
    await worker.terminate();
    if (onProgress) onProgress(100);

    console.log('✅ OCR complete:', { name: results.name, localId: results.localId });

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
