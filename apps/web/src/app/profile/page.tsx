'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';

function ProfileContent() {
  const { user, logout } = useAuth();
  const router = useRouter();

  if (!user) return null;

  function handleLogout() {
    logout();
    router.push('/');
  }

  const initials = (user.displayName ?? user.username)
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <main style={{ minHeight: '100vh', padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <Link href="/lobby" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
          ← Lobby
        </Link>
        <Link href="/settings" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.875rem' }}>
          Settings
        </Link>
      </nav>

      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          textAlign: 'center',
        }}
      >
        {/* Avatar */}
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt={user.displayName ?? user.username}
            width={80}
            height={80}
            style={{ borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'var(--accent)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.75rem',
              fontWeight: 700,
            }}
          >
            {initials}
          </div>
        )}

        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
            {user.displayName ?? user.username}
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
            @{user.username}
          </p>
          {user.email && (
            <p style={{ color: 'var(--text-secondary)', margin: '0.125rem 0 0', fontSize: '0.875rem' }}>
              {user.email}
            </p>
          )}
        </div>

        {user.isGuest && (
          <div
            style={{
              background: 'var(--warning-bg, #fffbeb)',
              border: '1px solid var(--warning, #f59e0b)',
              borderRadius: '0.5rem',
              padding: '0.75rem 1rem',
              fontSize: '0.875rem',
              color: 'var(--warning-text, #92400e)',
            }}
          >
            You&apos;re playing as a guest.{' '}
            <Link href="/settings?upgrade=true" style={{ fontWeight: 600, color: 'inherit' }}>
              Create an account
            </Link>{' '}
            to save your progress.
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link
            href="/settings"
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: '0.9rem',
            }}
          >
            Edit profile
          </Link>
          <button
            onClick={handleLogout}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--danger, #ef4444)',
              color: 'var(--danger, #ef4444)',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.9rem',
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <AuthGuard>
      <ProfileContent />
    </AuthGuard>
  );
}
