/**
 * TCGDex Service for Pokemon Card Data
 *
 * Fetches card information and images from the free TCGDex API.
 * https://tcgdex.dev
 */

import TCGdex from '@tcgdex/sdk';

// Initialize SDK with English language
const tcgdex = new TCGdex('en');

// Cache for sets (they don't change often)
let setsCache = null;
let setsCacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Get all available sets
 */
export async function getAllSets() {
  const now = Date.now();
  if (setsCache && now - setsCacheTime < CACHE_DURATION) {
    return setsCache;
  }

  try {
    const sets = await tcgdex.set.list();
    setsCache = sets;
    setsCacheTime = now;
    return sets;
  } catch (error) {
    console.error('Failed to fetch sets:', error);
    return [];
  }
}

/**
 * Search for cards by name using TCGDex server-side search
 * Returns brief card objects for quick display
 */
export async function searchCardsByName(name, limit = 20) {
  if (!name || name.length < 2) return [];

  try {
    // Use direct API call with server-side filtering (much faster than fetching all cards)
    const searchTerm = encodeURIComponent(name.trim());
    const response = await fetch(`https://api.tcgdex.net/v2/en/cards?name=like:${searchTerm}`);

    if (!response.ok) {
      console.error('TCGDex search failed:', response.status);
      return [];
    }

    const cards = await response.json();
    console.log(`[TCGDex] Found ${cards.length} cards matching "${name}"`);

    // Return top matches with image URLs
    return cards.slice(0, limit).map(card => ({
      id: card.id,
      name: card.name,
      localId: card.localId,
      image: card.image,
      set: card.set,
    }));
  } catch (error) {
    console.error('Card search error:', error);
    return [];
  }
}

/**
 * Search for card by set number
 * More precise than name search
 */
export async function searchBySetNumber(localId, setId = null) {
  if (!localId) return [];

  try {
    if (setId) {
      // If we know the set, get the specific card
      const cardId = `${setId}-${localId}`;
      const card = await tcgdex.card.get(cardId);
      return card ? [card] : [];
    }

    // Search by localId using API (don't fetch entire catalog)
    const response = await fetch(`https://api.tcgdex.net/v2/en/cards?localId=${encodeURIComponent(localId)}`);
    if (!response.ok) return [];

    const cards = await response.json();
    return cards.map(card => ({
      id: card.id,
      name: card.name,
      localId: card.localId,
      image: card.image,
      set: card.set,
    }));
  } catch (error) {
    console.error('Set number search error:', error);
    return [];
  }
}

/**
 * Get full card details by ID
 */
export async function getCard(cardId) {
  try {
    const card = await tcgdex.card.get(cardId);
    return card;
  } catch (error) {
    console.error('Get card error:', error);
    return null;
  }
}

/**
 * Get card image URL
 * @param {string} cardId - Card ID (e.g., "base1-4")
 * @param {string} quality - 'high' or 'low'
 * @param {string} format - 'png' or 'webp'
 */
export function getCardImageUrl(cardId, quality = 'high', format = 'png') {
  // Parse card ID to construct URL
  // Format: setId-localId (e.g., "base1-4" or "swsh3-136")
  const parts = cardId.split('-');
  if (parts.length < 2) return null;

  const localId = parts.pop();
  const setId = parts.join('-');

  // Determine series from set ID
  // Common patterns: base1, swsh3, sv08, etc.
  let series = 'unknown';
  if (setId.startsWith('base') || setId.startsWith('gym') || setId.startsWith('neo')) {
    series = 'base';
  } else if (setId.startsWith('swsh')) {
    series = 'swsh';
  } else if (setId.startsWith('sv')) {
    series = 'sv';
  } else if (setId.startsWith('sm')) {
    series = 'sm';
  } else if (setId.startsWith('xy')) {
    series = 'xy';
  } else if (setId.startsWith('bw')) {
    series = 'bw';
  } else if (setId.startsWith('dp') || setId.startsWith('pl')) {
    series = 'dp';
  } else if (setId.startsWith('ex')) {
    series = 'ex';
  }

  return `https://assets.tcgdex.net/en/${series}/${setId}/${localId}/${quality}.${format}`;
}

/**
 * Get card image URL directly from card object
 */
export function getImageUrlFromCard(card, quality = 'high', format = 'png') {
  if (!card?.image) return null;
  return `${card.image}/${quality}.${format}`;
}

