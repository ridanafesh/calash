'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/lib/auth-guard';
import { useGame } from '@/lib/game-context';
import { useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

function JoinRoomInner() {
  const { joinByCode, room, roomError, clearError } = useGame();
  const router = useRouter();
  const t = useT();
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Redirect when room joined
  useEffect(() => {
    if (room) router.push(`/rooms/${room.id}`);
  }, [room, router]);

  useEffect(() => {
    if (roomError) setJoining(false);
  }, [roomError]);

  function handleJoin() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) return;
    clearError();
    setJoining(true);
    joinByCode(trimmed);
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/lobby" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('rooms.create.backToLobby')}</Link>
        <span style={{ fontWeight: 700 }}>{t('rooms.join.headerTitle')}</span>
        <div className="row" style={{ gap: 8 }}>
          <LanguageSwitcher />
        </div>
      </header>

      <div className="page-content" style={{ maxWidth: 420 }}>
        <div className="surface col" style={{ gap: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 4 }}>{t('rooms.join.heading')}</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {t('rooms.join.helper')}
            </p>
          </div>

          {roomError && (
            <div className="error-banner">
              {roomError.message}
              <button onClick={clearError} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="code">{t('rooms.join.codeLabel')}</label>
            <input
              ref={inputRef}
              id="code"
              className="input"
              placeholder={t('rooms.join.codePlaceholder')}
              value={code}
              maxLength={6}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                if (roomError) clearError();
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              style={{
                fontFamily: 'monospace',
                fontSize: '1.6rem',
                letterSpacing: '0.25em',
                textAlign: 'center',
                textTransform: 'uppercase',
              }}
            />
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
              {t('rooms.join.charCount', { n: code.length })}
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleJoin}
            disabled={code.trim().length !== 6 || joining}
            style={{ width: '100%' }}
          >
            {joining ? <><div className="spinner" />{t('rooms.join.joining')}</> : t('rooms.join.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function JoinRoomPage() {
  return (
    <AuthGuard>
      <JoinRoomInner />
    </AuthGuard>
  );
}
