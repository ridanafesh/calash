'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type {
  BotDifficulty,
  GameRoom,
  JokerAssignment,
  RoomCreateOptions,
  RoundStateView,
  RoundResult,
  GameScore,
  Card,
  TurnAction,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@calash/shared';
import { useAuth } from './auth-context';
import { socketUrl } from './server-urls';

type CalashSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Wider error shape than just `{code, message}` — `candidates` and `meldIndex`
 * are populated only for the `AMBIGUOUS_JOKER_ASSIGNMENT` code so the UI can
 * open a picker dialog instead of just showing a banner.
 */
export interface RoomError {
  code: string;
  message: string;
  candidates?: JokerAssignment[];
  meldIndex?: number;
}

/**
 * Transient emoji reaction. Stored per-player; replaced when the same
 * player sends a new one. Auto-cleared after REACTION_TTL_MS.
 *
 * `id` is the server-issued nonce — keeps React keys stable so the
 * fade-in animation re-triggers when the same player fires the same
 * emoji twice in a row.
 */
export interface ActiveReaction {
  emoji: string;
  id: string;
  /** Wall-clock ms when the reaction arrived; used for fade-out timing. */
  receivedAt: number;
}

/** Reactions live on screen this long, then auto-clear. */
const REACTION_TTL_MS = 3500;

/** Client-side cooldown — must match the server's so honest clients
 *  never hit the rate limit (server is still authoritative). */
const REACTION_COOLDOWN_MS = 2000;

interface GameContextValue {
  connected: boolean;
  room: GameRoom | null;
  roomError: RoomError | null;
  gameState: RoundStateView | null;
  hand: Card[];
  /**
   * The card the LOCAL player just drew from the deck and hasn't yet
   * decided to keep or discard. Null when the local player has no
   * pending decision. Other players' / bots' drawn cards are NEVER
   * delivered to this client — opponents only see
   * gameState.pendingDrawnCardPresent (a boolean) so the UI can
   * render "X is deciding…" without leaking the card identity.
   */
  myDrawnCard: Card | null;
  scores: GameScore[];
  roundResult: RoundResult | null;
  winner: { playerId: string; finalScore: number } | null;
  createRoom: (options: RoomCreateOptions) => void;
  joinRoom: (roomId: string) => void;
  joinByCode: (code: string) => void;
  leaveRoom: () => void;
  toggleReady: () => void;
  addBot: (difficulty?: BotDifficulty) => void;
  removeBot: (botUserId: string) => void;
  submitAction: (action: TurnAction) => void;
  /**
   * Send an emoji reaction. The server enforces a per-player cooldown;
   * clients should also gate locally via `canReactNow()` to avoid
   * obviously dropped sends.
   */
  sendReaction: (emoji: string) => void;
  /** True when the local player is past their own cooldown. */
  canReactNow: () => boolean;
  /**
   * Active reactions per playerId. Each entry is auto-removed
   * REACTION_TTL_MS after it arrived. The map is keyed by playerId so
   * a fresh reaction from the same player overwrites the previous one.
   */
  reactions: Record<string, ActiveReaction>;
  clearError: () => void;
  clearRoundResult: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<CalashSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [roomError, setRoomError] = useState<RoomError | null>(null);
  const [gameState, setGameState] = useState<RoundStateView | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  const [myDrawnCard, setMyDrawnCard] = useState<Card | null>(null);
  const [scores, setScores] = useState<GameScore[]>([]);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [winner, setWinner] = useState<{ playerId: string; finalScore: number } | null>(null);
  // Active emoji reactions, keyed by playerId. Each entry auto-clears
  // REACTION_TTL_MS after it arrived. Stored in state (not a ref) so
  // re-renders pick up new reactions immediately.
  const [reactions, setReactions] = useState<Record<string, ActiveReaction>>({});
  // Track expiration timers per player so a fresh reaction from the
  // same player cancels the previous timer cleanly.
  const reactionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Local cooldown gate — purely UX; the server still enforces.
  const lastReactionAt = useRef<number>(0);

