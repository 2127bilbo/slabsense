/**
 * Card Matcher - Searches hash database for matching cards
 *
 * Loads pre-computed pHash database and finds cards by Hamming distance.
 * Uses IndexedDB for persistent caching.
 */

import { hammingDistance } from './phash.js';

// In-memory cache
let hashDb = null;
let hashDbMeta = null;

// IndexedDB setup
const DB_NAME = 'SlabSenseHashDB';
const DB_VERSION = 1;
const STORE_NAME = 'hashData';

/**
 * Open IndexedDB connection
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Get data from IndexedDB
 */
async function getFromIDB(key) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.data);
    });
  } catch (e) {
    console.warn('[CardMatcher] IndexedDB unavailable:', e);
    return null;
  }
}

/**
 * Save data to IndexedDB
 */
async function saveToIDB(key, data) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put({ key, data });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (e) {
    console.warn('[CardMatcher] IndexedDB save failed:', e);
  }
}

/**
 * Load hash database from cache or network
 * @param {boolean} forceRefresh - Skip cache and fetch fresh
 * @returns {Promise<object>} Hash database object
 */
export async function loadHashDb(forceRefresh = false) {
  // Return memory cache if available
  if (hashDb && !forceRefresh) {
    return { cards: hashDb, meta: hashDbMeta };
  }

  // Try IndexedDB cache
  if (!forceRefresh) {
    const cached = await getFromIDB('hashDb');
    if (cached) {
      console.log('[CardMatcher] Loaded from IndexedDB cache');
      hashDb = cached.cards;
      hashDbMeta = { generated: cached.generated, version: cached.version, count: cached.count };
      return { cards: hashDb, meta: hashDbMeta };
    }
  }

  // Fetch from network
  console.log('[CardMatcher] Fetching hash database...');
  const startTime = performance.now();

  try {
    const response = await fetch('/card-hashes.json');
    if (!response.ok) {
      throw new Error(`Failed to load hash DB: ${response.status}`);
    }

    const data = await response.json();
    const elapsed = performance.now() - startTime;

    console.log(`[CardMatcher] Loaded ${data.count} cards in ${elapsed.toFixed(0)}ms`);

    // Cache in memory
    hashDb = data.cards;
    hashDbMeta = { generated: data.generated, version: data.version, count: data.count };

    // Cache in IndexedDB
    await saveToIDB('hashDb', data);

    return { cards: hashDb, meta: hashDbMeta };
  } catch (error) {
    console.error('[CardMatcher] Failed to load hash DB:', error);
    throw error;
  }
}

/**
 * Get hash database metadata (for checking updates)
 */
export function getHashDbMeta() {
  return hashDbMeta;
}

/**
 * Confidence levels based on Hamming distance
 * Note: pHash is 64-bit, so max distance is 64
 * Thresholds tuned for holo/foil cards which have more variance
 */
const CONFIDENCE_THRESHOLDS = {
  HIGH: 8,       // distance <= 8: very likely correct match (loosened for holo)
  MEDIUM: 16,    // distance 9-16: show options for user to pick
  // distance > 16: low confidence, go to manual search
};

/**
 * Determine confidence level from Hamming distance
 */
function getConfidence(distance) {
  if (distance <= CONFIDENCE_THRESHOLDS.HIGH) return 'high';
  if (distance <= CONFIDENCE_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Find matching cards by pHash
 *
 * @param {string} queryHash - 16-char hex hash of query image
 * @param {object[]} cards - Array of {id, hash, name, set, number} from DB
 * @param {number} topN - Number of top matches to return
 * @returns {object[]} Matches sorted by distance (ascending)
 */
export function findMatches(queryHash, cards, topN = 5) {
  const startTime = performance.now();

  // Calculate distance for all cards
  const matches = cards.map(card => ({
    id: card.id,
    name: card.name,
    set: card.set,
    number: card.number,
    hash: card.hash,
    distance: hammingDistance(queryHash, card.hash),
  }));

  // Sort by distance (ascending)
  matches.sort((a, b) => a.distance - b.distance);

  // Take top N and add confidence
  const topMatches = matches.slice(0, topN).map(match => ({
    ...match,
    confidence: getConfidence(match.distance),
  }));

  const elapsed = performance.now() - startTime;
  console.log(`[CardMatcher] Searched ${cards.length} cards in ${elapsed.toFixed(1)}ms`);
  console.log(`[CardMatcher] Top match: ${topMatches[0]?.name} (distance: ${topMatches[0]?.distance})`);

  return topMatches;
}

/**
 * Group matches by unique artwork (for reprint handling)
 *
 * When multiple cards have the same/similar hash (reprints with same art),
 * group them so user sees "Charizard (5 versions)" instead of 5 separate entries.
 *
 * @param {object[]} matches - Array of match objects
 * @param {number} groupThreshold - Max distance difference to consider same artwork
 * @returns {object[]} Grouped matches
 */
export function groupByArtwork(matches, groupThreshold = 3) {
  if (matches.length === 0) return [];

  const groups = [];
  const used = new Set();

  for (const match of matches) {
    if (used.has(match.id)) continue;

    // Find all cards with similar distance (likely same artwork)
    const group = matches.filter(m =>
      !used.has(m.id) &&
      Math.abs(m.distance - match.distance) <= groupThreshold &&
      m.name.toLowerCase() === match.name.toLowerCase()
    );

    group.forEach(m => used.add(m.id));

    if (group.length > 0) {
      groups.push({
        name: match.name,
        distance: match.distance,
        confidence: match.confidence,
        primaryCard: group[0],
        variants: group,
        variantCount: group.length,
      });
    }
  }

  return groups;
}

/**
 * Full match pipeline
 *
 * @param {string} queryHash - pHash of captured card
 * @param {object} options - { topN, groupResults }
 * @returns {Promise<object>} Match results with status
 */
export async function matchCard(queryHash, options = {}) {
  const { topN = 20, groupResults = true } = options;

  // Load hash database
  const { cards, meta } = await loadHashDb();

  if (!cards || cards.length === 0) {
    return {
      status: 'error',
      error: 'Hash database not loaded',
      matches: [],
    };
  }

  // Find matches
  const matches = findMatches(queryHash, cards, topN);

  if (matches.length === 0) {
    return {
      status: 'unknown',
      matches: [],
      dbMeta: meta,
    };
  }

  // Group by artwork if requested
  const results = groupResults ? groupByArtwork(matches) : matches;
  const topResult = results[0];

  // Determine status based on top match confidence
  let status;
  if (topResult.confidence === 'high') {
    status = 'matched';
  } else if (topResult.confidence === 'medium') {
    status = 'ambiguous';
  } else {
    status = 'unknown';
  }

  return {
    status,
    confidence: topResult.confidence,
    topMatch: topResult,
    matches: results,
    rawMatches: matches,
    dbMeta: meta,
  };
}

export default {
  loadHashDb,
  getHashDbMeta,
  findMatches,
  groupByArtwork,
  matchCard,
};
