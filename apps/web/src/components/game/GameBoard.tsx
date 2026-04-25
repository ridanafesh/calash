'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { GAME_CONFIG, CARD_VALUES } from '@calash/shared';
import type { Card, JokerAssignment, MeldType, TurnAction, Suit } from '@calash/shared';
import { CardView, CardBack, cardId, cardEquals } from './CardView';
import { DiscardInspector } from './DiscardInspector';
import { HandToolbar } from './HandToolbar';
import { ScoresPanel } from './ScoresPanel';
import { JokerAssignmentPicker } from './JokerAssignmentPicker';
import { applySortMode, type HandSortMode } from './hand-sort';
import { detectMeldFitness, findExtendableMelds, sortForMeldPreview } from './meld-detect';

const SUIT_GLYPH: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_TEXT_COLOR: Record<Suit, string> = {
  hearts: '#dc2626',
  diamonds: '#dc2626',
  clubs: '#1f2937',
  spades: '#1f2937',
};

type GameMode = 'idle' | 'go-down' | 'add-new-meld' | 'add-to-meld' | 'take-all-return';

function sumCards(cards: readonly Card[]): number {
  return cards.reduce((s, c) => s + (CARD_VALUES[c.rank] ?? 0), 0);
}

export function GameBoard() {
  const { user } = useAuth();
  const { room, gameState, hand, myDrawnCard, roundResult, winner, scores, submitAction, leaveRoom, clearRoundResult, roomError, clearError } =
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
  const [scoresOpen, setScoresOpen] = useState(false);
  // Tracks the meld-count we expect after a successful submit. When the
  // server-broadcast state shows our melds list has reached this count, we
  // know the action committed and can clear the panel.
  const expectedMeldCountAfterSubmit = useRef<number | null>(null);
  // Tracks the hand size we expect after a successful discard (one less).
  const expectedHandSizeAfterDiscard = useRef<number | null>(null);
  // Tracks the most recent action we sent so we can re-submit with an added
  // jokerAssignment when the server returns AMBIGUOUS_JOKER_ASSIGNMENT.
  // This is the only place we keep the original action shape in client state;
  // it's cleared once the picker is dismissed or accepted.
  const lastAttemptedAction = useRef<TurnAction | null>(null);

  function send(action: TurnAction): void {
    lastAttemptedAction.current = action;
    submitAction(action);
  }

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

  // Auto-dismiss the round-result modal when the next round's state arrives
  // (gameState.roundNumber moves past the result's roundNumber). The user
  // may still see the modal for the 5s grace period, but it goes away
  // automatically the moment a fresh round starts so they're not staring at
  // last round's scores while round 2 is already live.
  useEffect(() => {
    if (roundResult && gameState && gameState.roundNumber > roundResult.roundNumber) {
      clearRoundResult();
    }
  }, [roundResult, gameState, clearRoundResult]);

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

  /**
   * Special finish exception: a player may go down even when below the
   * threshold IF the go-down would leave exactly one card in their hand
   * (which they then discard, emptying the hand and ending the round
   * with the +20 winner bonus). The engine enforces this; the UI mirrors
   * the rule so the Submit button isn't wrongly disabled.
   */
  const wouldFinishHand = pendingMelds.length > 0 && inPendingMelds.length === hand.length - 1;
  const meetsGoDownRule = pendingTotal >= goDownThreshold || wouldFinishHand;

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
  //
  // Owner-only rule: the engine rejects any add-to-meld targeting a meld
  // the actor doesn't own. Restrict the candidate pool to MY melds so the
  // UI never offers an opponent's meld as a drop target — both as a hint
  // and as a click handler. (Belt-and-suspenders: even if a stale UI tries
  // it, the server rejects it with a clear "you can only add cards to
  // your own melds" message.)
  const extendableMeldIds = useMemo(
    () =>
      new Set(
        findExtendableMelds(
          selectedCards,
          allTableMelds.filter((m) => m.ownerId === myId),
        ),
      ),
    [selectedCards, allTableMelds, myId],
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
    send({ type: 'add-to-meld', meldId, cards: [...selectedCards] });
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
    send({ type: 'draw-from-deck' });
  }

  /**
   * LEAVE-ONE mode: the player picked a specific discard card to remain on
   * the pile. Every other pile card moves to their hand. Submitted directly
   * from inside the DiscardInspector — no follow-up hand selection needed.
   */
  function takeLeaveOne(keepOnPileCard: Card) {
    send({ type: 'take-from-discard', keepOnPileCard });
    setMode('idle');
    setSelectedCards([]);
  }

  function keepDrawnCard() {
    if (submitting) return;
    clearError();
    send({ type: 'keep-drawn-card' });
  }

  function discardDrawnCardDirect() {
    if (submitting) return;
    clearError();
    send({ type: 'discard-drawn-card' });
  }

  /**
   * TAKE-ALL-REPLACE mode: the whole pile becomes part of the player's
   * hand, then the player picks one card from the COMBINED set (their
   * original hand plus the just-picked-up cards) to put back on the pile.
   *
   * The engine validates that the returned card is in `hand ∪ pile`, which
   * is exactly the post-pickup hand. The "take-all-return" mode renders
   * a banner and lifts every pile card into the hand area visually so the
   * player can click any of them.
   */
  function doTakeAll(returnCard: Card) {
    send({ type: 'take-from-discard', returnCardFromHand: returnCard });
    setMode('idle');
    setSelectedCards([]);
  }

  function discard() {
    if (selectedCards.length !== 1) return;
    if (submitting) return;
    clearError();
    setSubmitting(true);
    expectedHandSizeAfterDiscard.current = hand.length - 1;
    send({ type: 'discard', card: selectedCards[0] });
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
    send({ type: 'go-down', melds: pendingMelds });
  }

  function submitAddNewMeld(meldType: MeldType) {
    if (selectedCards.length < 2) return;
    if (submitting) return;
    clearError();
    setSubmitting(true);
    expectedMeldCountAfterSubmit.current = (myState?.melds.length ?? 0) + 1;
    const sorted = sortForMeldPreview(selectedCards, meldType);
    send({ type: 'add-new-meld', meld: { type: meldType, cards: sorted } });
  }

  function submitAddToMeld(meldId: string) {
    if (selectedCards.length === 0) return;
    if (submitting) return;
    clearError();
    setSubmitting(true);
    // Add-to-meld doesn't add a new meld but it does shrink the hand.
    expectedHandSizeAfterDiscard.current = hand.length - selectedCards.length;
    send({ type: 'add-to-meld', meldId, cards: [...selectedCards] });
  }

  // ── Joker assignment & replacement ────────────────────────────────────────

  /**
   * Re-submit the last action with the user's chosen joker assignment merged in.
   * Used after the AMBIGUOUS_JOKER_ASSIGNMENT picker is dismissed with a choice.
   */
  function resubmitWithJokerAssignment(choice: JokerAssignment): void {
    const last = lastAttemptedAction.current;
    if (!last) return;
    // Capture meldIndex BEFORE clearError() — clearError nulls out roomError
    // synchronously and the meldIndex would be lost.
    const meldIndexFromError = roomError?.meldIndex;
    clearError();

    // The first attempt failed with AMBIGUOUS_JOKER_ASSIGNMENT, which fired
    // the roomError effect and wiped BOTH expectation refs to null. Without
    // re-arming the right one, neither confirmation effect can fire when
    // the second submit broadcasts back, and the spinner sticks forever.
    // (This is the bug that caused the post-picker hang.)
    const myMeldsNow = myState?.melds.length ?? 0;
    const myHandLenNow = hand.length;

    if (last.type === 'go-down') {
      const idx = meldIndexFromError ?? 0;
      const newMelds = last.melds.map((m, i) =>
        i === idx ? { ...m, jokerAssignment: choice } : m,
      );
      expectedMeldCountAfterSubmit.current = myMeldsNow + newMelds.length;
      setSubmitting(true);
      send({ type: 'go-down', melds: newMelds });
    } else if (last.type === 'add-new-meld') {
      expectedMeldCountAfterSubmit.current = myMeldsNow + 1;
      setSubmitting(true);
      send({ type: 'add-new-meld', meld: { ...last.meld, jokerAssignment: choice } });
    } else if (last.type === 'add-to-meld') {
      // add-to-meld shrinks the hand by the cards added (no new meld row).
      expectedHandSizeAfterDiscard.current = myHandLenNow - last.cards.length;
      setSubmitting(true);
      send({ ...last, jokerAssignment: choice });
    }
  }

  /**
   * Trigger the replace-joker flow: a meld on the table contains a joker,
   * the player has the matching real card selected (exactly 1), and clicking
   * the meld swaps it. The meld may belong to the player or to an opponent.
   */
  function tryReplaceJoker(meldId: string, jokerAssignment: JokerAssignment): boolean {
    if (submitting) return false;
    if (!isMyTurn) return false;
    if (!myState?.hasGoneDown) return false;
    if (gameState?.didTakeFromDiscardThisTurn) return false;
    if (selectedCards.length !== 1) return false;
    // Owner-only rule: only the meld's owner can swap a joker out of it.
    // The opponent strip never marks itself as a target after this fix
    // (canReplaceJokerNow now requires ownership), but guard here too as a
    // safety net for any future caller of this helper.
    const ownerId = allTableMelds.find((m) => m.id === meldId)?.ownerId;
    if (ownerId !== myId) return false;
    const card = selectedCards[0];
    if (card.isJoker) return false;
    if (card.rank !== jokerAssignment.representsRank) return false;
    if (card.suit !== jokerAssignment.representsSuit) return false;
    clearError();
    // No optimistic submitting flag: replace-joker doesn't change hand size or
    // meld count, so neither commit-watch effect would fire. We instead clear
    // selection eagerly — the server-broadcast game:state and game:hand will
    // arrive in the next tick or so. If it errors, the error banner shows.
    setSelectedCards([]);
    send({ type: 'replace-joker', meldId, replacementCard: card });
    return true;
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

  // Pending draw decision — between draw-from-deck and the Keep/Discard
  // choice. While in this phase the engine rejects every other action, so
  // the UI hides the rest of the action bar and shows the preview instead.
  //
  // PRIVACY: the actual drawn card is delivered via the private
  // game:drawn-card socket event into context.myDrawnCard — only the
  // owning player ever receives it. Opponents see only
  // gameState.pendingDrawnCardPresent (a boolean) and render a redacted
  // "{name} is deciding…" hint with a card-back.
  const isPendingDecision = isMyTurn && gameState.turnPhase === 'pending-drawn-decision';
  const pendingDrawnCard = isPendingDecision ? myDrawnCard : null;

  // True when the local player can attempt to replace the joker in `meld`
  // right now: it has a joker assignment, the player has gone down, hasn't
  // taken from the discard pile this turn, has selected exactly one card
  // matching the joker's representsRank+suit, AND the meld belongs to the
  // local player (owner-only rule — never offered as a target on opponent
  // melds, even when the local player happens to hold the matching card).
  function canReplaceJokerNow(
    jokerAssignment: JokerAssignment | undefined,
    meldOwnerId: string,
  ): boolean {
    if (!jokerAssignment) return false;
    if (meldOwnerId !== myId) return false;
    if (!isMyTurn) return false;
    if (!myState?.hasGoneDown) return false;
    if (gameState?.didTakeFromDiscardThisTurn) return false;
    if (selectedCards.length !== 1) return false;
    const c = selectedCards[0];
    if (c.isJoker) return false;
    return c.rank === jokerAssignment.representsRank && c.suit === jokerAssignment.representsSuit;
  }

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
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setScoresOpen(true)}
          title="Show all players' cumulative scores"
        >
          📊 Scores
        </button>
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
                  // Owner-only: opponent melds are NEVER quick-extend or
                  // replace-joker targets. Render them read-only — visible
                  // but not interactive. The "MINE / OPPONENT" distinction
                  // is also reinforced by placement (opponents up top,
                  // mine in the my-section panel below).
                  return (
                    <div
                      key={meld.id}
                      className="meld-group"
                      style={{ cursor: 'default' }}
                    >
                      {meld.cards.map((c) => (
                        <CardView key={cardId(c)} card={c} size="xs" />
                      ))}
                      {meld.jokerAssignment && (
                        <JokerLabel assignment={meld.jokerAssignment} compact />
                      )}
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
              <div style={{ width: 84, height: 118, borderRadius: 5, border: '1.5px dashed rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            const canReplaceHere = canReplaceJokerNow(meld.jokerAssignment, myId);
            const showAsTarget = isExplicitTarget || isQuickTarget || canReplaceHere;
            const handleClick = canReplaceHere
              ? () => tryReplaceJoker(meld.id, meld.jokerAssignment!)
              : isExplicitTarget
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
                  canReplaceHere
                    ? `Click to swap your ${meld.jokerAssignment!.representsRank}${SUIT_GLYPH[meld.jokerAssignment!.representsSuit]} for the joker in this meld`
                    : isExplicitTarget
                      ? 'Click to add cards here'
                      : isQuickTarget
                        ? `Click to add ${selectedCards.length} card(s) to this meld`
                        : undefined
                }
              >
                {meld.cards.map((c) => (
                  <CardView key={cardId(c)} card={c} size="sm" />
                ))}
                {meld.jokerAssignment && (
                  <JokerLabel assignment={meld.jokerAssignment} />
                )}
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
                <span style={{ fontSize: '0.82rem', color: meetsGoDownRule ? 'var(--success)' : 'var(--text-secondary)' }}>
                  {pendingTotal} / {goDownThreshold} pts
                  {wouldFinishHand && pendingTotal < goDownThreshold && (
                    <span style={{ marginLeft: 6, color: 'var(--success)', fontWeight: 600 }}>
                      • finish hand!
                    </span>
                  )}
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

          {/* Selected Melds preview — only meaningful in go-down mode where
              the player builds up a list of melds before submitting. In
              add-new-meld mode there's no batching: one selection submits
              one meld immediately, so we skip the section there. The list
              container has its own scroll so a long pending-melds list
              never pushes the panel controls — or the bottom-anchored hand
              — off-screen. */}
          {mode === 'go-down' && (
            <div
              className="col"
              style={{ gap: 4, minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}
            >
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.55)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Selected melds {pendingMelds.length > 0 && `(${pendingMelds.length})`}
              </span>
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
                  disabled={submitting || pendingMelds.length === 0 || !meetsGoDownRule}
                  title={
                    pendingMelds.length === 0
                      ? 'Add at least one meld first'
                      : meetsGoDownRule
                        ? wouldFinishHand && pendingTotal < goDownThreshold
                          ? 'Below threshold, but this go-down empties your hand — round will end with +20 bonus'
                          : undefined
                        : `Need ${goDownThreshold} pts (or use all but one card to finish your hand)`
                  }
                  onClick={submitGoDown}
                >
                  {submitting
                    ? <><span className="spinner" style={{ width: 12, height: 12 }} aria-hidden="true" />Submitting…</>
                    : wouldFinishHand && pendingTotal < goDownThreshold
                      ? `Finish & win (${pendingTotal} pts)`
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
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ color: 'var(--warning)', fontSize: '0.88rem', fontWeight: 600 }}>
              Taking all {discardPile.length} — pick ANY card to put back on the pile.
            </span>
            <button className="btn btn-ghost btn-sm" onClick={cancelMode}>Cancel</button>
          </div>
          <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
            You may return one of your existing hand cards <strong>or</strong> one of the
            cards you just picked up from the pile (shown below in the “picked up” strip).
            Your turn ends as soon as you click.
          </p>
          {discardPile.length > 0 && (
            <div className="col" style={{ gap: 4, marginTop: 6 }}>
              <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)' }}>
                Just picked up — click any card to put it back on the pile:
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {discardPile.map((c) => (
                  <CardView
                    key={cardId(c) + ':pickup'}
                    card={c}
                    size="sm"
                    onClick={() => doTakeAll(c)}
                  />
                ))}
              </div>
            </div>
          )}
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

      {/* ── Drawn-card preview (Keep / Discard) ── */}
      {isPendingDecision && pendingDrawnCard && (
        <div className="drawn-card-preview" role="region" aria-label="Drawn card decision">
          <div className="drawn-card-preview-card">
            <CardView card={pendingDrawnCard} size="md" />
          </div>
          <div className="drawn-card-preview-body">
            <div className="drawn-card-preview-title">You drew this card</div>
            <p className="drawn-card-preview-help">
              Keep it (then discard one card from hand to end your turn) or
              discard it directly to the pile.
            </p>
            {roomError && (
              <div className="error-banner" role="alert" style={{ margin: 0 }}>
                {roomError.message}
                <button
                  onClick={clearError}
                  style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                  aria-label="Dismiss error"
                >✕</button>
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-success"
                disabled={submitting}
                onClick={keepDrawnCard}
              >
                ✓ Keep
              </button>
              <button
                className="btn btn-danger"
                disabled={submitting}
                onClick={discardDrawnCardDirect}
                title="Send the drawn card straight to the discard pile and end your turn"
              >
                ✕ Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending-decision view for opponents — REDACTED. We render a card-back
          so the player sees the activity without seeing the card's identity. */}
      {!isPendingDecision && gameState.turnPhase === 'pending-drawn-decision'
        && gameState.pendingDrawnCardPresent && (
        <div className="drawn-card-preview drawn-card-preview--watch" role="status">
          <div className="drawn-card-preview-card">
            <CardBack size="sm" />
          </div>
          <div className="drawn-card-preview-body">
            <div className="drawn-card-preview-title">
              {nameOf(gameState.currentTurnPlayerId)} drew a card and is deciding…
            </div>
          </div>
        </div>
      )}

      {/* Idle-mode error banner (e.g. invalid draw or discard rejected) */}
      {mode === 'idle' && !isPendingDecision && roomError && (
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
            {discardPile.length >= 1 && (
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
          onLeaveOne={(keep) => {
            setDiscardInspectorOpen(false);
            takeLeaveOne(keep);
          }}
          onStartTakeAllReturn={() => {
            setDiscardInspectorOpen(false);
            setMode('take-all-return');
          }}
          onClose={() => setDiscardInspectorOpen(false)}
        />
      )}

      {/* ── Scores panel (open from header button) ── */}
      {scoresOpen && (
        <ScoresPanel
          players={room?.players ?? []}
          gameState={gameState}
          scores={scores}
          myId={myId}
          onClose={() => setScoresOpen(false)}
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
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
              Round {(roundResult.roundNumber ?? 0) + 1} starts in a few seconds…
            </p>
            <button className="btn btn-ghost" onClick={clearRoundResult}>
              Dismiss
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

      {/* ── Joker assignment picker (ambiguous meld) ── */}
      {roomError?.code === 'AMBIGUOUS_JOKER_ASSIGNMENT' && roomError.candidates && roomError.candidates.length > 0 && (
        <JokerAssignmentPicker
          candidates={roomError.candidates}
          onChoose={(choice) => resubmitWithJokerAssignment(choice)}
          onCancel={() => {
            // Cancelling clears the error AND wipes the pending action so a
            // stale lastAttemptedAction can't be silently reused on the next
            // unrelated submission. The player keeps their selection so they
            // can adjust the meld and try again.
            clearError();
            lastAttemptedAction.current = null;
            setSubmitting(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Inline label used inside meld groups to show what real card a joker
 * currently represents. Stays small so it tucks under the joker card
 * without pushing other cards around.
 */
function JokerLabel({
  assignment,
  compact = false,
}: {
  assignment: JokerAssignment;
  compact?: boolean;
}) {
  return (
    <span
      title={`Joker is currently standing in for ${assignment.representsRank} of ${assignment.representsSuit}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: compact ? '0 4px' : '1px 6px',
        marginLeft: 2,
        background: 'rgba(217, 70, 239, 0.18)',
        color: '#f5d0fe',
        border: '1px solid rgba(217, 70, 239, 0.45)',
        borderRadius: 4,
        fontSize: compact ? '0.62rem' : '0.7rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">🃏→</span>
      <span>{assignment.representsRank}</span>
      <span style={{ color: SUIT_TEXT_COLOR[assignment.representsSuit], background: 'rgba(255,255,255,0.85)', padding: '0 2px', borderRadius: 2 }}>
        {SUIT_GLYPH[assignment.representsSuit]}
      </span>
    </span>
  );
}
