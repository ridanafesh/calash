'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { GAME_CONFIG, CARD_VALUES } from '@calash/shared';
import type { Card, MeldType } from '@calash/shared';
import { CardView, CardBack, cardId, cardEquals } from './CardView';
import { DiscardInspector } from './DiscardInspector';
import { HandToolbar } from './HandToolbar';
import { applySortMode, type HandSortMode } from './hand-sort';
import { detectMeldFitness, findExtendableMelds, sortForMeldPreview } from './meld-detect';

type GameMode = 'idle' | 'go-down' | 'add-new-meld' | 'add-to-meld' | 'take-all-return';

function sumCards(cards: readonly Card[]): number {
  return cards.reduce((s, c) => s + (CARD_VALUES[c.rank] ?? 0), 0);
}

export function GameBoard() {
  const { user } = useAuth();
  const { room, gameState, hand, roundResult, winner, scores, submitAction, leaveRoom, clearRoundResult, roomError, clearError } =
    useGame();

  const myId = user?.id ?? '';

  // Quick lookup for display names + bot status, keyed by user id.
  const playerById = useMemo(() => {
    const map = new Map<string, { displayName: string; isBot: boolean }>();
    for (const p of room?.players ?? []) {
      map.set(p.userId, { displayName: p.displayName, isBot: p.isBot });
    }
    return map;
  }, [room?.players]);

  function nameOf(uid: string): string {
    return playerById.get(uid)?.displayName ?? uid;
  }
  function isBot(uid: string): boolean {
    return playerById.get(uid)?.isBot ?? false;
  }

  const [mode, setMode] = useState<GameMode>('idle');
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [pendingMelds, setPendingMelds] = useState<Array<{ type: MeldType; cards: Card[] }>>([]);
  const [handSortMode, setHandSortMode] = useState<HandSortMode>('original');
  const [submitting, setSubmitting] = useState(false);
  const [discardInspectorOpen, setDiscardInspectorOpen] = useState(false);
  // Tracks the meld-count we expect after a successful submit. When the
  // server-broadcast state shows our melds list has reached this count, we
  // know the action committed and can clear the panel.
  const expectedMeldCountAfterSubmit = useRef<number | null>(null);
  // Tracks the hand size we expect after a successful discard (one less).
  const expectedHandSizeAfterDiscard = useRef<number | null>(null);

  // Derived hand: only the visual order changes — the underlying `hand` from
  // the server stays authoritative. Selection logic uses card identity so
  // re-sorting never disturbs which cards are selected.
  const displayedHand = useMemo(() => applySortMode(hand, handSortMode), [hand, handSortMode]);

  // Confirmation: when the server-broadcast state shows our melds list grew
  // to the expected size, our submit succeeded — clear panel.
  const myMeldCount = gameState?.playerStates[myId]?.melds.length ?? 0;
  useEffect(() => {
    if (
      submitting &&
      expectedMeldCountAfterSubmit.current !== null &&
      myMeldCount >= expectedMeldCountAfterSubmit.current
    ) {
      setSubmitting(false);
      setPendingMelds([]);
      setSelectedCards([]);
      setMode('idle');
      expectedMeldCountAfterSubmit.current = null;
    }
  }, [submitting, myMeldCount]);

  // Confirmation for actions that only shrink the hand (discard / add-to-meld).
  useEffect(() => {
    if (
      submitting &&
      expectedHandSizeAfterDiscard.current !== null &&
      hand.length <= expectedHandSizeAfterDiscard.current
    ) {
      setSubmitting(false);
      setSelectedCards([]);
      setMode('idle');
      expectedHandSizeAfterDiscard.current = null;
    }
  }, [submitting, hand.length]);

  // On error: release the submitting flag so the user can retry. Keep
  // pendingMelds and selection intact so the player doesn't lose their work.
  useEffect(() => {
    if (submitting && roomError) {
      setSubmitting(false);
      expectedMeldCountAfterSubmit.current = null;
      expectedHandSizeAfterDiscard.current = null;
    }
  }, [submitting, roomError]);

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

  // Live meld-fitness check for the current selection — drives button state
  // and the "✓ valid sequence" / "✗ no valid meld" hint shown to the user.
  // Pure derivation; no side effects.
  const meldFitness = useMemo(() => detectMeldFitness(selectedCards), [selectedCards]);

  // All melds currently on the table (mine + opponents'), with owner ids so
  // we can compare against the engine's add-to-meld lookup.
  const allTableMelds = useMemo(() => {
    if (!gameState) return [] as Array<{ id: string; type: typeof gameState.playerStates[string]['melds'][number]['type']; cards: typeof gameState.playerStates[string]['melds'][number]['cards']; ownerId: string }>;
    const out: Array<{ id: string; type: 'sequence' | 'set'; cards: readonly Card[]; ownerId: string }> = [];
    for (const [ownerId, ps] of Object.entries(gameState.playerStates)) {
      for (const m of ps.melds) {
        out.push({ id: m.id, type: m.type, cards: m.cards, ownerId });
      }
    }
    return out;
  }, [gameState]);

  // Which table melds can the current selection legally extend?
  // Used to highlight valid drop targets and to enable the in-place "extend"
  // shortcut (click meld → instant submit, no mode change).
  const extendableMeldIds = useMemo(
    () => new Set(findExtendableMelds(selectedCards, allTableMelds)),
    [selectedCards, allTableMelds],
  );

  function quickExtendMeld(meldId: string) {
    if (submitting) return;
    if (selectedCards.length === 0) return;
    if (!extendableMeldIds.has(meldId)) return;
    if (!myState?.hasGoneDown) return; // engine will reject anyway
    if (gameState?.didTakeFromDiscardThisTurn) return;
    clearError();
    setSubmitting(true);
    expectedHandSizeAfterDiscard.current = hand.length - selectedCards.length;
    submitAction({ type: 'add-to-meld', meldId, cards: [...selectedCards] });
  }

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
    if (submitting) return;
    clearError();
    setSubmitting(true);
    expectedHandSizeAfterDiscard.current = hand.length - 1;
    submitAction({ type: 'discard', card: selectedCards[0] });
  }

  function addToPendingMeld(meldType: MeldType) {
    if (selectedCards.length < 2) return;
    // Sort the cards into the order they'd actually play as the chosen meld
    // type — the user might have clicked them in any order. The engine
    // accepts any order, but this gives a clean preview.
    const sorted = sortForMeldPreview(selectedCards, meldType);
    setPendingMelds((prev) => [...prev, { type: meldType, cards: sorted }]);
    setSelectedCards([]);
  }

  function submitGoDown() {
    if (pendingMelds.length === 0) return;
    if (submitting) return;
    clearError();
    setSubmitting(true);
    // Existing on-table melds count + the new ones we expect to land.
    const currentMyMeldCount = myState?.melds.length ?? 0;
    expectedMeldCountAfterSubmit.current = currentMyMeldCount + pendingMelds.length;
    submitAction({ type: 'go-down', melds: pendingMelds });
  }

  function submitAddNewMeld(meldType: MeldType) {
    if (selectedCards.length < 2) return;
    if (submitting) return;
    clearError();
    setSubmitting(true);
    expectedMeldCountAfterSubmit.current = (myState?.melds.length ?? 0) + 1;
    const sorted = sortForMeldPreview(selectedCards, meldType);
    submitAction({ type: 'add-new-meld', meld: { type: meldType, cards: sorted } });
  }

  function submitAddToMeld(meldId: string) {
    if (selectedCards.length === 0) return;
    if (submitting) return;
    clearError();
    setSubmitting(true);
    // Add-to-meld doesn't add a new meld but it does shrink the hand.
    expectedHandSizeAfterDiscard.current = hand.length - selectedCards.length;
    submitAction({ type: 'add-to-meld', meldId, cards: [...selectedCards] });
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
        ) : isBot(gameState.currentTurnPlayerId) ? (
          <span className="row" style={{ gap: 6, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <span className="spinner" style={{ width: 12, height: 12 }} aria-hidden="true" />
            {nameOf(gameState.currentTurnPlayerId)} is thinking…
          </span>
        ) : (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {nameOf(gameState.currentTurnPlayerId)}&apos;s turn
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
                <div
                  className="avatar"
                  style={{
                    width: 24, height: 24, fontSize: '0.7rem',
                    background: isBot(opId) ? 'var(--surface-2)' : 'var(--accent)',
                  }}
                >
                  {isBot(opId) ? '🤖' : nameOf(opId).charAt(0).toUpperCase()}
                </div>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                  {nameOf(opId)}
                </span>
                {isBot(opId) && <span className="badge badge-accent" style={{ fontSize: '0.62rem' }}>BOT</span>}
                {isOpTurn && <span className="badge badge-warning" style={{ fontSize: '0.68rem' }}>▶</span>}
                {op?.hasGoneDown && <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>DOWN</span>}
              </div>
              {opScore && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {opScore.total} pts
                </div>
              )}
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {op?.melds.map((meld) => {
                  const isQuickTarget =
                    mode === 'idle' &&
                    !submitting &&
                    selectedCards.length > 0 &&
                    extendableMeldIds.has(meld.id) &&
                    isMyTurn &&
                    !!myState?.hasGoneDown &&
                    !gameState?.didTakeFromDiscardThisTurn;
                  return (
                    <div
                      key={meld.id}
                      className={`meld-group ${isQuickTarget ? 'target' : ''}`}
                      onClick={isQuickTarget ? () => quickExtendMeld(meld.id) : undefined}
                      title={isQuickTarget ? `Click to add ${selectedCards.length} card(s) to this opponent meld` : undefined}
                    >
                      {meld.cards.map((c) => (
                        <CardView key={cardId(c)} card={c} size="xs" />
                      ))}
                    </div>
                  );
                })}
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
            style={{ cursor: discardPile.length > 0 ? 'pointer' : 'default' }}
            onClick={discardPile.length > 0 ? () => setDiscardInspectorOpen(true) : undefined}
            title={discardPile.length > 0 ? 'Click to inspect the full pile' : 'Pile is empty'}
          >
            {topDiscard ? (
              <CardView card={topDiscard} size="md" />
            ) : (
              <div style={{ width: 58, height: 82, borderRadius: 5, border: '1.5px dashed rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)' }}>empty</span>
              </div>
            )}
          </div>
          {discardPile.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setDiscardInspectorOpen(true)}
              title="View all cards on the pile"
            >
              Inspect
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
          {myState?.melds.map((meld) => {
            const isExplicitTarget = mode === 'add-to-meld';
            const isQuickTarget =
              mode === 'idle' &&
              !submitting &&
              selectedCards.length > 0 &&
              extendableMeldIds.has(meld.id) &&
              isMyTurn &&
              !!myState?.hasGoneDown &&
              !gameState?.didTakeFromDiscardThisTurn;
            const showAsTarget = isExplicitTarget || isQuickTarget;
            const handleClick = isExplicitTarget
              ? () => submitAddToMeld(meld.id)
              : isQuickTarget
                ? () => quickExtendMeld(meld.id)
                : undefined;
            return (
              <div
                key={meld.id}
                className={`meld-group ${showAsTarget ? 'target' : ''}`}
                onClick={handleClick}
                title={
                  isExplicitTarget
                    ? 'Click to add cards here'
                    : isQuickTarget
                      ? `Click to add ${selectedCards.length} card(s) to this meld`
                      : undefined
                }
              >
                {meld.cards.map((c) => (
                  <CardView key={cardId(c)} card={c} size="sm" />
                ))}
              </div>
            );
          })}
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
            <button className="btn btn-ghost btn-sm" onClick={cancelMode} disabled={submitting}>Cancel</button>
          </div>

          {roomError && (
            <div className="error-banner" role="alert" style={{ marginTop: 4 }}>
              {roomError.message}
              <button
                onClick={clearError}
                style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                aria-label="Dismiss error"
              >✕</button>
            </div>
          )}

          {pendingMelds.length > 0 && (
            <div className="pending-melds">
              {pendingMelds.map((pm, i) => (
                <div key={i} className="pending-meld-item">
                  <span style={{ fontSize: '0.7rem', color: 'var(--accent)', marginRight: 3 }}>{pm.type}</span>
                  {pm.cards.map((c) => <CardView key={cardId(c)} card={c} size="xs" />)}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: 3 }}>
                    ({sumCards(pm.cards)})
                  </span>
                  <button
                    className="btn-icon"
                    style={{ fontSize: 11 }}
                    disabled={submitting}
                    onClick={() => setPendingMelds((p) => p.filter((_, j) => j !== i))}
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {selectedCards.length > 0
                ? `${selectedCards.length} selected (${sumCards(selectedCards)} pts)`
                : 'Select cards below'}
            </span>
            {/* Live fitness hint — drives confidence about which button to press. */}
            {selectedCards.length >= 3 && (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color:
                    meldFitness.bestType === 'sequence'
                      ? 'var(--success)'
                      : meldFitness.bestType === 'set'
                        ? 'var(--accent)'
                        : 'var(--danger)',
                }}
              >
                {meldFitness.isValidSequence && meldFitness.isValidSet
                  ? '✓ valid sequence or set'
                  : meldFitness.isValidSequence
                    ? '✓ valid sequence'
                    : meldFitness.isValidSet
                      ? '✓ valid set'
                      : '✗ not a valid meld'}
              </span>
            )}
            {mode === 'go-down' ? (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={submitting || !meldFitness.isValidSet}
                  title={meldFitness.isValidSet ? 'Add as set' : 'Selected cards do not form a valid set (same rank, distinct suits)'}
                  onClick={() => addToPendingMeld('set')}
                >
                  + Set
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={submitting || !meldFitness.isValidSequence}
                  title={meldFitness.isValidSequence ? 'Add as sequence' : 'Selected cards do not form a valid sequence (same suit, consecutive ranks)'}
                  onClick={() => addToPendingMeld('sequence')}
                >
                  + Sequence
                </button>
                <button
                  className="btn btn-success btn-sm"
                  disabled={submitting || pendingMelds.length === 0 || pendingTotal < goDownThreshold}
                  onClick={submitGoDown}
                >
                  {submitting
                    ? <><span className="spinner" style={{ width: 12, height: 12 }} aria-hidden="true" />Submitting…</>
                    : `Submit (${pendingTotal} pts)`}
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={submitting || !meldFitness.isValidSet}
                  title={meldFitness.isValidSet ? 'Submit as set' : 'Selected cards do not form a valid set'}
                  onClick={() => submitAddNewMeld('set')}
                >
                  {submitting ? 'Submitting…' : 'Submit as Set'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={submitting || !meldFitness.isValidSequence}
                  title={meldFitness.isValidSequence ? 'Submit as sequence' : 'Selected cards do not form a valid sequence'}
                  onClick={() => submitAddNewMeld('sequence')}
                >
                  {submitting ? 'Submitting…' : 'Submit as Sequence'}
                </button>
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
              {submitting
                ? 'Submitting…'
                : selectedCards.length > 0
                  ? `${selectedCards.length} cards selected — click a meld above`
                  : 'Select cards from hand, then click a meld above'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={cancelMode} disabled={submitting}>Cancel</button>
          </div>
          {roomError && (
            <div className="error-banner" role="alert" style={{ marginTop: 4 }}>
              {roomError.message}
              <button
                onClick={clearError}
                style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                aria-label="Dismiss error"
              >✕</button>
            </div>
          )}
        </div>
      )}

      {/* ── Hand ── */}
      <div className="hand-area">
        <HandToolbar
          mode={handSortMode}
          onChange={setHandSortMode}
          cardCount={hand.length}
          selectedCount={selectedCards.length}
          selectedPoints={sumCards(selectedCards)}
        />
        <div className="hand-scroll">
          {displayedHand.map((card) => {
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

      {/* Quick-extend hint: cards selected, valid extension target highlighted */}
      {mode === 'idle' && !submitting && selectedCards.length > 0 && extendableMeldIds.size > 0 &&
        isMyTurn && myState?.hasGoneDown && !gameState?.didTakeFromDiscardThisTurn && (
        <div className="info-banner" role="status" style={{ margin: '0 12px 4px' }}>
          ✨ {extendableMeldIds.size === 1 ? '1 meld' : `${extendableMeldIds.size} melds`} can be extended — click the highlighted meld above
        </div>
      )}

      {/* Idle-mode error banner (e.g. invalid draw or discard rejected) */}
      {mode === 'idle' && roomError && (
        <div className="error-banner" role="alert" style={{ margin: '0 12px 4px' }}>
          {roomError.message}
          <button
            onClick={clearError}
            style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            aria-label="Dismiss error"
          >✕</button>
        </div>
      )}

      {/* ── Action bar ── */}
      <div className="action-bar">
        {!isMyTurn && (
          <span className="row" style={{ gap: 6, color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
            {isBot(gameState.currentTurnPlayerId) && <span className="spinner" style={{ width: 12, height: 12 }} aria-hidden="true" />}
            {isBot(gameState.currentTurnPlayerId)
              ? `${nameOf(gameState.currentTurnPlayerId)} is thinking…`
              : `Waiting for ${nameOf(gameState.currentTurnPlayerId)}…`}
          </span>
        )}
        {canDrawOrTake && mode === 'idle' && (
          <>
            <button className="btn btn-primary" disabled={submitting} onClick={drawFromDeck}>Draw from deck</button>
            {discardPile.length >= 2 && (
              <button
                className="btn btn-ghost"
                disabled={submitting}
                onClick={() => setDiscardInspectorOpen(true)}
                title="Open pile inspector to take cards"
              >
                Take from discard…
              </button>
            )}
          </>
        )}
        {canHold && mode === 'idle' && (
          <>
            {canGoDown && (
              <button className="btn btn-success" disabled={submitting} onClick={() => { setMode('go-down'); setSelectedCards([]); clearError(); }}>
                Go down (≥{goDownThreshold} pts)
              </button>
            )}
            {canAddMelds && (
              <>
                <button className="btn btn-ghost btn-sm" disabled={submitting} onClick={() => { setMode('add-new-meld'); setSelectedCards([]); clearError(); }}>+ New meld</button>
                <button className="btn btn-ghost btn-sm" disabled={submitting || selectedCards.length === 0} onClick={() => { setMode('add-to-meld'); clearError(); }}>
                  Add to meld
                </button>
              </>
            )}
            <div style={{ flex: 1 }} />
            <button
              className="btn btn-danger btn-sm"
              disabled={submitting || selectedCards.length !== 1}
              onClick={discard}
            >
              {submitting
                ? 'Discarding…'
                : selectedCards.length === 1
                  ? 'Discard ✓'
                  : 'Discard (select 1)'}
            </button>
          </>
        )}
      </div>

      {/* ── Discard pile inspector ── */}
      {discardInspectorOpen && (
        <DiscardInspector
          pile={discardPile}
          canTake={canDrawOrTake}
          onTakeStandard={() => {
            setDiscardInspectorOpen(false);
            takeFromDiscard();
          }}
          onTakeAllReturn={discardPile.length === 4 ? () => {
            setDiscardInspectorOpen(false);
            setMode('take-all-return');
          } : undefined}
          onClose={() => setDiscardInspectorOpen(false)}
        />
      )}

      {/* ── Round result overlay ── */}
      {roundResult && (
        <div className="overlay">
          <div className="result-modal">
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, textAlign: 'center' }}>
              Round {roundResult.roundNumber} Result
            </h2>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
              {roundResult.endReason === 'player-finished' && roundResult.finisherPlayerId
                ? `${nameOf(roundResult.finisherPlayerId)} emptied their hand!`
                : 'Draw pile exhausted'}
            </div>
            <div className="col" style={{ gap: '0.45rem', marginTop: 8 }}>
              {[...roundResult.playerScores]
                .sort((a, b) => b.finalScore - a.finalScore)
                .map((ps) => (
                  <div key={ps.playerId} className="surface-sm row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontWeight: ps.playerId === myId ? 700 : 400 }}>
                        {nameOf(ps.playerId)}{ps.playerId === myId ? ' (you)' : ''}
                      </span>
                      {isBot(ps.playerId) && <span className="badge badge-accent" style={{ fontSize: '0.62rem' }}>BOT</span>}
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
                    <span style={{ fontSize: '0.9rem' }}>
                      {nameOf(s.playerId)}{s.playerId === myId ? ' (you)' : ''}
                      {isBot(s.playerId) && <span className="badge badge-accent" style={{ fontSize: '0.62rem', marginLeft: 6 }}>BOT</span>}
                    </span>
                    <span style={{ fontWeight: 700 }}>{s.total} / {GAME_CONFIG.WIN_SCORE}</span>
                  </div>
                ))}
              </>
            )}
            {roundResult.nextDealerId && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: 4 }}>
                Next dealer: <strong style={{ color: 'var(--text-primary)' }}>{nameOf(roundResult.nextDealerId)}</strong>
              </div>
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
              {winner.playerId === myId ? 'You Win!' : `${nameOf(winner.playerId)} wins!`}
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
