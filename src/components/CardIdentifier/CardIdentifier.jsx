/**
 * CardIdentifier - Card identification via pHash + TCGDex
 *
 * Flow:
 * 1. User captures card image
 * 2. pHash computed and matched against database
 * 3. High/Medium confidence → show candidates for user to confirm
 * 4. Low/error → fall back to manual search
 * 5. Returns full card data + high-quality image
 */

import { useState, useEffect } from 'react';
import { identifyCard, selectCard } from '../../lib/identify-card.js';
import { smartSearch, getFullCardData } from '../../services/tcgdex.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

/**
 * Construct image URL from set and number when card.image is not available
 * Uses TCGDex asset URL pattern
 */
function getCardImageUrl(card) {
  // If card already has image URL, use it
  if (card.image) {
    return `${card.image}/low.webp`;
  }

  // Construct from set and number
  const setId = card.set?.id || card.set || '';
  const localId = card.localId || card.number || '';

  if (!setId || !localId) return null;

  // Determine series from set ID
  let series = 'unknown';
  if (setId.startsWith('base') || setId.startsWith('gym') || setId.startsWith('neo') ||
      setId.startsWith('si') || setId.startsWith('lc') || setId.startsWith('ecard')) {
    series = 'base';
  } else if (setId.startsWith('swsh')) {
    series = 'swsh';
  } else if (setId.startsWith('sv')) {
    series = 'sv';
  } else if (setId.startsWith('sm') || setId.startsWith('sma')) {
    series = 'sm';
  } else if (setId.startsWith('xy')) {
    series = 'xy';
  } else if (setId.startsWith('bw')) {
    series = 'bw';
  } else if (setId.startsWith('dp') || setId.startsWith('pl')) {
    series = 'dp';
  } else if (setId.startsWith('ex') || setId.startsWith('pop') || setId.startsWith('dc')) {
    series = 'ex';
  } else if (setId.startsWith('hgss') || setId.startsWith('col') || setId.startsWith('ru')) {
    series = 'hgss';
  } else if (setId.startsWith('A') || setId.startsWith('B') || setId.startsWith('P') || setId.startsWith('me')) {
    series = 'poke';  // Pokemon TCG Pocket
  }

  return `https://assets.tcgdex.net/en/${series}/${setId}/${localId}/low.webp`;
}

