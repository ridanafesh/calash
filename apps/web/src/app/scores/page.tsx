'use client';

import Link from 'next/link';
import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { GAME_CONFIG } from '@calash/shared';

function ScoresInner() {
  const { user } = useAuth();
  const { scores, room } = useGame();

  const sorted = [...scores].sort((a, b) => b.total - a.total);

  return (
    <div className="page">
      <header className="page-header">
        <Link href={room ? `/rooms/${room.id}` : '/lobby'} style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          ← {room ? 'Game' : 'Lobby'}
        </Link>
        <span style={{ fontWeight: 700 }}>Scores</span>
        <div />
      </header>

      <div className="page-content" style={{ maxWidth: 520 }}>
        {scores.length === 0 ? (
          <div className="surface" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem 1rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>📊</div>
            No active game scores. Join or start a game to see scores here.
            <div style={{ marginTop: 16 }}>
              <Link href="/lobby" className="btn btn-primary">Go to Lobby</Link>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              {room && <>Room <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{room.code}</span> · </>}
              First to {GAME_CONFIG.WIN_SCORE} pts wins
            </div>

            <div className="col" style={{ gap: '0.6rem' }}>
              {sorted.map((s, i) => {
                const isMe = s.playerId === user?.id;
                const pct = Math.min(100, (s.total / GAME_CONFIG.WIN_SCORE) * 100);
                return (
                  <div key={s.playerId} className="surface" style={{ borderColor: isMe ? 'var(--accent)' : undefined }}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                      <div className="row" style={{ gap: 10 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '1.1rem', minWidth: 24 }}>
                          #{i + 1}
                        </span>
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: '0.75rem' }}>
                          {s.playerId.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: isMe ? 700 : 400 }}>
                          {s.playerId}{isMe ? ' (you)' : ''}
                        </span>
                        {i === 0 && <span className="badge badge-warning">leading</span>}
                      </div>
                      <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>
                        {s.total}
                        <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 4 }}>
                          / {GAME_CONFIG.WIN_SCORE}
                        </span>
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: i === 0 ? 'var(--warning)' : 'var(--accent)', borderRadius: 3, transition: 'width 0.5s ease' }} />
                    </div>

                    {/* Round breakdown */}
                    {s.rounds.length > 0 && (
                      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        {s.rounds.map((r, j) => (
                          <span key={j} className={`badge ${r >= 0 ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.72rem' }}>
                            R{j + 1}: {r >= 0 ? '+' : ''}{r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ScoresPage() {
  return (
    <AuthGuard>
      <ScoresInner />
    </AuthGuard>
  );
}
