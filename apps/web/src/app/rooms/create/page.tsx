'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/lib/auth-guard';
import { useGame } from '@/lib/game-context';
import { GAME_CONFIG } from '@calash/shared';

const CREATE_TIMEOUT_MS = 8000;

type RoomMode = 'multiplayer' | 'vs-computer';

function CreateRoomInner() {
  const { connected, createRoom, room, roomError, clearError } = useGame();
  const router = useRouter();
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [mode, setMode] = useState<RoomMode>('multiplayer');
  const [fillEmptySeats, setFillEmptySeats] = useState(false);
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
      setLocalError('Not connected to the game server. Please wait or refresh the page.');
      return;
    }

    setCreating(true);
    createRoom({
      maxPlayers,
      fillWithBots: mode === 'vs-computer' || fillEmptySeats,
      botDifficulty: 'easy',
    });

    clearTimer();
    timeoutRef.current = setTimeout(() => {
      setCreating(false);
      setLocalError('Room creation timed out. Check your connection and try again.');
    }, CREATE_TIMEOUT_MS);
  }

  const displayedError = localError ?? roomError?.message ?? null;

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/lobby" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>← Lobby</Link>
        <span style={{ fontWeight: 700 }}>Create Room</span>
        <div />
      </header>

      <div className="page-content" style={{ maxWidth: 480 }}>
        <div className="surface col" style={{ gap: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 4 }}>New Game Room</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Choose your mode, then start a game.
            </p>
          </div>

          {!connected && (
            <div className="info-banner" role="status">Connecting to game server…</div>
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
            <label className="label">Mode</label>
            <div className="row" style={{ gap: 8 }}>
              <ModeButton
                active={mode === 'multiplayer'}
                onClick={() => setMode('multiplayer')}
                disabled={creating}
                title="Multiplayer"
                subtitle="Invite friends with a 6-letter code"
              />
              <ModeButton
                active={mode === 'vs-computer'}
                onClick={() => setMode('vs-computer')}
                disabled={creating}
                title="Play vs Computer"
                subtitle="1 human + 1 bot · starts immediately"
              />
            </div>
          </div>

          {mode === 'multiplayer' && (
            <>
              <div className="field">
                <label className="label">Max Players</label>
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
                  {maxPlayers} players · game ends at {GAME_CONFIG.WIN_SCORE} pts
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
                  Fill empty seats with bots (start without waiting)
                </span>
              </label>
            </>
          )}

          <div className="surface-sm" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>How it works</div>
            {mode === 'vs-computer'
              ? <>You play heads-up against an Easy bot. Click Ready in the room to start the game immediately.</>
              : <>After creating the room you&apos;ll get a 6-character code to share. Game starts when all players ready up.</>}
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleCreate}
            disabled={creating || !connected}
            style={{ width: '100%' }}
          >
            {creating ? (
              <><span className="spinner" aria-hidden="true" />Creating…</>
            ) : mode === 'vs-computer' ? 'Start vs Computer' : 'Create Room'}
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
