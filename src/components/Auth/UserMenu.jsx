/**
 * SlabSense - User Menu
 * Dropdown menu for logged-in users
 */

import { useState } from 'react';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

export function UserMenu({ user, profile, onSignOut, onOpenCollection }) {
  const [isOpen, setIsOpen] = useState(false);

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'User';
  const initial = displayName.charAt(0).toUpperCase();
  const tier = profile?.tier || 'free';

  const tierColors = {
    free: { bg: '#2a2d35', color: '#888' },
    beta_lifetime: { bg: 'rgba(139,92,246,0.2)', color: '#a78bfa' },
    pro_monthly: { bg: 'rgba(0,255,136,0.2)', color: '#00ff88' },
  };

  const tierLabels = {
    free: 'Free',
    beta_lifetime: 'Beta Lifetime',
    pro_monthly: 'Pro',
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          border: 'none',
          color: '#fff',
          fontFamily: mono,
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {initial}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99,
            }}
          />

          {/* Menu */}
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            background: '#0d0f13',
            border: '1px solid #2a2d35',
            borderRadius: 10,
            minWidth: 200,
            zIndex: 100,
            overflow: 'hidden',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          }}>
            {/* User Info */}
            <div style={{ padding: 14, borderBottom: '1px solid #1a1c22' }}>
              <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 4 }}>
                {displayName}
              </div>
              <div style={{ fontFamily: mono, fontSize: 10, color: '#555' }}>
                {user?.email}
              </div>
              <div style={{
                marginTop: 8,
                display: 'inline-block',
                padding: '3px 8px',
                borderRadius: 4,
                background: tierColors[tier]?.bg || tierColors.free.bg,
                fontFamily: mono,
                fontSize: 9,
                color: tierColors[tier]?.color || tierColors.free.color,
                textTransform: 'uppercase',
              }}>
                {tierLabels[tier] || 'Free'}
              </div>
            </div>

            {/* Menu Items */}
            <div style={{ padding: 6 }}>
              <button
                onClick={() => { onOpenCollection?.(); setIsOpen(false); }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: '#ccc',
                  fontFamily: sans,
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
                onMouseEnter={(e) => e.target.style.background = '#1a1c22'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                <span style={{ fontSize: 14 }}>📁</span>
                My Collection
              </button>

              <button
                onClick={() => { /* TODO: Settings */ setIsOpen(false); }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: '#ccc',
                  fontFamily: sans,
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
                onMouseEnter={(e) => e.target.style.background = '#1a1c22'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                <span style={{ fontSize: 14 }}>⚙️</span>
                Settings
              </button>

              {tier === 'free' && (
                <button
                  onClick={() => { /* TODO: Upgrade */ setIsOpen(false); }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'rgba(139,92,246,0.1)',
                    border: 'none',
                    borderRadius: 6,
                    color: '#a78bfa',
                    fontFamily: sans,
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                  onMouseEnter={(e) => e.target.style.background = 'rgba(139,92,246,0.2)'}
                  onMouseLeave={(e) => e.target.style.background = 'rgba(139,92,246,0.1)'}
                >
                  <span style={{ fontSize: 14 }}>⭐</span>
                  Upgrade to Pro
                </button>
              )}
            </div>

            {/* Sign Out */}
            <div style={{ padding: 6, borderTop: '1px solid #1a1c22' }}>
              <button
                onClick={() => { onSignOut(); setIsOpen(false); }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: '#ff6666',
                  fontFamily: sans,
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
                onMouseEnter={(e) => e.target.style.background = 'rgba(255,68,68,0.1)'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                <span style={{ fontSize: 14 }}>🚪</span>
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
