'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { GAME_CONFIG } from '@calash/shared';

export function WaitingRoom() {
  const { user } = useAuth();
  const { room, roomError, toggleReady, addBot, removeBot, leaveRoom, clearError } = useGame();
  const t = useT();
  const [copied, setCopied] = useState(false);

  if (!room) return null;

  const me = room.players.find((p) => p.userId === user?.id);
  const isHost = room.hostUserId === user?.id;
  const allReady = room.players.length >= GAME_CONFIG.MIN_PLAYERS && room.players.every((p) => p.isReady);
  const canStart = allReady;
  const hasOpenSeat = room.players.length < room.maxPlayers;

  function copyCode() {
    navigator.clipboard.writeText(room!.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyLink() {
    const url = `${window.location.origin}/rooms/${room!.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="page">
      {/* Header */}
      <header className="page-header">
        <Link href="/lobby" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {t('rooms.create.backToLobby')}
        </Link>
        <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{t('waiting.title')}</span>
        <div className="row" style={{ gap: 8 }}>
          <LanguageSwitcher />
          <button className="btn btn-ghost btn-sm" onClick={leaveRoom}>
            {t('waiting.leave')}
          </button>
        </div>
      </header>

      <div className="page-content" style={{ maxWidth: 560 }}>
        {/* Room code */}
        <div className="surface" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
            {t('waiting.shareCode')}
          </div>
          <div className="room-code" style={{ justifyContent: 'center', fontSize: '2rem', letterSpacing: '0.3em' }}>
            {room.code}
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12, gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={copyCode}>
              {copied ? t('waiting.copied') : t('waiting.copyCode')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={copyLink}>
              {t('waiting.copyLink')}
            </button>
          </div>
        </div>

        {roomError && (
          <div className="error-banner" style={{ marginBottom: '1rem' }}>
            {roomError.message}
            <button
              onClick={clearError}
              style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Players */}
        <div className="surface" style={{ marginBottom: '1.25rem' }}>
          <div
            className="row"
            style={{ justifyContent: 'space-between', marginBottom: '0.85rem' }}
          >
            <span style={{ fontWeight: 700 }}>
              {t('waiting.players', { n: room.players.length, max: room.maxPlayers })}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {t('waiting.needToStart', { min: GAME_CONFIG.MIN_PLAYERS, max: GAME_CONFIG.MAX_PLAYERS })}
            </span>
          </div>

          <div className="col" style={{ gap: '0.6rem' }}>
            {room.players.map((p) => (
              <div
                key={p.userId}
                className="row surface-sm"
                style={{ justifyContent: 'space-between', gap: 8 }}
              >
                <div className="row" style={{ gap: 8 }}>
                  <div
                    className="avatar"
                    style={{
                      width: 28, height: 28, fontSize: '0.75rem',
                      background: p.isBot ? 'var(--surface-2)' : 'var(--accent)',
                      color: p.isBot ? 'var(--text-secondary)' : '#fff',
                    }}
                  >
                    {p.isBot ? '🤖' : (p.displayName || p.userId).charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontWeight: p.userId === user?.id ? 700 : 400 }}>
                    {p.displayName || p.userId}
                    {p.userId === user?.id && (
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> {t('waiting.you')}</span>
                    )}
                    {p.userId === room.hostUserId && !p.isBot && (
                      <span style={{ color: 'var(--warning)', marginLeft: 4 }}>👑</span>
                    )}
                  </span>
                  {p.isBot && (
                    <span className="badge badge-accent" title={`Difficulty: ${p.botDifficulty ?? 'easy'}`}>
                      {t('waiting.bot')}
                    </span>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {!p.isBot && !p.isConnected && (
                    <span className="badge badge-warning">{t('waiting.disconnected')}</span>
                  )}
                  {p.isReady ? (
                    <span className="badge badge-success">{t('waiting.ready')}</span>
                  ) : (
                    <span className="badge badge-neutral">{t('waiting.waiting')}</span>
                  )}
                  {isHost && p.isBot && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeBot(p.userId)}
                      title={t('waiting.removeBot')}
                      style={{ padding: '2px 8px' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Empty slots */}
            {Array.from({ length: room.maxPlayers - room.players.length }).map((_, i) => (
              <div
                key={i}
                className="surface-sm"
                style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.85rem' }}
              >
                {t('waiting.empty')}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="col" style={{ gap: '0.75rem' }}>
          {isHost && hasOpenSeat && (
            <button
              className="btn btn-ghost btn-lg"
              style={{ width: '100%' }}
              onClick={() => addBot('easy')}
            >
              {t('waiting.addBot')}
            </button>
          )}

          {me && (
            <button
              className={`btn ${me.isReady ? 'btn-ghost' : 'btn-success'} btn-lg`}
              style={{ width: '100%' }}
              onClick={toggleReady}
            >
              {me.isReady ? t('waiting.unready') : t('waiting.markReady')}
            </button>
          )}

          {isHost && !canStart && (
            <div className="info-banner" style={{ textAlign: 'center', fontSize: '0.85rem' }}>
              {t('waiting.waitingForReady')}
              {room.players.length < GAME_CONFIG.MIN_PLAYERS && (
                <> {t('waiting.needAtLeast', { n: GAME_CONFIG.MIN_PLAYERS })}</>
              )}
            </div>
          )}

          {isHost && canStart && (
            <div className="info-banner" style={{ textAlign: 'center', fontSize: '0.85rem' }}>
              {t('waiting.allReady')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
