/**
 * SlabSense - Set a new password after a reset email.
 * Shown when Supabase reports PASSWORD_RECOVERY (the user clicked the link we sent from
 * "Forgot password?"). Before this existed a forgotten password was a permanent lockout
 * (App Store readiness audit L-03).
 */
import { useState } from 'react';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

export function SetPasswordModal({ onSubmit, onClose }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setSaving(true);
    try { await onSubmit(password); setDone(true); } catch (err) { setError(err.message || 'Could not update the password.'); } finally { setSaving(false); }
  };

  const field = { width: '100%', padding: '12px', background: '#1a1c22', border: '1px solid #2a2d35', borderRadius: 8, color: '#fff', fontFamily: sans, fontSize: 16, outline: 'none', marginBottom: 10 };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="setpw-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={submit} style={{ background: '#0d0f13', border: '1px solid #2a2d35', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
        <div id="setpw-title" style={{ fontFamily: mono, fontSize: 14, color: '#fff', marginBottom: 6 }}>Set a new password</div>
        <div style={{ fontFamily: sans, fontSize: 12, color: '#999', marginBottom: 16 }}>You arrived from a password-reset link. Choose a new password for this account.</div>
        {done ? (
          <>
            <div style={{ fontFamily: sans, fontSize: 13, color: '#00ff88', marginBottom: 16 }}>Password updated. You are signed in.</div>
            <button type="button" onClick={onClose} style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontFamily: mono, fontSize: 12, cursor: 'pointer', minHeight: 44 }}>Continue</button>
          </>
        ) : (
          <>
            <label htmlFor="setpw-new" style={{ display: 'block', fontFamily: mono, fontSize: 10, color: '#555', marginBottom: 6, textTransform: 'uppercase' }}>New password</label>
            <input id="setpw-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
            <label htmlFor="setpw-confirm" style={{ display: 'block', fontFamily: mono, fontSize: 10, color: '#555', marginBottom: 6, textTransform: 'uppercase' }}>Repeat it</label>
            <input id="setpw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={field} />
            {error && <div role="alert" style={{ fontFamily: sans, fontSize: 12, color: '#ff6666', marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #2a2d35', background: 'transparent', color: '#888', fontFamily: mono, fontSize: 12, cursor: 'pointer', minHeight: 44 }}>Not now</button>
              <button type="submit" disabled={saving} style={{ flex: 2, padding: 12, borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontFamily: mono, fontSize: 12, cursor: 'pointer', minHeight: 44, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save password'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
