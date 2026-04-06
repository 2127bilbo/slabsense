/**
 * SlabSense - Profile Settings
 * Edit display name, default grading company, delete account
 */

import { useState, useEffect } from 'react';
import { updateProfile, deleteAccount } from '../../services/auth.js';
import { getCompanyOptions } from '../../utils/gradingScales.js';

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

export function ProfileSettings({ user, profile, onClose, onProfileUpdate, onSignOut }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [preferredCompany, setPreferredCompany] = useState(profile?.preferred_company || 'tag');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
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
      await deleteAccount(user.id);
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
            <label style={{
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
            <label style={{
              display: 'block',
              fontFamily: mono,
              fontSize: 10,
              color: '#555',
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Email
            </label>
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
          </div>

          {/* Preferred Grading Company */}
          <div>
            <label style={{
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
                This will permanently delete your account and all saved scans. This action cannot be undone.
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
