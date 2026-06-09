/**
 * PricingPage - Subscription tiers and credit bundles
 */

import { useState, useEffect } from 'react';
import {
  getCreditsBalance,
  createCheckout,
  openCustomerPortal,
  SUBSCRIPTION_TIERS,
  CREDIT_BUNDLES,
} from '../../services/credits';

const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', -apple-system, sans-serif";

export function PricingPage({ userId, onClose }) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);
  const [singleQuantity, setSingleQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState('subscriptions'); // 'subscriptions' | 'bundles'

  useEffect(() => {
    if (userId) {
      loadBalance();
    }
  }, [userId]);

  async function loadBalance() {
    try {
      const data = await getCreditsBalance(userId);
      setBalance(data);
    } catch (err) {
      console.error('Failed to load balance:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchase(priceKey, quantity = 1) {
    try {
      setPurchasing(priceKey);
      const { url } = await createCheckout(userId, priceKey, quantity);
      window.location.href = url;
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Failed to start checkout: ' + err.message);
    } finally {
      setPurchasing(null);
    }
  }

  function handleManageSubscription() {
    openCustomerPortal(userId);
  }

  // Calculate single credits price with auto-pack logic
  function getSinglesPrice(qty) {
    if (qty >= 50) return 49.99 + (qty - 50) * 1.99;
    if (qty >= 30) return 39.99 + (qty - 30) * 1.99;
    if (qty >= 20) return 29.99 + (qty - 20) * 1.99;
    if (qty >= 10) return 14.99 + (qty - 10) * 1.99;
    return qty * 1.99;
  }

  function getSinglesBreakdown(qty) {
    if (qty >= 50) return `50-Pack + ${qty - 50} singles`;
    if (qty >= 30) return `30-Pack + ${qty - 30} singles`;
    if (qty >= 20) return `20-Pack + ${qty - 20} singles`;
    if (qty >= 10) return `10-Pack + ${qty - 10} singles`;
    return `${qty} single${qty > 1 ? 's' : ''}`;
  }

  const isSubscribed = balance?.subscription && !['free', 'trial'].includes(balance.subscription);
  const canUseTrial = !balance?.trialUsed;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.9)',
      zIndex: 9999,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start',
      padding: 20,
      overflowY: 'auto',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 800,
        background: '#0d0f13',
        borderRadius: 16,
        border: '1px solid #1a1c22',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid #1a1c22',
        }}>
          <div>
            <h2 style={{ fontFamily: sans, fontSize: 20, fontWeight: 600, color: '#fff', margin: 0 }}>
              Credits & Pricing
            </h2>
            {balance && (
              <p style={{ fontFamily: mono, fontSize: 12, color: '#666', margin: '4px 0 0' }}>
                Current balance: <span style={{ color: '#00ff88' }}>{balance.credits} credits</span>
                {balance.daysUntilExpiry && (
                  <span style={{ color: '#ffcc00' }}> (expires in {balance.daysUntilExpiry}d)</span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              background: '#1a1c22',
              border: 'none',
              borderRadius: 8,
              color: '#888',
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #1a1c22',
        }}>
          {['subscriptions', 'bundles'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '12px 16px',
                background: activeTab === tab ? '#1a1c22' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #00ff88' : '2px solid transparent',
                fontFamily: mono,
                fontSize: 12,
                fontWeight: 600,
                color: activeTab === tab ? '#00ff88' : '#666',
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {tab === 'subscriptions' ? 'Monthly Plans' : 'Credit Packs'}
            </button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {/* Subscriptions Tab */}
          {activeTab === 'subscriptions' && (
            <div>
              {/* Current subscription management */}
              {isSubscribed && (
                <div style={{
                  padding: 16,
                  background: '#00ff8810',
                  border: '1px solid #00ff8833',
                  borderRadius: 12,
                  marginBottom: 20,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 12, color: '#00ff88' }}>
                      CURRENT PLAN
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 16, color: '#fff', marginTop: 4 }}>
                      {SUBSCRIPTION_TIERS[balance.subscription]?.name || balance.subscription}
                    </div>
                  </div>
                  <button
                    onClick={handleManageSubscription}
                    style={{
                      padding: '8px 16px',
                      background: '#1a1c22',
                      border: '1px solid #333',
                      borderRadius: 8,
                      fontFamily: mono,
                      fontSize: 11,
                      color: '#888',
                      cursor: 'pointer',
                    }}
                  >
                    Manage Subscription
                  </button>
                </div>
              )}

              {/* Trial offer */}
              {canUseTrial && !isSubscribed && (
                <div style={{
                  padding: 16,
                  background: 'linear-gradient(135deg, #8b5cf620 0%, #f9731620 100%)',
                  border: '1px solid #8b5cf633',
                  borderRadius: 12,
                  marginBottom: 20,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontFamily: mono, fontSize: 11, color: '#8b5cf6' }}>
                        SPECIAL OFFER
                      </div>
                      <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 4 }}>
                        7-Day Trial - $4.99
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 11, color: '#888', marginTop: 4 }}>
                        Get 5 credits • Auto-renews to Hobby ($9.99/mo) • Cancel anytime
                      </div>
                    </div>
                    <button
                      onClick={() => handlePurchase('trial')}
                      disabled={purchasing === 'trial'}
                      style={{
                        padding: '10px 20px',
                        background: '#8b5cf6',
                        border: 'none',
                        borderRadius: 8,
                        fontFamily: mono,
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#fff',
                        cursor: 'pointer',
                        opacity: purchasing === 'trial' ? 0.5 : 1,
                      }}
                    >
                      {purchasing === 'trial' ? 'Loading...' : 'Start Trial'}
                    </button>
                  </div>
                </div>
              )}

              {/* Subscription tiers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                {Object.entries(SUBSCRIPTION_TIERS).filter(([key]) => key !== 'trial').map(([key, tier]) => {
                  const isCurrentPlan = balance?.subscription === key;
                  const isPopular = key === 'pro';

                  return (
                    <div
                      key={key}
                      style={{
                        padding: 20,
                        background: '#0a0b0e',
                        border: isPopular ? '2px solid #00ff88' : '1px solid #1a1c22',
                        borderRadius: 12,
                        position: 'relative',
                      }}
                    >
                      {isPopular && (
                        <div style={{
                          position: 'absolute',
                          top: -10,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          padding: '2px 12px',
                          background: '#00ff88',
                          borderRadius: 4,
                          fontFamily: mono,
                          fontSize: 9,
                          fontWeight: 700,
                          color: '#000',
                        }}>
                          POPULAR
                        </div>
                      )}

                      <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff' }}>
                        {tier.name}
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <span style={{ fontFamily: mono, fontSize: 28, fontWeight: 700, color: '#00ff88' }}>
                          ${tier.price}
                        </span>
                        <span style={{ fontFamily: mono, fontSize: 12, color: '#666' }}>/mo</span>
                      </div>

                      <div style={{ fontFamily: mono, fontSize: 12, color: '#888', marginTop: 8 }}>
                        {tier.credits} credits/month
                      </div>

                      <div style={{ fontFamily: mono, fontSize: 10, color: '#555', marginTop: 4 }}>
                        ${(tier.price / tier.credits).toFixed(2)}/credit
                      </div>

                      {!balance?.signup_bonus_awarded && (
                        <div style={{
                          marginTop: 8,
                          padding: '4px 8px',
                          background: '#ffcc0020',
                          borderRadius: 4,
                          fontFamily: mono,
                          fontSize: 9,
                          color: '#ffcc00',
                        }}>
                          +7 bonus credits (first time)
                        </div>
                      )}

                      <button
                        onClick={() => handlePurchase(key)}
                        disabled={purchasing === key || isCurrentPlan}
                        style={{
                          width: '100%',
                          marginTop: 16,
                          padding: '10px 16px',
                          background: isCurrentPlan ? '#1a1c22' : '#00ff88',
                          border: 'none',
                          borderRadius: 8,
                          fontFamily: mono,
                          fontSize: 11,
                          fontWeight: 600,
                          color: isCurrentPlan ? '#666' : '#000',
                          cursor: isCurrentPlan ? 'default' : 'pointer',
                          opacity: purchasing === key ? 0.5 : 1,
                        }}
                      >
                        {isCurrentPlan ? 'Current Plan' : purchasing === key ? 'Loading...' : 'Subscribe'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bundles Tab */}
          {activeTab === 'bundles' && (
            <div>
              {/* Single credits with quantity selector */}
              <div style={{
                padding: 20,
                background: '#0a0b0e',
                border: '1px solid #1a1c22',
                borderRadius: 12,
                marginBottom: 20,
              }}>
                <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff' }}>
                  Custom Amount
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: '#888', marginTop: 4 }}>
                  Buy exactly what you need • Auto-converts to packs for best price
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => setSingleQuantity(Math.max(1, singleQuantity - 1))}
                      style={{
                        width: 32,
                        height: 32,
                        background: '#1a1c22',
                        border: 'none',
                        borderRadius: 6,
                        color: '#888',
                        fontSize: 18,
                        cursor: 'pointer',
                      }}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={singleQuantity}
                      onChange={(e) => setSingleQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{
                        width: 60,
                        padding: '6px 10px',
                        background: '#1a1c22',
                        border: '1px solid #333',
                        borderRadius: 6,
                        fontFamily: mono,
                        fontSize: 14,
                        color: '#fff',
                        textAlign: 'center',
                      }}
                    />
                    <button
                      onClick={() => setSingleQuantity(singleQuantity + 1)}
                      style={{
                        width: 32,
                        height: 32,
                        background: '#1a1c22',
                        border: 'none',
                        borderRadius: 6,
                        color: '#888',
                        fontSize: 18,
                        cursor: 'pointer',
                      }}
                    >
                      +
                    </button>
                    <span style={{ fontFamily: mono, fontSize: 12, color: '#666' }}>credits</span>
                  </div>

                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <div style={{ fontFamily: mono, fontSize: 10, color: '#666' }}>
                      {getSinglesBreakdown(singleQuantity)}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: '#00ff88' }}>
                      ${getSinglesPrice(singleQuantity).toFixed(2)}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      // Determine which pack + singles combo to purchase
                      // For now, just buy singles (backend handles it)
                      handlePurchase('single', singleQuantity);
                    }}
                    disabled={purchasing === 'single'}
                    style={{
                      padding: '10px 20px',
                      background: '#00ff88',
                      border: 'none',
                      borderRadius: 8,
                      fontFamily: mono,
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#000',
                      cursor: 'pointer',
                      opacity: purchasing === 'single' ? 0.5 : 1,
                    }}
                  >
                    {purchasing === 'single' ? 'Loading...' : 'Buy'}
                  </button>
                </div>
              </div>

              {/* Fixed bundles */}
              <div style={{ fontFamily: mono, fontSize: 11, color: '#666', marginBottom: 12 }}>
                QUICK PACKS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                {Object.entries(CREDIT_BUNDLES).filter(([key]) => key !== 'single').map(([key, bundle]) => (
                  <div
                    key={key}
                    style={{
                      padding: 16,
                      background: '#0a0b0e',
                      border: '1px solid #1a1c22',
                      borderRadius: 12,
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: '#00ff88' }}>
                      {bundle.credits}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: '#666' }}>credits</div>

                    <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 8 }}>
                      ${bundle.price}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 9, color: '#555' }}>
                      ${(bundle.price / bundle.credits).toFixed(2)}/credit
                    </div>

                    <button
                      onClick={() => handlePurchase(key)}
                      disabled={purchasing === key}
                      style={{
                        width: '100%',
                        marginTop: 12,
                        padding: '8px 12px',
                        background: '#1a1c22',
                        border: '1px solid #333',
                        borderRadius: 6,
                        fontFamily: mono,
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#888',
                        cursor: 'pointer',
                        opacity: purchasing === key ? 0.5 : 1,
                      }}
                    >
                      {purchasing === key ? '...' : 'Buy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Credit costs info */}
          <div style={{
            marginTop: 24,
            padding: 16,
            background: '#0a0b0e',
            borderRadius: 12,
            border: '1px solid #1a1c22',
          }}>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#666', marginBottom: 8 }}>
              CREDIT USAGE
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: '#8b5cf6' }}>1 credit</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: '#888' }}> = AI Grade</span>
              </div>
              <div>
                <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: '#f97316' }}>2 credits</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: '#888' }}> = Deep AI Grade</span>
              </div>
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: '#555', marginTop: 8 }}>
              Credits expire 30 days from purchase. Any new purchase resets expiration for all credits.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PricingPage;
