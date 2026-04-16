/**
 * Generate CLIP embeddings using Transformers.js
 *
 * Creates embeddings compatible with browser-based matching.
 *
 * Usage:
 *   node scripts/generate-transformers-embeddings.mjs
 */

import { pipeline, env } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..');

// Configure transformers.js
env.cacheDir = path.join(PROJECT_DIR, 'models', 'transformers-cache');
env.allowLocalModels = true;

// Paths
const CARD_IMAGES_DIR = path.join(PROJECT_DIR, 'public', 'card-images');
const HASH_DB_PATH = path.join(PROJECT_DIR, 'public', 'card-hashes.json');
const OUTPUT_PATH = path.join(PROJECT_DIR, 'models', 'clip_embeddings_tfjs.json');

/**
 * Get all card image paths from the database
 */
function getCardImagePaths() {
  const hashDb = JSON.parse(fs.readFileSync(HASH_DB_PATH, 'utf8'));
  const cardPaths = {};

  for (const card of hashDb.cards) {
    const setDir = path.join(CARD_IMAGES_DIR, card.set);

    // Try different extensions
    const extensions = ['.png', '.jpg', '.webp'];
    for (const ext of extensions) {
      const imgPath = path.join(setDir, card.number + ext);
      if (fs.existsSync(imgPath)) {
        cardPaths[card.id] = imgPath;
        break;
      }
    }
  }

  return cardPaths;
}

/**
 * Format time duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Transformers.js CLIP Embedding Generator');
  console.log('='.repeat(60));

  // Get card image paths
  console.log('\nScanning card images...');
  const cardPaths = getCardImagePaths();
  const totalCards = Object.keys(cardPaths).length;
  console.log(`Found ${totalCards} card images`);

  // Load CLIP model
  console.log('\nLoading CLIP model...');
  const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
  console.log('Model loaded!');

  // Generate embeddings
  console.log(`\nGenerating embeddings for ${totalCards} cards...`);
  console.log('This will take a while (~5-10 minutes)...\n');

  const embeddings = {};
  const errors = [];
  let processed = 0;
  const startTime = Date.now();
  const batchSize = 100; // Log progress every 100 cards

  for (const [cardId, imagePath] of Object.entries(cardPaths)) {
    try {
      const output = await extractor(imagePath, { pooling: 'mean', normalize: true });
      embeddings[cardId] = Array.from(output.data);

    } catch (err) {
      errors.push({ cardId, error: err.message });
    }

    processed++;

    // Progress update
    if (processed % batchSize === 0 || processed === totalCards) {
      const elapsed = Date.now() - startTime;
      const rate = processed / (elapsed / 1000);
      const remaining = (totalCards - processed) / rate;
      const pct = (100 * processed / totalCards).toFixed(1);

      process.stdout.write(`\rProgress: ${processed}/${totalCards} (${pct}%) - ${rate.toFixed(1)} cards/sec - ETA: ${formatDuration(remaining * 1000)}    `);
    }
  }

  console.log('\n');

  // Save embeddings
  console.log('Saving embeddings...');
  const outputData = {
    version: 2,
    model: 'Xenova/clip-vit-base-patch32',
    generator: 'transformers.js',
    embedding_dim: 512,
    count: Object.keys(embeddings).length,
    generated: new Date().toISOString(),
    embeddings,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputData));

  const fileSizeMB = fs.statSync(OUTPUT_PATH).size / (1024 * 1024);

  console.log(`\nDone!`);
  console.log(`  Embeddings: ${Object.keys(embeddings).length}`);
  console.log(`  Errors: ${errors.length}`);
  console.log(`  File size: ${fileSizeMB.toFixed(1)} MB`);
  console.log(`  Output: ${OUTPUT_PATH}`);
  console.log(`  Duration: ${formatDuration(Date.now() - startTime)}`);

  if (errors.length > 0 && errors.length < 20) {
    console.log('\nErrors:');
    for (const e of errors) {
      console.log(`  ${e.cardId}: ${e.error}`);
    }
  }
}

main().catch(console.error);
