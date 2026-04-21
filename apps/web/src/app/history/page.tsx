'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';
import { apiClient, type MatchHistoryEntry, type MatchDetail } from '@/lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtScore(n: number) {
  return n >= 0 ? `+${n}` : String(n);
}

// ── Round detail panel ────────────────────────────────────────────────────────

function RoundDetailPanel({ detail, myId }: { detail: MatchDetail; myId: string }) {
  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {detail.rounds.map((round) => (
        <div key={round.roundId} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Round {round.roundNumber}</span>
              <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                {round.endReason === 'player_finished'
                  ? `${round.finisherName ?? round.finisherId} went out`
                  : 'Deck exhausted'}
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Dealer: {round.dealerName ?? round.dealerId}
            </span>
          </div>

          {/* Score table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 500 }}>Player</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 500 }}>Table</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 500 }}>Hand</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 500 }}>Bonus</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 500 }}>Round</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 500 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {round.scores.map((s) => {
                const isMe = s.userId === myId;
                return (
                  <tr key={s.userId} style={{ borderTop: '1px solid var(--border)', background: isMe ? 'rgba(99,102,241,0.06)' : undefined }}>
                    <td style={{ padding: '4px 6px', fontWeight: isMe ? 700 : 400 }}>
                      {s.displayName}{isMe ? ' ●' : ''}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--success)' }}>+{s.tableTotal}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--danger)' }}>−{s.handTotal}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: s.finishBonus > 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
                      {s.finishBonus > 0 ? `+${s.finishBonus}` : '—'}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600, color: s.finalScore >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {fmtScore(s.finalScore)}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700 }}>{s.cumulativeAfter}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {round.nextDealerId && (
            <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
              Next dealer: <strong style={{ color: 'var(--text-primary)' }}>{round.nextDealerName ?? round.nextDealerId}</strong>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Match card ────────────────────────────────────────────────────────────────

function MatchCard({ match, myId }: { match: MatchHistoryEntry; myId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function toggleDetail() {
    if (!expanded && !detail) {
      setLoadingDetail(true);
      try {
        const d = await apiClient.getMatchDetail(match.id);
        setDetail(d);
      } finally {
        setLoadingDetail(false);
      }
    }
    setExpanded((v) => !v);
  }

  const isWin = match.winnerId === myId;
  const myRankSuffix = match.myRank === 1 ? 'st' : match.myRank === 2 ? 'nd' : match.myRank === 3 ? 'rd' : 'th';

  return (
    <div className="surface">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {isWin ? (
            <span className="badge badge-success">Won 🏆</span>
          ) : match.myRank ? (
            <span className="badge badge-neutral">{match.myRank}{myRankSuffix} place</span>
          ) : (
            <span className="badge badge-neutral">Played</span>
          )}
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {fmtDate(match.finishedAt)}
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {match.roundsPlayed} round{match.roundsPlayed !== 1 ? 's' : ''}
          </span>
          {match.inviteCode && (
            <span className="room-code" style={{ fontSize: '0.75rem', letterSpacing: '0.1em', padding: '1px 6px' }}>
              {match.inviteCode}
            </span>
          )}
        </div>
        {match.myFinalScore !== null && (
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>
            {match.myFinalScore} pts
          </span>
        )}
      </div>

      {/* Player results */}
      <div className="col" style={{ gap: '0.35rem' }}>
        {match.players.map((p) => {
          const isMe = p.userId === myId;
          return (
            <div key={p.userId} className="row" style={{ justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <div className="row" style={{ gap: 6 }}>
                <span style={{ color: 'var(--text-secondary)', minWidth: 18 }}>#{p.rank}</span>
                <span style={{ fontWeight: isMe ? 700 : 400 }}>
                  {p.displayName}{isMe ? ' (you)' : ''}
                  {p.userId === match.winnerId && ' 👑'}
                </span>
              </div>
              <span style={{ fontWeight: isMe ? 700 : 400 }}>{p.finalScore}</span>
            </div>
          );
        })}
      </div>

      {/* Expand / collapse round breakdown */}
      <button
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 10, width: '100%' }}
        onClick={toggleDetail}
        disabled={loadingDetail}
      >
        {loadingDetail ? (
          <><div className="spinner" style={{ width: 14, height: 14 }} />Loading…</>
        ) : expanded ? (
          '▲ Hide rounds'
        ) : (
          '▼ Show round breakdown'
        )}
      </button>

      {expanded && detail && <RoundDetailPanel detail={detail} myId={myId} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function HistoryInner() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [before, setBefore] = useState<string | undefined>(undefined);

  const myId = user?.id ?? '';
  const PAGE_SIZE = 15;

  const loadMatches = useCallback(async (cursor?: string, append = false) => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getMatchHistory({ before: cursor, limit: PAGE_SIZE + 1 });
      const hasMoreResults = data.length > PAGE_SIZE;
      const page = hasMoreResults ? data.slice(0, PAGE_SIZE) : data;
      setMatches((prev) => (append ? [...prev, ...page] : page));
      setHasMore(hasMoreResults);
      if (page.length > 0) {
        setBefore(page[page.length - 1].finishedAt ?? undefined);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMatches(); }, [loadMatches]);

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/lobby" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>← Lobby</Link>
        <span style={{ fontWeight: 700 }}>Match History</span>
        <Link href="/leaderboard" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Leaderboard →
        </Link>
      </header>

      <div className="page-content" style={{ maxWidth: 640 }}>
        {error && (
          <div className="error-banner" style={{ marginBottom: '1rem' }}>
            {error}
            <button onClick={() => loadMatches()} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
              Retry
            </button>
          </div>
        )}

        {loading && matches.length === 0 ? (
          <div className="row" style={{ justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" />
          </div>
        ) : matches.length === 0 ? (
          <div className="surface" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🃏</div>
            No completed games yet. Play a game to build your history!
            <div style={{ marginTop: 16 }}>
              <Link href="/rooms/create" className="btn btn-primary">Create Room</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="col" style={{ gap: '0.65rem' }}>
              {matches.map((m) => (
                <MatchCard key={m.id} match={m} myId={myId} />
              ))}
            </div>

            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => loadMatches(before, true)}
                  disabled={loading}
                >
                  {loading ? <><div className="spinner" />Loading…</> : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <AuthGuard>
      <HistoryInner />
    </AuthGuard>
  );
}
