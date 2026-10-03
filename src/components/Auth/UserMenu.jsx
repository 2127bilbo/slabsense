/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/**
 * SlabSense - User Menu
 * Dropdown menu for logged-in users: who is signed in, their plan (PlanCard, loaded when the
 * menu opens so the counts are current), Collection, Settings and Sign Out.
 */

import { useState } from 'react';
import { PlanCard } from '../Billing/PlanCard.jsx';
import { getCreditsBalance } from '../../services/credits';
import { manageSubscription } from '../../services/purchases.js';
import { isNativeApp } from '../../lib/platform.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

export function UserMenu({ user, profile, onSignOut, onOpenCollection, onOpenSettings, onBuyCredits }) {
  const [isOpen, setIsOpen] = useState(false);

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'User';
  const initial = displayName.charAt(0).toUpperCase();
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (!next || !user?.id) return;
    setLoading(true);
    try { setBalance(await getCreditsBalance(user.id)); } catch { setBalance(null); }
    setLoading(false);
  };
  const openStore = () => { setIsOpen(false); onBuyCredits?.(); };

  return (
    <div style={{ position: 'relative' }}>
      {/* Avatar Button */}
      <button aria-label="Account menu" aria-haspopup="menu" aria-expanded={isOpen}
        onClick={toggle}
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
            width: 'min(320px, calc(100vw - 32px))',
            maxHeight: 'calc(100vh - 80px)',
            overflowY: 'auto',
            zIndex: 100,
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

            </div>

            {/* Plan */}
            <div style={{ padding: 10, borderBottom: '1px solid #1a1c22' }}>
              <PlanCard balance={balance} loading={loading} native={isNativeApp()} onPlus={openStore} onPacks={openStore}
                onManage={() => { setIsOpen(false); manageSubscription({ userId: user?.id }).catch(() => openStore()); }}
                style={{ background: '#08090c' }} />
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
                onClick={() => { onOpenSettings?.(); setIsOpen(false); }}
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
