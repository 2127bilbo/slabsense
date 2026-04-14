/**
 * Hash Database Builder
 *
 * Fetches all Pokemon cards from TCGDex, computes pHash for each,
 * and outputs to public/card-hashes.json
 *
 * Usage:
 *   node scripts/build-hash-db.js              # Build hash DB only
 *   node scripts/build-hash-db.js --resume     # Resume from checkpoint
 *   node scripts/build-hash-db.js --save-images  # Also save all card images
 *   node scripts/build-hash-db.js --images-only  # Only download images (skip hashing)
 *
 * Requirements:
 *   npm install canvas  (for image processing in Node.js)
 *
 * Output:
 *   public/card-hashes.json (~400KB gzipped)
 *   public/card-images/{set}/{number}.png (if --save-images, ~5-10GB total)
 *
 * Runtime: 1-3 hours for full catalog (~20k cards)
 *
 * Future uses for saved images:
 *   - Train custom ML model on Replicate
 *   - Build your own card recognition API
 *   - Offline card display
 *   - Backup independent of TCGDex
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

// ============================================
// Configuration
// ============================================

const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'card-hashes.json');
const CHECKPOINT_FILE = path.join(__dirname, 'hash-checkpoint.json');
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'card-images');
const TCGDEX_API = 'https://api.tcgdex.net/v2/en';

// Rate limiting (be nice to TCGDex)
const REQUESTS_PER_SECOND = 5;
const DELAY_MS = 1000 / REQUESTS_PER_SECOND;

// Checkpoint every N cards
const CHECKPOINT_INTERVAL = 100;

// Command line flags
const SAVE_IMAGES = process.argv.includes('--save-images');
const IMAGES_ONLY = process.argv.includes('--images-only');
const RESUME_MODE = process.argv.includes('--resume');

// ============================================
// pHash Implementation (Node.js version)
// ============================================

const DCT_SIZE = 32;
const HASH_SIZE = 8;
let cosineTable = null;

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

async function imageToGrayscale32x32(imageUrl) {
  try {
    const img = await loadImage(imageUrl);

    // Create 32x32 canvas
    const canvas = createCanvas(DCT_SIZE, DCT_SIZE);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, DCT_SIZE, DCT_SIZE);

    // Extract grayscale
    const imageData = ctx.getImageData(0, 0, DCT_SIZE, DCT_SIZE);
    const pixels = imageData.data;
    const gray = new Float32Array(DCT_SIZE * DCT_SIZE);

    for (let i = 0; i < DCT_SIZE * DCT_SIZE; i++) {
      const idx = i * 4;
      gray[i] = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
    }

    return gray;
  } catch (error) {
    throw new Error(`Failed to load image: ${error.message}`);
  }
}

function dct2d(gray) {
  initCosineTable();
  const dctBlock = new Float32Array(HASH_SIZE * HASH_SIZE);
  const c0 = 1 / Math.sqrt(DCT_SIZE);
  const c1 = Math.sqrt(2 / DCT_SIZE);

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
      const cu = u === 0 ? c0 : c1;
      const cv = v === 0 ? c0 : c1;
      dctBlock[u * HASH_SIZE + v] = sum * cu * cv;
    }
  }
  return dctBlock;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function generateHash(dctBlock) {
  const values = [];
  for (let i = 0; i < HASH_SIZE * HASH_SIZE; i++) {
    if (i === 0) continue;
    values.push(dctBlock[i]);
  }

  const med = median(values);
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

  const highHex = (hashHigh >>> 0).toString(16).padStart(8, '0');
  const lowHex = (hashLow >>> 0).toString(16).padStart(8, '0');
  return highHex + lowHex;
}

async function computePHash(imageUrl) {
  const gray = await imageToGrayscale32x32(imageUrl);
  const dctBlock = dct2d(gray);
  return generateHash(dctBlock);
}

// ============================================
// TCGDex API Functions
// ============================================

async function fetchAllCards() {
  console.log('Fetching card list from TCGDex...');
  const response = await fetch(`${TCGDEX_API}/cards`);
  if (!response.ok) {
    throw new Error(`Failed to fetch cards: ${response.status}`);
  }
  const cards = await response.json();
  console.log(`Found ${cards.length} cards`);
  return cards;
}

function getImageUrl(card, quality = 'low') {
  // TCGDex image URL pattern
  if (card.image) {
    return `${card.image}/${quality}.png`;
  }
  return null;
}

/**
 * Save card image to disk
 * Organized by set: public/card-images/{setId}/{localId}.png
 */
async function saveCardImage(card, imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return false;

    const buffer = Buffer.from(await response.arrayBuffer());

    // Create directory structure: card-images/{set}/
    const setId = card.set?.id || card.id.split('-')[0];
    const setDir = path.join(IMAGES_DIR, setId);

    if (!fs.existsSync(setDir)) {
      fs.mkdirSync(setDir, { recursive: true });
    }

    // Save as {localId}.png
    const fileName = `${card.localId || card.id.split('-').pop()}.png`;
    const filePath = path.join(setDir, fileName);

    fs.writeFileSync(filePath, buffer);
    return true;
  } catch (error) {
    console.error(`[SAVE] Failed to save ${card.id}:`, error.message);
    return false;
  }
}

