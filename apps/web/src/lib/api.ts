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

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
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

  getRoom: (id: string) =>
    request<GameRoom>(`/api/rooms/${id}`, { headers: authHeaders() }),

  getRoomByCode: (code: string) =>
    request<GameRoom>(`/api/rooms/join/${code}`, { headers: authHeaders() }),

  // ── Match history ─────────────────────────────────────────────────────────────
  getMatchHistory: () =>
    request<MatchHistoryEntry[]>('/api/history', { headers: authHeaders() }),

  // ── Health ────────────────────────────────────────────────────────────────────
  health: () =>
    request<{ status: string; db: string }>('/api/health', { headers: authHeaders() }),
};

export interface MatchHistoryEntry {
  id: string;
  roomId: string;
  finishedAt: string;
  players: Array<{ userId: string; displayName: string; finalScore: number }>;
  winnerId: string;
}
