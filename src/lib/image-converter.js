/**
 * Image Converter Utility
 *
 * Converts various image formats to JPEG for Claude API compatibility.
 * Handles HEIC/HEIF (iPhone), BMP, TIFF, and other formats.
 */

/**
 * Convert any image to JPEG data URL
 * @param {File|Blob} file - Image file to convert
 * @returns {Promise<string>} JPEG data URL
 */
export async function convertToJpeg(file) {
  const type = file.type?.toLowerCase() || '';
  const name = file.name?.toLowerCase() || '';

  // Already JPEG - just return as data URL
  if (type === 'image/jpeg' || type === 'image/jpg') {
    return await fileToDataUrl(file);
  }

  // Compatible formats - convert via canvas for consistency
  if (['image/png', 'image/gif', 'image/webp', 'image/bmp'].includes(type)) {
    return await canvasConvert(file);
  }

  // HEIC/HEIF detection (iPhone photos)
  const isHeic = type === 'image/heic' ||
                 type === 'image/heif' ||
                 name.endsWith('.heic') ||
                 name.endsWith('.heif');

  if (isHeic) {
    return await convertHeic(file);
  }

  // Unknown format - try canvas conversion as fallback
  console.log('[ImageConverter] Unknown format, attempting canvas conversion:', type || name);
  return await canvasConvert(file);
}

/**
 * Convert HEIC/HEIF to JPEG using heic2any library
 */
async function convertHeic(file) {
  try {
    // Dynamic import to avoid loading if not needed
    const heic2any = (await import('heic2any')).default;

    console.log('[ImageConverter] Converting HEIC to JPEG...');
    const blob = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92,
    });

    // heic2any can return array for multi-image HEIC, take first
    const resultBlob = Array.isArray(blob) ? blob[0] : blob;
    return await blobToDataUrl(resultBlob);
  } catch (err) {
    console.error('[ImageConverter] HEIC conversion failed:', err);
    throw new Error('Failed to convert HEIC image. Please try a different format.');
  }
}

/**
 * Convert image via canvas (handles PNG, GIF, WebP, BMP, etc.)
 */
async function canvasConvert(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for conversion'));
    };

    img.src = objectUrl;
  });
}

/**
 * Convert File/Blob to data URL
 */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Convert Blob to data URL
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Check if a file needs conversion
 * @param {File} file
 * @returns {boolean}
 */
export function needsConversion(file) {
  const type = file.type?.toLowerCase() || '';
  const name = file.name?.toLowerCase() || '';

  // JPEG doesn't need conversion
  if (type === 'image/jpeg' || type === 'image/jpg') {
    return false;
  }

  // Everything else needs conversion to ensure JPEG output
  return true;
}

/**
 * Get supported format info for UI display
 */
export const SUPPORTED_FORMATS = {
  native: ['JPEG', 'JPG'],
  converted: ['PNG', 'GIF', 'WebP', 'BMP', 'HEIC', 'HEIF', 'TIFF'],
  description: 'Supports all common image formats including iPhone photos (HEIC)',
};

export default {
  convertToJpeg,
  needsConversion,
  SUPPORTED_FORMATS,
};
