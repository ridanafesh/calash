'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { GAME_CONFIG } from '@calash/shared';

export function WaitingRoom() {
  const { user } = useAuth();
  const { room, roomError, toggleReady, addBot, removeBot, leaveRoom, clearError } = useGame();
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
          ← Lobby
        </Link>
        <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>Waiting Room</span>
        <button className="btn btn-ghost btn-sm" onClick={leaveRoom}>
          Leave
        </button>
      </header>

      <div className="page-content" style={{ maxWidth: 560 }}>
        {/* Room code */}
        <div className="surface" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Share this code with friends
          </div>
          <div className="room-code" style={{ justifyContent: 'center', fontSize: '2rem', letterSpacing: '0.3em' }}>
            {room.code}
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12, gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={copyCode}>
              {copied ? '✓ Copied' : '⎘ Copy code'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={copyLink}>
              🔗 Copy link
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
              Players ({room.players.length}/{room.maxPlayers})
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Need {GAME_CONFIG.MIN_PLAYERS}–{GAME_CONFIG.MAX_PLAYERS} to start
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
                    aria-label={p.isBot ? 'Bot avatar' : 'Player avatar'}
                  >
                    {p.isBot ? '🤖' : (p.displayName || p.userId).charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontWeight: p.userId === user?.id ? 700 : 400 }}>
                    {p.displayName || p.userId}
                    {p.userId === user?.id && (
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> (you)</span>
                    )}
                    {p.userId === room.hostUserId && !p.isBot && (
                      <span style={{ color: 'var(--warning)', marginLeft: 4 }}>👑</span>
                    )}
                  </span>
                  {p.isBot && (
                    <span className="badge badge-accent" title={`Difficulty: ${p.botDifficulty ?? 'easy'}`}>
                      BOT
                    </span>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {!p.isBot && !p.isConnected && (
                    <span className="badge badge-warning">disconnected</span>
                  )}
                  {p.isReady ? (
                    <span className="badge badge-success">✓ Ready</span>
                  ) : (
                    <span className="badge badge-neutral">Waiting</span>
                  )}
                  {isHost && p.isBot && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeBot(p.userId)}
                      aria-label={`Remove ${p.displayName}`}
                      title="Remove bot"
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
                Empty slot
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
              🤖 Add Easy Bot
            </button>
          )}

          {me && (
            <button
              className={`btn ${me.isReady ? 'btn-ghost' : 'btn-success'} btn-lg`}
              style={{ width: '100%' }}
              onClick={toggleReady}
            >
              {me.isReady ? 'Unready' : '✓ Ready up'}
            </button>
          )}

          {isHost && !canStart && (
            <div className="info-banner" style={{ textAlign: 'center', fontSize: '0.85rem' }}>
              Waiting for all players to ready up
              {room.players.length < GAME_CONFIG.MIN_PLAYERS && (
                <> · need at least {GAME_CONFIG.MIN_PLAYERS} players</>
              )}
            </div>
          )}

          {isHost && canStart && (
            <div className="info-banner" style={{ textAlign: 'center', fontSize: '0.85rem' }}>
              All players ready — game will start automatically!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
