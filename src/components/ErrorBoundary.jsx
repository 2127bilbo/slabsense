/**
 * ErrorBoundary — the last line before a blank screen.
 * A render exception anywhere below shows a reload screen instead of an empty page
 * (App Store audit E-01; Apple guideline 2.1). Unhandled promise rejections are logged
 * from main.jsx so they show up in the console with a stack instead of vanishing.
 */
import React from 'react';

const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', -apple-system, sans-serif";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error?.message || String(this.state.error);
    return (
      <div role="alert" style={{ minHeight: '100vh', background: '#0a0b0e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: sans }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontFamily: mono, fontSize: 12, color: '#ff4444', letterSpacing: 1, marginBottom: 12 }}>SOMETHING WENT WRONG</div>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: '#ccc' }}>
            SlabSense hit an error it could not recover from. Your saved cards are safe. Reload to continue.
          </div>
          <div style={{ fontFamily: mono, fontSize: 11, color: '#666', marginTop: 12, wordBreak: 'break-word' }}>{message}</div>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, minHeight: 44, padding: '12px 24px', background: '#6366f1', border: 'none', borderRadius: 10, color: '#fff', fontFamily: mono, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Reload SlabSense
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
