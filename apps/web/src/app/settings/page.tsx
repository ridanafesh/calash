'use client';

import { GoogleLogin } from '@react-oauth/google';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { apiClient } from '@/lib/api';
import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';

const inputStyle: React.CSSProperties = {
  padding: '0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: '1rem',
};

const btnStyle: React.CSSProperties = {
  padding: '0.75rem 1.5rem',
  borderRadius: '0.5rem',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  fontSize: '1rem',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '0.75rem',
  padding: '1.5rem',
  marginBottom: '1.25rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

function SettingsContent() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const upgradeMode = searchParams.get('upgrade') === 'true';

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeMsg, setUpgradeMsg] = useState('');
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
  }, [user]);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg('');
    setProfileLoading(true);
    try {
      await apiClient.updateProfile({ displayName: displayName || undefined });
      await refreshUser();
      setProfileMsg('Profile updated.');
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleUpgradePassword(e: React.FormEvent) {
    e.preventDefault();
    setUpgradeMsg('');
    setUpgradeLoading(true);
    try {
      await apiClient.upgradeWithPassword({ email: upgradeEmail, password: upgradePassword });
      await refreshUser();
      setUpgradeMsg('Account created! You can now log in with your email.');
      router.push('/profile');
    } catch (err) {
      setUpgradeMsg(err instanceof Error ? err.message : 'Upgrade failed');
    } finally {
      setUpgradeLoading(false);
    }
  }

  async function handleUpgradeGoogle(response: { credential?: string }) {
    if (!response.credential) return;
    setUpgradeMsg('');
    setUpgradeLoading(true);
    try {
      await apiClient.upgradeWithGoogle({ credential: response.credential });
      await refreshUser();
      router.push('/profile');
    } catch (err) {
      setUpgradeMsg(err instanceof Error ? err.message : 'Google link failed');
    } finally {
      setUpgradeLoading(false);
    }
  }

  if (!user) return null;

  return (
    <main style={{ minHeight: '100vh', padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <Link href="/profile" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
          ← Profile
        </Link>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Account settings</h1>
        <div style={{ width: '5rem' }} />
      </nav>

      {/* ── Guest upgrade banner ─────────────────────────────────────────────── */}
      {user.isGuest && (
        <div style={{ ...cardStyle, borderColor: 'var(--warning, #f59e0b)' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
            {upgradeMode ? 'Create a permanent account' : 'Playing as guest'}
          </h2>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Link an account to keep your game history and play on multiple devices.
          </p>

          {upgradeMsg && (
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--danger)' }}>{upgradeMsg}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoogleLogin
              onSuccess={handleUpgradeGoogle}
              onError={() => setUpgradeMsg('Google link failed')}
              text="signup_with"
              shape="rectangular"
              size="large"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
            <span>or set a password</span>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
          </div>

          <form onSubmit={handleUpgradePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              type="email"
              placeholder="Email address"
              value={upgradeEmail}
              onChange={(e) => setUpgradeEmail(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Password (min 8 chars)"
              value={upgradePassword}
              onChange={(e) => setUpgradePassword(e.target.value)}
              minLength={8}
              required
              style={inputStyle}
            />
            <button type="submit" disabled={upgradeLoading} style={btnStyle}>
              {upgradeLoading ? 'Saving…' : 'Create account'}
            </button>
          </form>
        </div>
      )}

      {/* ── Display name ────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Display name</h2>
        {profileMsg && (
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{profileMsg}</p>
        )}
        <form onSubmit={handleProfileSave} style={{ display: 'flex', gap: '0.75rem' }}>
          <input
            type="text"
            placeholder="Your display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={64}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" disabled={profileLoading} style={{ ...btnStyle, padding: '0.75rem 1rem' }}>
            {profileLoading ? '…' : 'Save'}
          </button>
        </form>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Username: <strong>@{user.username}</strong> (cannot be changed)
        </p>
      </div>

      {/* ── Account info ────────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Account</h2>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Email: <strong>{user.email ?? '—'}</strong>
        </p>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Account type: <strong>{user.isGuest ? 'Guest' : 'Permanent'}</strong>
        </p>
      </div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <Suspense>
        <SettingsContent />
      </Suspense>
    </AuthGuard>
  );
}
