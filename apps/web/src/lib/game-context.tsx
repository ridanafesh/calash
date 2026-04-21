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

type CalashSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface GameContextValue {
  connected: boolean;
  room: GameRoom | null;
  roomError: { code: string; message: string } | null;
  gameState: RoundStateView | null;
  hand: Card[];
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
  clearError: () => void;
  clearRoundResult: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<CalashSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [roomError, setRoomError] = useState<{ code: string; message: string } | null>(null);
  const [gameState, setGameState] = useState<RoundStateView | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  const [scores, setScores] = useState<GameScore[]>([]);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [winner, setWinner] = useState<{ playerId: string; finalScore: number } | null>(null);

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

    const wsUrl = process.env['NEXT_PUBLIC_WS_URL'] ?? 'http://localhost:4000';
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
    s.on('game:scores', setScores);
    s.on('game:round-result', setRoundResult);
    s.on('game:finished', setWinner);

    return () => {
      s.disconnect();
      socketRef.current = null;
      setConnected(false);
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
    setScores([]);
    setRoundResult(null);
    setWinner(null);
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

  return (
    <GameContext.Provider
      value={{
        connected,
        room,
        roomError,
        gameState,
        hand,
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
