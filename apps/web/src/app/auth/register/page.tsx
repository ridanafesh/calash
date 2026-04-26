'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export default function RegisterPage() {
  const router = useRouter();
  const t = useT();
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
      setError(err instanceof Error ? err.message : t('auth.register.failed'));
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <LanguageSwitcher />
      </div>
      <form onSubmit={handleSubmit} className="auth-card" noValidate suppressHydrationWarning>
        <header className="auth-header">
          <h1 className="auth-title">{t('auth.register.title')}</h1>
          <p className="auth-subtitle">{t('auth.usernamePlaceholder')}</p>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <div className="field" suppressHydrationWarning>
          <label htmlFor="username" className="label">{t('auth.username')}</label>
          <input
            id="username"
            type="text"
            className="input"
            placeholder={t('auth.usernamePlaceholder')}
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
          <label htmlFor="email" className="label">{t('auth.email')}</label>
          <input
            id="email"
            type="email"
            className="input"
            placeholder={t('auth.emailPlaceholder')}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="field" suppressHydrationWarning>
          <label htmlFor="password" className="label">{t('auth.password')}</label>
          <input
            id="password"
            type="password"
            className="input"
            placeholder={t('auth.passwordPlaceholder')}
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
              {t('auth.register.submitting')}
            </>
          ) : (
            t('auth.register.submit')
          )}
        </button>

        <p className="auth-footer">
          {t('auth.haveAccount')} <Link href="/auth/login">{t('auth.signIn')}</Link>
        </p>
      </form>
    </main>
  );
}
