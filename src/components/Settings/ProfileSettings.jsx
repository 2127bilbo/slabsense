/**
 * SlabSense - Profile Settings
 * Edit display name, default grading company, delete account
 */

import { useState, useEffect } from 'react';
import { updateProfile, deleteAccount, updatePassword, updateEmail, exportAccountData } from '../../services/auth.js';
import { getCompanyOptions } from '../../utils/gradingScales.js';
import { modelGradingEnabled, setModelGrading, modelPassCrashed, clearModelPassCrash } from '../../services/cornerEdgeModels.js';
import { trainingCaptureEnabled, setTrainingCapture } from '../../services/trainingCapture.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

export function ProfileSettings({ user, profile, onClose, onProfileUpdate, onSignOut }) {
  const [modelGrading, setModelGradingState] = useState(modelGradingEnabled());
  const [modelCrash, setModelCrash] = useState(modelPassCrashed());
  const [keepOriginals, setKeepOriginalsState] = useState(trainingCaptureEnabled());
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [preferredCompany, setPreferredCompany] = useState(profile?.preferred_company || 'tag');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [accountMsg, setAccountMsg] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || '');
      setPreferredCompany(profile.preferred_company || 'tag');
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      await updateProfile(user.id, {
        display_name: displayName,
        preferred_company: preferredCompany,
      });
      setSaved(true);
      onProfileUpdate?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteText !== 'DELETE') return;
    setDeleting(true);
    setError(null);

    try {
      await deleteAccount();
      onSignOut();
      onClose();
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  const companyOptions = getCompanyOptions();

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#0a0b0e',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid #1a1c22',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
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
        <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: '#fff' }}>
          Settings
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {/* Error Message */}
        {error && (
          <div style={{
            padding: 12,
            marginBottom: 16,
            background: 'rgba(255,68,68,0.1)',
            border: '1px solid rgba(255,68,68,0.3)',
            borderRadius: 8,
            fontFamily: sans,
            fontSize: 12,
            color: '#ff6666',
          }}>
            {error}
          </div>
        )}

        {/* Profile Section */}
        {/* Legal + your data */}
        <div style={{ marginBottom: 20, padding: 16, background: '#0d0f13', border: '1px solid #1a1c22', borderRadius: 12 }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: '#555', marginBottom: 10, textTransform: 'uppercase' }}>Legal &amp; your data</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontFamily: sans, fontSize: 13 }}>
            <a href="/privacy" target="_blank" rel="noopener" style={{ color: '#8b5cf6' }}>Privacy Policy</a>
            <a href="/terms" target="_blank" rel="noopener" style={{ color: '#8b5cf6' }}>Terms of Service</a>
            <a href="/disclaimers" target="_blank" rel="noopener" style={{ color: '#8b5cf6' }}>Disclaimers</a>
            <button type="button" onClick={async () => { setAccountMsg(null); try { const data = await exportAccountData(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'slabsense-export.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); } catch (e) { setAccountMsg(e.message); } }}
              style={{ background: 'none', border: 'none', padding: 0, color: '#8b5cf6', fontFamily: sans, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', minHeight: 44 }}>Download my data</button>
          </div>
          <div style={{ fontFamily: sans, fontSize: 11, color: '#666', marginTop: 8, lineHeight: 1.5 }}>Grades in SlabSense are estimates and SlabSense is not affiliated with any grading company. Paid AI grades send your card photos to Anthropic for analysis, as described in the privacy policy.</div>
        </div>

        <div style={{
          background: '#0d0f13',
          borderRadius: 10,
          border: '1px solid #1a1c22',
          padding: 16,
          marginBottom: 16,
        }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#666',
            textTransform: 'uppercase',
            marginBottom: 16,
          }}>
            Profile
          </div>

          {/* Display Name */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="settings-display-name" style={{
              display: 'block',
              fontFamily: mono,
              fontSize: 10,
              color: '#555',
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Display Name
            </label>
            <input
              id="settings-display-name"
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

          {/* Email (read-only) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'block',
              fontFamily: mono,
              fontSize: 10,
              color: '#555',
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Email
            </div>
            <div style={{
              padding: '10px 12px',
              background: '#151720',
              border: '1px solid #1a1c22',
              borderRadius: 6,
              color: '#666',
              fontFamily: mono,
              fontSize: 12,
            }}>
              {user?.email}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="New email address" aria-label="New email address"
                style={{ flex: 1, padding: '10px 12px', background: '#1a1c22', border: '1px solid #2a2d35', borderRadius: 6, color: '#fff', fontFamily: sans, fontSize: 14, outline: 'none' }} />
              <button type="button" disabled={!newEmail} onClick={async () => { setAccountMsg(null); try { await updateEmail(newEmail); setAccountMsg('Check the new address for a confirmation link; the change applies after you click it.'); setNewEmail(''); } catch (e) { setAccountMsg(e.message); } }}
                style={{ padding: '0 14px', minHeight: 44, borderRadius: 6, border: '1px solid #2a2d35', background: 'transparent', color: newEmail ? '#fff' : '#555', fontFamily: mono, fontSize: 11, cursor: 'pointer' }}>Change</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (8+ characters)" aria-label="New password"
                style={{ flex: 1, padding: '10px 12px', background: '#1a1c22', border: '1px solid #2a2d35', borderRadius: 6, color: '#fff', fontFamily: sans, fontSize: 14, outline: 'none' }} />
              <button type="button" disabled={newPassword.length < 8} onClick={async () => { setAccountMsg(null); try { await updatePassword(newPassword); setAccountMsg('Password updated.'); setNewPassword(''); } catch (e) { setAccountMsg(e.message); } }}
                style={{ padding: '0 14px', minHeight: 44, borderRadius: 6, border: '1px solid #2a2d35', background: 'transparent', color: newPassword.length >= 8 ? '#fff' : '#555', fontFamily: mono, fontSize: 11, cursor: 'pointer' }}>Change</button>
            </div>
            {accountMsg && <div role="status" style={{ fontFamily: sans, fontSize: 12, color: '#999', marginTop: 8 }}>{accountMsg}</div>}
          </div>

          {/* Preferred Grading Company */}
          <div>
            <label htmlFor="settings-company" style={{
              display: 'block',
              fontFamily: mono,
              fontSize: 10,
              color: '#555',
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Default Grading Company
            </label>
            <select
              id="settings-company"
              value={preferredCompany}
              onChange={(e) => setPreferredCompany(e.target.value)}
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
                cursor: 'pointer',
              }}
            >
              {companyOptions.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div style={{
              fontFamily: mono,
              fontSize: 10,
              color: '#444',
              marginTop: 6,
            }}>
              This company will be selected by default when you open the app
            </div>
          </div>

          {/* Corner and edge models (software grade) */}
          <div>
            <label htmlFor="settings-models-toggle" style={{
              display: 'block',
              fontFamily: mono,
              fontSize: 10,
              color: '#555',
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Corner &amp; Edge Models
            </label>
            <button
              id="settings-models-toggle"
              type="button"
              onClick={() => { const next = !modelGrading; setModelGrading(next); setModelGradingState(next); if (next) { clearModelPassCrash(); setModelCrash(null); } }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                background: '#1a1c22',
                border: `1px solid ${modelGrading ? '#3a7d44' : '#2a2d35'}`,
                borderRadius: 6,
                color: '#fff',
                fontFamily: sans,
                fontSize: 14,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>Use the trained models on the free grade</span>
              <span style={{
                fontFamily: mono,
                fontSize: 11,
                color: modelGrading ? '#6ede82' : '#666',
                border: `1px solid ${modelGrading ? '#3a7d44' : '#2a2d35'}`,
                borderRadius: 4,
                padding: '2px 8px',
              }}>
                {modelGrading ? 'ON' : 'OFF'}
              </span>
            </button>
            <div style={{
              fontFamily: mono,
              fontSize: 10,
              color: '#444',
              marginTop: 6,
            }}>
              Finds corner and edge wear with the TAG-trained models instead of the pixel
              detectors. Downloads about 110 MB the first time, then works offline. Slower on
              phones without WebGPU.
            </div>
            {modelCrash && (
              <div style={{ fontFamily: mono, fontSize: 10, color: '#e0a040', marginTop: 6 }}>
                Turned off automatically: the app restarted during a model pass on this device
                ({new Date(modelCrash).toLocaleString()}), which usually means it ran out of memory.
                Turn it back on to try again.
              </div>
            )}
          </div>

          {/* Keep originals for training */}
          <div>
            <label htmlFor="settings-training-toggle" style={{
              display: 'block',
              fontFamily: mono,
              fontSize: 10,
              color: '#555',
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Keep Originals For Training
            </label>
            <button
              id="settings-training-toggle"
              type="button"
              onClick={() => { const next = !keepOriginals; setTrainingCapture(next); setKeepOriginalsState(next); }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                background: '#1a1c22',
                border: `1px solid ${keepOriginals ? '#3a7d44' : '#2a2d35'}`,
                borderRadius: 6,
                color: '#fff',
                fontFamily: sans,
                fontSize: 14,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>Let SlabSense keep my full card photos to train its models</span>
              <span style={{
                fontFamily: mono,
                fontSize: 11,
                color: keepOriginals ? '#6ede82' : '#666',
                border: `1px solid ${keepOriginals ? '#3a7d44' : '#2a2d35'}`,
                borderRadius: 4,
                padding: '2px 8px',
              }}>
                {keepOriginals ? 'ON' : 'OFF'}
              </span>
            </button>
            <div style={{ fontFamily: sans, fontSize: 11, color: '#777', marginTop: 6, lineHeight: 1.5 }}>
              Off by default. When on, the original front and back photos and the card outline you draw are stored with the saved card and may be used to train SlabSense&apos;s card-detection and grading models. They are tied to your account, not shared with anyone else, and are deleted when you delete the card or your account. Turn it off any time; photos already saved stay until you delete those cards.
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%',
            padding: '12px 0',
            marginBottom: 24,
            borderRadius: 8,
            border: 'none',
            background: saved
              ? 'rgba(0,255,136,0.2)'
              : saving
              ? '#1a1c22'
              : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
            color: saved ? '#00ff88' : '#fff',
            fontFamily: mono,
            fontSize: 12,
            fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
            textTransform: 'uppercase',
          }}
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
        </button>

        {/* Danger Zone */}
        <div style={{
          background: '#0d0f13',
          borderRadius: 10,
          border: '1px solid rgba(255,68,68,0.2)',
          padding: 16,
        }}>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: '#ff6666',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}>
            Danger Zone
          </div>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 8,
                border: '1px solid rgba(255,68,68,0.3)',
                background: 'transparent',
                color: '#ff6666',
                fontFamily: mono,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Delete Account
            </button>
          ) : (
            <div>
              <div style={{
                fontFamily: sans,
                fontSize: 12,
                color: '#999',
                marginBottom: 12,
                lineHeight: 1.5,
              }}>
                This permanently deletes your account: every saved card and photo, your grade history, any remaining credits, and your billing record. An active subscription is cancelled. A physical slab you ordered keeps its public cert page, but your name and address are removed from it. This cannot be undone.
              </div>
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: '#666',
                marginBottom: 8,
              }}>
                Type DELETE to confirm:
              </div>
              <input
                type="text"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value.toUpperCase())}
                placeholder="DELETE"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  marginBottom: 12,
                  background: '#1a1c22',
                  border: '1px solid rgba(255,68,68,0.3)',
                  borderRadius: 6,
                  color: '#ff6666',
                  fontFamily: mono,
                  fontSize: 14,
                  outline: 'none',
                  textAlign: 'center',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteText(''); }}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 6,
                    border: '1px solid #2a2d35',
                    background: 'transparent',
                    color: '#666',
                    fontFamily: mono,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteText !== 'DELETE' || deleting}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 6,
                    border: 'none',
                    background: deleteText === 'DELETE' ? '#ff4444' : '#2a2d35',
                    color: deleteText === 'DELETE' ? '#fff' : '#555',
                    fontFamily: mono,
                    fontSize: 11,
                    cursor: deleteText === 'DELETE' ? 'pointer' : 'not-allowed',
                  }}
                >
                  {deleting ? 'Deleting...' : 'Delete Forever'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
