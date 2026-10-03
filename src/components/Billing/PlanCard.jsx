/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * PlanCard — the account's plan at a glance: plan name and date, grades left this month,
 * AI Grades split into plan and pack grades, saved cards, and the next useful action.
 * Wording comes from src/lib/plan-summary.js; this file only lays it out.
 * Used in the account menu and at the top of the store.
 */
import { planSummary } from '../../lib/plan-summary.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";
const GOLD = '#d9b56a';

const BADGE = {
  free: { label: 'FREE', bg: '#2a2d35', color: '#aaa' },
  trial: { label: 'TRIAL', bg: 'linear-gradient(135deg,#8b5cf6,#d9b56a)', color: '#0a0b0e' },
  plus: { label: 'PLUS', bg: 'linear-gradient(135deg,#8b5cf6,#d9b56a)', color: '#0a0b0e' },
  past_due: { label: 'PAYMENT DUE', bg: 'rgba(255,204,0,0.15)', color: '#ffcc00' },
  lifetime: { label: 'LIFETIME', bg: 'rgba(139,92,246,0.2)', color: '#c4b5fd' },
};

function Meter({ value, warn, invert }) {
  // Grades show what is left; saved cards show what is used.
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = warn ? '#ff6b6b' : invert && pct >= 80 ? '#ffcc00' : GOLD;
  return (
    <div aria-hidden="true" style={{ height: 4, background: '#1f2229', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .4s ease' }} />
    </div>
  );
}

export function PlanCard({ balance, native = false, onPlus, onPacks, onManage, loading = false, style }) {
  const s = planSummary(balance);
  const btn = (primary) => ({ flex: 1, minHeight: 44, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: mono, fontSize: 12, fontWeight: 600,
    border: primary ? 'none' : '1px solid #2a2d35', background: primary ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent', color: primary ? '#fff' : '#ccc' });

  if (!s) {
    return (
      <div style={{ padding: 14, background: '#0d0f13', border: '1px solid #1a1c22', borderRadius: 12, fontFamily: sans, fontSize: 13, color: '#777', ...style }}>
        {loading ? 'Loading your plan…' : 'Your plan could not be loaded. Check your connection and try again.'}
      </div>
    );
  }
  const badge = BADGE[s.plan];
  // A web (Stripe) plan cannot be managed from Apple's settings, and the reverse.
  const manageElsewhere = (native && s.source === 'stripe') ? 'Manage this plan where you signed up for it.'
    : (!native && s.source === 'apple') ? 'Manage this plan in your Apple ID settings on your iPhone.' : null;
  const actions = s.actions.filter((a) => !(a === 'manage' && manageElsewhere));

  return (
    <section aria-label="Your plan" style={{ padding: 14, background: '#0d0f13', border: '1px solid #1a1c22', borderRadius: 12, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', color: '#777' }}>YOUR PLAN</div>
          <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 2 }}>{s.name}</div>
        </div>
        <span style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 6, background: badge.bg, color: badge.color, fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>{badge.label}</span>
      </div>
      {s.dateLine && (
        <div role={s.plan === 'past_due' ? 'alert' : undefined} style={{ fontFamily: sans, fontSize: 12, color: s.plan === 'past_due' ? '#ffcc00' : '#aaa', marginTop: 6, lineHeight: 1.4 }}>{s.dateLine}</div>
      )}
      <dl style={{ margin: '12px 0 0', display: 'grid', gap: 12 }}>
        {s.rows.map((r) => (
          <div key={r.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <dt style={{ fontFamily: sans, fontSize: 13, color: '#bbb' }}>{r.label}</dt>
              <dd style={{ margin: 0, fontFamily: mono, fontSize: 13, fontWeight: 600, color: r.warn ? '#ff6b6b' : '#fff', fontVariantNumeric: 'tabular-nums' }}>{r.value}</dd>
            </div>
            {r.meter != null && <Meter value={r.meter} warn={r.warn} invert={r.key === 'cards'} />}
            {r.detail && <div style={{ fontFamily: sans, fontSize: 11, color: '#777', marginTop: 4, lineHeight: 1.4 }}>{r.detail}</div>}
          </div>
        ))}
      </dl>
      {manageElsewhere && <div style={{ fontFamily: sans, fontSize: 11, color: '#777', marginTop: 10 }}>{manageElsewhere}</div>}
      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {actions.map((a, i) => (
            a === 'plus' ? <button key={a} onClick={onPlus} style={btn(i === 0)}>See Plus</button>
              : a === 'packs' ? <button key={a} onClick={onPacks} style={btn(i === 0 && s.plan !== 'past_due')}>Buy AI Grades</button>
                : <button key={a} onClick={onManage} style={btn(s.plan === 'past_due')}>Manage</button>
          ))}
        </div>
      )}
    </section>
  );
}

export default PlanCard;
