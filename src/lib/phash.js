/**
 * Perceptual Hash (pHash) Implementation
 *
 * Computes a 64-bit perceptual hash of an image using DCT (Discrete Cosine Transform).
 * Similar images produce similar hashes, allowing fuzzy matching via Hamming distance.
 *
 * Algorithm:
 * 1. Resize image to 32x32 grayscale
 * 2. Apply 2D DCT to the pixel matrix
 * 3. Take top-left 8x8 block (low frequencies, excluding DC)
 * 4. Compute median of the 63 values
 * 5. Generate 64-bit hash: bit=1 if value > median, else 0
 *
 * Performance target: <30ms on mid-tier mobile
 */

// Pre-computed cosine table for 32x32 DCT (computed once)
const DCT_SIZE = 32;
const HASH_SIZE = 8;
let cosineTable = null;

/**
 * Initialize cosine lookup table for DCT
 * cos(PI * (2x + 1) * u / (2 * N))
 */
function initCosineTable() {
  if (cosineTable) return;

  cosineTable = new Float32Array(DCT_SIZE * DCT_SIZE);
  const PI = Math.PI;

  for (let u = 0; u < DCT_SIZE; u++) {
    for (let x = 0; x < DCT_SIZE; x++) {
      cosineTable[u * DCT_SIZE + x] = Math.cos((PI * (2 * x + 1) * u) / (2 * DCT_SIZE));
    }
  }
}

/**
 * Convert image source to 32x32 grayscale pixel array
 * @param {HTMLImageElement|HTMLCanvasElement|ImageData|string} source
 * @returns {Promise<Float32Array>} 32x32 grayscale values (0-255)
 */
async function toGrayscale32x32(source) {
  // Handle data URL strings
  if (typeof source === 'string') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = source;
    });
    source = img;
  }

  // Create 32x32 canvas
  const canvas = document.createElement('canvas');
  canvas.width = DCT_SIZE;
  canvas.height = DCT_SIZE;
  const ctx = canvas.getContext('2d');

  // Draw source scaled to 32x32
  if (source instanceof ImageData) {
    // Create temp canvas to hold ImageData
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = source.width;
    tempCanvas.height = source.height;
    tempCanvas.getContext('2d').putImageData(source, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0, DCT_SIZE, DCT_SIZE);
  } else {
    ctx.drawImage(source, 0, 0, DCT_SIZE, DCT_SIZE);
  }

  // Extract grayscale values
  const imageData = ctx.getImageData(0, 0, DCT_SIZE, DCT_SIZE);
  const pixels = imageData.data;
  const gray = new Float32Array(DCT_SIZE * DCT_SIZE);

  for (let i = 0; i < DCT_SIZE * DCT_SIZE; i++) {
    const idx = i * 4;
    // Standard luminance formula
    gray[i] = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
  }

  return gray;
}

/**
 * Apply 2D DCT-II to grayscale image
 * Only computes the top-left 8x8 block (all we need for hash)
 * @param {Float32Array} gray - 32x32 grayscale values
 * @returns {Float32Array} 8x8 DCT coefficients
 */
function dct2d(gray) {
  initCosineTable();

  const dctBlock = new Float32Array(HASH_SIZE * HASH_SIZE);
  const c0 = 1 / Math.sqrt(DCT_SIZE);
  const c1 = Math.sqrt(2 / DCT_SIZE);

  // Compute only the 8x8 low-frequency block
  for (let u = 0; u < HASH_SIZE; u++) {
    for (let v = 0; v < HASH_SIZE; v++) {
      let sum = 0;

      for (let x = 0; x < DCT_SIZE; x++) {
        for (let y = 0; y < DCT_SIZE; y++) {
          const pixel = gray[x * DCT_SIZE + y];
          const cosU = cosineTable[u * DCT_SIZE + x];
          const cosV = cosineTable[v * DCT_SIZE + y];
          sum += pixel * cosU * cosV;
        }
      }

      // Apply normalization coefficients
      const cu = u === 0 ? c0 : c1;
      const cv = v === 0 ? c0 : c1;
      dctBlock[u * HASH_SIZE + v] = sum * cu * cv;
    }
  }

  return dctBlock;
}

/**
 * Compute median of array values
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Generate 64-bit hash from DCT coefficients
 * @param {Float32Array} dctBlock - 8x8 DCT coefficients
 * @returns {string} 16-character hex string
 */
function generateHash(dctBlock) {
  // Exclude DC component [0,0] - use remaining 63 values
  const values = [];
  for (let i = 0; i < HASH_SIZE * HASH_SIZE; i++) {
    if (i === 0) continue; // Skip DC
    values.push(dctBlock[i]);
  }

  const med = median(values);

  // Build 64-bit hash (we have 63 values, pad with 0 for the 64th bit)
  // Using two 32-bit numbers for JS compatibility
  let hashHigh = 0;
  let hashLow = 0;

  for (let i = 0; i < 32; i++) {
    if (i < values.length && values[i] > med) {
      hashHigh |= (1 << (31 - i));
    }
  }

  for (let i = 32; i < 64; i++) {
    const valueIdx = i;
    if (valueIdx < values.length && values[valueIdx] > med) {
      hashLow |= (1 << (63 - i));
    }
  }

  // Convert to hex string (16 chars)
  const highHex = (hashHigh >>> 0).toString(16).padStart(8, '0');
  const lowHex = (hashLow >>> 0).toString(16).padStart(8, '0');

  return highHex + lowHex;
}

/**
 * Compute perceptual hash of an image
 *
 * @param {HTMLImageElement|HTMLCanvasElement|ImageData|string} imageSource
 *   - HTMLImageElement: loaded image
 *   - HTMLCanvasElement: canvas with image
 *   - ImageData: raw pixel data
 *   - string: data URL or image URL
 *
 * @returns {Promise<string>} 16-character hex string (64-bit hash)
 *
 * @example
 * const hash = await computePHash(cardImageDataUrl);
 * // Returns something like "a1b2c3d4e5f6a7b8"
 */
export async function computePHash(imageSource) {
  const startTime = performance.now();

  // Step 1: Convert to 32x32 grayscale
  const gray = await toGrayscale32x32(imageSource);

  // Step 2: Compute 2D DCT (only 8x8 low-frequency block)
  const dctBlock = dct2d(gray);

  // Step 3: Generate hash from DCT coefficients
  const hash = generateHash(dctBlock);

  const elapsed = performance.now() - startTime;
  console.log(`[pHash] Computed in ${elapsed.toFixed(1)}ms: ${hash}`);

  return hash;
}

/**
 * Compute Hamming distance between two hashes
 * Lower = more similar (0 = identical)
 *
 * @param {string} hash1 - 16-char hex hash
 * @param {string} hash2 - 16-char hex hash
 * @returns {number} Number of differing bits (0-64)
 */
export function hammingDistance(hash1, hash2) {
  if (hash1.length !== 16 || hash2.length !== 16) {
    throw new Error('Invalid hash length (expected 16 hex chars)');
  }

  let distance = 0;

  // Compare 4 bits at a time (one hex digit)
  for (let i = 0; i < 16; i++) {
    const xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16);
    // Count bits in the XOR result (0-4 bits per digit)
    distance += popcount4(xor);
  }

  return distance;
}

/**
 * Count number of 1 bits in a 4-bit number
 */
function popcount4(n) {
  // Lookup table for 0-15
  const table = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  return table[n & 0xF];
}

export default { computePHash, hammingDistance };
