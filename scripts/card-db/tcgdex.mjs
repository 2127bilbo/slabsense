/**
 * TCGDex REST helpers for the card DB scripts.
 * Shapes verified 2026-09-14:
 *   GET /v2/en/sets        → [{ id, name, logo, symbol, cardCount: { total, official } }]
 *   GET /v2/en/sets/{id}   → { id, name, releaseDate, serie: { id, name }, cardCount, cards: [{ id, localId, name, image }] }
 *   image URL = `${image}/high.png` or `${image}/low.webp`
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.tcgdex.net/v2/en';
export const POCKET_SERIES = 'tcgp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { 'user-agent': 'slabsense-card-db/1.0' } });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    await sleep(500 * (i + 1));
  }
  throw new Error(`GET ${url} failed after ${tries} tries`);
}

export async function fetchSets() {
  const sets = await getJson(`${API}/sets`);
  return sets.map((s) => ({ id: s.id, name: s.name, total: s.cardCount?.total ?? 0 }));
}

export async function fetchSet(id) {
  const s = await getJson(`${API}/sets/${encodeURIComponent(id)}`);
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    serieId: s.serie?.id ?? null,
    releaseDate: s.releaseDate ?? null,
    total: s.cardCount?.total ?? s.cards?.length ?? 0,
    cards: (s.cards || []).map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image || null })),
  };
}

/** Digital-only TCG Pocket sets share artwork with physical cards and are excluded.
 *  Set ids: A1, A1a, A2, B1, B2a ... and the P-A promo set. Card ids follow the same prefixes. */
export const isPocketSetId = (setId) => /^[AB]\d/.test(setId) || setId === 'P-A';
export const isPocketSet = (set) => set.serieId === POCKET_SERIES || isPocketSetId(set.id);

/** Downloads `${imageBase}/high.png` to destPath. Returns 'ok' | 'missing'. */
export async function downloadImage(imageBase, destPath) {
  if (!imageBase) return 'missing';
  const r = await fetch(`${imageBase}/high.png`);
  if (r.status === 404 || r.status === 403) return 'missing';
  if (!r.ok) throw new Error(`image ${imageBase}: HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(await r.arrayBuffer()));
  return 'ok';
}
