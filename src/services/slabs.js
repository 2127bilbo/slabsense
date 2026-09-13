/**
 * Slabbing orders — client side. The cert is minted by the Stripe webhook; the app only starts
 * Checkout and reads the resulting row (owner-only via RLS).
 */
import { supabase, isSupabaseConfigured } from './supabase.js';

const API_BASE = import.meta.env.PROD ? '' : '';

export const SLAB_STATUS_TEXT = {
  paid: 'Paid — awaiting engraving',
  engraved: 'Engraved — awaiting shipping',
  shipped: 'Shipped',
};

export async function orderSlab(userId, scanId) {
  const response = await fetch(`${API_BASE}/api/stripe/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId, scanId, priceKey: 'slab',
      successUrl: `${window.location.origin}/?slab_ordered=1`,
      cancelUrl: `${window.location.origin}/?slab_canceled=1`,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to start slab checkout');
  return data;
}

export async function getSlabForScan(scanId) {
  if (!isSupabaseConfigured() || !scanId) return null;
  const { data, error } = await supabase
    .from('slabs').select('cert, status, paid_at, engraved_at, shipped_at')
    .eq('scan_id', scanId).order('paid_at', { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error('[Slabs] lookup failed:', error); return null; }
  return data;
}

export function certUrl(cert) { return `${window.location.origin}/v/${cert}`; }
