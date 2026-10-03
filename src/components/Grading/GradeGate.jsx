/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * What a user sees instead of a grade (owner decision 2026-10-02): sign in first, or the month's
 * free grades are used up. Photos and centering stay free; only the grade itself is gated.
 */
const mono = "'JetBrains Mono','SF Mono',monospace", sans = "'Inter',-apple-system,sans-serif";

export function GradeGate({ kind, freeGrades, onSignIn, onPlus, onBack }) {
  const btn = (primary) => ({ minHeight: 44, padding: '12px 20px', borderRadius: 10, border: primary ? 'none' : '1px solid #2a2d35', background: primary ? '#6366f1' : 'transparent', color: primary ? '#fff' : '#aaa', fontFamily: mono, fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: 10 });
  const signin = kind === 'signin';
  return (
    <div role="status" style={{ padding: 20, margin: 16, background: '#0d0f13', border: '1px solid #1a1c22', borderRadius: 12 }}>
      <div style={{ fontFamily: mono, fontSize: 11, color: '#8b5cf6', letterSpacing: 1 }}>{signin ? 'ALMOST THERE' : 'FREE LIMIT REACHED'}</div>
      <div style={{ fontFamily: sans, fontSize: 15, color: '#fff', marginTop: 8, lineHeight: 1.5 }}>
        {signin
          ? 'Your photos and centering are ready. Sign in or create a free account to see the grade. Free accounts get 10 grades a month; centering and your collection are always free.'
          : `You have used ${freeGrades?.used ?? 10} of ${freeGrades?.limit ?? 10} free grades this month. SlabSense Plus has unlimited grades and 5 AI Grades a month, with a 5-day free trial.`}
      </div>
      {signin
        ? <button onClick={onSignIn} style={btn(true)}>Sign in or create account</button>
        : <button onClick={onPlus} style={btn(true)}>See SlabSense Plus</button>}
      <button onClick={onBack} style={btn(false)}>Back to photos</button>
    </div>
  );
}