  useEffect(() => {
    if (!token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      setRoom(null);
      setGameState(null);
      setHand([]);
      return;
    }

    // Resolves NEXT_PUBLIC_SOCKET_URL → NEXT_PUBLIC_WS_URL → NEXT_PUBLIC_API_URL → localhost.
    // This is the actual hot path: the dev → prod bug we hit was that
    // Render set NEXT_PUBLIC_SOCKET_URL but the code only checked WS_URL,
    // so the localhost fallback fired in production.
    const wsUrl = socketUrl();
    const s = io(wsUrl, { auth: { token }, reconnectionAttempts: 10 }) as CalashSocket;
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      setRoomError(null);
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (err: Error) => {
      setConnected(false);
      setRoomError({
        code: 'SOCKET_CONNECT_ERROR',
        message:
          err.message === 'Authentication required' || err.message === 'Invalid token'
            ? 'Your session has expired. Please sign in again.'
            : `Cannot reach game server (${err.message}).`,
      });
    });
    s.on('room:updated', setRoom);
    s.on('room:error', setRoomError);
    s.on('game:state', setGameState);
    s.on('game:hand', setHand);
    // PRIVATE — only the drawing player receives this event with the actual
    // card. null clears the local preview when the decision is resolved or
    // the turn advances. Receiving this event for someone else is impossible
    // (the server only emits to the owning player's socket).
    s.on('game:drawn-card', setMyDrawnCard);
    s.on('game:scores', setScores);
    s.on('game:round-result', setRoundResult);
    s.on('game:finished', setWinner);
    // Emoji reactions arrive here. Replace any prior reaction from the
    // same player and arm a fresh expiration timer so the bubble fades
    // exactly REACTION_TTL_MS after it was received.
    s.on('room:reaction', (event) => {
      const { playerId, emoji, id } = event;
      const existing = reactionTimers.current.get(playerId);
      if (existing) clearTimeout(existing);
      setReactions((prev) => ({
        ...prev,
        [playerId]: { emoji, id, receivedAt: Date.now() },
      }));
      const timer = setTimeout(() => {
        setReactions((prev) => {
          // Only delete if this exact reaction is still on screen — a
          // newer reaction would have replaced the entry, and its own
          // timer should be the one that clears it.
          if (prev[playerId]?.id !== id) return prev;
          const { [playerId]: _, ...rest } = prev;
          return rest;
        });
        reactionTimers.current.delete(playerId);
      }, REACTION_TTL_MS);
      reactionTimers.current.set(playerId, timer);
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
      setConnected(false);
      // Clear any pending reaction timers so they don't fire after the
      // socket is gone (would race with the next mount).
      for (const t of reactionTimers.current.values()) clearTimeout(t);
      reactionTimers.current.clear();
      setReactions({});
    };
  }, [token]);

  const createRoom = useCallback((options: RoomCreateOptions) => {
    socketRef.current?.emit('room:create', options);
  }, []);

  const joinRoom = useCallback((roomId: string) => {
    socketRef.current?.emit('room:join', roomId);
  }, []);

  const joinByCode = useCallback((code: string) => {
    socketRef.current?.emit('room:join-by-code', code);
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('room:leave');
    setRoom(null);
    setGameState(null);
    setHand([]);
    setMyDrawnCard(null);
    setScores([]);
    setRoundResult(null);
    setWinner(null);
    // Clear any active reactions + their timers — leaving the room
    // makes them stale by definition.
    for (const t of reactionTimers.current.values()) clearTimeout(t);
    reactionTimers.current.clear();
    setReactions({});
  }, []);

  const toggleReady = useCallback(() => {
    socketRef.current?.emit('room:ready');
  }, []);

  const addBot = useCallback((difficulty: BotDifficulty = 'easy') => {
    socketRef.current?.emit('room:add-bot', { difficulty });
  }, []);

  const removeBot = useCallback((botUserId: string) => {
    socketRef.current?.emit('room:remove-bot', botUserId);
  }, []);

  const submitAction = useCallback((action: TurnAction) => {
    socketRef.current?.emit('game:action', action);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    const now = Date.now();
    if (now - lastReactionAt.current < REACTION_COOLDOWN_MS) {
      // Drop locally so the request never leaves the page. Server
      // would reject it anyway; this just avoids the round-trip.
      return;
    }
    lastReactionAt.current = now;
    socketRef.current?.emit('room:reaction', emoji);
  }, []);

  const canReactNow = useCallback(() => {
    return Date.now() - lastReactionAt.current >= REACTION_COOLDOWN_MS;
  }, []);

  return (
    <GameContext.Provider
      value={{
        connected,
        room,
        roomError,
        gameState,
        hand,
        myDrawnCard,
        scores,
        roundResult,
        winner,
        createRoom,
        joinRoom,
        joinByCode,
        leaveRoom,
        toggleReady,
        addBot,
        removeBot,
        submitAction,
        sendReaction,
        canReactNow,
        reactions,
        clearError: () => setRoomError(null),
        clearRoundResult: () => setRoundResult(null),
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside GameProvider');
  return ctx;
}
