'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiClient, type LeaderboardEntry } from '@/lib/api';
import { GAME_CONFIG } from '@calash/shared';

type SortKey = 'score' | 'wins' | 'winrate';

const SORT_LABELS: Record<SortKey, string> = {
  score: 'Total Score',
  wins: 'Most Wins',
  winrate: 'Win Rate',
};

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sort, setSort] = useState<SortKey>('score');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    apiClient.getLeaderboard({ sort })
      .then(setEntries)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sort]);

  const myEntry = entries.find((e) => e.userId === user?.id);

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/lobby" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>← Lobby</Link>
        <span style={{ fontWeight: 700 }}>Leaderboard</span>
        <div />
      </header>

      <div className="page-content" style={{ maxWidth: 700 }}>
        {/* Sort tabs */}
        <div className="row" style={{ gap: 6, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={sort === key ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
            >
              {SORT_LABELS[key]}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>
            Win target: {GAME_CONFIG.WIN_SCORE} pts
          </span>
        </div>

        {/* My stats banner */}
        {myEntry && (
          <div className="surface" style={{ borderColor: 'var(--accent)', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 700, marginBottom: 6 }}>
              Your ranking
            </div>
            <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>#{myEntry.rank}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rank</div>
              </div>
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{myEntry.gamesWon}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Wins</div>
              </div>
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{myEntry.gamesPlayed}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Games</div>
              </div>
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{myEntry.winRate}%</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Win rate</div>
              </div>
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{myEntry.totalScore.toLocaleString()}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total score</div>
              </div>
            </div>
          </div>
        )}

        {error && <div className="error-banner" style={{ marginBottom: '1rem' }}>{error}</div>}

        {loading ? (
          <div className="row" style={{ justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" />
          </div>
        ) : entries.length === 0 ? (
          <div className="surface" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>🏆</div>
            No players on the leaderboard yet. Play a game to get started!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Rank</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>Player</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>Wins</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>Games</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>Win %</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>Score</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600 }}>Best Rnd</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isMe = entry.userId === user?.id;
                  return (
                    <tr
                      key={entry.userId}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: isMe ? 'rgba(99,102,241,0.07)' : undefined,
                      }}
                    >
                      <td style={{ padding: '10px 10px' }}>
                        {entry.rank <= 3 ? (
                          <span style={{ fontSize: '1.1rem' }}>
                            {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>#{entry.rank}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <div className="row" style={{ gap: 8 }}>
                          <div className="avatar" style={{ width: 26, height: 26, fontSize: '0.72rem', background: isMe ? 'var(--accent)' : undefined }}>
                            {(entry.displayName || '?').charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontWeight: isMe ? 700 : 400 }}>
                            {entry.displayName}
                            {isMe && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>●</span>}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>
                        {entry.gamesWon}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {entry.gamesPlayed}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                        <span className={`badge ${entry.winRate >= 50 ? 'badge-success' : 'badge-neutral'}`}>
                          {entry.winRate}%
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700 }}>
                        {entry.totalScore.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {entry.highestRoundScore >= 0 ? `+${entry.highestRoundScore}` : entry.highestRoundScore}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
