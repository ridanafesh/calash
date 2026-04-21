'use client';

import { GoogleLogin } from '@react-oauth/google';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/lib/auth-context';

const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] ?? '';

export default function LoginPage() {
  const router = useRouter();
  const { loginWithPassword, loginWithGoogle, loginAsGuest } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<null | 'password' | 'google' | 'guest'>(null);

  const isBusy = loading !== null;

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading('password');
    try {
      await loginWithPassword(email, password);
      router.push('/lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(null);
    }
  }

  async function handleGoogleSuccess(response: { credential?: string }) {
    if (!response.credential) {
      setError('Google sign-in returned no credential');
      return;
    }
    setError('');
    setLoading('google');
    try {
      await loginWithGoogle(response.credential);
      router.push('/lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
      setLoading(null);
    }
  }

  async function handleGuestLogin() {
    setError('');
    setLoading('guest');
    try {
      await loginAsGuest();
      router.push('/lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start guest session');
      setLoading(null);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <header className="auth-header">
          <h1 className="auth-title">Welcome to Calash</h1>
          <p className="auth-subtitle">Sign in to play with friends in real time.</p>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {GOOGLE_CLIENT_ID ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google sign-in failed')}
              text="signin_with"
              shape="rectangular"
              size="large"
              theme="filled_black"
              width="356"
            />
          </div>
        ) : null}

        {GOOGLE_CLIENT_ID ? <div className="auth-divider"><span>or</span></div> : null}

        <form onSubmit={handlePasswordLogin} className="auth-form" noValidate suppressHydrationWarning>
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
              disabled={isBusy}
              required
              suppressHydrationWarning
            />
          </div>
          <div className="field" suppressHydrationWarning>
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="Your password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isBusy}
              required
              suppressHydrationWarning
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={isBusy}
          >
            {loading === 'password' ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <div className="auth-divider"><span>or</span></div>

        <button
          type="button"
          onClick={handleGuestLogin}
          disabled={isBusy}
          className="btn btn-ghost btn-lg btn-block"
        >
          {loading === 'guest' ? 'Starting guest session…' : 'Continue as guest'}
        </button>

        <p className="auth-footer">
          No account? <Link href="/auth/register">Create one</Link>
        </p>
      </div>
    </main>
  );
}
