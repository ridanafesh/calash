'use client';

import type { HandSortMode } from './hand-sort';

interface HandToolbarProps {
  mode: HandSortMode;
  onChange: (mode: HandSortMode) => void;
  cardCount: number;
  selectedCount: number;
  selectedPoints: number;
}

interface OptionDef {
  value: HandSortMode;
  label: string;
  title: string;
}

const OPTIONS: OptionDef[] = [
  { value: 'original', label: 'Reset', title: 'Original (server) order' },
  { value: 'rank', label: 'Rank', title: 'Sort by rank, low to high' },
  { value: 'suit', label: 'Suit', title: 'Group by suit, then by rank' },
  { value: 'melds', label: 'Group Melds', title: 'Cluster cards into likely sets and sequences' },
];

export function HandToolbar({ mode, onChange, cardCount, selectedCount, selectedPoints }: HandToolbarProps) {
  return (
    <div className="hand-toolbar" role="toolbar" aria-label="Hand sorting">
      <div className="hand-toolbar-info">
        Hand ({cardCount})
        {selectedCount > 0 && (
          <span className="hand-toolbar-selected">
            {selectedCount} selected · {selectedPoints} pts
          </span>
        )}
      </div>
      <div className="hand-toolbar-actions" role="radiogroup" aria-label="Sort mode">
        {OPTIONS.map((opt) => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={opt.title}
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
