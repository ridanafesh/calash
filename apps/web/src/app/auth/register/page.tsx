'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/lib/auth-context';

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
      await loginWithPassword(email, password);
      router.push('/lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <form onSubmit={handleSubmit} className="auth-card" noValidate suppressHydrationWarning>
        <header className="auth-header">
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-subtitle">Pick a username and start playing.</p>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <div className="field" suppressHydrationWarning>
          <label htmlFor="username" className="label">Username</label>
          <input
            id="username"
            type="text"
            className="input"
            placeholder="letters, numbers, _"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            required
            minLength={3}
            maxLength={32}
          />
        </div>

        <div className="field" suppressHydrationWarning>
          <label htmlFor="email" className="label">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="field" suppressHydrationWarning>
          <label htmlFor="password" className="label">Password</label>
          <input
            id="password"
            type="password"
            className="input"
            placeholder="min 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
            minLength={8}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary btn-lg btn-block"
        >
          {loading ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Creating account…
            </>
          ) : (
            'Create account'
          )}
        </button>

        <p className="auth-footer">
          Already have an account? <Link href="/auth/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