export function CardIdentifier({
  cardImage,           // The user's captured card image
  onCardIdentified,    // Callback when card is identified: (cardData) => void
  onCancel,            // Callback to cancel
  autoStart = true,    // Start identification automatically
}) {
  const [status, setStatus] = useState('idle'); // idle | identifying | results | loading | manual
  const [progress, setProgress] = useState(0);
  const [identifyResult, setIdentifyResult] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [error, setError] = useState(null);
  const [manualSearch, setManualSearch] = useState('');
  const [manualSearching, setManualSearching] = useState(false);
  const [hashDbMissing, setHashDbMissing] = useState(false);

  // Auto-start when image is provided
  useEffect(() => {
    if (cardImage && autoStart && status === 'idle') {
      startIdentification();
    }
  }, [cardImage, autoStart]);

  const startIdentification = async () => {
    if (!cardImage) return;

    console.log('[CardIdentifier] Starting pHash identification...');
    setStatus('identifying');
    setError(null);
    setProgress(0);

    try {
      // Run pHash identification
      const result = await identifyCard(cardImage, {
        cropCard: true,
        onProgress: setProgress,
      });

      console.log('[CardIdentifier] Result:', result.status, result.confidence);
      setIdentifyResult(result);

      // Handle different status outcomes
      if (result.status === 'error') {
        // Check if hash DB is missing
        if (result.error?.includes('Hash database') || result.error?.includes('hash DB')) {
          console.log('[CardIdentifier] Hash DB not found, falling back to manual');
          setHashDbMissing(true);
        }
        setError(result.error || 'Identification failed');
        setStatus('manual');
        return;
      }

      // Always show matches for user confirmation (never auto-accept)
      // This prevents false positives like Mewtwo matching Oricorio
      if (result.status === 'matched' || result.status === 'ambiguous') {
        // Show matches for user selection
        const matches = result.matches || [];
        // Flatten grouped matches for display
        const flatMatches = matches.flatMap(m =>
          m.variants ? m.variants.map(v => ({
            ...v,
            confidence: m.confidence,
            variantCount: m.variantCount,
          })) : [m]
        );
        setSearchResults(flatMatches.slice(0, 50));
        setStatus('results');
        return;
      }

      // Unknown - go to manual search
      setStatus('manual');

    } catch (err) {
      console.error('[CardIdentifier] Error:', err);
      setError(err.message || 'Identification failed');
      setStatus('manual');
    }
  };

  const handleSelectCard = async (card) => {
    setSelectedCard(card);
    setStatus('loading');

    try {
      const fullData = await getFullCardData(card.id);

      if (fullData) {
        onCardIdentified(fullData);
      } else {
        setError('Failed to load card details');
        setStatus('manual');
      }
    } catch (err) {
      console.error('[CardIdentifier] Load card error:', err);
      setError(err.message);
      setStatus('manual');
    }
  };

  // Manual search by card name
  const handleManualSearch = async () => {
    if (!manualSearch || manualSearch.length < 2) return;

    setManualSearching(true);
    setError(null);

    try {
      console.log('[CardIdentifier] Manual search for:', manualSearch);
      const results = await smartSearch({ name: manualSearch, localId: null, setTotal: null, hp: null });
      console.log('[CardIdentifier] Search results:', results.length);

      if (results.length > 0) {
        setSearchResults(results);
        setStatus('results');
      } else {
        setError('No cards found. Try a different name.');
      }
    } catch (err) {
      console.error('[CardIdentifier] Manual search error:', err);
      setError('Search failed. Check your connection.');
    } finally {
      setManualSearching(false);
    }
  };

  const handleRetry = () => {
    setStatus('idle');
    setIdentifyResult(null);
    setSearchResults([]);
    setSelectedCard(null);
    setError(null);
    startIdentification();
  };

  // Get confidence color
  const getConfidenceColor = (confidence) => {
    if (confidence === 'high') return '#00ff88';
    if (confidence === 'medium') return '#ffcc00';
    return '#ff6633';
  };

  // Get match quality display based on similarity score
  const getMatchDisplay = (similarity) => {
    if (similarity >= 0.85) return { label: 'Excellent', color: '#00ff88' };
    if (similarity >= 0.80) return { label: 'Good', color: '#66dd44' };
    if (similarity >= 0.75) return { label: 'Fair', color: '#ffcc00' };
    return { label: 'Weak', color: '#ff9944' };
  };

  // Legacy distance display (for backwards compatibility)
  const getDistanceDisplay = (distance) => {
    if (distance <= 10) return { label: 'Excellent', color: '#00ff88' };
    if (distance <= 15) return { label: 'Good', color: '#66dd44' };
    if (distance <= 20) return { label: 'Fair', color: '#ffcc00' };
    return { label: 'Weak', color: '#ff9944' };
  };

  return (
    <div style={{
      padding: 16,
      background: '#0a0b0e',
      borderRadius: 12,
      border: '1px solid #1a1c22',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: '#fff' }}>
          Card Identification
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              fontSize: 18,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Status: Identifying with pHash */}
      {status === 'identifying' && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{
            width: 48,
            height: 48,
            margin: '0 auto 16px',
            border: '3px solid #1a1c22',
            borderTopColor: '#6366f1',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <div style={{ fontFamily: mono, fontSize: 12, color: '#888', marginBottom: 8 }}>
            {progress < 30 ? 'Loading AI model...' :
             progress < 50 ? 'Detecting card...' :
             progress < 70 ? 'Analyzing image...' :
             progress < 90 ? 'Finding matches...' :
             'Loading card data...'}
          </div>
          <div style={{
            width: '100%',
            height: 4,
            background: '#1a1c22',
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: '#555', marginTop: 4 }}>
            {progress}%
          </div>

          {/* Skip button */}
          <button
            onClick={() => setStatus('manual')}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid #2a2d35',
              borderRadius: 6,
              color: '#666',
              fontFamily: mono,
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            Skip - Search manually
          </button>
        </div>
      )}

      {/* Status: Show pHash results */}
      {status === 'results' && (
        <div>
          {/* Match info header */}
          {identifyResult && (
            <div style={{
              padding: 12,
              background: '#0d0f13',
              borderRadius: 8,
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: '#666' }}>
                  AI VISUAL MATCH
                </div>
                {identifyResult.topMatch && (
                  <div style={{
                    padding: '3px 8px',
                    background: `${getConfidenceColor(identifyResult.confidence)}22`,
                    borderRadius: 4,
                    fontFamily: mono,
                    fontSize: 9,
                    color: getConfidenceColor(identifyResult.confidence),
                  }}>
                    {identifyResult.confidence?.toUpperCase()} CONFIDENCE
                  </div>
                )}
              </div>
              {identifyResult.topMatch && (
                <div style={{ fontFamily: sans, fontSize: 13, color: '#fff', marginTop: 6 }}>
                  Best match: <strong>{identifyResult.topMatch.name}</strong>
                  {identifyResult.topMatch.variantCount > 1 && (
                    <span style={{ color: '#888', fontSize: 11 }}>
                      {' '}({identifyResult.topMatch.variantCount} versions)
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Card Options */}
          <div style={{ fontFamily: mono, fontSize: 10, color: '#666', marginBottom: 8 }}>
            SELECT YOUR CARD ({searchResults.length} found)
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {searchResults.map((card, idx) => {
              const distInfo = card.distance != null ? getDistanceDisplay(card.distance) : null;

              return (
                <button
                  key={card.id || idx}
                  onClick={() => handleSelectCard(card)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    marginBottom: 8,
                    background: '#0d0f13',
                    border: '1px solid #1a1c22',
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = '#6366f1';
                    e.currentTarget.style.background = '#111318';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = '#1a1c22';
                    e.currentTarget.style.background = '#0d0f13';
                  }}
                >
                  {/* Card Thumbnail */}
                  <div style={{
                    width: 45,
                    height: 63,
                    background: '#1a1c22',
                    borderRadius: 4,
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}>
                    {(() => {
                      const imgUrl = getCardImageUrl(card);
                      return imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={card.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                          loading="lazy"
                        />
                      ) : null;
                    })()}
                  </div>

                  {/* Card Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: sans,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#fff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {card.name}
                    </div>
                    <div style={{
                      fontFamily: mono,
                      fontSize: 10,
                      color: '#666',
                      marginTop: 2,
                    }}>
                      {card.set?.name || card.set || 'Unknown Set'} #{card.localId || card.number}
                    </div>
                  </div>

                  {/* Match indicator - show similarity percentage */}
                  {card.similarity != null ? (
                    (() => {
                      const matchInfo = getMatchDisplay(card.similarity);
                      const pct = Math.round(card.similarity * 100);
                      return (
                        <div style={{
                          padding: '4px 8px',
                          background: `${matchInfo.color}15`,
                          borderRadius: 4,
                          fontFamily: mono,
                          fontSize: 9,
                          color: matchInfo.color,
                        }}>
                          {pct}%
                        </div>
                      );
                    })()
                  ) : distInfo ? (
                    <div style={{
                      padding: '4px 8px',
                      background: `${distInfo.color}15`,
                      borderRadius: 4,
                      fontFamily: mono,
                      fontSize: 9,
                      color: distInfo.color,
                    }}>
                      {distInfo.label}
                    </div>
                  ) : card.matchScore != null && (
                    <div style={{
                      padding: '4px 8px',
                      background: card.matchScore > 80 ? 'rgba(0,255,136,0.1)' : 'rgba(255,153,68,0.1)',
                      borderRadius: 4,
                      fontFamily: mono,
                      fontSize: 9,
                      color: card.matchScore > 80 ? '#00ff88' : '#ff9944',
                    }}>
                      {card.matchScore}%
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Not found option */}
          <button
            onClick={() => setStatus('manual')}
            style={{
              width: '100%',
              padding: 10,
              marginTop: 8,
              background: 'transparent',
              border: '1px dashed #2a2d35',
              borderRadius: 8,
              color: '#555',
              fontFamily: mono,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Not in list? Search by name
          </button>
        </div>
      )}

      {/* Status: Loading full card data */}
      {status === 'loading' && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{
            width: 48,
            height: 48,
            margin: '0 auto 16px',
            border: '3px solid #1a1c22',
            borderTopColor: '#8b5cf6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <div style={{ fontFamily: mono, fontSize: 12, color: '#888' }}>
            Loading card data...
          </div>
          {selectedCard && (
            <div style={{ fontFamily: sans, fontSize: 11, color: '#555', marginTop: 8 }}>
              {selectedCard.name}
            </div>
          )}
        </div>
      )}

      {/* Manual search (fallback) */}
      {status === 'manual' && (
        <div style={{ padding: 16 }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 20 }}>🔍</span>
            <span style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: '#fff' }}>
              Find Your Card
            </span>
          </div>

          {/* Hash DB missing notice */}
          {hashDbMissing && (
            <div style={{
              padding: 10,
              marginBottom: 12,
              background: 'rgba(255,153,68,0.1)',
              border: '1px solid rgba(255,153,68,0.2)',
              borderRadius: 8,
              fontFamily: mono,
              fontSize: 10,
              color: '#ff9944',
            }}>
              Visual matching unavailable - using name search
            </div>
          )}

          {/* Error display */}
          {error && !hashDbMissing && (
            <div style={{
              padding: 10,
              marginBottom: 12,
              background: 'rgba(255,102,102,0.1)',
              border: '1px solid rgba(255,102,102,0.2)',
              borderRadius: 8,
              fontFamily: mono,
              fontSize: 10,
              color: '#ff6666',
            }}>
              {error}
            </div>
          )}

          {/* Search form */}
          <div style={{ fontFamily: mono, fontSize: 10, color: '#666', marginBottom: 8 }}>
            ENTER CARD NAME
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              type="text"
              value={manualSearch}
              onChange={(e) => setManualSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
              placeholder="e.g. Pikachu, Charizard VSTAR..."
              style={{
                flex: 1,
                padding: '12px 14px',
                background: '#0d0f13',
                border: '1px solid #2a2d35',
                borderRadius: 8,
                color: '#fff',
                fontFamily: mono,
                fontSize: 12,
                outline: 'none',
              }}
              autoFocus
            />
            <button
              onClick={handleManualSearch}
              disabled={manualSearching || manualSearch.length < 2}
              style={{
                padding: '12px 20px',
                background: manualSearch.length >= 2 ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#1a1c22',
                border: 'none',
                borderRadius: 8,
                color: manualSearch.length >= 2 ? '#fff' : '#555',
                fontFamily: mono,
                fontSize: 11,
                fontWeight: 600,
                cursor: manualSearch.length >= 2 ? 'pointer' : 'default',
              }}
            >
              {manualSearching ? '...' : 'Search'}
            </button>
          </div>

          {/* Retry pHash button (if not hash DB missing) */}
          {!hashDbMissing && (
            <button
              onClick={handleRetry}
              style={{
                width: '100%',
                padding: 10,
                marginBottom: 8,
                background: '#0d0f13',
                border: '1px solid #2a2d35',
                borderRadius: 8,
                color: '#888',
                fontFamily: mono,
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              Retry visual matching
            </button>
          )}

          {/* Skip option */}
          <button
            onClick={() => onCardIdentified(null)}
            style={{
              width: '100%',
              padding: 10,
              background: 'transparent',
              border: '1px dashed #2a2d35',
              borderRadius: 8,
              color: '#555',
              fontFamily: mono,
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            Skip - I'll enter details later
          </button>
        </div>
      )}

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default CardIdentifier;
