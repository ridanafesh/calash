'use client';

import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/lib/game-context';
import { useT } from '@/lib/i18n';

/**
 * Allowlist of reactions the player can send. MUST stay in sync with
 * the server's ALLOWED_EMOJIS in apps/server/src/sockets/handlers/reaction.ts —
 * anything not on this list is silently dropped server-side.
 *
 * `key` is the i18n key for the hover label / aria-label so the choice
 * is fully translatable without touching the emoji glyph.
 */
const REACTIONS: ReadonlyArray<{ emoji: string; key: string }> = [
  { emoji: '😀', key: 'reaction.happy' },
  { emoji: '😂', key: 'reaction.laughing' },
  { emoji: '😡', key: 'reaction.angry' },
  { emoji: '😢', key: 'reaction.sad' },
  { emoji: '😎', key: 'reaction.cool' },
  { emoji: '👍', key: 'reaction.thumbsUp' },
  { emoji: '👎', key: 'reaction.thumbsDown' },
  { emoji: '😮', key: 'reaction.surprised' },
  { emoji: '😴', key: 'reaction.bored' },
  { emoji: '🔥', key: 'reaction.fire' },
  { emoji: '💪', key: 'reaction.strong' },
  { emoji: '👏', key: 'reaction.clap' },
];

/**
 * Compact emoji-reaction button for the game header. Click to open a
 * 4-column grid popover; click an emoji to broadcast it. The picker
 * closes automatically after a successful send.
 *
 * Cooldown: the button visually disables while the local cooldown is
 * active. Server enforces independently — this is purely UX so the
 * player gets immediate feedback when they're spamming.
 */
export function EmojiReactionButton() {
  const { sendReaction, canReactNow, connected } = useGame();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cooldownActive, setCooldownActive] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close popover on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Clear pending cooldown timer on unmount.
  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, []);

  function pick(emoji: string) {
    if (!canReactNow()) {
      // Should be already disabled, but defense in depth.
      return;
    }
    sendReaction(emoji);
    setOpen(false);
    setCooldownActive(true);
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    // Use the same window the context uses (2000ms) but read it via a
    // poll so we don't need to import the constant — once canReactNow()
    // says true again, drop the disabled state.
    cooldownTimer.current = setTimeout(() => {
      setCooldownActive(false);
    }, 2100);
  }

  const disabled = !connected || cooldownActive;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('reaction.button')}
        title={cooldownActive ? t('reaction.cooldown') : t('reaction.button')}
        style={{ fontSize: '1.05rem', padding: '4px 10px', lineHeight: 1 }}
      >
        😀
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('reaction.title')}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            insetInlineEnd: 0,
            background: 'var(--surface, #1a1d27)',
            border: '1px solid var(--border, #2d3148)',
            borderRadius: 10,
            padding: 6,
            boxShadow: '0 12px 28px -8px rgba(0,0,0,0.55)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 36px)',
            gap: 4,
            zIndex: 80,
          }}
        >
          {REACTIONS.map(({ emoji, key }) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onClick={() => pick(emoji)}
              title={t(key)}
              aria-label={t(key)}
              style={{
                width: 36,
                height: 36,
                fontSize: '1.3rem',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                lineHeight: 1,
                transition: 'background 0.12s, transform 0.08s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
