'use client';

import { GoogleLogin } from '@react-oauth/google';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] ?? '';

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
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
      setError(err instanceof Error ? err.message : t('auth.loginFailed'));
      setLoading(null);
    }
  }

  async function handleGoogleSuccess(response: { credential?: string }) {
    if (!response.credential) {
      setError(t('auth.googleNoCredential'));
      return;
    }
    setError('');
    setLoading('google');
    try {
      await loginWithGoogle(response.credential);
      router.push('/lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.googleFailed'));
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
      setError(err instanceof Error ? err.message : t('auth.guestFailed'));
      setLoading(null);
    }
  }

  return (
    <main className="auth-shell">
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <LanguageSwitcher />
      </div>
      <div className="auth-card">
        <header className="auth-header">
          <h1 className="auth-title">{t('auth.login.title')}</h1>
          <p className="auth-subtitle">{t('auth.login.subtitle')}</p>
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
              onError={() => setError(t('auth.googleFailed'))}
              text="signin_with"
              shape="rectangular"
              size="large"
              theme="filled_black"
              width="356"
            />
          </div>
        ) : null}

        {GOOGLE_CLIENT_ID ? <div className="auth-divider"><span>{t('auth.divider.or')}</span></div> : null}

        <form onSubmit={handlePasswordLogin} className="auth-form" noValidate suppressHydrationWarning>
          <div className="field" suppressHydrationWarning>
            <label htmlFor="email" className="label">{t('auth.email')}</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder={t('auth.emailPlaceholder')}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isBusy}
              required
              suppressHydrationWarning
            />
          </div>
          <div className="field" suppressHydrationWarning>
            <label htmlFor="password" className="label">{t('auth.password')}</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder={t('auth.passwordPlaceholder')}
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
                {t('auth.signingIn')}
              </>
            ) : (
              t('auth.signIn')
            )}
          </button>
        </form>

        <div className="auth-divider"><span>{t('auth.divider.or')}</span></div>

        <button
          type="button"
          onClick={handleGuestLogin}
          disabled={isBusy}
          className="btn btn-ghost btn-lg btn-block"
        >
          {loading === 'guest' ? t('auth.startingGuest') : t('auth.continueAsGuest')}
        </button>

        <p className="auth-footer">
          {t('auth.noAccount')} <Link href="/auth/register">{t('auth.createOne')}</Link>
        </p>
      </div>
    </main>
  );
}
