'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card, RegularCard, Suit } from '@calash/shared';
import { RANK_ORDER } from '@calash/shared';
import { CardView, cardEquals, cardId } from './CardView';

interface DiscardInspectorProps {
  pile: readonly Card[];
  /** True when the player can take from the discard pile this turn. */
  canTake: boolean;
  /**
   * LEAVE-ONE mode: the player picked one specific pile card to remain on
   * the ground; every other pile card moves to their hand. Called from
   * inside the inspector after the player confirms a selection.
   */
  onLeaveOne: (keepOnPileCard: Card) => void;
  /**
   * TAKE-ALL-REPLACE mode: take the entire pile and then the player picks
   * one card from their (now-extended) hand to put back on the pile. The
   * inspector closes and GameBoard drives the hand-side selection.
   */
  onStartTakeAllReturn: () => void;
  onClose: () => void;
}

type ViewMode = 'grouped' | 'order';

interface Entry {
  card: Card;
  originalIndex: number; // position in the pile: 0 = bottom (oldest), N-1 = top
}

const SUIT_META: Array<{ suit: Suit; symbol: string; label: string; color: string }> = [
  { suit: 'spades',   symbol: '♠', label: 'Spades',   color: '#e5e7eb' },
  { suit: 'hearts',   symbol: '♥', label: 'Hearts',   color: '#f87171' },
  { suit: 'diamonds', symbol: '♦', label: 'Diamonds', color: '#f87171' },
  { suit: 'clubs',    symbol: '♣', label: 'Clubs',    color: '#e5e7eb' },
];

/**
 * Modal card-browser for the discard pile with two pickup modes:
 *
 *   Mode 1 — "Take all + leave one on the ground"
 *     The player clicks any pile card; that card stays on the pile and
 *     every other pile card moves to their hand. Submit happens directly
 *     from inside the inspector.
 *
 *   Mode 2 — "Take all + return one from hand"
 *     The whole pile moves to the player's hand; the inspector closes
 *     and the parent (GameBoard) prompts the player to pick one card
 *     from their now-extended hand to put back on the pile. The returned
 *     card may be one of the just-picked-up cards.
 *
 * Either mode ends with exactly 1 card on the pile and the turn passes.
 *
 * View toggle (grouped/order) is purely presentational.
 */