/**
 * Download high-quality image for saving (use 'high' quality for future ML training)
 */
function getHighQualityImageUrl(card) {
  if (card.image) {
    return `${card.image}/high.png`;
  }
  return null;
}

// ============================================
// Progress & Checkpoint Management
// ============================================

function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
      console.log(`Resuming from checkpoint: ${data.processed} cards processed`);
      return data;
    }
  } catch (e) {
    console.log('No valid checkpoint found, starting fresh');
  }
  return { processed: 0, hashes: [] };
}

function saveCheckpoint(processed, hashes, imagesSaved = 0) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ processed, hashes, imagesSaved }, null, 2));
}

function deleteCheckpoint() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
  }
}

// ============================================
// Main Build Process
// ============================================

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function buildHashDatabase() {
  console.log('='.repeat(50));
  console.log('SlabSense Hash Database Builder');
  console.log('='.repeat(50));

  // Show mode
  if (IMAGES_ONLY) {
    console.log('MODE: Download images only (no hashing)');
  } else if (SAVE_IMAGES) {
    console.log('MODE: Build hash DB + save images');
  } else {
    console.log('MODE: Build hash DB only');
  }

  // Load checkpoint if resuming
  let checkpoint = { processed: 0, hashes: [], imagesSaved: 0 };
  if (RESUME_MODE) {
    checkpoint = loadCheckpoint();
  }

  // Fetch all cards
  const allCards = await fetchAllCards();

  // Skip already processed cards
  const startIndex = checkpoint.processed;
  const hashes = checkpoint.hashes || [];
  const cardsToProcess = allCards.slice(startIndex);

  console.log(`\nProcessing ${cardsToProcess.length} cards (starting at index ${startIndex})`);
  console.log(`Rate limit: ${REQUESTS_PER_SECOND} requests/sec`);
  if (SAVE_IMAGES || IMAGES_ONLY) {
    console.log(`Images will be saved to: ${IMAGES_DIR}`);
  }
  console.log('');

  let processed = startIndex;
  let failed = 0;
  let imagesSaved = checkpoint.imagesSaved || 0;
  const startTime = Date.now();

  for (const card of cardsToProcess) {
    const hashImageUrl = getImageUrl(card, 'low');  // Low quality for hashing
    const saveImageUrl = getHighQualityImageUrl(card);  // High quality for saving

    if (!hashImageUrl && !saveImageUrl) {
      console.log(`[SKIP] ${card.id} - no image URL`);
      processed++;
      continue;
    }

    try {
      // Compute pHash (unless images-only mode)
      if (!IMAGES_ONLY && hashImageUrl) {
        const hash = await computePHash(hashImageUrl);

        hashes.push({
          id: card.id,
          hash: hash,
          name: card.name,
          set: card.set?.id || card.id.split('-')[0],
          number: card.localId,
        });
      }

      // Save image if requested
      if ((SAVE_IMAGES || IMAGES_ONLY) && saveImageUrl) {
        const saved = await saveCardImage(card, saveImageUrl);
        if (saved) imagesSaved++;
      }

      processed++;

      // Progress logging
      if (processed % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (processed - startIndex) / elapsed;
        const remaining = (allCards.length - processed) / rate;
        const imgStatus = (SAVE_IMAGES || IMAGES_ONLY) ? ` | ${imagesSaved} images` : '';
        console.log(
          `[${processed}/${allCards.length}] ` +
          `${card.name} | ` +
          `${rate.toFixed(1)}/sec | ` +
          `ETA: ${Math.round(remaining / 60)}min` +
          imgStatus
        );
      }

      // Checkpoint
      if (processed % CHECKPOINT_INTERVAL === 0) {
        saveCheckpoint(processed, hashes, imagesSaved);
      }

    } catch (error) {
      console.log(`[FAIL] ${card.id} - ${error.message}`);
      failed++;
    }

    // Rate limiting
    await sleep(DELAY_MS);
  }

  // Build and write hash DB (unless images-only mode)
  let sizeKB = 0;
  if (!IMAGES_ONLY) {
    const output = {
      generated: new Date().toISOString().split('T')[0],
      version: 1,
      count: hashes.length,
      cards: hashes,
    };

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write output
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));

    // Calculate file size
    const stats = fs.statSync(OUTPUT_FILE);
    sizeKB = (stats.size / 1024).toFixed(1);
  }

  console.log('\n' + '='.repeat(50));
  console.log('BUILD COMPLETE');
  console.log('='.repeat(50));
  if (!IMAGES_ONLY) {
    console.log(`Total cards hashed: ${hashes.length}`);
    console.log(`Output: ${OUTPUT_FILE}`);
    console.log(`Size: ${sizeKB} KB`);
  }
  if (SAVE_IMAGES || IMAGES_ONLY) {
    console.log(`Images saved: ${imagesSaved}`);
    console.log(`Images directory: ${IMAGES_DIR}`);
  }
  console.log(`Failed: ${failed}`);
  console.log(`Time: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);

  // Clean up checkpoint
  deleteCheckpoint();
}

// ============================================
// Entry Point
// ============================================

buildHashDatabase().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
