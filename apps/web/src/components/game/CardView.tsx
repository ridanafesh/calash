'use client';

import type { Card } from '@calash/shared';

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export function cardId(card: Card): string {
  if (card.isJoker) return `joker-${card.jokerIndex}`;
  return `${card.rank}-${card.suit}-${card.deckIndex}`;
}

export function cardEquals(a: Card, b: Card): boolean {
  if (a.isJoker !== b.isJoker) return false;
  if (a.isJoker && b.isJoker) return a.jokerIndex === b.jokerIndex;
  if (!a.isJoker && !b.isJoker) {
    return a.rank === b.rank && a.suit === b.suit && a.deckIndex === b.deckIndex;
  }
  return false;
}

function isRed(card: Card): boolean {
  return !card.isJoker && (card.suit === 'hearts' || card.suit === 'diamonds');
}

interface CardViewProps {
  card: Card;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  size?: 'xs' | 'sm' | 'md';
}

const SIZES = {
  xs: { width: 36, height: 50, fontSize: 10, suitSize: 12 },
  sm: { width: 46, height: 64, fontSize: 12, suitSize: 15 },
  md: { width: 58, height: 82, fontSize: 14, suitSize: 18 },
};

export function CardView({ card, selected, dimmed, onClick, size = 'md' }: CardViewProps) {
  const s = SIZES[size];
  const joker = card.isJoker;
  const red = !joker && isRed(card);
  const rank = card.rank;
  const suit = joker ? '★' : SUIT_SYMBOLS[card.suit!];
  const textColor = joker ? '#d946ef' : red ? '#dc2626' : '#111827';

  const bg = joker
    ? selected
      ? 'linear-gradient(135deg, #6b21a8, #4c1d95)'
      : 'linear-gradient(135deg, #3b0764, #1e1b4b)'
    : selected
    ? red
      ? '#fff0f0'
      : '#f0f0ff'
    : '#ffffff';

  const border = selected
    ? joker
      ? '2px solid #d946ef'
      : red
      ? '2px solid #dc2626'
      : '2px solid #6366f1'
    : '1.5px solid #d1d5db';

  return (
    <div
      onClick={onClick}
      title={joker ? 'Joker' : `${rank} of ${card.suit}`}
      style={{
        width: s.width,
        height: s.height,
        borderRadius: 5,
        background: bg,
        border,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        padding: '3px 4px',
        userSelect: 'none',
        flexShrink: 0,
        opacity: dimmed ? 0.4 : 1,
        transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s',
        transform: selected ? 'translateY(-10px)' : 'none',
        boxShadow: selected
          ? '0 6px 18px rgba(0,0,0,0.5)'
          : '0 1px 4px rgba(0,0,0,0.4)',
        position: 'relative',
      }}
    >
      <div style={{ fontSize: s.fontSize, fontWeight: 700, color: joker ? '#e879f9' : textColor, lineHeight: 1 }}>
        {rank}
      </div>
      {!joker && (
        <div style={{ fontSize: s.fontSize - 2, color: textColor, lineHeight: 1 }}>
          {suit}
        </div>
      )}
      <div
        style={{
          fontSize: s.suitSize,
          color: joker ? '#e879f9' : textColor,
          lineHeight: 1,
          marginTop: 'auto',
          textAlign: 'right',
        }}
      >
        {suit}
      </div>
      {joker && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: s.suitSize * 1.2,
            opacity: 0.3,
          }}
        >
          🃏
        </div>
      )}
    </div>
  );
}

export function CardBack({ size = 'md' }: { size?: 'xs' | 'sm' | 'md' }) {
  const s = SIZES[size];
  return (
    <div
      style={{
        width: s.width,
        height: s.height,
        borderRadius: 5,
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0f2040 100%)',
        border: '1.5px solid #2d4a6f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ fontSize: s.suitSize, opacity: 0.35, color: '#93c5fd' }}>⬡</div>
    </div>
  );
}
