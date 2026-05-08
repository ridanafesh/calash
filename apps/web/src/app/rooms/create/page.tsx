'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/lib/auth-guard';
import { useGame } from '@/lib/game-context';
import { useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { GAME_CONFIG } from '@calash/shared';

const CREATE_TIMEOUT_MS = 8000;

type RoomMode = 'multiplayer' | 'vs-computer';

function CreateRoomInner() {
  const { connected, createRoom, room, roomError, clearError } = useGame();
  const router = useRouter();
  const t = useT();
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [mode, setMode] = useState<RoomMode>('multiplayer');
  const [fillEmptySeats, setFillEmptySeats] = useState(false);
  // Locked rooms still appear in the public list but require the
  // invite code to join. Default to "open" — most users want
  // friction-free joins.
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  // Force maxPlayers = 2 in single-player mode (1 human + 1 bot is the minimum game).
  useEffect(() => {
    if (mode === 'vs-computer' && maxPlayers !== 2) setMaxPlayers(2);
  }, [mode, maxPlayers]);

  // Redirect when room is created.
  useEffect(() => {
    if (room) {
      clearTimer();
      router.push(`/rooms/${room.id}`);
    }
  }, [room, router]);

  useEffect(() => {
    if (roomError && creating) {
      clearTimer();
      setCreating(false);
    }
  }, [roomError, creating]);

  useEffect(() => () => clearTimer(), []);

  function handleCreate() {
    clearError();
    setLocalError(null);

    if (!connected) {
      setLocalError(t('rooms.create.notConnected'));
      return;
    }

    setCreating(true);
    createRoom({
      maxPlayers,
      fillWithBots: mode === 'vs-computer' || fillEmptySeats,
      botDifficulty: 'easy',
      // vs-computer rooms are inherently single-player and don't need
      // the privacy gate; force them to open so the host doesn't
      // accidentally lock themselves into a code.
      isPrivate: mode === 'multiplayer' ? isPrivate : false,
    });

    clearTimer();
    timeoutRef.current = setTimeout(() => {
      setCreating(false);
      setLocalError(t('rooms.create.timeout'));
    }, CREATE_TIMEOUT_MS);
  }

  const displayedError = localError ?? roomError?.message ?? null;

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/lobby" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('rooms.create.backToLobby')}</Link>
        <span style={{ fontWeight: 700 }}>{t('rooms.create.headerTitle')}</span>
        <div className="row" style={{ gap: 8 }}>
          <LanguageSwitcher />
        </div>
      </header>

      <div className="page-content" style={{ maxWidth: 480 }}>
        <div className="surface col" style={{ gap: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 4 }}>{t('rooms.create.title')}</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {t('rooms.create.subtitle')}
            </p>
          </div>

          {!connected && (
            <div className="info-banner" role="status">{t('rooms.create.connecting')}</div>
          )}

          {displayedError && (
            <div className="error-banner" role="alert">
              {displayedError}
              <button
                onClick={() => { clearError(); setLocalError(null); }}
                style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                aria-label="Dismiss error"
              >✕</button>
            </div>
          )}

          {/* Mode selector */}
          <div className="field">
            <label className="label">{t('rooms.create.mode')}</label>
            <div className="row" style={{ gap: 8 }}>
              <ModeButton
                active={mode === 'multiplayer'}
                onClick={() => setMode('multiplayer')}
                disabled={creating}
                title={t('rooms.create.modeMultiplayer')}
                subtitle={t('rooms.create.modeMultiplayerSub')}
              />
              <ModeButton
                active={mode === 'vs-computer'}
                onClick={() => setMode('vs-computer')}
                disabled={creating}
                title={t('rooms.create.modeVsBots')}
                subtitle={t('rooms.create.modeVsBotsSub')}
              />
            </div>
          </div>

          {mode === 'multiplayer' && (
            <>
              <div className="field">
                <label className="label">{t('rooms.create.maxPlayers')}</label>
                <div className="row" style={{ gap: 8 }}>
                  {Array.from(
                    { length: GAME_CONFIG.MAX_PLAYERS - GAME_CONFIG.MIN_PLAYERS + 1 },
                    (_, i) => i + GAME_CONFIG.MIN_PLAYERS,
                  ).map((n) => (
                    <button
                      key={n}
                      onClick={() => setMaxPlayers(n)}
                      disabled={creating}
                      style={{
                        width: 52, height: 52, borderRadius: 8,
                        border: maxPlayers === n ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: maxPlayers === n ? 'rgba(99,102,241,0.15)' : 'var(--surface-2)',
                        color: maxPlayers === n ? 'var(--accent)' : 'var(--text-primary)',
                        fontWeight: 700, fontSize: '1.1rem',
                        cursor: creating ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
                      }}
                    >{n}</button>
                  ))}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {t('rooms.create.gameEndsAt', { n: maxPlayers, score: GAME_CONFIG.WIN_SCORE })}
                </div>
              </div>

              <label className="row" style={{ gap: 10, cursor: creating ? 'not-allowed' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={fillEmptySeats}
                  onChange={(e) => setFillEmptySeats(e.target.checked)}
                  disabled={creating}
                  style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.9rem' }}>
                  {t('rooms.create.fillWithBots')}
                </span>
              </label>

              <div className="field">
                <label className="label">{t('rooms.create.privacy')}</label>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setIsPrivate(false)}
                    disabled={creating}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      borderRadius: 10,
                      border: !isPrivate ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: !isPrivate ? 'rgba(99,102,241,0.12)' : 'var(--surface-2)',
                      color: 'var(--text-primary)',
                      cursor: creating ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 2 }}>
                      🌐 {t('rooms.create.privacyOpen')}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {t('rooms.create.privacyOpenSub')}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPrivate(true)}
                    disabled={creating}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      borderRadius: 10,
                      border: isPrivate ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: isPrivate ? 'rgba(99,102,241,0.12)' : 'var(--surface-2)',
                      color: 'var(--text-primary)',
                      cursor: creating ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 2 }}>
                      🔒 {t('rooms.create.privacyLocked')}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {t('rooms.create.privacyLockedSub')}
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="surface-sm" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{t('rooms.create.howItWorksTitle')}</div>
            {mode === 'vs-computer'
              ? t('rooms.create.howItWorksVsBot')
              : t('rooms.create.howItWorksMulti')}
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleCreate}
            disabled={creating || !connected}
            style={{ width: '100%' }}
          >
            {creating ? (
              <><span className="spinner" aria-hidden="true" />{t('rooms.create.creating')}</>
            ) : mode === 'vs-computer' ? t('rooms.create.submitVsBot') : t('rooms.create.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  title: string;
  subtitle: string;
}

function ModeButton({ active, onClick, disabled, title, subtitle }: ModeButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: '0.75rem',
        borderRadius: 10,
        border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'rgba(99,102,241,0.12)' : 'var(--surface-2)',
        color: 'var(--text-primary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{subtitle}</div>
    </button>
  );
}

export default function CreateRoomPage() {
  return (
    <AuthGuard>
      <CreateRoomInner />
    </AuthGuard>
  );
}
