/**
 * SlabSense - Shared Image Utilities
 *
 * Common image loading and processing functions used across the app.
 */

/**
 * Load an image and return canvas data for processing
 * @param {string} src - Image source URL or data URL
 * @param {number} mx - Maximum dimension (default 1400px)
 * @returns {Promise<{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number, data: ImageData}|null>}
 */
export function loadImg(src, mx = 1400) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let w = img.width;
      let h = img.height;

      // Scale down if larger than max dimension
      if (Math.max(w, h) > mx) {
        const s = mx / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      resolve({
        canvas,
        ctx,
        w,
        h,
        data: ctx.getImageData(0, 0, w, h),
      });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Load an image element without canvas processing
 * @param {string} src - Image source URL
 * @returns {Promise<HTMLImageElement|null>}
 */
export function loadImageElement(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Convert a canvas to a data URL
 * @param {HTMLCanvasElement} canvas
 * @param {string} type - MIME type (default 'image/jpeg')
 * @param {number} quality - Quality 0-1 (default 0.92)
 * @returns {string}
 */
export function canvasToDataUrl(canvas, type = 'image/jpeg', quality = 0.92) {
  return canvas.toDataURL(type, quality);
}

/**
 * Resize an image to fit within max dimensions
 * @param {string} src - Image source
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @param {number} quality - JPEG quality (default 0.92)
 * @returns {Promise<string>} - Data URL of resized image
 */
export async function resizeImage(src, maxWidth, maxHeight, quality = 0.92) {
  const result = await loadImg(src, Math.max(maxWidth, maxHeight));
  if (!result) return src;

  return canvasToDataUrl(result.canvas, 'image/jpeg', quality);
}

/**
 * Calculate luminance from RGB values
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {number} Luminance value
 */
export function LUM(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Generate surface vision maps (emboss, high-pass, edge detection)
 * Used for analyzing card surface defects
 * @param {string} src - Image source URL or data URL
 * @returns {Promise<{original: string, emboss: string, highpass: string, edges: string, width: number, height: number}|null>}
 */
export async function genMaps(src) {
  const result = await loadImg(src, 1400);
  if (!result) return null;

  const { canvas, w, h, data } = result;
  const d = data.data;

  const mk = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };

  const L = (Y, X) => LUM(d[(Y * w + X) * 4], d[(Y * w + X) * 4 + 1], d[(Y * w + X) * 4 + 2]);

  // Emboss filter
  const eC = mk();
  const eX = eC.getContext("2d");
  const eD = eX.createImageData(w, h);
  const e = eD.data;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const v = Math.min(255, Math.max(0, 128 + (L(y + 1, x + 1) - L(y - 1, x - 1)) * 2));
      e[i] = e[i + 1] = e[i + 2] = v;
      e[i + 3] = 255;
    }
  }
  eX.putImageData(eD, 0, 0);

  // High-pass filter
  const hC = mk();
  const hX = hC.getContext("2d");
  const hD = hX.createImageData(w, h);
  const hp = hD.data;
  for (let y = 8; y < h - 8; y++) {
    for (let x = 8; x < w - 8; x++) {
      const i = (y * w + x) * 4;
      let ls = 0, ln = 0;
      for (let dy = -8; dy <= 8; dy += 2) {
        for (let dx = -8; dx <= 8; dx += 2) {
          ls += L(y + dy, x + dx);
          ln++;
        }
      }
      const v = Math.min(255, Math.max(0, 128 + (L(y, x) - ls / ln) * 3));
      hp[i] = hp[i + 1] = hp[i + 2] = v;
      hp[i + 3] = 255;
    }
  }
  hX.putImageData(hD, 0, 0);

  // Sobel edge detection
  const dC = mk();
  const dX = dC.getContext("2d");
  const dD = dX.createImageData(w, h);
  const ed = dD.data;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const gx = -L(y - 1, x - 1) + L(y - 1, x + 1) - 2 * L(y, x - 1) + 2 * L(y, x + 1) - L(y + 1, x - 1) + L(y + 1, x + 1);
      const gy = -L(y - 1, x - 1) - 2 * L(y - 1, x) - L(y - 1, x + 1) + L(y + 1, x - 1) + 2 * L(y + 1, x) + L(y + 1, x + 1);
      const m = Math.min(255, Math.sqrt(gx * gx + gy * gy));
      ed[i] = ~~(m * 0.2);
      ed[i + 1] = ~~(m * 0.9);
      ed[i + 2] = ~~m;
      ed[i + 3] = 255;
    }
  }
  dX.putImageData(dD, 0, 0);

  return {
    original: canvas.toDataURL(),
    emboss: eC.toDataURL(),
    highpass: hC.toDataURL(),
    edges: dC.toDataURL(),
    width: w,
    height: h,
  };
}

export default {
  loadImg,
  loadImageElement,
  canvasToDataUrl,
  resizeImage,
  LUM,
  genMaps,
};