export function DiscardInspector({
  pile,
  canTake,
  onLeaveOne,
  onStartTakeAllReturn,
  onClose,
}: DiscardInspectorProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<ViewMode>('grouped');
  // When set, the player is in "leave-one selection" mode and this is the
  // card they've highlighted as the one that should stay on the pile.
  const [leaveOneSelected, setLeaveOneSelected] = useState<Card | null>(null);
  const [pickerActive, setPickerActive] = useState(false);

  // Close on Escape and outside click. (When the picker is active and a card
  // is highlighted, Escape clears the selection first instead of closing.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (leaveOneSelected) {
        setLeaveOneSelected(null);
        return;
      }
      if (pickerActive) {
        setPickerActive(false);
        return;
      }
      onClose();
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose, leaveOneSelected, pickerActive]);

  const entries: Entry[] = useMemo(
    () => pile.map((card, originalIndex) => ({ card, originalIndex })),
    [pile],
  );

  const bySuit = useMemo(() => groupBySuit(entries), [entries]);

  const canLeaveOne = pile.length >= 2;
  const canTakeAll = pile.length >= 1;
  const bottomIndex = 0;
  const topIndex = pile.length - 1;

  function selectForLeaveOne(card: Card) {
    if (!pickerActive) return;
    setLeaveOneSelected((prev) => (prev && cardEquals(prev, card) ? null : card));
  }

  function confirmLeaveOne() {
    if (!leaveOneSelected) return;
    onLeaveOne(leaveOneSelected);
  }

  function highlight(c: Card): boolean {
    return !!leaveOneSelected && cardEquals(leaveOneSelected, c);
  }

  return (
    <div className="overlay" role="dialog" aria-label="Discard pile">
      <div
        ref={ref}
        className="result-modal discard-inspector"
        style={{ maxWidth: 640, width: '100%', maxHeight: '85vh', gap: '0.75rem' }}
      >
        {/* Header */}
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
            Discard pile ({pile.length})
          </h2>
          <div className="row" style={{ gap: 4 }}>
            <div className="hand-toolbar-actions" role="radiogroup" aria-label="View mode">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'grouped'}
                className={`hand-toolbar-btn ${mode === 'grouped' ? 'is-active' : ''}`}
                onClick={() => setMode('grouped')}
                title="Group cards by suit"
              >
                Grouped
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'order'}
                className={`hand-toolbar-btn ${mode === 'order' ? 'is-active' : ''}`}
                onClick={() => setMode('order')}
                title="Show cards in pile order (bottom → top)"
              >
                Order
              </button>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              aria-label="Close discard inspector"
              style={{ marginLeft: 4 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Mode-1 picker hint banner */}
        {pickerActive && (
          <div
            className="info-banner"
            role="status"
            style={{ margin: 0, fontSize: '0.85rem' }}
          >
            <strong>Pick one card to leave on the pile.</strong> Every other discard card
            will move into your hand. The card you click stays on the ground.
          </div>
        )}

        {/* Scrollable card area */}
        <div className="discard-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {pile.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>
              Pile is empty.
            </div>
          ) : mode === 'grouped' ? (
            <div className="col" style={{ gap: '0.6rem' }}>
              {/* Regular suits */}
              {SUIT_META.map(({ suit, symbol, label, color }) => {
                const group = bySuit.bySuit[suit];
                if (!group || group.length === 0) return null;
                return (
                  <SuitSection
                    key={suit}
                    symbol={symbol}
                    label={label}
                    color={color}
                    count={group.length}
                    entries={group}
                    bottomIndex={bottomIndex}
                    topIndex={topIndex}
                    selectable={pickerActive}
                    isSelected={highlight}
                    onSelect={selectForLeaveOne}
                  />
                );
              })}
              {/* Jokers */}
              {bySuit.jokers.length > 0 && (
                <SuitSection
                  symbol="🃏"
                  label="Jokers"
                  color="#e879f9"
                  count={bySuit.jokers.length}
                  entries={bySuit.jokers}
                  bottomIndex={bottomIndex}
                  topIndex={topIndex}
                  selectable={pickerActive}
                  isSelected={highlight}
                  onSelect={selectForLeaveOne}
                />
              )}
            </div>
          ) : (
            <div className="discard-order-row">
              {entries.map((e) => (
                <EntryChip
                  key={cardId(e.card) + ':' + e.originalIndex}
                  entry={e}
                  bottomIndex={bottomIndex}
                  topIndex={topIndex}
                  selectable={pickerActive}
                  isSelected={highlight(e.card)}
                  onSelect={() => selectForLeaveOne(e.card)}
                  showIndex
                />
              ))}
            </div>
          )}
        </div>

        {/* Take actions */}
        {canTake && pile.length >= 1 && (
          <div className="col" style={{ gap: 6 }}>
            {!pickerActive ? (
              <>
                {canLeaveOne && (
                  <button
                    className="btn btn-primary btn-block"
                    onClick={() => setPickerActive(true)}
                  >
                    Take all + leave one card on the ground
                  </button>
                )}
                {canTakeAll && (
                  <button
                    className="btn btn-warning btn-block"
                    onClick={onStartTakeAllReturn}
                    title="Take the whole pile, then choose any card from your hand (including just-picked-up cards) to put back on the pile."
                  >
                    Take all + return one card from hand
                  </button>
                )}
                <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {canLeaveOne && (
                    <>
                      <strong>Leave-one</strong>: pick any card from the pile to stay on the ground;
                      every other pile card moves into your hand. No follow-up discard needed.{' '}
                    </>
                  )}
                  <strong>Take-all + return</strong>: the whole pile moves into your hand and you
                  put one card back on the pile. The returned card can be one you originally held
                  or one you just picked up.{' '}
                  {pile.length === 1 && (
                    <>With only 1 card on the pile, take-all + return is the only legal pickup. </>
                  )}
                  <strong>Either action ends your turn — you cannot go down or extend a meld this turn.</strong>
                </p>
              </>
            ) : (
              <>
                <div
                  className="row"
                  style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {leaveOneSelected
                      ? 'Confirm: this card stays on the ground.'
                      : 'Click a card above to select it.'}
                  </span>
                  {leaveOneSelected && <SelectedCardBadge card={leaveOneSelected} />}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPickerActive(false);
                      setLeaveOneSelected(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-success btn-block"
                    style={{ flex: 1 }}
                    disabled={!leaveOneSelected}
                    onClick={confirmLeaveOne}
                  >
                    {leaveOneSelected ? 'Confirm — take the rest' : 'Pick a card first'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!canTake && (
          <p className="info-banner" style={{ margin: 0, fontSize: '0.85rem' }}>
            You can only take from the discard pile during the draw phase of your turn.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface SuitSectionProps {
  symbol: string;
  label: string;
  color: string;
  count: number;
  entries: Entry[];
  bottomIndex: number;
  topIndex: number;
  selectable: boolean;
  isSelected: (card: Card) => boolean;
  onSelect: (card: Card) => void;
}

function SuitSection({
  symbol,
  label,
  color,
  count,
  entries,
  bottomIndex,
  topIndex,
  selectable,
  isSelected,
  onSelect,
}: SuitSectionProps) {
  return (
    <div className="discard-suit">
      <div className="discard-suit-header">
        <span style={{ color, fontSize: '1.05rem', lineHeight: 1 }}>{symbol}</span>
        <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{label}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>({count})</span>
      </div>
      <div className="discard-suit-cards">
        {entries.map((e) => (
          <EntryChip
            key={cardId(e.card) + ':' + e.originalIndex}
            entry={e}
            bottomIndex={bottomIndex}
            topIndex={topIndex}
            selectable={selectable}
            isSelected={isSelected(e.card)}
            onSelect={() => onSelect(e.card)}
          />
        ))}
      </div>
    </div>
  );
}

interface EntryChipProps {
  entry: Entry;
  bottomIndex: number;
  topIndex: number;
  selectable: boolean;
  isSelected: boolean;
  onSelect: () => void;
  showIndex?: boolean;
}

function EntryChip({
  entry,
  bottomIndex,
  topIndex,
  selectable,
  isSelected,
  onSelect,
  showIndex,
}: EntryChipProps) {
  const isBottom = entry.originalIndex === bottomIndex;
  const isTop = entry.originalIndex === topIndex;
  return (
    <div
      className={`discard-chip ${isBottom ? 'is-bottom' : ''} ${isTop ? 'is-top' : ''} ${isSelected ? 'is-selected' : ''}`}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : -1}
      onClick={selectable ? onSelect : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      title={
        selectable
          ? isSelected
            ? 'Selected — this card stays on the pile'
            : 'Click to leave this card on the pile'
          : isBottom
            ? 'Bottom — oldest card on the pile'
            : isTop
              ? 'Top — most recent discard'
              : `Pile position #${entry.originalIndex + 1}`
      }
      style={
        selectable
          ? { cursor: 'pointer', outline: isSelected ? '2px solid var(--success)' : undefined, borderRadius: 6 }
          : undefined
      }
    >
      <CardView card={entry.card} size="sm" />
      {isBottom && <span className="ds-marker ds-marker--bottom" aria-hidden="true">⚓</span>}
      {isTop && !isBottom && <span className="ds-marker ds-marker--top" aria-hidden="true">🆕</span>}
      {showIndex && (
        <span className="discard-chip-index" aria-hidden="true">#{entry.originalIndex + 1}</span>
      )}
    </div>
  );
}

function SelectedCardBadge({ card }: { card: Card }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.45)', color: '#bbf7d0', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600 }}>
      <span aria-hidden="true">✓</span>
      <CardView card={card} size="xs" />
    </div>
  );
}

// ─── Grouping + sorting helpers ─────────────────────────────────────────────

interface Grouped {
  bySuit: Record<Suit, Entry[]>;
  jokers: Entry[];
}

function groupBySuit(entries: readonly Entry[]): Grouped {
  const bySuit: Record<Suit, Entry[]> = {
    spades: [], hearts: [], clubs: [], diamonds: [],
  };
  const jokers: Entry[] = [];

  for (const e of entries) {
    if (e.card.isJoker) {
      jokers.push(e);
    } else {
      bySuit[(e.card as RegularCard).suit].push(e);
    }
  }

  // Ascending rank within each suit. Ties (two decks) broken by originalIndex
  // so order is stable across renders.
  for (const suit of Object.keys(bySuit) as Suit[]) {
    bySuit[suit].sort((a, b) => {
      const ra = RANK_ORDER[(a.card as RegularCard).rank] ?? 0;
      const rb = RANK_ORDER[(b.card as RegularCard).rank] ?? 0;
      if (ra !== rb) return ra - rb;
      return a.originalIndex - b.originalIndex;
    });
  }
  jokers.sort((a, b) => a.originalIndex - b.originalIndex);

  return { bySuit, jokers };
}
