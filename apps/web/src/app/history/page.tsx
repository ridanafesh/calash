'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';
import { apiClient, type MatchHistoryEntry } from '@/lib/api';

function HistoryInner() {
  const { user } = useAuth();
  const [history, setHistory] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.getMatchHistory()
      .then(setHistory)
      .catch(() => setError('Match history is not yet available.'))
      .finally(() => setLoading(false));
  }, []);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/lobby" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>← Lobby</Link>
        <span style={{ fontWeight: 700 }}>Match History</span>
        <div />
      </header>

      <div className="page-content" style={{ maxWidth: 600 }}>
        {loading ? (
          <div className="row" style={{ justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" />
          </div>
        ) : error ? (
          <div className="surface" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem 1rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>📜</div>
            <div>{error}</div>
            <div style={{ marginTop: 16 }}>
              <Link href="/lobby" className="btn btn-ghost">Back to Lobby</Link>
            </div>
          </div>
        ) : history.length === 0 ? (
          <div className="surface" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem 1rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🃏</div>
            No matches played yet. Start a game to build your history!
            <div style={{ marginTop: 16 }}>
              <Link href="/rooms/create" className="btn btn-primary">Create Room</Link>
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: '0.75rem' }}>
            {history.map((match) => {
              const myEntry = match.players.find((p) => p.userId === user?.id);
              const isWinner = match.winnerId === user?.id;
              const winner = match.players.find((p) => p.userId === match.winnerId);
              return (
                <div key={match.id} className="surface">
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <div className="row" style={{ gap: 8 }}>
                      {isWinner ? (
                        <span className="badge badge-success">Won 🏆</span>
                      ) : (
                        <span className="badge badge-neutral">Played</span>
                      )}
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {formatDate(match.finishedAt)}
                      </span>
                    </div>
                    {myEntry && (
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                        {myEntry.finalScore} pts
                      </span>
                    )}
                  </div>
                  <div className="col" style={{ gap: '0.4rem' }}>
                    {[...match.players]
                      .sort((a, b) => b.finalScore - a.finalScore)
                      .map((p, i) => (
                        <div key={p.userId} className="row" style={{ justifyContent: 'space-between', fontSize: '0.85rem' }}>
                          <div className="row" style={{ gap: 8 }}>
                            <span style={{ color: 'var(--text-secondary)', minWidth: 18 }}>#{i + 1}</span>
                            <span style={{ fontWeight: p.userId === user?.id ? 700 : 400 }}>
                              {p.displayName}
                              {p.userId === user?.id && ' (you)'}
                              {p.userId === match.winnerId && ' 👑'}
                            </span>
                          </div>
                          <span style={{ fontWeight: 600 }}>{p.finalScore}</span>
                        </div>
                      ))}
                  </div>
                  {winner && !isWinner && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                      Winner: {winner.displayName}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
