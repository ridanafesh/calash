'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { apiClient } from '@/lib/api';
import type { GameRoom } from '@calash/shared';

function LobbyInner() {
  const { user, logout } = useAuth();
  const { room, connected, createRoom, roomError } = useGame();
  const router = useRouter();

  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [startingVsBot, setStartingVsBot] = useState(false);

  function startVsComputer() {
    if (!connected || startingVsBot) return;
    setStartingVsBot(true);
    createRoom({ maxPlayers: 2, fillWithBots: true, botDifficulty: 'easy' });
  }

  // Reset the vs-bot loading state if creation errored.
  useEffect(() => {
    if (roomError) setStartingVsBot(false);
  }, [roomError]);

  // Redirect if already in a room
  useEffect(() => {
    if (room) router.push(`/rooms/${room.id}`);
  }, [room, router]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await apiClient.getRooms();
        if (!cancelled) { setRooms(list); setFetchError(''); }
      } catch {
        if (!cancelled) setFetchError('Could not load rooms.');
      } finally {
        if (!cancelled) setLoadingRooms(false);
      }
    }
    load();
    const id = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const openRooms = rooms.filter((r) => r.status === 'lobby');

  return (
    <div className="page">
      <header className="page-header">
        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)' }}>Calash</span>
        <div style={{ flex: 1 }} />
        <div className="row" style={{ gap: 12 }}>
          {!connected && <span className="badge badge-warning">connecting…</span>}
          <Link href="/profile" className="row" style={{ gap: 8, textDecoration: 'none', color: 'inherit' }}>
            <div className="avatar" style={{ width: 28, height: 28, fontSize: '0.75rem' }}>
              {(user?.displayName || user?.username || '?').charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: '0.9rem' }} className="hide-mobile">
              {user?.displayName || user?.username}
              {user?.isGuest && <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> (guest)</span>}
            </span>
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={() => { logout(); router.push('/'); }}>
            Sign out
          </button>
        </div>
      </header>

      <div className="page-content">
        <div className="row" style={{ gap: 12, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <Link href="/rooms/create" className="btn btn-primary btn-lg">+ Create Room</Link>
          <Link href="/rooms/join" className="btn btn-ghost btn-lg">Join by Code</Link>
          <button
            onClick={startVsComputer}
            disabled={!connected || startingVsBot}
            className="btn btn-ghost btn-lg"
            title="Start a heads-up game against an Easy bot"
          >
            {startingVsBot ? <><span className="spinner" />Starting…</> : '🤖 Play vs Computer'}
          </button>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '1rem' }}>Open Rooms</h2>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>auto-refresh 8s</span>
        </div>

        {fetchError && <div className="error-banner" style={{ marginBottom: '1rem' }}>{fetchError}</div>}

        {loadingRooms ? (
          <div className="row" style={{ justifyContent: 'center', padding: '2.5rem' }}>
            <div className="spinner" />
          </div>
        ) : openRooms.length === 0 ? (
          <div className="surface" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem 1rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🃏</div>
            No open rooms. Be the first to create one!
          </div>
        ) : (
          <div className="col" style={{ gap: '0.6rem' }}>
            {openRooms.map((r) => (
              <div key={r.id} className="surface row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                    <span className="room-code" style={{ fontSize: '0.9rem', letterSpacing: '0.15em', padding: '2px 8px' }}>
                      {r.code}
                    </span>
                    <span className="badge badge-success">Open</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {r.players.length}/{r.maxPlayers} players
                    {r.players.length > 0 && ` · ${r.players.map((p) => p.displayName).join(', ')}`}
                  </div>
                </div>
                <Link href={`/rooms/${r.id}`} className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}>
                  Join →
                </Link>
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: '2rem', gap: 20, justifyContent: 'center' }}>
          <Link href="/leaderboard" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Leaderboard</Link>
          <Link href="/history" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>History</Link>
          <Link href="/scores" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Scores</Link>
          <Link href="/profile" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Profile</Link>
        </div>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <AuthGuard>
      <LobbyInner />
    </AuthGuard>
  );
}
