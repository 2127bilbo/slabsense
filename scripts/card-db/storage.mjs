/** Supabase Storage helpers for the `card-db` bucket (service role for writes, public URL for reads). */
import { createClient } from '@supabase/supabase-js';

export const BUCKET = 'card-db';
const url = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

export function publicUrl(p) {
  return `${url()}/storage/v1/object/public/${BUCKET}/${p}`;
}

export function getClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url() || !key) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url(), key, { auth: { persistSession: false } });
}

/**
 * Cache policy: shards are immutable (addressed by id, never rewritten) → cache for a year.
 * The manifest changes on every publish → 60 s, and the client also cache-busts it with a
 * query string so a stale CDN copy can never point at removed shards.
 */
const cacheControlFor = (p) => (p === 'manifest.json' ? '60' : '31536000');

export async function uploadFile(p, body, contentType) {
  const { error } = await getClient().storage.from(BUCKET).upload(p, body, { contentType, upsert: true, cacheControl: cacheControlFor(p) });
  if (error) throw new Error(`upload ${p}: ${error.message}`);
}

/** Returns the manifest object, or null when the bucket has none yet. */
export async function fetchManifest() {
  const r = await fetch(publicUrl('manifest.json') + `?t=${Date.now()}`);
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
  return r.json();
}
