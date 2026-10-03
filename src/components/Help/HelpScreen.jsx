/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * HelpScreen — photo tips (with the animated scanning guide), how each kind of grade works, and
 * the FAQ. Opened from the account menu and the Home tab. Words live in src/lib/help-content.js.
 */
import { useState } from 'react';
import { TIPS, GRADE_KINDS, CONFIDENCE_NOTE, FAQ } from '../../lib/help-content.js';
import { FEEDBACK_EMAIL } from '../../lib/products.js';
import { ScanGuide } from '../Capture/ScanGuide.jsx';
import { ConfidenceMedallion } from '../Grading/ConfidenceMedallion.jsx';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";
const GOLD = '#d9b56a';
const TABS = [['tips', 'Photo tips'], ['how', 'How it works'], ['faq', 'FAQ']];
const ACCENT = { centering: '#00ff88', grade: '#8b5cf6', ai: GOLD };

/** Small line icons for the tips, drawn on a 24 grid. */
const ICON = {
  background: <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="9" y="8" width="6" height="8" rx="1" /></>,
  light: <><circle cx="12" cy="10" r="4" /><path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2M19.1 4.9l-1.4 1.4M22 12h-2M9 18h6M10 21h4" /></>,
  sleeve: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 3v4h6V3" /></>,
  lens: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M15 6.5l1.5-1.5" /></>,
  frame: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><rect x="9" y="7.5" width="6" height="9" rx="1" /></>,
  steady: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2" /></>,
  confidence: <><circle cx="12" cy="12" r="8" /><path d="M8.5 12.5l2.3 2.3 4.7-5" /></>,
  notfound: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5M9 9l4 4M13 9l-4 4" /></>,
};
function TipIcon({ k }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[k]}</svg>
  );
}

function Chevron({ open }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease' }}><path d="M4 6l4 4 4-4" stroke="#888" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>;
}

export function HelpScreen({ onClose, initialTab = 'tips' }) {
  const [tab, setTab] = useState(initialTab);
  const [guide, setGuide] = useState(false);
  const [openKind, setOpenKind] = useState(null);
  const [openQ, setOpenQ] = useState(null);
  const card = { background: '#0d0f13', border: '1px solid #1a1c22', borderRadius: 14 };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="help-title" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0a0b0e', overflowY: 'auto', padding: 'max(16px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom))' }}>
      {guide && <div style={{ position: 'fixed', inset: 0, zIndex: 1001 }}><ScanGuide onClose={() => setGuide(false)} /></div>}
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 id="help-title" style={{ fontFamily: sans, fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Help</h2>
          <button onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44, background: 'transparent', border: '1px solid #2a2d35', borderRadius: 10, color: '#888', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        <div role="tablist" aria-label="Help sections" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, padding: 4, background: '#121419', borderRadius: 12, marginBottom: 18 }}>
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              style={{ minHeight: 40, borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: sans, fontSize: 13, fontWeight: 600, background: tab === k ? '#262a35' : 'transparent', color: tab === k ? '#fff' : '#888' }}>{label}</button>
          ))}
        </div>

        {tab === 'tips' && (
          <div role="tabpanel" style={{ display: 'grid', gap: 12 }}>
            <button onClick={() => setGuide(true)} style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: 16, cursor: 'pointer', textAlign: 'left', border: `1px solid ${GOLD}44`, background: 'linear-gradient(135deg,#16141e,#0d0f13)' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#8b5cf6,#d9b56a)' }}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z" fill="#0a0b0e" /></svg>
              </span>
              <span>
                <span style={{ display: 'block', fontFamily: sans, fontSize: 15, fontWeight: 600, color: '#fff' }}>Watch the scanning guide</span>
                <span style={{ display: 'block', fontFamily: sans, fontSize: 12, color: '#999', marginTop: 2 }}>Four short animations on taking a good card photo.</span>
              </span>
            </button>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {TIPS.map((t) => (
                <li key={t.key} style={{ ...card, display: 'flex', gap: 14, padding: 14 }}>
                  <span style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'rgba(217,181,106,0.08)' }}><TipIcon k={t.key} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: sans, fontSize: 14, fontWeight: 600, color: '#fff' }}>{t.title}</span>
                    <span style={{ display: 'block', fontFamily: sans, fontSize: 13, color: '#a3a8b3', marginTop: 3, lineHeight: 1.5 }}>{t.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'how' && (
          <div role="tabpanel" style={{ display: 'grid', gap: 12 }}>
            {GRADE_KINDS.map((g, n) => {
              const open = openKind === g.key;
              return (
                <div key={g.key} style={{ ...card, overflow: 'hidden', borderTop: `3px solid ${ACCENT[g.key]}` }}>
                  <button onClick={() => setOpenKind(open ? null : g.key)} aria-expanded={open}
                    style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'flex-start', padding: 16, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: ACCENT[g.key], marginTop: 2 }}>{n + 1}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontFamily: sans, fontSize: 16, fontWeight: 700, color: '#fff' }}>{g.name}</span>
                      <span style={{ display: 'block', fontFamily: mono, fontSize: 11, color: ACCENT[g.key], marginTop: 3 }}>{g.cost}</span>
                      <span style={{ display: 'block', fontFamily: sans, fontSize: 13, color: '#a3a8b3', marginTop: 6, lineHeight: 1.5 }}>{g.summary}</span>
                    </span>
                    <Chevron open={open} />
                  </button>
                  {open && (
                    <ul style={{ margin: 0, padding: '0 16px 16px 44px', display: 'grid', gap: 8 }}>
                      {g.details.map((d) => <li key={d} style={{ fontFamily: sans, fontSize: 13, color: '#c4c8d1', lineHeight: 1.5 }}>{d}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
            <div style={{ ...card, display: 'flex', gap: 14, alignItems: 'center', padding: 14 }}>
              <ConfidenceMedallion score={8.6} issues={{}} size={72} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: GOLD, fontWeight: 700 }}>{CONFIDENCE_NOTE.title}</div>
                <div style={{ fontFamily: sans, fontSize: 13, color: '#a3a8b3', marginTop: 4, lineHeight: 1.5 }}>{CONFIDENCE_NOTE.body}</div>
              </div>
            </div>
          </div>
        )}

        {tab === 'faq' && (
          <div role="tabpanel">
            <div style={{ ...card }}>
              {FAQ.map((f, n) => {
                const open = openQ === f.key;
                return (
                  <div key={f.key} style={{ borderTop: n ? '1px solid #1a1c22' : 'none' }}>
                    <button onClick={() => setOpenQ(open ? null : f.key)} aria-expanded={open}
                      style={{ width: '100%', minHeight: 52, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: sans, fontSize: 14, fontWeight: 600, color: open ? '#fff' : '#dde0e6' }}>
                      {f.q}<Chevron open={open} />
                    </button>
                    {open && <p style={{ margin: 0, padding: '0 16px 16px', fontFamily: sans, fontSize: 13, color: '#a3a8b3', lineHeight: 1.6 }}>{f.a}</p>}
                  </div>
                );
              })}
            </div>
            <div style={{ ...card, marginTop: 12, padding: 16 }}>
              <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: '#fff' }}>Still need help?</div>
              <div style={{ fontFamily: sans, fontSize: 13, color: '#a3a8b3', marginTop: 4, lineHeight: 1.5 }}>
                Email <a href={`mailto:${FEEDBACK_EMAIL}`} style={{ color: '#a78bfa' }}>{FEEDBACK_EMAIL}</a>. Suggestions and bug reports are welcome too.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HelpScreen;
