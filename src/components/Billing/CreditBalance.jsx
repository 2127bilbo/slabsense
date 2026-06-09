/**
 * CreditBalance - Display credit balance in header
 * Shows credits, expiration warning, and quick-buy button
 */

import { useState, useEffect } from 'react';
import { getCreditsBalance } from '../../services/credits';

const mono = "'JetBrains Mono', monospace";

export function CreditBalance({ userId, onBuyCredits, compact = false }) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    loadBalance();
  }, [userId]);

  async function loadBalance() {
    try {
      setLoading(true);
      const data = await getCreditsBalance(userId);
      setBalance(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load balance:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Refresh balance (call this after purchases or grades)
  window.refreshCreditBalance = loadBalance;

  if (!userId) return null;

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: '#1a1c22',
        borderRadius: 6,
      }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: '#666' }}>...</span>
      </div>
    );
  }

  if (error) {
    return null; // Silently fail for header display
  }

  // Lifetime users
  if (balance?.isLifetime) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
        borderRadius: 6,
      }}>
        <span style={{ fontSize: 12 }}>⭐</span>
        <span style={{
          fontFamily: mono,
          fontSize: 11,
          fontWeight: 600,
          color: '#000',
        }}>
          LIFETIME
        </span>
      </div>
    );
  }

  const credits = balance?.credits || 0;
  const daysLeft = balance?.daysUntilExpiry;
  const isLow = credits <= 3;
  const isExpiringSoon = daysLeft && daysLeft <= 7;

  // Determine color based on status
  let bgColor = '#1a1c22';
  let textColor = '#00ff88';

  if (isLow) {
    bgColor = '#2a1a1a';
    textColor = '#ff6633';
  } else if (isExpiringSoon) {
    bgColor = '#2a2a1a';
    textColor = '#ffcc00';
  }

  if (compact) {
    return (
      <div
        onClick={onBuyCredits}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          background: bgColor,
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: textColor }}>
          {credits}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9, color: '#666' }}>CR</span>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <div
        onClick={onBuyCredits}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          background: bgColor,
          borderRadius: 8,
          cursor: 'pointer',
          border: isLow ? '1px solid #ff663333' : '1px solid transparent',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{
              fontFamily: mono,
              fontSize: 16,
              fontWeight: 700,
              color: textColor,
            }}>
              {credits}
            </span>
            <span style={{ fontFamily: mono, fontSize: 10, color: '#666' }}>credits</span>
          </div>

          {isExpiringSoon && (
            <span style={{ fontFamily: mono, fontSize: 9, color: '#ffcc00' }}>
              expires in {daysLeft}d
            </span>
          )}
        </div>

        {isLow && (
          <div style={{
            padding: '2px 6px',
            background: '#ff6633',
            borderRadius: 4,
            fontFamily: mono,
            fontSize: 9,
            fontWeight: 600,
            color: '#fff',
          }}>
            LOW
          </div>
        )}
      </div>

      {isLow && (
        <button
          onClick={onBuyCredits}
          style={{
            padding: '6px 12px',
            background: '#00ff88',
            border: 'none',
            borderRadius: 6,
            fontFamily: mono,
            fontSize: 11,
            fontWeight: 600,
            color: '#000',
            cursor: 'pointer',
          }}
        >
          + Buy
        </button>
      )}
    </div>
  );
}

export default CreditBalance;
