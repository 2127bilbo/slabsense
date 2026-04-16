/**
 * Split large embeddings file into chunks for Vercel deployment
 * Each chunk must be under 50MB to stay within Vercel's 100MB per-file limit
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '../public/models/clip_embeddings_tfjs.json');
const OUTPUT_DIR = path.join(__dirname, '../public/models');
const NUM_CHUNKS = 5;

console.log('Loading embeddings file...');
const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

const { embeddings, ...meta } = data;
const cardIds = Object.keys(embeddings);
const totalCards = cardIds.length;
const cardsPerChunk = Math.ceil(totalCards / NUM_CHUNKS);

console.log(`Total cards: ${totalCards}`);
console.log(`Cards per chunk: ~${cardsPerChunk}`);
console.log(`Creating ${NUM_CHUNKS} chunks...`);

for (let i = 0; i < NUM_CHUNKS; i++) {
  const start = i * cardsPerChunk;
  const end = Math.min(start + cardsPerChunk, totalCards);
  const chunkCardIds = cardIds.slice(start, end);

  const chunkEmbeddings = {};
  for (const id of chunkCardIds) {
    chunkEmbeddings[id] = embeddings[id];
  }

  const chunk = {
    ...meta,
    chunkIndex: i,
    totalChunks: NUM_CHUNKS,
    chunkCount: chunkCardIds.length,
    embeddings: chunkEmbeddings,
  };

  const outputPath = path.join(OUTPUT_DIR, `clip_embeddings_${i}.json`);
  const jsonStr = JSON.stringify(chunk);
  fs.writeFileSync(outputPath, jsonStr);

  const sizeMB = (jsonStr.length / 1024 / 1024).toFixed(2);
  console.log(`  Chunk ${i}: ${chunkCardIds.length} cards, ${sizeMB}MB`);
}

console.log('\nDone! Chunked embeddings created.');
console.log('You can now delete the original large file if chunks work.');
