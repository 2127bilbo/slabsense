/**
 * SlabSense - Auth Modal
 * Login and Register modal component
 */

import { useState } from 'react';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

export function AuthModal({ isOpen, onClose, onAuth, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === 'register') {
        await onAuth.signUp(email, password, displayName);
        setSuccess('Check your email to confirm your account!');
      } else {
        await onAuth.signIn(email, password);
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setSuccess(null);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.85)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: '#0d0f13',
        borderRadius: 12,
        border: '1px solid #2a2d35',
        maxWidth: 380,
        width: '100%',
        padding: 24,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: '#fff' }}>
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              fontSize: 20,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div style={{
            padding: 10,
            marginBottom: 16,
            background: 'rgba(255,68,68,0.1)',
            border: '1px solid rgba(255,68,68,0.3)',
            borderRadius: 6,
            fontFamily: sans,
            fontSize: 12,
            color: '#ff6666',
          }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{
            padding: 10,
            marginBottom: 16,
            background: 'rgba(0,255,136,0.1)',
            border: '1px solid rgba(0,255,136,0.3)',
            borderRadius: 6,
            fontFamily: sans,
            fontSize: 12,
            color: '#00ff88',
          }}>
            {success}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontFamily: mono, fontSize: 10, color: '#666', marginBottom: 6, textTransform: 'uppercase' }}>
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: '#1a1c22',
                  border: '1px solid #2a2d35',
                  borderRadius: 6,
                  color: '#fff',
                  fontFamily: sans,
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontFamily: mono, fontSize: 10, color: '#666', marginBottom: 6, textTransform: 'uppercase' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#1a1c22',
                border: '1px solid #2a2d35',
                borderRadius: 6,
                color: '#fff',
                fontFamily: sans,
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontFamily: mono, fontSize: 10, color: '#666', marginBottom: 6, textTransform: 'uppercase' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Min 6 characters' : 'Your password'}
              required
              minLength={6}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#1a1c22',
                border: '1px solid #2a2d35',
                borderRadius: 6,
                color: '#fff',
                fontFamily: sans,
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 8,
              border: 'none',
              background: loading ? '#333' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              color: '#fff',
              fontFamily: mono,
              fontSize: 12,
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '.05em',
            }}
          >
            {loading ? 'Please wait...' : (mode === 'login' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        {/* Switch Mode */}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <span style={{ fontFamily: sans, fontSize: 12, color: '#666' }}>
            {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button
            onClick={switchMode}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b5cf6',
              fontFamily: sans,
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {mode === 'login' ? 'Sign Up' : 'Sign In'}
          </button>
        </div>

        {/* Terms notice for register */}
        {mode === 'register' && (
          <div style={{ marginTop: 16, fontFamily: sans, fontSize: 10, color: '#555', textAlign: 'center', lineHeight: 1.5 }}>
            By creating an account, you agree to our Terms of Service and Privacy Policy.
          </div>
        )}
      </div>
    </div>
  );
}
