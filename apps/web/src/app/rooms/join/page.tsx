'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/lib/auth-guard';
import { useGame } from '@/lib/game-context';

function JoinRoomInner() {
  const { joinByCode, room, roomError, clearError } = useGame();
  const router = useRouter();
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
        <Link href="/lobby" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>← Lobby</Link>
        <span style={{ fontWeight: 700 }}>Join by Code</span>
        <div />
      </header>

      <div className="page-content" style={{ maxWidth: 420 }}>
        <div className="surface col" style={{ gap: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 4 }}>Enter Room Code</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Ask the room host for their 6-character code.
            </p>
          </div>

          {roomError && (
            <div className="error-banner">
              {roomError.message}
              <button onClick={clearError} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="code">Room Code</label>
            <input
              ref={inputRef}
              id="code"
              className="input"
              placeholder="ABCD12"
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
              {code.length}/6 characters
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleJoin}
            disabled={code.trim().length !== 6 || joining}
            style={{ width: '100%' }}
          >
            {joining ? <><div className="spinner" />Joining…</> : 'Join Room'}
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
