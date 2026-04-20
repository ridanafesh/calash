'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { GAME_CONFIG, CARD_VALUES } from '@calash/shared';
import type { Card, MeldType } from '@calash/shared';
import { CardView, CardBack, cardId, cardEquals } from './CardView';

type GameMode = 'idle' | 'go-down' | 'add-new-meld' | 'add-to-meld' | 'take-all-return';

function sumCards(cards: readonly Card[]): number {
  return cards.reduce((s, c) => s + (CARD_VALUES[c.rank] ?? 0), 0);
}

export function GameBoard() {
  const { user } = useAuth();
  const { gameState, hand, roundResult, winner, scores, submitAction, leaveRoom, clearRoundResult } =
    useGame();

  const myId = user?.id ?? '';

  const [mode, setMode] = useState<GameMode>('idle');
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [pendingMelds, setPendingMelds] = useState<Array<{ type: MeldType; cards: Card[] }>>([]);

  const isMyTurn = gameState?.currentTurnPlayerId === myId;
  const myState = gameState?.playerStates[myId];
  const opponents = gameState?.playerOrder.filter((id) => id !== myId) ?? [];
  const discardPile = gameState?.discardPile ?? [];
  const topDiscard = discardPile.length > 0 ? discardPile[discardPile.length - 1] : null;

  const goDownThreshold = gameState
    ? gameState.highestTableTotal === 0
      ? GAME_CONFIG.INITIAL_GO_DOWN_MINIMUM
      : gameState.highestTableTotal + GAME_CONFIG.GO_DOWN_INCREMENT
    : GAME_CONFIG.INITIAL_GO_DOWN_MINIMUM;

  const inPendingMelds = useMemo(() => pendingMelds.flatMap((m) => m.cards), [pendingMelds]);
  const pendingTotal = useMemo(() => pendingMelds.reduce((s, m) => s + sumCards(m.cards), 0), [pendingMelds]);

  const isSelected = (card: Card) => selectedCards.some((c) => cardEquals(c, card));
  const isInPending = (card: Card) => inPendingMelds.some((c) => cardEquals(c, card));

  function toggleCard(card: Card) {
    if (!isMyTurn || isInPending(card)) return;
    setSelectedCards((prev) =>
      prev.some((c) => cardEquals(c, card)) ? prev.filter((c) => !cardEquals(c, card)) : [...prev, card],
    );
  }

  function cancelMode() {
    setMode('idle');
    setSelectedCards([]);
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  function drawFromDeck() {
    submitAction({ type: 'draw-from-deck' });
  }

  function takeFromDiscard() {
    const count = discardPile.length - 1;
    if (count < 1) return;
    submitAction({ type: 'take-from-discard', count });
  }

  function doTakeAll(returnCard: Card) {
    submitAction({ type: 'take-from-discard', count: discardPile.length, returnCardFromHand: returnCard });
    setMode('idle');
    setSelectedCards([]);
  }

  function discard() {
    if (selectedCards.length !== 1) return;
    submitAction({ type: 'discard', card: selectedCards[0] });
    setSelectedCards([]);
    setMode('idle');
  }

  function addToPendingMeld(meldType: MeldType) {
    if (selectedCards.length < 2) return;
    setPendingMelds((prev) => [...prev, { type: meldType, cards: [...selectedCards] }]);
    setSelectedCards([]);
  }

  function submitGoDown() {
    if (pendingMelds.length === 0) return;
    submitAction({ type: 'go-down', melds: pendingMelds });
    setPendingMelds([]);
    setSelectedCards([]);
    setMode('idle');
  }

  function submitAddNewMeld(meldType: MeldType) {
    if (selectedCards.length < 2) return;
    submitAction({ type: 'add-new-meld', meld: { type: meldType, cards: [...selectedCards] } });
    setSelectedCards([]);
    setMode('idle');
  }

  function submitAddToMeld(meldId: string) {
    if (selectedCards.length === 0) return;
    submitAction({ type: 'add-to-meld', meldId, cards: [...selectedCards] });
    setSelectedCards([]);
    setMode('idle');
  }

  if (!gameState) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
        <div className="spinner spinner-lg" />
        <span style={{ color: 'var(--text-secondary)' }}>Loading game…</span>
      </div>
    );
  }

  const canDrawOrTake = isMyTurn && gameState.turnPhase === 'awaiting-draw-or-take';
  const canHold = isMyTurn && gameState.turnPhase === 'holding';
  const hasGoneDown = myState?.hasGoneDown ?? false;
  const canGoDown = canHold && !hasGoneDown && !gameState.didTakeFromDiscardThisTurn;
  const canAddMelds = canHold && hasGoneDown;

  return (
    <div className="game-board">
      {/* ── Header ── */}
      <div className="game-header">
        <span style={{ fontWeight: 700, color: 'var(--accent)' }}>Calash</span>
        <span className="badge badge-neutral">Round {gameState.roundNumber}</span>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Deck: {gameState.hiddenDeckCount}
        </span>
        <div style={{ flex: 1 }} />
        {isMyTurn ? (
          <span className="badge badge-success">Your turn</span>
        ) : (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {gameState.currentTurnPlayerId}&apos;s turn
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={leaveRoom}>
          Leave
        </button>
      </div>

      {/* ── Opponents ── */}
      <div className="opponents-strip">
        {opponents.map((opId) => {
          const op = gameState.playerStates[opId];
          const isOpTurn = gameState.currentTurnPlayerId === opId;
          const opScore = scores.find((s) => s.playerId === opId);
          return (
            <div
              key={opId}
              className="opponent-zone"
              style={{ borderColor: isOpTurn ? 'var(--warning)' : undefined }}
            >
              <div className="row" style={{ gap: 6 }}>
                <div className="avatar" style={{ width: 24, height: 24, fontSize: '0.7rem' }}>
                  {opId.charAt(0).toUpperCase()}
                </div>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                  {opId}
                </span>
                {isOpTurn && <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>▶</span>}
                {op?.hasGoneDown && <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>DOWN</span>}
              </div>
              {opScore && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {opScore.total} pts
                </div>
              )}
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {op?.melds.map((meld) => (
                  <div key={meld.id} className="meld-group">
                    {meld.cards.map((c) => (
                      <CardView key={cardId(c)} card={c} size="xs" />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Table: deck + discard ── */}
      <div className="table-area">
        <div className="pile-slot">
          <div className="pile-label">Draw pile</div>
          <div style={{ cursor: canDrawOrTake ? 'pointer' : 'default' }} onClick={canDrawOrTake ? drawFromDeck : undefined}>
            <CardBack size="md" />
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {gameState.hiddenDeckCount} left
          </div>
          {canDrawOrTake && (
            <button className="btn btn-primary btn-sm" onClick={drawFromDeck}>
              Draw
            </button>
          )}
        </div>

        <div className="pile-slot">
          <div className="pile-label">Discard ({discardPile.length})</div>
          <div
            style={{ cursor: canDrawOrTake && discardPile.length >= 2 ? 'pointer' : 'default' }}
            onClick={canDrawOrTake && discardPile.length >= 2 ? takeFromDiscard : undefined}
          >
            {topDiscard ? (
              <CardView card={topDiscard} size="md" />
            ) : (
              <div style={{ width: 58, height: 82, borderRadius: 5, border: '1.5px dashed rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)' }}>empty</span>
              </div>
            )}
          </div>
          {canDrawOrTake && discardPile.length >= 2 && (
            <button className="btn btn-ghost btn-sm" onClick={takeFromDiscard}>
              Take {discardPile.length - 1}
            </button>
          )}
          {canDrawOrTake && discardPile.length === 4 && (
            <button className="btn btn-warning btn-sm" onClick={() => setMode('take-all-return')}>
              Take all (–1)
            </button>
          )}
        </div>
      </div>

      {/* ── My melds ── */}
      <div className="my-section">
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)' }}>
          My melds
          {myState?.hasGoneDown && (
            <span className="badge badge-accent" style={{ marginLeft: 8, fontSize: '0.68rem' }}>
              DOWN · {myState.tableTotal} pts
            </span>
          )}
          {!myState?.hasGoneDown && isMyTurn && (
            <span style={{ marginLeft: 8, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
              need ≥{goDownThreshold} pts
            </span>
          )}
        </div>
        <div className="my-melds-row">
          {myState?.melds.map((meld) => (
            <div
              key={meld.id}
              className={`meld-group ${mode === 'add-to-meld' ? 'target' : ''}`}
              onClick={mode === 'add-to-meld' ? () => submitAddToMeld(meld.id) : undefined}
              title={mode === 'add-to-meld' ? 'Click to add cards here' : undefined}
            >
              {meld.cards.map((c) => (
                <CardView key={cardId(c)} card={c} size="sm" />
              ))}
            </div>
          ))}
          {(!myState?.melds || myState.melds.length === 0) && (
            <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: '0.78rem', alignSelf: 'center' }}>
              No melds placed
            </span>
          )}
        </div>
      </div>

      {/* ── Go-down builder panel ── */}
      {(mode === 'go-down' || mode === 'add-new-meld') && (
        <div className="go-down-panel">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>
                {mode === 'go-down' ? 'Go Down' : 'New Meld'}
              </span>
              {mode === 'go-down' && (
                <span style={{ fontSize: '0.82rem', color: pendingTotal >= goDownThreshold ? 'var(--success)' : 'var(--text-secondary)' }}>
                  {pendingTotal} / {goDownThreshold} pts
                </span>
              )}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={cancelMode}>Cancel</button>
          </div>

          {pendingMelds.length > 0 && (
            <div className="pending-melds">
              {pendingMelds.map((pm, i) => (
                <div key={i} className="pending-meld-item">
                  <span style={{ fontSize: '0.7rem', color: 'var(--accent)', marginRight: 3 }}>{pm.type}</span>
                  {pm.cards.map((c) => <CardView key={cardId(c)} card={c} size="xs" />)}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: 3 }}>
                    ({sumCards(pm.cards)})
                  </span>
                  <button className="btn-icon" style={{ fontSize: 11 }} onClick={() => setPendingMelds((p) => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {selectedCards.length > 0 ? `${selectedCards.length} selected (${sumCards(selectedCards)} pts)` : 'Select cards below'}
            </span>
            {mode === 'go-down' ? (
              <>
                <button className="btn btn-ghost btn-sm" disabled={selectedCards.length < 3} onClick={() => addToPendingMeld('set')}>+ Set</button>
                <button className="btn btn-ghost btn-sm" disabled={selectedCards.length < 3} onClick={() => addToPendingMeld('sequence')}>+ Sequence</button>
                <button className="btn btn-success btn-sm" disabled={pendingMelds.length === 0 || pendingTotal < goDownThreshold} onClick={submitGoDown}>
                  Submit ({pendingTotal} pts)
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" disabled={selectedCards.length < 3} onClick={() => submitAddNewMeld('set')}>Submit as Set</button>
                <button className="btn btn-ghost btn-sm" disabled={selectedCards.length < 3} onClick={() => submitAddNewMeld('sequence')}>Submit as Sequence</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Take-all / add-to-meld banners ── */}
      {mode === 'take-all-return' && (
        <div className="go-down-panel" style={{ borderTopColor: 'var(--warning)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--warning)', fontSize: '0.88rem', fontWeight: 600 }}>
              Taking all {discardPile.length} — click a card from your hand to return to the pile
            </span>
            <button className="btn btn-ghost btn-sm" onClick={cancelMode}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'add-to-meld' && (
        <div className="go-down-panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.88rem' }}>
              {selectedCards.length > 0 ? `${selectedCards.length} cards selected — click a meld above` : 'Select cards from hand, then click a meld above'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={cancelMode}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Hand ── */}
      <div className="hand-area">
        <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', padding: '0 12px' }}>
          Hand ({hand.length})
          {selectedCards.length > 0 && (
            <span style={{ color: 'var(--accent)', marginLeft: 8 }}>
              {selectedCards.length} selected · {sumCards(selectedCards)} pts
            </span>
          )}
        </div>
        <div className="hand-scroll">
          {hand.map((card) => {
            const inPend = isInPending(card);
            return (
              <CardView
                key={cardId(card)}
                card={card}
                selected={isSelected(card) || inPend}
                dimmed={inPend}
                size="md"
                onClick={() => {
                  if (mode === 'take-all-return') doTakeAll(card);
                  else toggleCard(card);
                }}
              />
            );
          })}
          {hand.length === 0 && (
            <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: '0.82rem', alignSelf: 'center' }}>
              No cards in hand
            </span>
          )}
        </div>
      </div>

      {/* ── Action bar ── */}
      <div className="action-bar">
        {!isMyTurn && (
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
            Waiting for {gameState.currentTurnPlayerId}…
          </span>
        )}
        {canDrawOrTake && mode === 'idle' && (
          <>
            <button className="btn btn-primary" onClick={drawFromDeck}>Draw from deck</button>
            {discardPile.length >= 2 && (
              <button className="btn btn-ghost" onClick={takeFromDiscard}>
                Take {discardPile.length - 1} from discard
              </button>
            )}
          </>
        )}
        {canHold && mode === 'idle' && (
          <>
            {canGoDown && (
              <button className="btn btn-success" onClick={() => { setMode('go-down'); setSelectedCards([]); }}>
                Go down (≥{goDownThreshold} pts)
              </button>
            )}
            {canAddMelds && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => { setMode('add-new-meld'); setSelectedCards([]); }}>+ New meld</button>
                <button className="btn btn-ghost btn-sm" disabled={selectedCards.length === 0} onClick={() => setMode('add-to-meld')}>
                  Add to meld
                </button>
              </>
            )}
            <div style={{ flex: 1 }} />
            <button
              className="btn btn-danger btn-sm"
              disabled={selectedCards.length !== 1}
              onClick={discard}
            >
              {selectedCards.length === 1 ? 'Discard ✓' : 'Discard (select 1)'}
            </button>
          </>
        )}
      </div>

      {/* ── Round result overlay ── */}
      {roundResult && (
        <div className="overlay">
          <div className="result-modal">
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, textAlign: 'center' }}>
              Round {roundResult.roundNumber} Result
            </h2>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
              {roundResult.endReason === 'player-finished'
                ? `${roundResult.finisherPlayerId} emptied their hand!`
                : 'Draw pile exhausted'}
            </div>
            <div className="col" style={{ gap: '0.45rem', marginTop: 8 }}>
              {[...roundResult.playerScores]
                .sort((a, b) => b.finalScore - a.finalScore)
                .map((ps) => (
                  <div key={ps.playerId} className="surface-sm row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontWeight: ps.playerId === myId ? 700 : 400 }}>
                        {ps.playerId}{ps.playerId === myId ? ' (you)' : ''}
                      </span>
                      {ps.finishedFirst && <span className="badge badge-success" style={{ fontSize: '0.68rem' }}>+20</span>}
                    </div>
                    <div className="row" style={{ gap: 10 }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {ps.tableTotal}−{ps.handTotal}
                      </span>
                      <span style={{ fontWeight: 700, color: ps.finalScore >= 0 ? 'var(--success)' : 'var(--danger)', minWidth: 40, textAlign: 'right' }}>
                        {ps.finalScore >= 0 ? '+' : ''}{ps.finalScore}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            {scores.length > 0 && (
              <>
                <div className="divider" />
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6 }}>Cumulative</div>
                {[...scores].sort((a, b) => b.total - a.total).map((s) => (
                  <div key={s.playerId} className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.9rem' }}>{s.playerId}{s.playerId === myId ? ' (you)' : ''}</span>
                    <span style={{ fontWeight: 700 }}>{s.total} / {GAME_CONFIG.WIN_SCORE}</span>
                  </div>
                ))}
              </>
            )}
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={clearRoundResult}>
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ── Game winner overlay ── */}
      {winner && (
        <div className="overlay">
          <div className="result-modal" style={{ textAlign: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '3.5rem' }}>🏆</div>
            <h2 style={{ fontSize: '1.7rem', fontWeight: 800 }}>
              {winner.playerId === myId ? 'You Win!' : `${winner.playerId} wins!`}
            </h2>
            <div style={{ color: 'var(--text-secondary)' }}>
              Final score: <strong>{winner.finalScore}</strong> pts
            </div>
            <Link href="/lobby" className="btn btn-primary btn-lg" style={{ marginTop: 8 }} onClick={leaveRoom}>
              Back to Lobby
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
