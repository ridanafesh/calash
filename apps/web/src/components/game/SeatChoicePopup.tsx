'use client';

import { useGame } from '@/lib/game-context';
import { useT } from '@/lib/i18n';

/**
 * Modal that asks the joining user how to take a seat: replace a bot
 * or take an empty seat. Mounted near the top of the app shell so it
 * surfaces wherever the user happens to be when room:join-options
 * arrives (lobby, rooms/[id]). Renders nothing when there's no
 * pending prompt.
 *
 * Self-dismissing: room:updated clears game-context.joinOptions, so
 * after a successful resubmit the popup unmounts on its own.
 */
export function SeatChoicePopup() {
  const { joinOptions, resolveJoinOptions, dismissJoinOptions } = useGame();
  const t = useT();

  if (!joinOptions) return null;

  const { replaceableBots, hasEmptySeat, roundInProgress } = joinOptions;

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('seatChoice.title')}
      style={{ zIndex: 200 }}
    >
      <div className="result-modal" style={{ maxWidth: 480, width: '100%' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{t('seatChoice.title')}</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
          {t('seatChoice.subtitle')}
        </p>

        {/* Replace-a-bot list. One button per replaceable bot when there
            are several so the user can pick which seat they take.
            With a single bot we still render one button — keeps the
            layout consistent and removes ambiguity. */}
        {replaceableBots.length > 0 && (
          <div className="col" style={{ gap: 6 }}>
            {replaceableBots.map((bot) => (
              <button
                key={bot.userId}
                type="button"
                className="btn btn-primary btn-block"
                style={{ textAlign: 'left', padding: '10px 14px' }}
                onClick={() => resolveJoinOptions({ kind: 'replace-bot', botUserId: bot.userId })}
              >
                <div style={{ fontWeight: 700 }}>
                  🤖 → 👤 {t('seatChoice.replaceBot')}: {bot.displayName}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.85)' }}>
                  {t('seatChoice.replaceBotSub')}
                </div>
              </button>
            ))}
          </div>
        )}

        {hasEmptySeat && (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ textAlign: 'left', padding: '10px 14px' }}
            onClick={() => resolveJoinOptions({ kind: 'empty-seat' })}
          >
            <div style={{ fontWeight: 700 }}>
              💺 {t('seatChoice.emptySeat')}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {roundInProgress
                ? t('seatChoice.emptySeatSubInProgress')
                : t('seatChoice.emptySeatSubLobby')}
            </div>
          </button>
        )}

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={dismissJoinOptions}
          >
            {t('seatChoice.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
