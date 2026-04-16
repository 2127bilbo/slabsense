/**
 * Test Full CLIP Pipeline
 *
 * Tests the complete browser-compatible pipeline:
 * 1. Load raw user photo (not pre-cropped)
 * 2. Detect and crop card (JS card-detector logic)
 * 3. Compute CLIP embedding (Transformers.js)
 * 4. Match against Transformers.js-generated embeddings
 *
 * This verifies the entire flow works before browser integration.
 *
 * Usage:
 *   node scripts/test-full-pipeline.mjs <folder-with-raw-images>
 */

import { pipeline, env } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..');

// Configure transformers
env.cacheDir = path.join(PROJECT_DIR, 'models', 'transformers-cache');

// Paths
const EMBEDDINGS_PATH = path.join(PROJECT_DIR, 'models', 'clip_embeddings_tfjs.json');
const EMBEDDINGS_FALLBACK = path.join(PROJECT_DIR, 'models', 'clip_embeddings.json');
const HASH_DB_PATH = path.join(PROJECT_DIR, 'public', 'card-hashes.json');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'test-crops-js');

/**
 * Cosine similarity
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Detect and crop card using variance-based detection (mirrors JS version)
 */
async function detectAndCropCard(imagePath, options = {}) {
  const {
    maxSize = 1000,
    gridSize = 16,
    varianceThreshold = 0.12,
    minVariance = 30,
    padding = 5,
  } = options;

  // Load and resize image
  let image = sharp(imagePath);
  const metadata = await image.metadata();

  let scale = 1;
  let width = metadata.width;
  let height = metadata.height;

  if (Math.max(width, height) > maxSize) {
    scale = maxSize / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    image = image.resize(width, height);
  }

  // Get raw pixel data
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const channels = info.channels;

  // Calculate variance for grid cells
  const cellW = Math.floor(w / gridSize);
  const cellH = Math.floor(h / gridSize);
  const variances = [];
  let maxVar = 0;

  for (let gy = 0; gy < gridSize; gy++) {
    variances[gy] = [];
    for (let gx = 0; gx < gridSize; gx++) {
      const x0 = gx * cellW;
      const y0 = gy * cellH;

      let sum = 0, sumSq = 0, count = 0;

      for (let y = y0; y < y0 + cellH && y < h; y += 2) {
        for (let x = x0; x < x0 + cellW && x < w; x += 2) {
          const idx = (y * w + x) * channels;
          // Grayscale
          const v = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          sum += v;
          sumSq += v * v;
          count++;
        }
      }

      const variance = count > 0 ? (sumSq / count) - Math.pow(sum / count, 2) : 0;
      variances[gy][gx] = variance;
      if (variance > maxVar) maxVar = variance;
    }
  }

  // Find bounding box
  const threshold = Math.max(minVariance, maxVar * varianceThreshold);
  let minGX = gridSize, maxGX = -1, minGY = gridSize, maxGY = -1;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      if (variances[gy][gx] > threshold) {
        if (gx < minGX) minGX = gx;
        if (gx > maxGX) maxGX = gx;
        if (gy < minGY) minGY = gy;
        if (gy > maxGY) maxGY = gy;
      }
    }
  }

  let bounds;
  let method = 'variance';

  if (maxGX >= minGX && maxGY >= minGY) {
    const x = Math.max(0, minGX * cellW - padding);
    const y = Math.max(0, minGY * cellH - padding);
    const right = Math.min(w, (maxGX + 1) * cellW + padding);
    const bottom = Math.min(h, (maxGY + 1) * cellH + padding);

    bounds = { x, y, width: right - x, height: bottom - y };
  } else {
    // Fallback: center 80%
    bounds = {
      x: Math.floor(w * 0.1),
      y: Math.floor(h * 0.1),
      width: Math.floor(w * 0.8),
      height: Math.floor(h * 0.8),
    };
    method = 'fallback';
  }

  // Extract cropped region
  const cropped = await sharp(imagePath)
    .resize(w, h)
    .extract({
      left: bounds.x,
      top: bounds.y,
      width: bounds.width,
      height: bounds.height,
    })
    .toBuffer();

  return { buffer: cropped, bounds, method };
}

/**
 * Load embeddings
 */
function loadEmbeddings() {
  let embPath = EMBEDDINGS_PATH;
  if (!fs.existsSync(embPath)) {
    console.log('TFJS embeddings not found, using Python CLIP embeddings...');
    embPath = EMBEDDINGS_FALLBACK;
  }

  if (!fs.existsSync(embPath)) {
    throw new Error('No embeddings found! Run generate-transformers-embeddings.mjs first.');
  }

  const data = JSON.parse(fs.readFileSync(embPath, 'utf8'));
  console.log(`Loaded embeddings: ${data.count} cards (${data.model || 'unknown'})`);
  return data.embeddings;
}

