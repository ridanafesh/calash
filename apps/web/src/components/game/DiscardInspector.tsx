'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card, RegularCard, Suit } from '@calash/shared';
import { RANK_ORDER } from '@calash/shared';
import { CardView, cardId } from './CardView';

interface DiscardInspectorProps {
  pile: readonly Card[];
  /** True when the player can take from the discard pile this turn. */
  canTake: boolean;
  /** Take pile.length - 1 cards, leaving exactly 1 (the bottom card). */
  onTakeStandard: () => void;
  /**
   * Take all 4 cards and immediately return one card from hand. Only legal
   * when pile.length === 4.
   */
  onTakeAllReturn?: () => void;
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
 * Modal card-browser for the discard pile. Renders in one of two modes:
 *
 *   - 'grouped' (default): entries bucketed by suit (Spades/Hearts/Clubs/
 *     Diamonds/Jokers), ascending rank within each bucket. Compact; fits
 *     in a single modal height even with a deep pile.
 *   - 'order':  entries in pile order (bottom → top) as a wrappable row.
 *
 * The bottom card (oldest, the one that stays after a standard take) and
 * the top card (newest) are tagged with overlay markers regardless of mode
 * so the player can always locate them.
 *
 * Take actions and their legality are unchanged — purely a presentation
 * layer refresh on top of the existing DiscardInspector contract.
 */
export function DiscardInspector({
  pile,
  canTake,
  onTakeStandard,
  onTakeAllReturn,
  onClose,
}: DiscardInspectorProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<ViewMode>('grouped');

  // Close on Escape and outside click.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
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
  }, [onClose]);

  const entries: Entry[] = useMemo(
    () => pile.map((card, originalIndex) => ({ card, originalIndex })),
    [pile],
  );

  const bySuit = useMemo(() => groupBySuit(entries), [entries]);

  const isFour = pile.length === 4;
  const standardTakeCount = pile.length - 1;
  const bottomIndex = 0;
  const topIndex = pile.length - 1;

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

        {/* Legend */}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          <span>
            <span className="ds-marker ds-marker--top" aria-hidden="true">🆕</span>
            <span style={{ marginLeft: 4 }}>top — most recent</span>
          </span>
          <span>
            <span className="ds-marker ds-marker--bottom" aria-hidden="true">⚓</span>
            <span style={{ marginLeft: 4 }}>bottom — stays after standard take</span>
          </span>
        </div>

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
                  showIndex
                />
              ))}
            </div>
          )}
        </div>

        {/* Take actions (unchanged logic) */}
        {canTake && pile.length >= 2 && (
          <div className="col" style={{ gap: 6 }}>
            <button className="btn btn-primary btn-block" onClick={onTakeStandard}>
              Take {standardTakeCount} card{standardTakeCount === 1 ? '' : 's'} (leave bottom card)
            </button>
            {isFour && onTakeAllReturn && (
              <button className="btn btn-warning btn-block" onClick={onTakeAllReturn}>
                Take all 4 + return 1 from hand
              </button>
            )}
            <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: 0 }}>
              Standard take grabs every card except the bottom one — that card stays on the pile.
              {isFour && <> The "take all + return" option lets you swap an unwanted hand card onto the pile instead.</>}
            </p>
          </div>
        )}

        {!canTake && (
          <p className="info-banner" style={{ margin: 0, fontSize: '0.85rem' }}>
            You can only take from the discard pile during the draw phase of your turn.
          </p>
        )}

        {pile.length === 1 && canTake && (
          <p className="info-banner" style={{ margin: 0, fontSize: '0.85rem' }}>
            Only one card on the pile — it must stay. Draw from the deck instead.
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
}

function SuitSection({ symbol, label, color, count, entries, bottomIndex, topIndex }: SuitSectionProps) {
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
  showIndex?: boolean;
}

function EntryChip({ entry, bottomIndex, topIndex, showIndex }: EntryChipProps) {
  const isBottom = entry.originalIndex === bottomIndex;
  const isTop = entry.originalIndex === topIndex;
  return (
    <div
      className={`discard-chip ${isBottom ? 'is-bottom' : ''} ${isTop ? 'is-top' : ''}`}
      title={
        isBottom
          ? 'Bottom — stays after standard take'
          : isTop
            ? 'Top — most recent discard'
            : `Pile position #${entry.originalIndex + 1}`
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
