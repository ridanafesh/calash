'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { GameScore, RoomPlayer, RoundStateView } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';

interface ScoresPanelProps {
  players: readonly RoomPlayer[];
  gameState: RoundStateView | null;
  scores: readonly GameScore[];
  myId: string;
  onClose: () => void;
}

/**
 * Read-only modal that shows the current cumulative score and per-round
 * delta for every player, sorted highest cumulative first. Designed to be
 * opened mid-turn without interrupting gameplay — no actions are exposed
 * here. All data is derived from existing frontend state (room.players for
 * names + bot flag, gameState for table totals + turn + dealer + has-gone-
 * down, scores for cumulative + round breakdown).
 */
export function ScoresPanel({ players, gameState, scores, myId, onClose }: ScoresPanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const rows = useMemo(() => {
    return players
      .map((p) => {
        const score = scores.find((s) => s.playerId === p.userId);
        const ps = gameState?.playerStates[p.userId];
        return {
          userId: p.userId,
          displayName: p.displayName,
          isBot: p.isBot,
          isMe: p.userId === myId,
          isCurrentTurn: gameState?.currentTurnPlayerId === p.userId,
          isDealer: gameState?.dealerPlayerId === p.userId,
          hasGoneDown: ps?.hasGoneDown ?? false,
          tableTotal: ps?.tableTotal ?? 0,
          cumulative: score?.total ?? 0,
          rounds: score?.rounds ?? [],
        };
      })
      .sort((a, b) => b.cumulative - a.cumulative);
  }, [players, scores, gameState, myId]);

  const leaderId = rows[0]?.userId ?? null;
  const leaderHasNonZero = (rows[0]?.cumulative ?? 0) !== 0
    || (rows[0]?.rounds.length ?? 0) > 0;

  return (
    <div className="overlay" role="dialog" aria-label="Score summary">
      <div
        ref={ref}
        className="result-modal"
        style={{ maxWidth: 560, width: '100%', maxHeight: '85vh', gap: '0.75rem' }}
      >
        {/* Header */}
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div className="col" style={{ gap: 2 }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Scores</h2>
            {gameState && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Round {gameState.roundNumber} · target {GAME_CONFIG.WIN_SCORE} pts
              </span>
            )}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close scores"
          >
            ✕
          </button>
        </div>

        {/* Score list */}
        <div className="col" style={{ gap: '0.5rem', overflowY: 'auto', minHeight: 0 }}>
          {rows.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              No players in this game.
            </p>
          ) : (
            rows.map((row, idx) => (
              <div
                key={row.userId}
                className="surface-sm"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  borderColor: row.isCurrentTurn ? 'var(--warning)' : undefined,
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <div className="row" style={{ gap: 6, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: 22 }}>
                      #{idx + 1}
                    </span>
                    <div
                      className="avatar"
                      style={{
                        width: 24, height: 24, fontSize: '0.7rem',
                        background: row.isBot ? 'var(--surface-2)' : 'var(--accent)',
                        color: row.isBot ? 'var(--text-secondary)' : '#fff',
                        flexShrink: 0,
                      }}
                    >
                      {row.isBot ? '🤖' : (row.displayName || '?').charAt(0).toUpperCase()}
                    </div>
                    <span
                      style={{
                        fontWeight: row.isMe ? 700 : 500,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {row.displayName || row.userId}
                      {row.isMe && (
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> (you)</span>
                      )}
                    </span>
                    {row.isBot && <span className="badge badge-accent" style={{ fontSize: '0.62rem' }}>BOT</span>}
                    {leaderHasNonZero && row.userId === leaderId && rows.length > 1 && (
                      <span className="badge badge-success" style={{ fontSize: '0.62rem' }} title="Leading">
                        ★ LEADER
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '1rem',
                      color: row.cumulative >= 0 ? 'var(--text-primary)' : 'var(--danger)',
                      minWidth: 60,
                      textAlign: 'right',
                    }}
                  >
                    {row.cumulative}
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                      {' '}/ {GAME_CONFIG.WIN_SCORE}
                    </span>
                  </span>
                </div>

                {/* Per-round status row */}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', fontSize: '0.72rem' }}>
                  {row.isCurrentTurn && (
                    <span className="badge badge-warning" style={{ fontSize: '0.62rem' }}>▶ Turn</span>
                  )}
                  {row.isDealer && (
                    <span className="badge badge-neutral" style={{ fontSize: '0.62rem' }}>🃏 Dealer</span>
                  )}
                  {row.hasGoneDown ? (
                    <span className="badge badge-accent" style={{ fontSize: '0.62rem' }}>
                      DOWN · {row.tableTotal} pts
                    </span>
                  ) : (
                    <span className="badge badge-neutral" style={{ fontSize: '0.62rem' }}>
                      not opened
                    </span>
                  )}
                  {row.rounds.length > 0 && (
                    <span style={{ color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                      Rounds:{' '}
                      {row.rounds.map((r, i) => (
                        <span
                          key={i}
                          style={{
                            color: r >= 0 ? 'var(--success)' : 'var(--danger)',
                            fontWeight: 600,
                            marginLeft: 4,
                          }}
                        >
                          {r >= 0 ? '+' : ''}{r}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, textAlign: 'center' }}>
          First player to reach {GAME_CONFIG.WIN_SCORE} pts wins the game.
        </p>
      </div>
    </div>
  );
}
