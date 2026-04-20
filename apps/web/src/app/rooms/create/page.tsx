'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/lib/auth-guard';
import { useGame } from '@/lib/game-context';
import { GAME_CONFIG } from '@calash/shared';

function CreateRoomInner() {
  const { createRoom, room, roomError, clearError } = useGame();
  const router = useRouter();
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [creating, setCreating] = useState(false);

  // Redirect when room is created
  useEffect(() => {
    if (room) router.push(`/rooms/${room.id}`);
  }, [room, router]);

  function handleCreate() {
    clearError();
    setCreating(true);
    createRoom(maxPlayers);
    // Creating flag resets if roomError fires
  }

  useEffect(() => {
    if (roomError) setCreating(false);
  }, [roomError]);

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
              Choose how many players can join, then share the room code.
            </p>
          </div>

          {roomError && (
            <div className="error-banner">
              {roomError.message}
              <button onClick={clearError} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
            </div>
          )}

          <div className="field">
            <label className="label">Max Players</label>
            <div className="row" style={{ gap: 8 }}>
              {Array.from({ length: GAME_CONFIG.MAX_PLAYERS - GAME_CONFIG.MIN_PLAYERS + 1 }, (_, i) => i + GAME_CONFIG.MIN_PLAYERS).map((n) => (
                <button
                  key={n}
                  onClick={() => setMaxPlayers(n)}
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 8,
                    border: maxPlayers === n ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: maxPlayers === n ? 'rgba(99,102,241,0.15)' : 'var(--surface-2)',
                    color: maxPlayers === n ? 'var(--accent)' : 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: '1.1rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {maxPlayers} players · game ends at {GAME_CONFIG.WIN_SCORE} pts
            </div>
          </div>

          <div className="surface-sm" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>How it works</div>
            After creating the room you&apos;ll get a 6-character code to share. Game starts when all players ready up.
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleCreate}
            disabled={creating}
            style={{ width: '100%' }}
          >
            {creating ? (
              <><div className="spinner" />Creating…</>
            ) : (
              'Create Room'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CreateRoomPage() {
  return (
    <AuthGuard>
      <CreateRoomInner />
    </AuthGuard>
  );
}
