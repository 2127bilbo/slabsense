/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * PricingPage — the purchase screen on the web (Stripe Checkout).
 * Same three products as the iOS store (src/lib/products.js): one monthly plan, two packs.
 * NativeStore replaces this screen inside the iOS app.
 */

import { useEffect, useState } from 'react';
import { getCreditsBalance } from '../../services/credits';
import { listProducts, purchase, manageSubscription } from '../../services/purchases.js';

const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', -apple-system, sans-serif";

export function PricingPage({ userId, onClose, notice = null }) {
  const [products, setProducts] = useState([]);
  const [balance, setBalance] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    try { setProducts(await listProducts()); } catch (e) { setMsg(e.message); }
    if (userId) { try { setBalance(await getCreditsBalance(userId)); } catch { /* shown as unknown */ } }
  };
  useEffect(() => { load(); }, [userId]);

  const buy = async (key) => {
    setMsg(null); setBusy(key);
    try { await purchase(key, { userId }); } // redirects to Stripe Checkout
    catch (e) { setMsg(e.message || 'Checkout could not be started.'); setBusy(null); }
  };

  const subs = products.filter((p) => p.kind === 'subscription');
  const packs = products.filter((p) => p.kind === 'consumable');
  const onPlan = balance?.subscription && !['free', 'expired', 'past_due'].includes(balance.subscription);
  const planName = subs.find((p) => p.key === balance?.subscription)?.name || (balance?.isLifetime ? 'Lifetime' : balance?.subscription);
  const renews = balance?.renewsAt ? new Date(balance.renewsAt).toLocaleDateString() : null;

  const card = { padding: 16, background: '#0d0f13', border: '1px solid #1a1c22', borderRadius: 12, marginBottom: 12 };
  const btn = (active) => ({ padding: '12px 18px', minHeight: 44, borderRadius: 10, border: 'none', background: active ? '#6366f1' : '#2a2d35', color: '#fff', fontFamily: mono, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pricing-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, overflowY: 'auto', padding: 'max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="pricing-title" style={{ fontFamily: mono, fontSize: 14, color: '#fff', margin: 0 }}>AI Grades</h2>
          <button onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44, background: 'transparent', border: '1px solid #2a2d35', borderRadius: 10, color: '#888', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontFamily: sans, fontSize: 13, color: '#aaa', lineHeight: 1.5, marginBottom: 16 }}>
          Free accounts get 10 on-device grades a month and save up to 25 cards; centering is always free. SlabSense Plus has unlimited grades, an unlimited collection and 5 AI Grades a month, starting with a 5-day free trial that includes 2. An AI Grade sends your photos for a full surface inspection and a written report. Packs add AI Grades that never expire. Grades are estimates, not official grades.
        </div>
        {notice && <div role="alert" style={{ ...card, color: '#ffcc00', fontFamily: sans, fontSize: 13 }}>{notice}</div>}
        {balance && (
          <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: '#888' }}>AI GRADES AVAILABLE</span>
            <span style={{ fontFamily: mono, fontSize: 18, color: '#00ff88' }}>{balance.isLifetime ? '∞' : balance.credits}</span>
          </div>
        )}
        {onPlan && (
          <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #00ff8833' }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 11, color: '#00ff88' }}>CURRENT PLAN</div>
              <div style={{ fontFamily: sans, fontSize: 15, color: '#fff', marginTop: 4 }}>{planName}</div>
              {renews && <div style={{ fontFamily: mono, fontSize: 11, color: '#888', marginTop: 2 }}>renews {renews}</div>}
            </div>
            {balance?.subscriptionSource !== 'apple' && !balance?.isLifetime && (
              <button disabled={!!busy} onClick={() => manageSubscription({ userId })} style={{ ...btn(false), background: 'transparent', border: '1px solid #2a2d35', color: '#aaa' }}>Manage</button>
            )}
          </div>
        )}
        {balance?.subscription === 'past_due' && (
          <div role="status" style={{ ...card, fontFamily: sans, fontSize: 13, color: '#ffcc00' }}>Your last payment did not go through. Update your card under Manage to keep your plan.</div>
        )}
        {subs.map((p) => (
          <div key={p.key} style={card}>
            <div style={{ fontFamily: sans, fontSize: 16, color: '#fff', fontWeight: 600 }}>{p.name}</div>
            <div style={{ fontFamily: sans, fontSize: 13, color: '#aaa', marginTop: 4 }}>{p.tagline}</div>
            {p.trial && <div style={{ fontFamily: sans, fontSize: 12, color: '#8b5cf6', marginTop: 4 }}>{p.trial.days}-day free trial with {p.trial.grades} AI Grades, then {p.displayPrice || 'the monthly price'} / {p.period}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span style={{ fontFamily: mono, fontSize: 14, color: '#fff' }}>{p.displayPrice} / {p.period}</span>
              <button disabled={!!busy || balance?.subscription === p.key} onClick={() => buy(p.key)} style={btn(true)}>
                {balance?.subscription === p.key ? 'Current plan' : busy === p.key ? 'Opening…' : 'Subscribe'}
              </button>
            </div>
          </div>
        ))}
        {packs.map((p) => (
          <div key={p.key} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: sans, fontSize: 15, color: '#fff', fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontFamily: sans, fontSize: 12, color: '#aaa', marginTop: 2 }}>{p.tagline}</div>
              </div>
              <button disabled={!!busy} onClick={() => buy(p.key)} aria-label={`Buy ${p.name}`} style={btn(false)}>{busy === p.key ? '…' : p.displayPrice}</button>
            </div>
          </div>
        ))}
        {msg && <div role="status" style={{ fontFamily: sans, fontSize: 13, color: '#ddd', margin: '8px 0 12px' }}>{msg}</div>}
        <div style={{ fontFamily: sans, fontSize: 11, color: '#777', lineHeight: 1.5, marginTop: 16 }}>
          One AI Grade = one credit. Plan grades renew each month and unused ones expire at the end of the period; pack grades never expire. Plans renew automatically until cancelled; cancel any time under Manage. Payments are handled by Stripe.
        </div>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#777', marginTop: 8 }}>
          <a href="/terms" target="_blank" rel="noopener" style={{ color: '#8b5cf6' }}>Terms of Use</a> · <a href="/privacy" target="_blank" rel="noopener" style={{ color: '#8b5cf6' }}>Privacy Policy</a>
        </div>
      </div>
    </div>
  );
}

export default PricingPage;
