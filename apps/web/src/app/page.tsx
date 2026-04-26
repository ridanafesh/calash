'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export default function Home() {
  const t = useT();
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
        padding: '2rem',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 60%)',
        position: 'relative',
      }}
    >
      {/* Top-right language switcher — always reachable so a first-time
          visitor can flip the UI before signing in. */}
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <LanguageSwitcher />
      </div>

      {/* Card suit decorations */}
      <div style={{ fontSize: '2.5rem', opacity: 0.15, letterSpacing: '1rem', marginBottom: '-1rem' }}>
        ♠ ♥ ♣ ♦
      </div>

      <h1
        style={{
          fontSize: 'clamp(3rem, 8vw, 5rem)',
          fontWeight: 900,
          letterSpacing: '-0.03em',
          background: 'linear-gradient(135deg, #f0f2ff 0%, #a5b4fc 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          margin: 0,
        }}
      >
        Calash
      </h1>

      <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', textAlign: 'center', maxWidth: 360 }}>
        {t('landing.tagline')}
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/auth/login" className="btn btn-ghost btn-lg">
          {t('landing.playAsGuest')}
        </Link>
        <Link href="/auth/register" className="btn btn-primary btn-lg">
          {t('landing.createAccount')}
        </Link>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '1.5rem',
          marginTop: '1rem',
          fontSize: '0.82rem',
          color: 'var(--text-secondary)',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <span>{t('landing.feature.realtime')}</span>
        <span>{t('landing.feature.players')}</span>
        <span>{t('landing.feature.noDownload')}</span>
      </div>
    </main>
  );
}
