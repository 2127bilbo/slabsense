/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * One-time welcome after sign-up and after the first purchase (owner decision 2026-10-02):
 * SlabSense is new; bugs and ideas go to the support address. Shown once per account and trigger.
 */
import { useEffect, useState } from 'react';
import { FEEDBACK_EMAIL } from '../lib/products.js';

const mono = "'JetBrains Mono','SF Mono',monospace", sans = "'Inter',-apple-system,sans-serif";

export function WelcomePrompt({ userId, trigger, onClose }) {
  const key = `slabsense_welcome_${trigger}_${userId}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(!!userId && !localStorage.getItem(key)); } catch { setShow(false); }
  }, [key, userId]);
  if (!show) return null;
  const close = () => {
    try { localStorage.setItem(key, '1'); } catch { /* private mode: shows again next time, harmless */ }
    setShow(false);
    onClose?.();
  };
  const subject = encodeURIComponent(trigger === 'purchase' ? 'SlabSense Plus feedback' : 'SlabSense feedback');
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#0d0f13', borderRadius: 12, border: '1px solid #2a2d35', maxWidth: 400, padding: 24 }}>
        <div id="welcome-title" style={{ fontFamily: mono, fontSize: 12, color: '#00ff88', textTransform: 'uppercase', marginBottom: 12 }}>
          {trigger === 'purchase' ? 'Thank you' : 'Welcome to SlabSense'}
        </div>
        <div style={{ fontFamily: sans, fontSize: 14, color: '#ccc', lineHeight: 1.6 }}>
          SlabSense is new and built by a collector. If something breaks, a grade looks off, or you want a feature, tell us and we will read it.
        </div>
        <a href={`mailto:${FEEDBACK_EMAIL}?subject=${subject}`} style={{ display: 'block', marginTop: 16, fontFamily: mono, fontSize: 13, color: '#8b5cf6' }}>{FEEDBACK_EMAIL}</a>
        <button onClick={close} style={{ width: '100%', marginTop: 20, minHeight: 44, borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontFamily: mono, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Got it</button>
      </div>
    </div>
  );
}

export default WelcomePrompt;
