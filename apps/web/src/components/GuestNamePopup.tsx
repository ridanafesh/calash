'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { apiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';

const MAX_LEN = 32;

interface Props {
  /** Called after a successful save (or skip) so the parent can clear
   *  the trigger flag (e.g. mark localStorage so we don't re-prompt). */
  onClose: () => void;
}

/**
 * One-time popup shown to guest users right after sign-in. Prefilled
 * with the server-generated display name (e.g. "Guest 4821"). The user
 * can keep it or pick something else; either way we mark the prompt
 * as resolved so they don't see it again on this device for this guest
 * session.
 *
 * On save we PUT /api/profile, refresh the auth context so the new
 * displayName is immediately visible in the UI, and signal the parent
 * to drop the popup. The parent is responsible for reconnecting the
 * socket so socket.data.displayName picks up the new value.
 */
export function GuestNamePopup({ onClose }: Props) {
  const t = useT();
  const { user, refreshUser } = useAuth();
  const { reconnectSocket } = useGame();
  const initial = user?.displayName?.trim() || user?.username || '';
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the user object hydrates after first paint (rare race), refresh
  // the input default so we never show an empty box.
  useEffect(() => {
    if (!name && initial) setName(initial);
    // intentionally only on initial change — typing should not get clobbered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(t('guest.popup.error.empty'));
      return;
    }
    if (trimmed.length > MAX_LEN) {
      setError(t('guest.popup.error.tooLong', { n: MAX_LEN }));
      return;
    }
    setError(null);

    // No-op when the user kept the server-generated default. Skipping
    // the network call avoids a "no fields to update" round-trip and
    // makes the Continue path instant. The socket already has the
    // default name from handshake, so no reconnect is needed either.
    if (trimmed === (user?.displayName ?? '').trim()) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await apiClient.updateProfile({ displayName: trimmed });
      await refreshUser();
      // Re-handshake the socket so socket.data.displayName picks up
      // the new name. Otherwise any room the user joins would still
      // see the old default in their seat slot.
      reconnectSocket();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('guest.popup.error.saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-name-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(0, 0, 0, 0.66)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onSubmit={save}
        style={{
          background: 'var(--bg-elevated, #1f2937)',
          color: 'var(--text-primary, white)',
          borderRadius: 12,
          padding: 24,
          maxWidth: 420,
          width: '100%',
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
        }}
      >
        <h2 id="guest-name-title" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
          {t('guest.popup.title')}
        </h2>
        <p style={{ margin: '8px 0 16px', fontSize: '0.9rem', color: 'var(--text-secondary, #9ca3af)' }}>
          {t('guest.popup.hint')}
        </p>

        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder={t('guest.popup.placeholder')}
          maxLength={MAX_LEN}
          autoFocus
          disabled={saving}
          style={{ width: '100%', marginBottom: 8 }}
        />

        {error && (
          <div
            role="alert"
            style={{
              fontSize: '0.85rem',
              color: '#fca5a5',
              marginBottom: 8,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
          >
            {saving
              ? t('guest.popup.saving')
              : name.trim() === (user?.displayName ?? '').trim()
                ? t('guest.popup.continue')
                : t('guest.popup.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
