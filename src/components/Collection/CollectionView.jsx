/**
 * SlabSense - Collection View
 * Displays user's saved card scans
 */

import { useState, useEffect } from 'react';
import { getUserScans, deleteScan } from '../../services/scans.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

export function CollectionView({ userId, onClose, isInline = false }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    loadScans();
  }, [userId]);

  const loadScans = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getUserScans(userId);
      setScans(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (scanId) => {
    try {
      await deleteScan(scanId);
      setScans(scans.filter(s => s.id !== scanId));
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const getGradeColor = (grade) => {
    if (grade >= 9.5) return '#00ff88';
    if (grade >= 9) return '#66dd44';
    if (grade >= 8) return '#ffcc00';
    if (grade >= 7) return '#ff9944';
    return '#ff6633';
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const companyLabels = {
    tag: 'TAG',
    psa: 'PSA',
    bgs: 'BGS',
    cgc: 'CGC',
    sgc: 'SGC',
  };

  return (
    <div style={isInline ? {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    } : {
      position: 'fixed',
      inset: 0,
      background: '#0a0b0e',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header - only show when not inline (inline uses app header) */}
      {!isInline && (
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid #1a1c22',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              fontSize: 20,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ←
          </button>
          <div>
            <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff' }}>
              My Collection
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: '#555' }}>
              {scans.length} {scans.length === 1 ? 'scan' : 'scans'} saved
            </div>
          </div>
        </div>
      </div>
      )}
      {/* Inline header - simpler version */}
      {isInline && (
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1a1c22',
        }}>
          <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff' }}>
            My Collection
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: '#555', marginTop: 2 }}>
            {scans.length} {scans.length === 1 ? 'scan' : 'scans'} saved
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontFamily: mono, fontSize: 12, color: '#555' }}>Loading...</div>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontFamily: mono, fontSize: 12, color: '#ff6666' }}>{error}</div>
          </div>
        ) : scans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
            <div style={{ fontFamily: sans, fontSize: 14, color: '#666', marginBottom: 8 }}>
              No scans yet
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#444' }}>
              Grade a card and click "Save to Collection"
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {scans.map(scan => (
              <div
                key={scan.id}
                style={{
                  background: '#0d0f13',
                  borderRadius: 10,
                  border: '1px solid #1a1c22',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    {/* Grade Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 50,
                        height: 50,
                        borderRadius: 8,
                        background: `${getGradeColor(scan.grade_value)}15`,
                        border: `1px solid ${getGradeColor(scan.grade_value)}33`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <div style={{
                          fontFamily: mono,
                          fontSize: 18,
                          fontWeight: 800,
                          color: getGradeColor(scan.grade_value),
                        }}>
                          {scan.grade_value}
                        </div>
                      </div>
                      <div>
                        <div style={{
                          fontFamily: mono,
                          fontSize: 12,
                          fontWeight: 600,
                          color: getGradeColor(scan.grade_value),
                        }}>
                          {scan.grade_label}
                        </div>
                        <div style={{
                          fontFamily: mono,
                          fontSize: 10,
                          color: '#555',
                          marginTop: 2,
                        }}>
                          {companyLabels[scan.grading_company] || 'TAG'} estimate
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {deleteConfirm === scan.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(scan.id)}
                            style={{
                              background: 'rgba(255,68,68,0.2)',
                              border: '1px solid rgba(255,68,68,0.3)',
                              borderRadius: 4,
                              color: '#ff6666',
                              fontFamily: mono,
                              fontSize: 9,
                              padding: '4px 8px',
                              cursor: 'pointer',
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            style={{
                              background: 'transparent',
                              border: '1px solid #2a2d35',
                              borderRadius: 4,
                              color: '#666',
                              fontFamily: mono,
                              fontSize: 9,
                              padding: '4px 8px',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(scan.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#444',
                            fontSize: 14,
                            cursor: 'pointer',
                            padding: 4,
                          }}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stats Row */}
                  <div style={{
                    display: 'flex',
                    gap: 8,
                    marginBottom: 12,
                  }}>
                    <div style={{
                      flex: 1,
                      padding: '8px 10px',
                      background: '#0a0b0e',
                      borderRadius: 6,
                    }}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: '#555', marginBottom: 2 }}>RAW</div>
                      <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: '#888' }}>
                        {scan.raw_score}
                      </div>
                    </div>
                    {scan.front_centering && (
                      <div style={{
                        flex: 1,
                        padding: '8px 10px',
                        background: '#0a0b0e',
                        borderRadius: 6,
                      }}>
                        <div style={{ fontFamily: mono, fontSize: 9, color: '#555', marginBottom: 2 }}>FRONT</div>
                        <div style={{ fontFamily: mono, fontSize: 11, color: '#888' }}>
                          {Math.round(scan.front_centering.lrRatio)}/{Math.round(100 - scan.front_centering.lrRatio)} · {Math.round(scan.front_centering.tbRatio)}/{Math.round(100 - scan.front_centering.tbRatio)}
                        </div>
                      </div>
                    )}
                    {scan.back_centering && (
                      <div style={{
                        flex: 1,
                        padding: '8px 10px',
                        background: '#0a0b0e',
                        borderRadius: 6,
                      }}>
                        <div style={{ fontFamily: mono, fontSize: 9, color: '#555', marginBottom: 2 }}>BACK</div>
                        <div style={{ fontFamily: mono, fontSize: 11, color: '#888' }}>
                          {Math.round(scan.back_centering.lrRatio)}/{Math.round(100 - scan.back_centering.lrRatio)} · {Math.round(scan.back_centering.tbRatio)}/{Math.round(100 - scan.back_centering.tbRatio)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* DINGS */}
                  {scan.dings && scan.dings.length > 0 && (
                    <div style={{
                      padding: '8px 10px',
                      background: 'rgba(255,102,51,0.1)',
                      borderRadius: 6,
                      marginBottom: 12,
                    }}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: '#ff6633', marginBottom: 4 }}>
                        {scan.dings.length} DING{scan.dings.length > 1 ? 'S' : ''}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 10, color: '#888' }}>
                        {scan.dings.slice(0, 3).map(d => d.location).join(' · ')}
                        {scan.dings.length > 3 && ` +${scan.dings.length - 3} more`}
                      </div>
                    </div>
                  )}

                  {/* Card Name & Date */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontFamily: sans, fontSize: 12, color: '#666' }}>
                      {scan.card_name || 'Unnamed Card'}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: '#444' }}>
                      {formatDate(scan.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
