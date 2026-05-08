'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/lib/auth-guard';
import { useAuth } from '@/lib/auth-context';
import { useGame } from '@/lib/game-context';
import { useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { SeatChoicePopup } from '@/components/game/SeatChoicePopup';
import { apiClient } from '@/lib/api';
import type { GameRoom } from '@calash/shared';

function LobbyInner() {
  const { user, logout } = useAuth();
  const { room, connected, createRoom, joinByCode, roomError, clearError } = useGame();
  const router = useRouter();
  const t = useT();

  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [rejoinableRooms, setRejoinableRooms] = useState<GameRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [startingVsBot, setStartingVsBot] = useState(false);
  // Locked-room code prompt: target room id + the typed code + an
  // error message we surface inline. Dismissed on Cancel or success.
  const [lockedPrompt, setLockedPrompt] = useState<{ roomId: string; code: string } | null>(null);
  const [lockedPromptError, setLockedPromptError] = useState<string | null>(null);

  function startJoin(r: GameRoom): void {
    if (r.isPrivate) {
      setLockedPrompt({ roomId: r.id, code: '' });
      setLockedPromptError(null);
      return;
    }
    // Open room: navigate immediately. The rooms/[id] page emits
    // room:join automatically on mount.
    router.push(`/rooms/${r.id}`);
  }

  function submitLockedJoin(): void {
    if (!lockedPrompt) return;
    const code = lockedPrompt.code.trim().toUpperCase();
    if (code.length !== 6) {
      setLockedPromptError(t('lobby.lockedRoomError'));
      return;
    }
    clearError();
    setLockedPromptError(null);
    // joinByCode handles the locked-room handshake server-side: the
    // code itself satisfies the privacy gate, so the join lands
    // (or surfaces a server error which we'll display).
    joinByCode(code);
    // Optimistic navigation — if the server rejects we'll bounce back
    // and show the error via the existing roomError flow.
    router.push(`/rooms/${lockedPrompt.roomId}`);
    setLockedPrompt(null);
  }

  function startVsComputer() {
    if (!connected || startingVsBot) return;
    setStartingVsBot(true);
    createRoom({ maxPlayers: 2, fillWithBots: true, botDifficulty: 'easy' });
  }

  // Reset the vs-bot loading state if creation errored.
  useEffect(() => {
    if (roomError) setStartingVsBot(false);
  }, [roomError]);

  // Redirect if already in a room
  useEffect(() => {
    if (room) router.push(`/rooms/${room.id}`);
  }, [room, router]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiClient.getRoomsWithRejoinable();
        if (!cancelled) {
          setRooms(data.open);
          setRejoinableRooms(data.rejoinable);
          setFetchError('');
        }
      } catch {
        if (!cancelled) setFetchError('Could not load rooms.');
      } finally {
        if (!cancelled) setLoadingRooms(false);
      }
    }
    load();
    const id = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Render every room the server returned. The /api/rooms endpoint
  // already excludes finished/abandoned rooms and any room with no
  // joinable seat path, AND already excludes rooms in the user's
  // rejoinable list (those go in the section above). So no
  // extra client-side filtering is needed; doing so here is what
  // hid in-progress rooms from a fresh joiner.
  const visibleRooms = rooms;

  function joinabilityFor(r: GameRoom): {
    hasEmptySeat: boolean;
    hasReplaceableBot: boolean;
    joinable: boolean;
  } {
    const occupied = r.players.length;
    const hasEmptySeat = occupied < r.maxPlayers;
    // Only host-created bots are replaceable. Substituted bots are
    // reserved for the original human's reclaim.
    const hasReplaceableBot = r.players.some((p) => p.isBot && !p.isHumanSubstitute);
    return { hasEmptySeat, hasReplaceableBot, joinable: hasEmptySeat || hasReplaceableBot };
  }

  return (
    <div className="page">
      <header className="page-header">
        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)' }}>Calash</span>
        <div style={{ flex: 1 }} />
        <div className="row" style={{ gap: 12 }}>
          <LanguageSwitcher />
          {!connected && <span className="badge badge-warning">{t('common.loading')}</span>}
          <Link href="/profile" className="row" style={{ gap: 8, textDecoration: 'none', color: 'inherit' }}>
            <div className="avatar" style={{ width: 28, height: 28, fontSize: '0.75rem' }}>
              {(user?.displayName || user?.username || '?').charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: '0.9rem' }} className="hide-mobile">
              {user?.displayName || user?.username}
              {user?.isGuest && <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> ({t('common.you')})</span>}
            </span>
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={() => { logout(); router.push('/'); }}>
            {t('lobby.signOut')}
          </button>
        </div>
      </header>

      <div className="page-content">
        <div className="row" style={{ gap: 12, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <Link href="/rooms/create" className="btn btn-primary btn-lg">+ {t('lobby.createRoom')}</Link>
          <Link href="/rooms/join" className="btn btn-ghost btn-lg">{t('lobby.joinByCode')}</Link>
          <button
            onClick={startVsComputer}
            disabled={!connected || startingVsBot}
            className="btn btn-ghost btn-lg"
            title={t('lobby.playVsBots')}
          >
            {startingVsBot ? <><span className="spinner" />{t('common.loading')}</> : `🤖 ${t('lobby.playVsBots')}`}
          </button>
        </div>

        {rejoinableRooms.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h2 style={{ fontWeight: 700, fontSize: '1rem' }}>{t('lobby.rejoinable.title')}</h2>
            </div>
            <div className="col" style={{ gap: '0.6rem' }}>
              {rejoinableRooms.map((r) => (
                <div key={r.id} className="surface row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span className="room-code" style={{ fontSize: '0.9rem', letterSpacing: '0.15em', padding: '2px 8px' }}>
                        {r.code}
                      </span>
                      <span className="badge badge-accent">⏳ {t('lobby.rejoinable.badge')}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {t('lobby.rejoinable.hint')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/rooms/${r.id}`)}
                    className="btn btn-primary btn-sm"
                    style={{ flexShrink: 0 }}
                  >
                    {t('lobby.rejoinable.action')} →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '1rem' }}>{t('lobby.title')}</h2>
        </div>

        {fetchError && <div className="error-banner" style={{ marginBottom: '1rem' }}>{fetchError}</div>}

        {loadingRooms ? (
          <div className="row" style={{ justifyContent: 'center', padding: '2.5rem' }}>
            <div className="spinner" />
          </div>
        ) : visibleRooms.length === 0 ? (
          <div className="surface" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem 1rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🃏</div>
            {t('lobby.empty')}
          </div>
        ) : (
          <div className="col" style={{ gap: '0.6rem' }}>
            {visibleRooms.map((r) => {
              const inProgress = r.status === 'in-progress';
              const { hasReplaceableBot, joinable } = joinabilityFor(r);
              return (
                <div key={r.id} className="surface row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span className="room-code" style={{ fontSize: '0.9rem', letterSpacing: '0.15em', padding: '2px 8px' }}>
                        {r.code}
                      </span>
                      {r.isPrivate ? (
                        <span className="badge badge-neutral" title={t('lobby.lockedRoomTitle')}>
                          🔒 {t('lobby.locked')}
                        </span>
                      ) : (
                        <span className="badge badge-success">{t('lobby.open')}</span>
                      )}
                      {inProgress && (
                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                          ▶ {t('lobby.inProgress')}
                        </span>
                      )}
                      {hasReplaceableBot && (
                        <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>
                          🤖 {t('lobby.botSeatAvailable')}
                        </span>
                      )}
                      {!joinable && (
                        <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                          {t('lobby.full')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {r.players.length}/{r.maxPlayers} {t('lobby.players', { n: r.players.length })}
                      {r.players.length > 0 && ` · ${r.players.map((p) => p.displayName).join(', ')}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startJoin(r)}
                    className="btn btn-primary btn-sm"
                    style={{ flexShrink: 0 }}
                    disabled={!joinable}
                    title={!joinable ? t('lobby.full') : undefined}
                  >
                    {r.isPrivate ? '🔒 ' : ''}{t('lobby.join')} →
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Locked-room code prompt — small inline modal. */}
        {lockedPrompt && (
          <div className="overlay" role="dialog" aria-modal="true" aria-label={t('lobby.lockedRoomTitle')}>
            <div className="result-modal" style={{ maxWidth: 380, width: '100%' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>🔒 {t('lobby.lockedRoomTitle')}</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                {t('lobby.lockedRoomHint')}
              </p>
              <input
                type="text"
                className="input"
                autoFocus
                placeholder="ABCD12"
                value={lockedPrompt.code}
                maxLength={6}
                onChange={(e) =>
                  setLockedPrompt({ ...lockedPrompt, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitLockedJoin();
                  if (e.key === 'Escape') {
                    setLockedPrompt(null);
                    setLockedPromptError(null);
                  }
                }}
                style={{
                  fontFamily: 'monospace',
                  fontSize: '1.4rem',
                  letterSpacing: '0.25em',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                }}
              />
              {lockedPromptError && (
                <div className="error-banner">{lockedPromptError}</div>
              )}
              <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setLockedPrompt(null);
                    setLockedPromptError(null);
                  }}
                >
                  {t('lobby.lockedRoomCancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={submitLockedJoin}
                  disabled={lockedPrompt.code.length !== 6}
                >
                  {t('lobby.lockedRoomSubmit')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="row" style={{ marginTop: '2rem', gap: 20, justifyContent: 'center' }}>
          <Link href="/leaderboard" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('lobby.leaderboard')}</Link>
          <Link href="/history" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('lobby.history')}</Link>
          <Link href="/scores" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('lobby.scores')}</Link>
          <Link href="/profile" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('lobby.profile')}</Link>
        </div>
      </div>

      {/* Mounted here so the seat-choice popup overlays the lobby
          immediately if the server emits room:join-options after a
          locked-room code submission lands on a mid-round room. */}
      <SeatChoicePopup />
    </div>
  );
}

export default function LobbyPage() {
  return (
    <AuthGuard>
      <LobbyInner />
    </AuthGuard>
  );
}
