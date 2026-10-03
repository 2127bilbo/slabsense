/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * NativeStore — the store inside the iOS app (Apple in-app purchase).
 * Replaces PricingPage when isNativeApp(): no Stripe, no USD strings of our own (prices come
 * from StoreKit), Apple's subscription disclosure, Restore Purchases and Manage Subscription
 * (Apple guidelines 3.1.1, 3.1.2, 3.1.3(b); audit I-01, I-02, I-12, K-12).
 * Layout is shared with the web store (PlusStore.jsx).
 */
import { useEffect, useState } from 'react';
import { listProducts, purchase, restorePurchases, manageSubscription } from '../../services/purchases.js';
import { getCreditsBalance } from '../../services/credits.js';
import { APPLE_SUBSCRIPTION_TERMS } from '../../lib/products.js';
import { PlusStore } from './PlusStore.jsx';

const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', -apple-system, sans-serif";

export function NativeStore({ userId, onClose, notice = null }) {
  const [products, setProducts] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(!!userId);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    try { setProducts(await listProducts()); } catch (e) { setMsg(e.message); }
    if (userId) {
      try { setBalance(await getCreditsBalance(userId)); } catch { /* the plan card says it could not load */ }
      setLoadingBalance(false);
    }
  };
  useEffect(() => { load(); }, [userId]);

  const buy = async (key) => {
    setMsg(null); setBusy(key);
    try { await purchase(key, { userId }); setMsg('Thank you. Your purchase is ready.'); await load(); }
    catch (e) { setMsg(e.message || 'The purchase did not complete.'); }
    finally { setBusy(null); }
  };
  const restore = async () => {
    setMsg(null); setBusy('restore');
    try { const r = await restorePurchases(); setMsg(r.count ? `Restored ${r.count} purchase${r.count === 1 ? '' : 's'}.` : 'No purchases to restore on this Apple ID.'); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(null); }
  };
  const manage = () => manageSubscription({ userId });

  const ghost = { flex: 1, minHeight: 44, padding: '12px 14px', borderRadius: 10, background: 'transparent', border: '1px solid #2a2d35', color: '#aaa', fontFamily: mono, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="store-title" style={{ position: 'fixed', inset: 0, background: '#0a0b0e', zIndex: 1000, overflowY: 'auto', padding: 'max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))' }}>
      <PlusStore titleId="store-title" products={products} balance={balance} signedIn={!!userId} loadingBalance={loadingBalance}
        busy={busy} msg={msg} notice={notice} native onBuy={buy} onManage={manage} onClose={onClose}>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button disabled={!!busy} onClick={restore} style={ghost}>Restore Purchases</button>
          <button disabled={!!busy} onClick={manage} style={ghost}>Manage Subscription</button>
        </div>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#777', lineHeight: 1.5, marginTop: 16 }}>{APPLE_SUBSCRIPTION_TERMS}</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#777', marginTop: 8 }}>
          <a href="/terms" target="_blank" rel="noopener" style={{ color: '#a78bfa' }}>Terms of Use</a> · <a href="/privacy" target="_blank" rel="noopener" style={{ color: '#a78bfa' }}>Privacy Policy</a>
        </div>
      </PlusStore>
    </div>
  );
}
