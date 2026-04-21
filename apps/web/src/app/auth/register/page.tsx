'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/lib/auth-context';

const inputStyle: React.CSSProperties = {
  padding: '0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: '1rem',
};

export default function RegisterPage() {
  const router = useRouter();
  const { loginWithPassword } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { apiClient } = await import('@/lib/api');
      await apiClient.register({ username, email, password });
      // After registration, log in via context so user state is populated
      await loginWithPassword(email, password);
      router.push('/lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '2rem',
          width: '100%',
          maxWidth: '400px',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Create account</h1>
        {error && <p style={{ color: 'var(--danger)', fontSize: '0.875rem', margin: 0 }}>{error}</p>}
        <input
          type="text"
          placeholder="Username (letters, numbers, _)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={32}
          style={inputStyle}
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '0.75rem', borderRadius: '0.5rem', background: 'var(--accent)', color: '#fff', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '1rem' }}
        >
          {loading ? 'Creating…' : 'Create account'}
        </button>
        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)', margin: 0 }}>
          Already have an account?{' '}
          <Link href="/auth/login" style={{ color: 'var(--accent)' }}>
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
