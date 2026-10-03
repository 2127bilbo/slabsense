/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * PricingPage — the store on the web (Stripe Checkout and the Stripe customer portal).
 * Layout is shared with the iOS store (PlusStore.jsx); NativeStore replaces this screen inside the app.
 */

import { useEffect, useState } from 'react';
import { getCreditsBalance } from '../../services/credits';
import { listProducts, purchase, manageSubscription } from '../../services/purchases.js';
import { PlusStore } from './PlusStore.jsx';

const sans = "'Inter', -apple-system, sans-serif";

export function PricingPage({ userId, onClose, notice = null }) {
  const [products, setProducts] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(!!userId);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    (async () => {
      try { setProducts(await listProducts()); } catch (e) { setMsg(e.message); }
      if (userId) {
        try { setBalance(await getCreditsBalance(userId)); } catch { /* the plan card says it could not load */ }
        setLoadingBalance(false);
      }
    })();
  }, [userId]);

  const buy = async (key) => {
    setMsg(null); setBusy(key);
    try { await purchase(key, { userId }); } // redirects to Stripe Checkout
    catch (e) { setMsg(e.message || 'Checkout could not be started.'); setBusy(null); }
  };
  const manage = async () => {
    setMsg(null); setBusy('manage');
    try { await manageSubscription({ userId }); } // redirects to the Stripe customer portal
    catch (e) { setMsg(e.message || 'The billing page could not be opened.'); setBusy(null); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pricing-title" style={{ position: 'fixed', inset: 0, background: '#0a0b0e', zIndex: 9999, overflowY: 'auto', padding: 'max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))' }}>
      <PlusStore titleId="pricing-title" products={products} balance={balance} signedIn={!!userId} loadingBalance={loadingBalance}
        busy={busy} msg={msg} notice={notice} native={false} onBuy={buy} onManage={manage} onClose={onClose}>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#777', lineHeight: 1.5, marginTop: 12 }}>
          One AI Grade is one credit. Plan grades renew each month and unused ones expire at the end of the period; pack grades never expire. Plus renews automatically until cancelled; cancel any time under Manage. Payments are handled by Stripe.
        </div>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#777', marginTop: 8 }}>
          <a href="/terms" target="_blank" rel="noopener" style={{ color: '#a78bfa' }}>Terms of Use</a> · <a href="/privacy" target="_blank" rel="noopener" style={{ color: '#a78bfa' }}>Privacy Policy</a>
        </div>
      </PlusStore>
    </div>
  );
}

export default PricingPage;
