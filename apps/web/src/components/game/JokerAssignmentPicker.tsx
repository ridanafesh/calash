'use client';

import type { JokerAssignment, Suit } from '@calash/shared';
import { useT } from '@/lib/i18n';

const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const SUIT_COLOR: Record<Suit, string> = {
  hearts: '#dc2626',
  diamonds: '#dc2626',
  clubs: '#111827',
  spades: '#111827',
};

interface Props {
  candidates: readonly JokerAssignment[];
  onChoose: (choice: JokerAssignment) => void;
  onCancel: () => void;
}

/**
 * Modal shown when the server rejects a meld submission with the
 * AMBIGUOUS_JOKER_ASSIGNMENT error code. The server returns the legal
 * candidate (rank, suit) positions the joker could fill; the user picks
 * one and we re-submit the same action with `jokerAssignment` populated.
 *
 * Example: a player puts down [10♥, J♥, Joker]. The joker could be 9♥
 * (forming 9-10-J) or Q♥ (forming 10-J-Q). The server can't pick for
 * the player without changing what they intended, so we ask.
 */
export function JokerAssignmentPicker({ candidates, onChoose, onCancel }: Props) {
  const t = useT();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="joker-picker-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0, 0, 0, 0.66)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated, #1f2937)',
          color: 'var(--text-primary, white)',
          borderRadius: 12,
          padding: 20,
          maxWidth: 440,
          width: '100%',
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
        }}
      >
        <h2 id="joker-picker-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
          {t('joker.pickerTitle')}
        </h2>
        <p style={{ margin: '8px 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary, #9ca3af)' }}>
          {t('joker.pickerHint')}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: candidates.length > 4 ? 'repeat(2, 1fr)' : '1fr',
            gap: 8,
            marginBottom: 14,
          }}
        >
          {candidates.map((c) => (
            <button
              key={`${c.representsRank}-${c.representsSuit}`}
              type="button"
              onClick={() => onChoose(c)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: 'var(--bg, #111827)',
                color: 'var(--text-primary, white)',
                border: '1px solid var(--border, #374151)',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: 600,
              }}
            >
              <span style={{ color: '#d946ef', fontWeight: 700 }}>🃏 →</span>
              <span style={{ fontSize: '1.1rem' }}>{c.representsRank}</span>
              <span style={{ color: SUIT_COLOR[c.representsSuit], fontSize: '1.2rem' }}>
                {SUIT_SYMBOLS[c.representsSuit]}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              color: 'var(--text-secondary, #9ca3af)',
              border: '1px solid var(--border, #374151)',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
