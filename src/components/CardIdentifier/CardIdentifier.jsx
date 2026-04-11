/**
 * CardIdentifier - Automated card identification via OCR + TCGDex
 *
 * Flow:
 * 1. User captures card image
 * 2. OCR extracts name/set number
 * 3. TCGDex search finds matches
 * 4. User confirms correct card
 * 5. Returns full card data + high-quality image
 */

import { useState, useEffect } from 'react';
import { extractCardInfo } from '../../services/ocr.js';
import { smartSearch, getFullCardData, getImageUrlFromCard } from '../../services/tcgdex.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

export function CardIdentifier({
  cardImage,           // The user's captured card image
  onCardIdentified,    // Callback when card is identified: (cardData) => void
  onCancel,            // Callback to cancel
  autoStart = true,    // Start OCR automatically
}) {
  const [status, setStatus] = useState('idle'); // idle | ocr | searching | results | loading | error
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrResults, setOcrResults] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [error, setError] = useState(null);

  // Auto-start OCR when image is provided
  useEffect(() => {
    if (cardImage && autoStart && status === 'idle') {
      startIdentification();
    }
  }, [cardImage, autoStart]);

  const startIdentification = async () => {
    if (!cardImage) return;

    setStatus('ocr');
    setError(null);

    try {
      // Step 1: OCR extraction
      const ocr = await extractCardInfo(cardImage, setOcrProgress);
      setOcrResults(ocr);

      if (!ocr.name && !ocr.localId) {
        setError('Could not read card text. Try a clearer photo.');
        setStatus('error');
        return;
      }

      // Step 2: Search TCGDex
      setStatus('searching');
      const results = await smartSearch(ocr);
      setSearchResults(results);

      if (results.length === 0) {
        setError('No matching cards found. Try entering manually.');
        setStatus('error');
        return;
      }

      // If we have a high-confidence match, auto-select it
      if (results.length === 1 || (results[0]?.matchScore > 100 && results[0]?.matchScore > (results[1]?.matchScore || 0) * 1.5)) {
        handleSelectCard(results[0]);
      } else {
        setStatus('results');
      }
    } catch (err) {
      console.error('Identification error:', err);
      setError(err.message || 'Failed to identify card');
      setStatus('error');
    }
  };

  const handleSelectCard = async (card) => {
    setSelectedCard(card);
    setStatus('loading');

    try {
      // Get full card data
      const fullData = await getFullCardData(card.id);

      if (fullData) {
        onCardIdentified(fullData);
      } else {
        setError('Failed to load card details');
        setStatus('error');
      }
    } catch (err) {
      console.error('Load card error:', err);
      setError(err.message);
      setStatus('error');
    }
  };

  const handleRetry = () => {
    setStatus('idle');
    setOcrResults(null);
    setSearchResults([]);
    setSelectedCard(null);
    setError(null);
    startIdentification();
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

      {/* Status: OCR in progress */}
      {status === 'ocr' && (
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
            Reading card text...
          </div>
          <div style={{
            width: '100%',
            height: 4,
            background: '#1a1c22',
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${ocrProgress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: '#555', marginTop: 4 }}>
            {ocrProgress}%
          </div>
        </div>
      )}

      {/* Status: Searching TCGDex */}
      {status === 'searching' && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{
            width: 48,
            height: 48,
            margin: '0 auto 16px',
            border: '3px solid #1a1c22',
            borderTopColor: '#00ff88',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <div style={{ fontFamily: mono, fontSize: 12, color: '#888' }}>
            Searching card database...
          </div>
          {ocrResults && (
            <div style={{ marginTop: 12, fontFamily: mono, fontSize: 10, color: '#555' }}>
              Looking for: {ocrResults.name || '?'} #{ocrResults.localId || '?'}
            </div>
          )}
        </div>
      )}

      {/* Status: Show search results */}
      {status === 'results' && (
        <div>
          {/* OCR Results Summary */}
          <div style={{
            padding: 12,
            background: '#0d0f13',
            borderRadius: 8,
            marginBottom: 12,
          }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: '#666', marginBottom: 6 }}>
              DETECTED TEXT
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div>
                <span style={{ fontFamily: mono, fontSize: 10, color: '#555' }}>Name: </span>
                <span style={{ fontFamily: mono, fontSize: 11, color: '#00ff88' }}>
                  {ocrResults?.name || 'N/A'}
                </span>
              </div>
              <div>
                <span style={{ fontFamily: mono, fontSize: 10, color: '#555' }}>Number: </span>
                <span style={{ fontFamily: mono, fontSize: 11, color: '#00ff88' }}>
                  {ocrResults?.localId || 'N/A'}{ocrResults?.setTotal ? `/${ocrResults.setTotal}` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Card Options */}
          <div style={{ fontFamily: mono, fontSize: 10, color: '#666', marginBottom: 8 }}>
            SELECT MATCHING CARD ({searchResults.length} found)
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {searchResults.map((card) => (
              <button
                key={card.id}
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
                  {card.image && (
                    <img
                      src={`${card.image}/low.webp`}
                      alt={card.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
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
                    {card.set?.name || 'Unknown Set'} #{card.localId}
                  </div>
                  {card.rarity && (
                    <div style={{
                      fontFamily: mono,
                      fontSize: 9,
                      color: '#8b5cf6',
                      marginTop: 2,
                    }}>
                      {card.rarity}
                    </div>
                  )}
                </div>

                {/* Match Score */}
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
              </button>
            ))}
          </div>

          {/* Manual Entry Option */}
          <button
            onClick={() => onCardIdentified(null)} // Signal to use manual entry
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
            Not listed? Enter manually
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

      {/* Status: Error */}
      {status === 'error' && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{
            width: 48,
            height: 48,
            margin: '0 auto 16px',
            background: 'rgba(255,102,102,0.1)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
          }}>
            !
          </div>
          <div style={{ fontFamily: mono, fontSize: 12, color: '#ff6666', marginBottom: 16 }}>
            {error}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={handleRetry}
              style={{
                padding: '10px 20px',
                background: '#1a1c22',
                border: '1px solid #2a2d35',
                borderRadius: 8,
                color: '#888',
                fontFamily: mono,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              onClick={() => onCardIdentified(null)}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                fontFamily: mono,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Enter Manually
            </button>
          </div>
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
