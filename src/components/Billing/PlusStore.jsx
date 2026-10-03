/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * PlusStore — the store's shared layout: the account's plan, the SlabSense Plus offer and the
 * AI Grade packs. PricingPage (web, Stripe) and NativeStore (iOS, Apple) wrap it and supply the
 * purchase calls and their own footer (Apple's disclosure and Restore on iOS).
 * Every line here must be true of the product: no claims the app does not deliver.
 */
import { useRef } from 'react';
import { PlanCard } from './PlanCard.jsx';
import { plusOffer } from '../../lib/plan-summary.js';
import { FREE_TIER } from '../../lib/products.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";
const GOLD = '#d9b56a';

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="9" cy="9" r="9" fill="rgba(217,181,106,0.16)" />
      <path d="M5.2 9.3l2.4 2.4 5-5.2" stroke={GOLD} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusStore({ titleId, products, balance, signedIn, loadingBalance, busy, msg, notice, native, onBuy, onManage, onClose, children }) {
  const plusRef = useRef(null);
  const packsRef = useRef(null);
  const go = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const plus = products.find((p) => p.kind === 'subscription');
  const packs = products.filter((p) => p.kind === 'consumable');
  const offer = plusOffer(balance);
  const priceLine = plus?.displayPrice ? `${plus.displayPrice} / ${plus.period}` : native ? 'Price unavailable' : '';
  const buyBtn = (primary) => ({ minHeight: 44, padding: '12px 18px', borderRadius: 10, border: primary ? 'none' : '1px solid #2a2d35', cursor: 'pointer',
    background: primary ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#16181d', color: '#fff', fontFamily: mono, fontSize: 12, fontWeight: 600, opacity: busy ? 0.6 : 1 });

  const features = plus ? [
    ['Unlimited grades', `Free accounts get ${FREE_TIER.gradesPerMonth} a month.`],
    [`${plus.allowance} AI Grades every month`, 'Each one inspects the full-resolution photos for surface wear and writes a report. Unused ones end with the month.'],
    ['Unlimited saved cards', `Free accounts save up to ${FREE_TIER.collectionLimit}.`],
  ] : [];

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 id={titleId} style={{ fontFamily: sans, fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>SlabSense Plus</h2>
        <button onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44, background: 'transparent', border: '1px solid #2a2d35', borderRadius: 10, color: '#888', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>

      {signedIn && (
        <PlanCard balance={balance} loading={loadingBalance} native={native} onPlus={() => go(plusRef)} onPacks={() => go(packsRef)} onManage={onManage} style={{ marginBottom: 16 }} />
      )}
      {notice && <div role="alert" style={{ padding: 14, marginBottom: 16, borderRadius: 12, background: 'rgba(255,204,0,0.08)', border: '1px solid rgba(255,204,0,0.3)', color: '#ffcc00', fontFamily: sans, fontSize: 13, lineHeight: 1.45 }}>{notice}</div>}

      {plus && (
        <div ref={plusRef} style={{ padding: 1.5, borderRadius: 16, background: `linear-gradient(140deg,#8b5cf6 0%,#6366f1 40%,${GOLD} 100%)`, marginBottom: 20, scrollMarginTop: 16 }}>
          <div style={{ padding: 18, borderRadius: 14.5, background: 'linear-gradient(180deg,#14121d 0%,#0d0f13 60%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 700, color: '#fff' }}>{plus.name}</div>
                <div style={{ fontFamily: mono, fontSize: 14, color: '#ddd', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{priceLine}</div>
              </div>
              {offer.trial && <span style={{ flexShrink: 0, padding: '5px 9px', borderRadius: 999, background: 'rgba(217,181,106,0.14)', border: `1px solid ${GOLD}55`, color: GOLD, fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>{plus.trial.days}-DAY FREE TRIAL</span>}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'grid', gap: 12 }}>
              {features.map(([title, sub]) => (
                <li key={title} style={{ display: 'flex', gap: 10 }}>
                  <Check />
                  <div>
                    <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: '#fff' }}>{title}</div>
                    <div style={{ fontFamily: sans, fontSize: 12, color: '#999', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
                  </div>
                </li>
              ))}
            </ul>
            {offer.trial && (
              <div style={{ fontFamily: sans, fontSize: 12, color: '#bbb', marginTop: 16, lineHeight: 1.45 }}>
                Try it free for {plus.trial.days} days with {plus.trial.grades} AI Grades, then {plus.displayPrice || 'the monthly price'} a {plus.period}. Cancel any time before the trial ends and you will not be charged.
              </div>
            )}
            <button disabled={!!busy || offer.current || plus.available === false} onClick={() => onBuy(plus.key)}
              style={{ ...buyBtn(!offer.current), width: '100%', marginTop: 16, fontSize: 13, ...(offer.current ? { cursor: 'default', opacity: 0.7 } : {}) }}>
              {busy === plus.key ? (native ? 'Purchasing…' : 'Opening…') : offer.cta}
            </button>
          </div>
        </div>
      )}

      <div ref={packsRef} style={{ scrollMarginTop: 16 }}>
        <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', color: '#888' }}>AI GRADE PACKS</div>
        <div style={{ fontFamily: sans, fontSize: 12, color: '#999', margin: '4px 0 10px', lineHeight: 1.45 }}>Extra AI Grades that never expire, with or without Plus. Plan grades are used first.</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {packs.map((p) => {
            const each = !native && p.webPrice && p.credits ? `$${(p.webPrice / p.credits).toFixed(2)} each` : null;
            return (
              <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 14, background: '#0d0f13', border: '1px solid #1a1c22', borderRadius: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: sans, fontSize: 15, fontWeight: 600, color: '#fff' }}>{p.name}</div>
                  <div style={{ fontFamily: sans, fontSize: 12, color: '#999', marginTop: 2 }}>{[p.tagline, each].filter(Boolean).join(' · ')}</div>
                </div>
                <button disabled={!!busy || p.available === false} onClick={() => onBuy(p.key)} aria-label={`Buy ${p.name}`} style={buyBtn(false)}>
                  {busy === p.key ? '…' : (p.displayPrice || 'Buy')}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {msg && <div role="status" style={{ fontFamily: sans, fontSize: 13, color: '#ddd', margin: '14px 0 0' }}>{msg}</div>}
      <div style={{ fontFamily: sans, fontSize: 12, color: '#888', lineHeight: 1.5, marginTop: 18 }}>
        Centering is free for everyone. Grades are estimates, not official grades from any grading company.
      </div>
      {children}
    </div>
  );
}

export default PlusStore;
