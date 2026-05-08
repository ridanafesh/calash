import type {
  AuthResponse,
  GameRoom,
  GoogleAuthRequest,
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
  UpgradeWithGoogleRequest,
  UpgradeWithPasswordRequest,
  UserProfile,
} from '@calash/shared';

import { apiUrl } from './server-urls';

// Resolved once per module load. NEXT_PUBLIC_* values are baked at
// build time, so this can't change at runtime — no need to recompute
// per request.
const BASE_URL = apiUrl();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Build the final init explicitly. Spreading `...init` AFTER setting
  // headers (the previous shape) overwrote the merged headers map and
  // silently dropped Content-Type whenever the caller passed any of
  // their own headers — which broke every authenticated PUT/POST that
  // also set Authorization (e.g. PUT /api/profile would arrive with
  // an empty body parsed by Express's json middleware).
  const { headers: callerHeaders, ...rest } = init ?? {};
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...callerHeaders },
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? 'Request failed');
  }
  return json.data as T;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const apiClient = {
  // ── Auth ────────────────────────────────────────────────────────────────────
  register: (body: RegisterRequest) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: LoginRequest) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  loginWithGoogle: (body: GoogleAuthRequest) =>
    request<AuthResponse>('/api/auth/google', { method: 'POST', body: JSON.stringify(body) }),

  loginAsGuest: () =>
    request<AuthResponse>('/api/auth/guest', { method: 'POST', body: '{}' }),

  me: () =>
    request<{ user: UserProfile }>('/api/auth/me', { headers: authHeaders() }),

  logout: () =>
    request<{ message: string }>('/api/auth/logout', { method: 'POST', headers: authHeaders() }),

  // ── Profile ──────────────────────────────────────────────────────────────────
  getProfile: () =>
    request<{ user: UserProfile }>('/api/profile', { headers: authHeaders() }),

  updateProfile: (body: UpdateProfileRequest) =>
    request<{ user: UserProfile }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: authHeaders(),
    }),

  // ── Guest upgrade ─────────────────────────────────────────────────────────────
  upgradeWithPassword: (body: UpgradeWithPasswordRequest) =>
    request<AuthResponse>('/api/auth/upgrade/password', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: authHeaders(),
    }),

  upgradeWithGoogle: (body: UpgradeWithGoogleRequest) =>
    request<AuthResponse>('/api/auth/upgrade/google', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: authHeaders(),
    }),

  // ── Rooms ─────────────────────────────────────────────────────────────────────
  getRooms: () =>
    request<GameRoom[]>('/api/rooms', { headers: authHeaders() }),

  /**
   * Returns the public open-rooms list AND the caller's rejoinable
   * rooms (in-progress rooms where they previously left and the seat
   * is bot-substituted, waiting for them). The lobby renders these
   * as two distinct sections.
   */
  getRoomsWithRejoinable: () =>
    request<{ open: GameRoom[]; rejoinable: GameRoom[] }>(
      '/api/rooms?include=rejoinable',
      { headers: authHeaders() },
    ),

  getRoom: (id: string) =>
    request<GameRoom>(`/api/rooms/${id}`, { headers: authHeaders() }),

  getRoomByCode: (code: string) =>
    request<GameRoom>(`/api/rooms/join/${code}`, { headers: authHeaders() }),

  // ── Score breakdown ───────────────────────────────────────────────────────────
  getRoomScores: (roomId: string) =>
    request<RoomScoreSummary>(`/api/scores/rooms/${roomId}`, { headers: authHeaders() }),

  // ── Leaderboard ───────────────────────────────────────────────────────────────
  getLeaderboard: (params?: { sort?: 'score' | 'wins' | 'winrate'; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<LeaderboardEntry[]>(`/api/leaderboard${q ? `?${q}` : ''}`, { headers: authHeaders() });
  },

  // ── Match history ─────────────────────────────────────────────────────────────
  getMatchHistory: (params?: { before?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.before) qs.set('before', params.before);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<MatchHistoryEntry[]>(`/api/history${q ? `?${q}` : ''}`, { headers: authHeaders() });
  },

  getMatchDetail: (matchId: string) =>
    request<MatchDetail>(`/api/history/${matchId}`, { headers: authHeaders() }),

  // ── Health ────────────────────────────────────────────────────────────────────
  health: () =>
    request<{ status: string; db: string }>('/api/health', { headers: authHeaders() }),
};

// ── API response types ────────────────────────────────────────────────────────

export interface RoundScoreEntry {
  userId: string;
  displayName: string;
  tableTotal: number;
  handTotal: number;
  roundScore: number;
  finishBonus: number;
  finalScore: number;
  cumulativeAfter: number;
}

export interface RoundSummary {
  roundId: string;
  roundNumber: number;
  dealerId: string;
  dealerName: string | null;
  endReason: string;
  finisherId: string | null;
  finisherName: string | null;
  nextDealerId: string | null;
  nextDealerName: string | null;
  finishedAt: string | null;
  scores: RoundScoreEntry[];
}

export interface RoomScoreSummary {
  roomId: string;
  status: string;
  inviteCode: string | null;
  winnerId: string | null;
  winnerName: string | null;
  finishedAt: string | null;
  rounds: RoundSummary[];
  cumulative: Array<{ userId: string; displayName: string; total: number }>;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  gamesPlayed: number;
  gamesWon: number;
  totalScore: number;
  highestRoundScore: number;
  winRate: number;
  updatedAt: string;
}

export interface MatchHistoryEntry {
  id: string;
  roomId: string;
  inviteCode: string | null;
  winnerId: string | null;
  winnerName: string | null;
  roundsPlayed: number;
  finishedAt: string | null;
  myRank: number | null;
  myFinalScore: number | null;
  players: Array<{ userId: string; displayName: string; finalScore: number; rank: number }>;
}

export interface MatchDetail extends MatchHistoryEntry {
  rounds: RoundSummary[];
}
