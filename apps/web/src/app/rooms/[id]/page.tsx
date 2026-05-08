'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthGuard } from '@/lib/auth-guard';
import { useGame } from '@/lib/game-context';
import { WaitingRoom } from '@/components/game/WaitingRoom';
import { GameBoard } from '@/components/game/GameBoard';
import { SeatChoicePopup } from '@/components/game/SeatChoicePopup';

function RoomPageInner() {
  const { id } = useParams<{ id: string }>();
  const { room, roomError, joinRoom, leaveRoom, clearError, connected } = useGame();
  const router = useRouter();
  const [joining, setJoining] = useState(false);

  // Join if not already in this room
  useEffect(() => {
    if (!connected) return;
    if (!room || room.id !== id) {
      setJoining(true);
      joinRoom(id);
    }
  }, [connected, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (room && room.id === id) setJoining(false);
  }, [room, id]);

  useEffect(() => {
    if (roomError) setJoining(false);
  }, [roomError]);

  // Finished rooms → back to lobby after a moment.
  // Explicit `return undefined` on the non-finished branch satisfies TS's
  // "Not all code paths return a value" check (`next build` enforces this
  // even though Jest/dev mode doesn't); the cleanup return on the
  // finished branch keeps its existing semantics.
  useEffect(() => {
    if (room?.status === 'finished') {
      const t = setTimeout(() => router.push('/lobby'), 8000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [room?.status, router]);

  // ── Loading: waiting for socket to connect ──
  if (!connected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
        <div className="spinner spinner-lg" />
        <span style={{ color: 'var(--text-secondary)' }}>Connecting…</span>
      </div>
    );
  }

  // ── Error joining ──
  if (roomError && (!room || room.id !== id)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20, padding: '1rem' }}>
        <div style={{ fontSize: '3rem' }}>😕</div>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Couldn&apos;t join room</h2>
        <div className="error-banner">{roomError.message}</div>
        <div className="row" style={{ gap: 12 }}>
          <button className="btn btn-ghost" onClick={() => { clearError(); setJoining(true); joinRoom(id); }}>Retry</button>
          <Link href="/lobby" className="btn btn-primary">Back to Lobby</Link>
        </div>
      </div>
    );
  }

  // ── Joining ──
  if (joining || !room) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
        <div className="spinner spinner-lg" />
        <span style={{ color: 'var(--text-secondary)' }}>Joining room…</span>
      </div>
    );
  }

  // ── Game in progress ──
  if (room.status === 'in-progress') {
    return (
      <>
        <GameBoard />
        <SeatChoicePopup />
      </>
    );
  }

  // ── Finished ──
  if (room.status === 'finished') {
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 20 }}>
          <div style={{ fontSize: '3rem' }}>🏁</div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Game Over</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Returning to lobby…</p>
          <Link href="/lobby" className="btn btn-primary" onClick={leaveRoom}>Back to Lobby</Link>
        </div>
        <SeatChoicePopup />
      </>
    );
  }

  // ── Lobby (waiting room) ──
  return (
    <>
      <WaitingRoom />
      <SeatChoicePopup />
    </>
  );
}

export default function RoomPage() {
  return (
    <AuthGuard>
      <RoomPageInner />
    </AuthGuard>
  );
}