/**
 * Smart search - combines name and set number for best match
 */
export async function smartSearch(ocrResults) {
  const { name, localId, setTotal, hp } = ocrResults;
  let candidates = [];

  try {
    // Strategy 1: If we have a local ID, find cards with that number
    if (localId) {
      const byNumber = await searchBySetNumber(localId);
      candidates = [...byNumber];
    }

    // Strategy 2: Search by name
    if (name && name.length >= 3) {
      const byName = await searchCardsByName(name);
      candidates = [...candidates, ...byName];
    }

    // Deduplicate by card ID
    const seen = new Set();
    candidates = candidates.filter(card => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    });

    // Score and rank candidates
    const scored = candidates.map(card => {
      let score = 0;

      // Name match (most important)
      if (name && card.name) {
        const nameLower = name.toLowerCase();
        const cardNameLower = card.name.toLowerCase();
        if (cardNameLower === nameLower) score += 100;
        else if (cardNameLower.includes(nameLower)) score += 50;
        else if (nameLower.includes(cardNameLower)) score += 30;
      }

      // Local ID match
      if (localId && card.localId === localId.toString()) {
        score += 40;
      }

      // Set total match (if we detected it)
      if (setTotal && card.set?.cardCount?.total === parseInt(setTotal)) {
        score += 30;
      }

      // HP match
      if (hp && card.hp === hp) {
        score += 20;
      }

      return { ...card, matchScore: score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.matchScore - a.matchScore);

    return scored.slice(0, 10);
  } catch (error) {
    console.error('Smart search error:', error);
    return [];
  }
}

/**
 * Get full card data with image URLs
 */
export async function getFullCardData(cardId) {
  try {
    const card = await tcgdex.card.get(cardId);
    if (!card) return null;

    return {
      id: card.id,
      name: card.name,
      localId: card.localId,
      set: {
        id: card.set?.id,
        name: card.set?.name,
        logo: card.set?.logo,
        total: card.set?.cardCount?.total,
      },
      rarity: card.rarity,
      hp: card.hp,
      types: card.types,
      illustrator: card.illustrator,
      stage: card.stage,
      evolveFrom: card.evolveFrom,
      attacks: card.attacks,
      weaknesses: card.weaknesses,
      resistances: card.resistances,
      retreat: card.retreat,
      // Image URLs
      imageHigh: getImageUrlFromCard(card, 'high', 'png'),
      imageLow: getImageUrlFromCard(card, 'low', 'png'),
      imageHighWebp: getImageUrlFromCard(card, 'high', 'webp'),
      // Pricing if available
      pricing: card.pricing,
      // For our card info format
      cardInfo: {
        name: card.name,
        setName: card.set?.name,
        cardNumber: card.localId,
        year: extractYearFromSet(card.set?.id),
        rarity: card.rarity,
        hp: card.hp,
        // Cardmarket pricing (EUR)
        pricing: card.pricing ? {
          avg: card.pricing.averageSellPrice || card.pricing.avg || null,
          low: card.pricing.lowPrice || card.pricing.low || null,
          trend: card.pricing.trendPrice || card.pricing.trend || null,
          avg1: card.pricing.avg1 || null,
          avg7: card.pricing.avg7 || null,
          avg30: card.pricing.avg30 || null,
        } : null,
      },
    };
  } catch (error) {
    console.error('Get full card data error:', error);
    return null;
  }
}

/**
 * Extract approximate year from set ID
 */
function extractYearFromSet(setId) {
  if (!setId) return null;

  // Map set prefixes to approximate years
  const yearMap = {
    'sv': 2023, // Scarlet & Violet
    'swsh': 2020, // Sword & Shield
    'sm': 2017, // Sun & Moon
    'xy': 2014, // XY
    'bw': 2011, // Black & White
    'hgss': 2010, // HeartGold SoulSilver
    'pl': 2009, // Platinum
    'dp': 2007, // Diamond & Pearl
    'ex': 2003, // EX series
    'neo': 2000, // Neo series
    'gym': 2000, // Gym series
    'base': 1999, // Base Set era
  };

  for (const [prefix, year] of Object.entries(yearMap)) {
    if (setId.startsWith(prefix)) {
      return year.toString();
    }
  }

  return null;
}

export default {
  getAllSets,
  searchCardsByName,
  searchBySetNumber,
  getCard,
  getCardImageUrl,
  getImageUrlFromCard,
  smartSearch,
  getFullCardData,
};
