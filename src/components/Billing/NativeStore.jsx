/**
 * NativeStore — the purchase screen inside the iOS app (Apple in-app purchase).
 * Replaces PricingPage when isNativeApp(): no Stripe, no USD strings of our own (prices come
 * from StoreKit), Apple's subscription disclosure, Restore Purchases and Manage Subscription
 * (Apple guidelines 3.1.1, 3.1.2, 3.1.3(b); audit I-01, I-02, I-12, K-12).
 */
import { useEffect, useState } from 'react';
import { listProducts, purchase, restorePurchases, manageSubscription } from '../../services/purchases.js';
import { getCreditsBalance } from '../../services/credits.js';
import { APPLE_SUBSCRIPTION_TERMS } from '../../lib/products.js';

const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', -apple-system, sans-serif";

export function NativeStore({ userId, onClose }) {
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
    try { await purchase(key, { userId }); setMsg('Thank you. Your AI Grades are ready.'); await load(); }
    catch (e) { setMsg(e.message || 'The purchase did not complete.'); }
    finally { setBusy(null); }
  };
  const restore = async () => {
    setMsg(null); setBusy('restore');
    try { const r = await restorePurchases(); setMsg(r.count ? `Restored ${r.count} purchase${r.count === 1 ? '' : 's'}.` : 'No purchases to restore on this Apple ID.'); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(null); }
  };

  const card = { padding: 16, background: '#0d0f13', border: '1px solid #1a1c22', borderRadius: 12, marginBottom: 12 };
  const btn = (active) => ({ padding: '12px 18px', minHeight: 44, borderRadius: 10, border: 'none', background: active ? '#6366f1' : '#2a2d35', color: '#fff', fontFamily: mono, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 });
  const subs = products.filter((p) => p.kind === 'subscription');
  const packs = products.filter((p) => p.kind === 'consumable');

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="store-title" style={{ position: 'fixed', inset: 0, background: '#0a0b0e', zIndex: 1000, overflowY: 'auto', padding: 'max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="store-title" style={{ fontFamily: mono, fontSize: 14, color: '#fff', margin: 0 }}>AI Grades</h2>
          <button onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44, background: 'transparent', border: '1px solid #2a2d35', borderRadius: 10, color: '#888', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontFamily: sans, fontSize: 13, color: '#aaa', lineHeight: 1.5, marginBottom: 16 }}>
          An AI Grade sends your card photos for a full surface inspection and a written report. The free grade (corners, edges and centering) stays free. Grades are estimates, not official grades.
        </div>
        {balance && (
          <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: '#888' }}>AI GRADES AVAILABLE</span>
            <span style={{ fontFamily: mono, fontSize: 18, color: '#00ff88' }}>{balance.isLifetime ? '∞' : balance.credits}</span>
          </div>
        )}
        {subs.map((p) => (
          <div key={p.key} style={card}>
            <div style={{ fontFamily: sans, fontSize: 16, color: '#fff', fontWeight: 600 }}>{p.name}</div>
            <div style={{ fontFamily: sans, fontSize: 13, color: '#aaa', marginTop: 4 }}>{p.tagline}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span style={{ fontFamily: mono, fontSize: 14, color: '#fff' }}>{p.displayPrice ? `${p.displayPrice} / ${p.period}` : 'Price unavailable'}</span>
              <button disabled={!!busy || p.available === false} onClick={() => buy(p.key)} style={btn(true)}>{busy === p.key ? 'Purchasing…' : 'Subscribe'}</button>
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
              <button disabled={!!busy || p.available === false} onClick={() => buy(p.key)} aria-label={`Buy ${p.name}`} style={btn(false)}>{busy === p.key ? '…' : (p.displayPrice || 'Buy')}</button>
            </div>
          </div>
        ))}
        {msg && <div role="status" style={{ fontFamily: sans, fontSize: 13, color: '#ddd', margin: '8px 0 12px' }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button disabled={!!busy} onClick={restore} style={{ ...btn(false), flex: 1, background: 'transparent', border: '1px solid #2a2d35', color: '#aaa' }}>Restore Purchases</button>
          <button disabled={!!busy} onClick={() => manageSubscription({ userId })} style={{ ...btn(false), flex: 1, background: 'transparent', border: '1px solid #2a2d35', color: '#aaa' }}>Manage Subscription</button>
        </div>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#777', lineHeight: 1.5, marginTop: 16 }}>{APPLE_SUBSCRIPTION_TERMS}</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: '#777', marginTop: 8 }}>
          <a href="/terms" target="_blank" rel="noopener" style={{ color: '#8b5cf6' }}>Terms of Use</a> · <a href="/privacy" target="_blank" rel="noopener" style={{ color: '#8b5cf6' }}>Privacy Policy</a>
        </div>
      </div>
    </div>
  );
}