/**
 * Load card info
 */
function loadCardInfo() {
  const data = JSON.parse(fs.readFileSync(HASH_DB_PATH, 'utf8'));
  const map = {};
  for (const card of data.cards) {
    map[card.id] = card;
  }
  return map;
}

/**
 * Find best matches
 */
function findMatches(embedding, embeddings, cardInfo, topK = 5) {
  const results = [];

  for (const [cardId, emb] of Object.entries(embeddings)) {
    const sim = cosineSimilarity(embedding, emb);
    const card = cardInfo[cardId] || {};
    results.push({
      id: cardId,
      name: card.name || 'Unknown',
      number: card.number || '?',
      set: card.set || '?',
      similarity: sim,
    });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

function getStatus(sim) {
  if (sim >= 0.85) return 'HIGH';
  if (sim >= 0.75) return 'MEDIUM';
  if (sim >= 0.65) return 'WEAK';
  return 'FAIL';
}

async function main() {
  // Check for sharp
  try {
    await import('sharp');
  } catch {
    console.error('sharp not installed. Run: npm install sharp');
    process.exit(1);
  }

  const testFolder = process.argv[2];
  if (!testFolder || !fs.existsSync(testFolder)) {
    console.error('Usage: node scripts/test-full-pipeline.mjs <folder-with-raw-images>');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('Full Pipeline Test (Raw Images → Crop → CLIP → Match)');
  console.log('='.repeat(80));

  // Create output dir
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  // Load data
  const embeddings = loadEmbeddings();
  const cardInfo = loadCardInfo();

  // Load CLIP model
  console.log('\nLoading CLIP model...');
  const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
  console.log('Model ready!\n');

  // Get test images
  const files = fs.readdirSync(testFolder).filter(f =>
    /\.(png|jpg|jpeg|heic)$/i.test(f)
  );

  console.log(`Found ${files.length} test images\n`);
  console.log('='.repeat(100));
  console.log(`${'Image'.padEnd(35)} | ${'Crop'.padEnd(10)} | ${'Match'.padEnd(25)} | ${'Sim'.padStart(8)} | Status`);
  console.log('='.repeat(100));

  const results = [];

  for (const file of files.sort()) {
    const imagePath = path.join(testFolder, file);

    try {
      // Step 1: Crop
      const crop = await detectAndCropCard(imagePath);

      // Save cropped image
      const cropPath = path.join(OUTPUT_DIR, file.replace(/\.[^.]+$/, '_cropped.jpg'));
      await sharp(crop.buffer).jpeg().toFile(cropPath);

      // Step 2: CLIP embedding
      const output = await extractor(cropPath, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);

      // Step 3: Match
      const matches = findMatches(embedding, embeddings, cardInfo, 5);
      const top = matches[0];
      const status = getStatus(top.similarity);

      const imgName = file.replace(/\.[^.]+$/, '').slice(0, 33);
      const matchName = `${top.name} #${top.number}`.slice(0, 23);

      console.log(`${imgName.padEnd(35)} | ${crop.method.padEnd(10)} | ${matchName.padEnd(25)} | ${top.similarity.toFixed(4).padStart(8)} | ${status}`);

      results.push({ file, crop: crop.method, top, matches, status });

    } catch (err) {
      console.log(`${file.padEnd(35)} | ERROR: ${err.message.slice(0, 50)}`);
    }
  }

  console.log('='.repeat(100));

  // Summary
  const high = results.filter(r => r.status === 'HIGH').length;
  const medium = results.filter(r => r.status === 'MEDIUM').length;
  const weak = results.filter(r => r.status === 'WEAK').length;
  const fail = results.filter(r => r.status === 'FAIL').length;

  console.log('\nSummary:');
  console.log(`  HIGH (>=0.85):   ${high.toString().padStart(3)} (${(100 * high / results.length).toFixed(1)}%)`);
  console.log(`  MEDIUM (>=0.75): ${medium.toString().padStart(3)} (${(100 * medium / results.length).toFixed(1)}%)`);
  console.log(`  WEAK (>=0.65):   ${weak.toString().padStart(3)} (${(100 * weak / results.length).toFixed(1)}%)`);
  console.log(`  FAIL (<0.65):    ${fail.toString().padStart(3)} (${(100 * fail / results.length).toFixed(1)}%)`);

  console.log(`\nCropped images saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
