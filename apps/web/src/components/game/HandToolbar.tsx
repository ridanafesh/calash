'use client';

import { useT } from '@/lib/i18n';
import type { HandSortMode } from './hand-sort';

interface HandToolbarProps {
  mode: HandSortMode;
  onChange: (mode: HandSortMode) => void;
  cardCount: number;
  selectedCount: number;
  selectedPoints: number;
}

export function HandToolbar({ mode, onChange, cardCount, selectedCount, selectedPoints }: HandToolbarProps) {
  const t = useT();
  const options: Array<{ value: HandSortMode; label: string }> = [
    { value: 'original', label: t('game.sort.reset') },
    { value: 'rank', label: t('game.sort.rank') },
    { value: 'suit', label: t('game.sort.suit') },
    { value: 'melds', label: t('game.sort.melds') },
  ];

  return (
    <div className="hand-toolbar" role="toolbar">
      <div className="hand-toolbar-info">
        {t('game.handCount', { n: cardCount })}
        {selectedCount > 0 && (
          <span className="hand-toolbar-selected">
            {t('game.handSelected', { n: selectedCount, pts: selectedPoints })}
          </span>
        )}
      </div>
      <div className="hand-toolbar-actions" role="radiogroup">
        {options.map((opt) => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              className={`hand-toolbar-btn ${active ? 'is-active' : ''}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
