'use client';

import Link from 'next/link';

import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';

function LobbyContent() {
  const { user } = useAuth();

  return (
    <main style={{ minHeight: '100vh', padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>Game Lobby</h1>
        <Link
          href="/profile"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'var(--text-primary)',
            textDecoration: 'none',
            fontSize: '0.9rem',
            padding: '0.5rem 0.875rem',
            border: '1px solid var(--border)',
            borderRadius: '2rem',
          }}
        >
          <span>{user?.displayName ?? user?.username}</span>
          {user?.isGuest && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>(guest)</span>
          )}
        </Link>
      </header>

      <p style={{ color: 'var(--text-secondary)' }}>
        Room list and creation will be implemented in the next chunk.
      </p>
    </main>
  );
}

export default function LobbyPage() {
  return (
    <AuthGuard>
      <LobbyContent />
    </AuthGuard>
  );
}
