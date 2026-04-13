/**
 * OCR Service for Pokemon Card Text Extraction
 *
 * Uses Tesseract.js to extract card name and set number from photos.
 * First detects/crops the card, then reads from specific regions.
 */

import Tesseract from 'tesseract.js';

// Card layout - name region only (most reliable)
// Name is always at top, usually left-aligned
// Larger region to ensure we capture the full name area
const NAME_REGION = { top: 0.02, left: 0.05, width: 0.65, height: 0.10 };

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
 * Pre-process image for better OCR accuracy on Pokemon cards
 * - Contrast stretching to normalize lighting
 * - Sharpening to enhance text edges
 * - Adaptive thresholding for holofoil handling
 * - Converts to high-contrast black/white
 */
function preprocessImage(canvas, ctx, region) {
  const { width, height } = canvas;
  const x = Math.floor(width * region.left);
  const y = Math.floor(height * region.top);
  const w = Math.floor(width * region.width);
  const h = Math.floor(height * region.height);

  const imageData = ctx.getImageData(x, y, w, h);
  const data = imageData.data;

  // Step 1: Convert to grayscale and find min/max for contrast stretching
  const grayValues = [];
  let minGray = 255, maxGray = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    grayValues.push(gray);
    if (gray < minGray) minGray = gray;
    if (gray > maxGray) maxGray = gray;
  }

  // Step 2: Apply contrast stretching to normalize the range
  const range = maxGray - minGray;
  if (range > 10) {
    for (let i = 0; i < grayValues.length; i++) {
      grayValues[i] = ((grayValues[i] - minGray) / range) * 255;
    }
  }

  // Step 3: Calculate Otsu's threshold (better than simple mean)
  // This finds the optimal threshold to separate text from background
  const histogram = new Array(256).fill(0);
  for (const g of grayValues) {
    histogram[Math.round(g)]++;
  }

  let total = grayValues.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0, wB = 0;
  let maxVariance = 0, threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  // Step 4: Apply thresholding with some margin
  // Pokemon card names are usually dark text on lighter background
  for (let i = 0; i < data.length; i += 4) {
    const gray = grayValues[i / 4];

    // Binary threshold with slight bias toward dark (text)
    const val = gray < threshold - 10 ? 0 : 255;

    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }

  // Create new canvas with processed region (scaled up 2x for better OCR)
  const scale = 2;
  const regionCanvas = document.createElement('canvas');
  regionCanvas.width = w * scale;
  regionCanvas.height = h * scale;
  const regionCtx = regionCanvas.getContext('2d');

  // First put the processed data on a temp canvas
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  tempCanvas.getContext('2d').putImageData(imageData, 0, 0);

  // Then scale up with nearest-neighbor for crisp edges
  regionCtx.imageSmoothingEnabled = false;
  regionCtx.drawImage(tempCanvas, 0, 0, w * scale, h * scale);

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
 * Detects card, crops it, reads JUST THE NAME (most reliable)
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
    if (onProgress) onProgress(10);

    // Step 1: Crop to just the card (removes background)
    const croppedCard = await detectAndCropCard(imageSrc);
    console.log('✓ Card cropped');
    if (onProgress) onProgress(20);

    // Step 2: Extract and preprocess name region
    console.log('🔍 Step 2: Extracting name region...');
    const nameRegionImg = await extractRegion(croppedCard, NAME_REGION);
    if (onProgress) onProgress(30);

    // Step 3: Initialize Tesseract
    console.log('🔍 Step 3: Running OCR on name...');
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(30 + Math.round(m.progress * 60));
        }
      },
    });

    // Configure for single line of text, Pokemon card names
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -\'',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
      preserve_interword_spaces: '1',
    });

    // Read the name
    const nameResult = await worker.recognize(nameRegionImg);
    results.rawText.name = nameResult.data.text;
    results.name = cleanCardName(nameResult.data.text);
    results.confidence = Math.round(nameResult.data.confidence);

    console.log('📝 Raw OCR:', nameResult.data.text);
    console.log('📝 Cleaned:', results.name);
    console.log('📝 Confidence:', results.confidence + '%');

    await worker.terminate();
    if (onProgress) onProgress(100);

    console.log('✅ OCR complete:', results.name, `(${results.confidence}% confidence)`);

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

    const nameRegion = await extractRegion(imageSrc, NAME_REGION);
    const result = await worker.recognize(nameRegion);

    await worker.terminate();

    return cleanCardName(result.data.text);
  } catch (error) {
    console.error('Name extraction error:', error);
    return null;
  }
}

export default { extractCardInfo, extractCardName };
