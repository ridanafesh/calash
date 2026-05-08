'use client';

import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n';

interface Props {
  /** Epoch ms when the grace period expires. */
  graceUntil: number;
}

/**
 * Renders a "Disconnected — Ns" badge that ticks down to the grace
 * deadline. Self-contained: takes the absolute deadline (server-set)
 * and converts to a remaining-seconds counter on the client. We
 * deliberately use a server-supplied deadline rather than a duration
 * so client clock skew never matters once we trust the server's
 * Date.now() — which is also imperfect, but the worst case is being
 * a couple of seconds off, well inside the 30s window.
 *
 * Stops counting when the deadline has passed; the parent component
 * is responsible for unmounting (typically the next room:updated
 * either restores the seat or substitutes it, removing this badge).
 */
export function DisconnectCountdown({ graceUntil }: Props) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Tick once a second is enough for a 30s window; the badge text
    // changes at most 30 times. Using 250ms would burn CPU for no
    // visible gain.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, Math.ceil((graceUntil - now) / 1000));

  return (
    <span
      className="badge badge-warning"
      title={t('waiting.disconnectedHint')}
      aria-live="polite"
    >
      {remaining > 0
        ? t('waiting.disconnectedCountdown', { n: remaining })
        : t('waiting.disconnected')}
    </span>
  );
}
