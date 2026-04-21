'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { apiClient, type RoomScoreSummary } from '@/lib/api';
import { GAME_CONFIG } from '@calash/shared';

function ScoreBreakdownRow({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: number;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="row"
      style={{
        justifyContent: 'space-between',
        padding: '4px 0',
        borderBottom: highlight ? '1px solid var(--border)' : undefined,
        fontWeight: highlight ? 700 : 400,
      }}
    >
      <span style={{ color: highlight ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: '0.88rem' }}>
        {label}
        {sub && <span style={{ fontSize: '0.75rem', marginLeft: 4, opacity: 0.6 }}>{sub}</span>}
      </span>
      <span style={{ color: value > 0 ? 'var(--success)' : value < 0 ? 'var(--danger)' : 'var(--text-secondary)', fontSize: '0.88rem' }}>
        {value > 0 ? '+' : ''}{value}
      </span>
    </div>
  );
}

function RoundCard({ round, myId, isLast }: { round: RoomScoreSummary['rounds'][0]; myId: string; isLast: boolean }) {
  const [open, setOpen] = useState(isLast);

  const endLabel = round.endReason === 'player_finished'
    ? `${round.finisherName ?? round.finisherId} went out`
    : 'Deck exhausted';

  return (
    <div className="surface" style={{ marginBottom: '0.6rem' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--text-primary)',
          padding: 0,
          textAlign: 'left',
        }}
      >
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontWeight: 700 }}>Round {round.roundNumber}</span>
          <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
            {endLabel}
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Dealer: {round.dealerName ?? round.dealerId}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {/* Per-player breakdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {round.scores.map((s) => {
              const isMe = s.userId === myId;
              return (
                <div
                  key={s.userId}
                  style={{
                    background: isMe ? 'rgba(99,102,241,0.06)' : 'var(--surface-2)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    border: isMe ? '1px solid rgba(99,102,241,0.25)' : '1px solid var(--border)',
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontWeight: isMe ? 700 : 600 }}>
                        {s.displayName}{isMe ? ' (you)' : ''}
                      </span>
                      {s.finishBonus > 0 && (
                        <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>finished first</span>
                      )}
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        cumulative:
                      </span>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>{s.cumulativeAfter}</span>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <ScoreBreakdownRow label="Cards on table" value={s.tableTotal} />
                    <ScoreBreakdownRow label="Cards in hand" value={-s.handTotal} sub="(penalty)" />
                    {s.finishBonus > 0 && (
                      <ScoreBreakdownRow label="Finish bonus" value={s.finishBonus} />
                    )}
                    <ScoreBreakdownRow label="Round total" value={s.finalScore} highlight />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Next dealer info */}
          {round.nextDealerId && (
            <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
              Next dealer: <strong style={{ color: 'var(--text-primary)' }}>{round.nextDealerName ?? round.nextDealerId}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoresInner() {
  const { user } = useAuth();
  const { scores, room } = useGame();

  const [summary, setSummary] = useState<RoomScoreSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Fetch DB summary when viewing a finished or in-progress room
  useEffect(() => {
    if (!room) return;
    setLoadingSummary(true);
    apiClient.getRoomScores(room.id)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoadingSummary(false));
  }, [room?.id]);

  const myId = user?.id ?? '';

  // If we have a DB summary, prefer it (more complete); fall back to socket scores
  const hasDbData = summary && summary.rounds.length > 0;

  return (
    <div className="page">
      <header className="page-header">
        <Link href={room ? `/rooms/${room.id}` : '/lobby'} style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          ← {room ? 'Game' : 'Lobby'}
        </Link>
        <span style={{ fontWeight: 700 }}>Scores</span>
        <Link href="/leaderboard" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Leaderboard →
        </Link>
      </header>

      <div className="page-content" style={{ maxWidth: 640 }}>
        {/* No active game and no DB data */}
        {!room && !summary && (
          <div className="surface" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>📊</div>
            No active game. Join a room to track scores.
            <div style={{ marginTop: 16 }}>
              <Link href="/lobby" className="btn btn-primary">Go to Lobby</Link>
            </div>
          </div>
        )}

        {/* Real-time cumulative standings (socket) */}
        {scores.length > 0 && (
          <div className="surface" style={{ marginBottom: '1.25rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 700 }}>Standings</span>
              {room && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  First to {GAME_CONFIG.WIN_SCORE} pts wins
                </span>
              )}
            </div>
            {[...scores]
              .sort((a, b) => b.total - a.total)
              .map((s, i) => {
                const isMe = s.playerId === myId;
                const pct = Math.min(100, (s.total / GAME_CONFIG.WIN_SCORE) * 100);
                return (
                  <div key={s.playerId} style={{ marginBottom: 12 }}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', minWidth: 20 }}>
                          #{i + 1}
                        </span>
                        <span style={{ fontWeight: isMe ? 700 : 400 }}>
                          {s.playerId}{isMe ? ' (you)' : ''}
                        </span>
                        {i === 0 && <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>leading</span>}
                      </div>
                      <span style={{ fontWeight: 700 }}>
                        {s.total}
                        <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 3 }}>
                          / {GAME_CONFIG.WIN_SCORE}
                        </span>
                      </span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: i === 0 ? 'var(--warning)' : 'var(--accent)', borderRadius: 3, transition: 'width 0.4s' }} />
                    </div>
                    {s.rounds.length > 0 && (
                      <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {s.rounds.map((r, j) => (
                          <span key={j} className={`badge ${r >= 0 ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                            R{j + 1}: {r >= 0 ? '+' : ''}{r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {/* Round-by-round DB breakdown */}
        {loadingSummary && (
          <div className="row" style={{ justifyContent: 'center', padding: '1.5rem' }}>
            <div className="spinner" />
          </div>
        )}

        {hasDbData && (
          <>
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
              Round Breakdown ({summary.rounds.length} rounds)
            </div>
            {summary.rounds.map((round, i) => (
              <RoundCard
                key={round.roundId}
                round={round}
                myId={myId}
                isLast={i === summary.rounds.length - 1}
              />
            ))}

            {/* Final cumulative from DB */}
            {summary.status === 'finished' && (
              <div className="surface" style={{ marginTop: '1rem', borderColor: 'var(--warning)' }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>🏁 Final Standings</div>
                {summary.cumulative.map((c, i) => (
                  <div key={c.userId} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>#{i + 1}</span>
                      <span style={{ fontWeight: c.userId === myId ? 700 : 400 }}>
                        {c.displayName}{c.userId === myId ? ' (you)' : ''}
                        {c.userId === summary.winnerId && ' 👑'}
                      </span>
                    </div>
                    <span style={{ fontWeight: 700 }}>{c.total}</span>
                  </div>
                ))}
              </div>
            )}
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
