/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * ============================================================================
 * PURCHASES — purchases.js
 * ============================================================================
 * The one place the app buys things. On the web it is Stripe (checkout redirect, portal);
 * in the iOS app it is Apple in-app purchase through the native StoreKit bridge, verified
 * by our API (api/apple.js) before any credit lands. The UI never imports Stripe or
 * StoreKit directly (audit A-01, A-02, B-01, I-01; Apple 3.1.1 / 3.1.3(b)).
 *
 * Native bridge contract (installed in fix group 3f, Capacitor):
 *   window.SlabSenseStore = {
 *     getProducts(ids: string[]) -> [{ id, displayPrice, title, description }]
 *     purchase(id, appAccountToken) -> { signedTransaction }   // StoreKit 2 JWS
 *     restore() -> { signedTransactions: string[] }
 *     manageSubscriptions() -> void
 *   }
 * ============================================================================
 */
import { supabase } from './supabase.js';
import { isNativeApp } from '../lib/platform.js';
import { PRODUCTS } from '../lib/products.js';
import { createCheckout, openCustomerPortal } from './credits.js';

const API_BASE = import.meta.env.VITE_API_BASE || '';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in first');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}
function bridge() {
  const b = globalThis.SlabSenseStore;
  if (!b) throw new Error('In-app purchases are not available in this build');
  return b;
}

/** 'apple' in the iOS app, 'stripe' on the web. */
export function purchaseChannel() { return isNativeApp() ? 'apple' : 'stripe'; }

/** Catalogue with live prices where the platform can supply them. */
export async function listProducts() {
  const entries = Object.entries(PRODUCTS).map(([key, p]) => ({ key, ...p, displayPrice: null }));
  if (!isNativeApp()) return entries.map((e) => ({ ...e, displayPrice: `$${e.webPrice.toFixed(2)}` }));
  try {
    const live = await bridge().getProducts(entries.map((e) => e.appleId));
    const byId = Object.fromEntries((live || []).map((p) => [p.id, p]));
    return entries.map((e) => ({ ...e, displayPrice: byId[e.appleId]?.displayPrice || null, available: Boolean(byId[e.appleId]) }));
  } catch (e) {
    console.warn('[purchases] product lookup failed:', e?.message || e);
    return entries.map((e) => ({ ...e, displayPrice: null, available: false }));
  }
}

/**
 * Buy a catalogue product. Web: redirects to Stripe Checkout. Native: StoreKit purchase,
 * then the signed transaction goes to our API, which grants the credits.
 */
export async function purchase(productKey, { userId, quantity = 1 } = {}) {
  const p = PRODUCTS[productKey];
  if (!p) throw new Error(`Unknown product ${productKey}`);
  if (!isNativeApp()) {
    const { url } = await createCheckout(userId, p.stripeKey, quantity);
    window.location.href = url;
    return { channel: 'stripe' };
  }
  const { signedTransaction } = await bridge().purchase(p.appleId, userId);
  if (!signedTransaction) throw new Error('Purchase was not completed');
  const res = await fetch(`${API_BASE}/api/apple?action=verify`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ signedTransaction }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Purchase could not be verified');
  return { channel: 'apple', ...data };
}

/** Restore purchases on this Apple ID (required by Apple 3.1.2). No-op on the web. */
export async function restorePurchases() {
  if (!isNativeApp()) return { channel: 'stripe', count: 0 };
  const { signedTransactions } = await bridge().restore();
  const res = await fetch(`${API_BASE}/api/apple?action=restore`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ signedTransactions: signedTransactions || [] }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Restore failed');
  return { channel: 'apple', ...data };
}

/** Manage or cancel: Apple's subscription settings in the app, Stripe's portal on the web. */
export async function manageSubscription({ userId } = {}) {
  if (!isNativeApp()) return openCustomerPortal(userId);
  try { bridge().manageSubscriptions(); } catch { window.open('https://apps.apple.com/account/subscriptions', '_blank', 'noopener'); }
}
