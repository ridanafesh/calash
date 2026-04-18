import type { AuthResponse, LoginRequest, RegisterRequest } from '@calash/shared';

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
  register: (body: RegisterRequest) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: LoginRequest) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  health: () =>
    request<{ status: string; db: string }>('/api/health', { headers: authHeaders() }),
};
